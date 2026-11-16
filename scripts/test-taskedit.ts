/**
 * Görev düzenleme ve yanlış işareti geri alma testi.
 * Çalıştırmak için:  npm run test:taskedit
 */
import {
  addRoutineLog,
  createRoutine,
  createTask,
  getTask,
  listRecentLogs,
  listRoutineLogsSince,
  listTaskOutcomes,
  listTaskOutcomesSince,
} from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { completeTask, markTaskMissed, undoOutcome, updateTaskDetails, carryOverMissed } from '../services/taskFlow';
import { gatherHistory } from '../services/history';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

async function main(): Promise<void> {
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);

  console.log('Görevi düzenle');
  const t = await createTask(db, { title: 'Rapor', estimatedDuration: 30, cognitiveWeight: 'LOW' });
  await updateTaskDetails(db, t.id, { title: '  Haftalık rapor  ', estimatedDuration: 90, cognitiveWeight: 'HIGH', workOk: true }, at(10));
  let g = await getTask(db, t.id);
  check('ad kırpılır, süre, yük ve iş vakti işareti değişir', g?.title === 'Haftalık rapor' && g.estimatedDuration === 90 && g.cognitiveWeight === 'HIGH' && g.workOk === true, JSON.stringify(g));
  await updateTaskDetails(db, t.id, { title: 'Haftalık rapor', estimatedDuration: 2, cognitiveWeight: 'MEDIUM' }, at(10));
  g = await getTask(db, t.id);
  check('süre en az 5 dk; işaret verilmezse iş vakti işareti korunur', g?.estimatedDuration === 5 && g.workOk === true && g.cognitiveWeight === 'MEDIUM');
  let err = '';
  await updateTaskDetails(db, t.id, { title: '   ', estimatedDuration: 30, cognitiveWeight: 'LOW' }, at(10)).catch((e) => (err = e.message));
  g = await getTask(db, t.id);
  check('boş ad reddedilir, görev değişmez', /boş olamaz/.test(err) && g?.title === 'Haftalık rapor');
  check('durum, oluşturulma ve rutin bağı değişmez', g?.status !== undefined && g.createdAt === t.createdAt && g.routineId === null);

  console.log('"Yaptım"ı geri al');
  const r = await createRoutine(db, { title: 'Yürüyüş', category: 'SAGLIK', estimatedDuration: 20, cognitiveWeight: 'LOW', askHour: 18, askMinute: 0 });
  const rt = await createTask(db, { title: 'Yürüyüş', estimatedDuration: 20, cognitiveWeight: 'LOW', routineId: r.id });
  await completeTask(db, rt, 'HIGH', at(19, 30), { loggedAt: at(19, 30), minutes: 25 });
  const done = (await getTask(db, rt.id))!;
  check('önce tamam: durum, süre kaydı, sonuç, rutin cevabı var',
    done.status === 'COMPLETED' && (await listRecentLogs(db, 10)).some((l) => l.taskId === rt.id) &&
    (await listTaskOutcomes(db, day(16))).some((o) => o.taskId === rt.id && o.outcome === 'DONE') &&
    (await listRoutineLogsSince(db, day(1))).some((l) => l.taskId === rt.id && l.outcome === 'DONE'));
  const other = await createTask(db, { title: 'Başka', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  await completeTask(db, other, 'HIGH', at(19, 40), { loggedAt: at(19, 40), minutes: 10 });
  const res = await undoOutcome(db, done, at(20, 0));
  const back = (await getTask(db, rt.id))!;
  check('geri alınca görev bekleyen olur, başlangıç zamanı temizlenir', res === 'DONE' && back.status === 'PENDING' && back.startedAt === null);
  check('süre kaydı, sonuç kaydı ve rutindeki "yaptım" silinir',
    !(await listRecentLogs(db, 10)).some((l) => l.taskId === rt.id) &&
    !(await listTaskOutcomes(db, day(16))).some((o) => o.taskId === rt.id) &&
    !(await listRoutineLogsSince(db, day(1))).some((l) => l.taskId === rt.id && l.outcome === 'DONE'));
  check('başka görevin kayıtlarına dokunulmaz',
    (await listRecentLogs(db, 10)).some((l) => l.taskId === other.id) && (await listTaskOutcomes(db, day(16))).some((o) => o.taskId === other.id));
  const h = await gatherHistory(db, at(21, 0), 7);
  check('geçmiş grafiği geri alınanı saymaz (yalnızca 10 dk kalır)', h.days[h.days.length - 1].taskMinutes === 10 && h.days[h.days.length - 1].tasksDone === 1, JSON.stringify(h.days[h.days.length - 1]));
  await completeTask(db, back, 'HIGH', at(20, 30), { loggedAt: at(20, 30), minutes: 15 });
  check('geri alınan görev yeniden bitirilebilir (tek kayıt)', (await listTaskOutcomes(db, day(16))).filter((o) => o.taskId === rt.id).length === 1 && (await getTask(db, rt.id))?.status === 'COMPLETED');

  console.log('"Yapmadım / Yapamadım"ı geri al');
  const m = await createTask(db, { title: 'Arama', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  await markTaskMissed(db, m, 'COULD_NOT', 'WORK', at(21, 0), { at: at(21, 0) });
  check('önce: ertelenmiş ve sonuç kaydı var', (await getTask(db, m.id))?.status === 'POSTPONED' && (await listTaskOutcomes(db, day(16))).some((o) => o.taskId === m.id));
  const res2 = await undoOutcome(db, (await getTask(db, m.id))!, at(21, 5));
  check('geri alınca bekleyen olur, sonuç kaydı silinir', res2 === 'MISSED' && (await getTask(db, m.id))?.status === 'PENDING' && !(await listTaskOutcomes(db, day(16))).some((o) => o.taskId === m.id));
  check('geçmişteki "yapamadım" sayısı da düşer', !(await listTaskOutcomesSince(db, day(1))).some((o) => o.taskId === m.id));

  // Kayıtsız ertelenen: geri alınacak sonuç yok
  const p = await createTask(db, { title: 'Elle ertelenen', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  raw.prepare("UPDATE Task SET status = 'POSTPONED' WHERE id = ?").run(p.id);
  check('sonuç kaydı olmayan ertelenmiş görev: null (çağıran "plana al"a düşer)', (await undoOutcome(db, (await getTask(db, p.id))!, at(21, 6))) === null);
  check('bekleyen görevde de null, hiçbir şey değişmez', (await undoOutcome(db, (await getTask(db, t.id))!, at(21, 6))) === null);

  // Dünün kaydı ve yarına taşınmış kayıt korunur
  const y = await createTask(db, { title: 'Dünkü iş', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  await markTaskMissed(db, y, 'NOT_DONE', null, at(21, 0, 15), { at: at(21, 0, 15) });
  // 16'sında sabah, yarına taşıma çalışır
  await carryOverMissed(db, at(9, 0, 16));
  check('dünkü kayıt yarına taşındı (görev bekleyen)', (await getTask(db, y.id))?.status === 'PENDING');
  raw.prepare("UPDATE Task SET status = 'POSTPONED' WHERE id = ?").run(y.id); // bugün elle erteledi
  const res3 = await undoOutcome(db, (await getTask(db, y.id))!, at(9, 5, 16));
  check('dünün (taşınmış) kaydı silinmez; null döner', res3 === null && (await listTaskOutcomesSince(db, day(15))).some((o) => o.taskId === y.id && o.day === day(15)));
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
