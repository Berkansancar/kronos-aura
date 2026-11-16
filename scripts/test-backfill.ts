/**
 * Takvimden sonradan işaretleme testi (geçmiş günü "yaptım" yapma, geri alma, kilitli kayıtlar).
 * Çalıştırmak için:  npm run test:backfill
 */
import { createRoutine, getTask, listRoutineLogsSince, listRoutines } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { buildMonth, dayDetail, lockedDone, summarize } from '../services/habitCalendarLogic';
import { loadHabitScreen } from '../services/habits';
import { acceptRoutine, markRoutineDoneOnDay, unmarkRoutineDay } from '../services/routineFlow';
import { computeRoutineStats } from '../services/routineLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const at = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

async function main(): Promise<void> {
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const walk = await createRoutine(db, { title: 'Yürüyüş', category: 'SAGLIK', estimatedDuration: 20, cognitiveWeight: 'LOW', askHour: 18, askMinute: 30 });
  const sunOnly = await createRoutine(db, { title: 'Pazar planı', category: 'ODAK', estimatedDuration: 20, cognitiveWeight: 'MEDIUM', askHour: 10, days: '0' });
  const NOW = at(16, 12);

  console.log('Geçmiş günü işaretleme');
  check('geçmiş gün işaretlenir', (await markRoutineDoneOnDay(db, walk, day(12), NOW)) === true);
  const logs = (await listRoutineLogsSince(db, day(12))).filter((l) => l.day === day(12) && l.routineId === walk.id);
  check('tek DONE kaydı, göreve bağlı değil', logs.length === 1 && logs[0].outcome === 'DONE' && logs[0].taskId === null);
  check('kayıt saati rutinin sorulma saati (18:30)', new Date(logs[0].loggedAt).getHours() === 18 && new Date(logs[0].loggedAt).getMinutes() === 30);
  check('ikinci kez işaretlenmez', (await markRoutineDoneOnDay(db, walk, day(12), NOW)) === false && (await listRoutineLogsSince(db, day(12))).filter((l) => l.day === day(12) && l.routineId === walk.id).length === 1);
  let threw = false;
  try {
    await markRoutineDoneOnDay(db, walk, day(17), NOW);
  } catch {
    threw = true;
  }
  check('gelecek gün işaretlenemez', threw);

  console.log('Takvime ve seriye yansıma');
  await markRoutineDoneOnDay(db, walk, day(13), NOW);
  await markRoutineDoneOnDay(db, walk, day(14), NOW);
  const routines = await listRoutines(db, 'ACTIVE');
  const all = await listRoutineLogsSince(db, day(1));
  const m = buildMonth('2026-11', routines, all, [], NOW);
  const cell = (d: number) => (m.weeks.flat().filter(Boolean) as NonNullable<(typeof m.weeks)[number][number]>[]).find((c) => c.day === day(d))!;
  check('işaretlenen günler takvimde dolu', cell(12).done === 1 && cell(13).done === 1 && cell(14).done === 1 && cell(15).done === 0);
  check('seri güncellenir: 12-14 üç gün (15 henüz yapılmadı, 16 bugün)', summarize('2026-11', all, NOW).bestStreak === 3);
  const stats = computeRoutineStats(walk, all, at(15, 9), 14);
  check('rutin istatistiği: 12-14 yapıldı, seri 3', stats.doneDays === 3 && stats.streak === 3);
  const screen = await loadHabitScreen(db, '2026-11', NOW);
  check('ekran verisi aynı sonucu verir', screen.summary.doneDays === 3);

  console.log('Bugünü işaretleme');
  await acceptRoutine(db, walk, at(16, 9));
  const taskLogs = (await listRoutineLogsSince(db, day(16))).filter((l) => l.day === day(16) && l.routineId === walk.id && l.taskId);
  const taskId = taskLogs[0].taskId as string;
  check('bugün "yapacağım" ile görev oluştu', (await getTask(db, taskId))?.status !== 'COMPLETED');
  check('bugün işaretlenince görev de kapanır', (await markRoutineDoneOnDay(db, walk, day(16), at(16, 12))) === true && (await getTask(db, taskId))?.status === 'COMPLETED');
  check('bugün ikinci kez işaretlenmez', (await markRoutineDoneOnDay(db, walk, day(16), at(16, 12))) === false);

  console.log('Geri alma');
  check('takvimden eklenen geri alınır', (await unmarkRoutineDay(db, walk.id, day(13))) === 'REMOVED');
  check('geri alınan gün boşalır', !(await listRoutineLogsSince(db, day(13))).some((l) => l.day === day(13) && l.routineId === walk.id && l.outcome === 'DONE'));
  check('işaretli olmayan gün: NONE', (await unmarkRoutineDay(db, walk.id, day(13))) === 'NONE');
  check('göreve bağlı kayıt kilitli: geri alınamaz', (await unmarkRoutineDay(db, walk.id, day(16))) === 'LOCKED' && (await listRoutineLogsSince(db, day(16))).some((l) => l.day === day(16) && l.outcome === 'DONE'));
  const after = await listRoutineLogsSince(db, day(1));
  check('kilitli kümesi doğru', lockedDone(day(16), after).has(walk.id) && !lockedDone(day(12), after).has(walk.id));
  await markRoutineDoneOnDay(db, walk, day(13), NOW);
  check('geri alınan gün yeniden işaretlenebilir', (await listRoutineLogsSince(db, day(13))).some((l) => l.day === day(13) && l.outcome === 'DONE'));

  console.log('Planlı olmayan gün');
  const all2 = await listRoutineLogsSince(db, day(1));
  const mon = dayDetail(day(16), routines, all2);
  check('Pazartesi ayrıntısı: Pazar rutini yapılmayanlarda yok', mon.notDone.every((r) => r.id !== sunOnly.id));
  const sun = dayDetail(day(15), routines, all2);
  check('Pazar ayrıntısı: Pazar rutini yapılmayanlarda var', sun.notDone.some((r) => r.id === sunOnly.id));
  await markRoutineDoneOnDay(db, sunOnly, day(16), NOW);
  const mon2 = dayDetail(day(16), routines, await listRoutineLogsSince(db, day(1)));
  check('planlı olmayan günde yapıldıysa yapılanlarda görünür', mon2.done.some((r) => r.id === sunOnly.id));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
