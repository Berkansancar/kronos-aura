/**
 * Bildirimden rutin cevabı testi (düğmeler, ayrıştırma, karar, kuyruk, kayıt, hatırlatma planı).
 * Çalıştırmak için:  npm run test:notifyactions
 */
import { createRoutine, getTask, listRoutineLogsSince } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { drainActions, enqueueAction, resetActionQueue, subscribeActions } from '../services/notificationActionQueue';
import { runRoutineAction } from '../services/routineActions';
import {
  ROUTINE_ACTIONS,
  ROUTINE_CATEGORY,
  actionKey,
  decideAction,
  isStale,
  parseRoutineAction,
  toMs,
} from '../services/routineActionLogic';
import { loadRoutineBriefs } from '../services/routineBriefs';
import { planReminders } from '../services/routineRemindersLogic';
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
  console.log('Düğmeler ve ayrıştırma');
  check('üç düğme, benzersiz kimlikli', ROUTINE_ACTIONS.length === 3 && new Set(ROUTINE_ACTIONS.map((a) => a.identifier)).size === 3 && ROUTINE_CATEGORY.length > 0);
  check('Yaptım ayrıştırılır', JSON.stringify(parseRoutineAction('rtn-done', { routineId: 'r1', day: day(16) })) === JSON.stringify({ routineId: 'r1', day: day(16), kind: 'DONE' }));
  check('Yapacağım / Bugün değil ayrıştırılır', parseRoutineAction('rtn-accept', { routineId: 'r1' })?.kind === 'ACCEPT' && parseRoutineAction('rtn-skip', { routineId: 'r1' })?.kind === 'SKIP');
  check('gün yoksa null (bugün sayılır)', parseRoutineAction('rtn-done', { routineId: 'r1' })?.day === null);
  check('bozuk gün atılır', parseRoutineAction('rtn-done', { routineId: 'r1', day: 'dün' })?.day === null);
  check('varsayılan dokunuş (düğme değil) null', parseRoutineAction('expo.modules.notifications.actions.DEFAULT', { routineId: 'r1' }) === null);
  check('rutin kimliği yoksa null', parseRoutineAction('rtn-done', { route: '/review' }) === null && parseRoutineAction('rtn-done', null) === null && parseRoutineAction('rtn-done', { routineId: '' }) === null);
  check('anahtar bildirim+düğme+tarih', actionKey('rtn-a-1', 'rtn-done', 1000.4) === 'rtn-a-1|rtn-done|1000');
  check('saniye cinsi tarih milisaniyeye çevrilir', toMs(1_700_000_000) === 1_700_000_000_000 && toMs(1_700_000_000_000) === 1_700_000_000_000);
  const now = at(16, 12).getTime();
  check('eski cevap (36 saatten eski) işlenmez', isStale(now - 40 * 3_600_000, now) && !isStale(now - 5 * 3_600_000, now));
  check('okunamayan tarih eski sayılmaz', !isStale(NaN, now));

  console.log('Karar');
  const T = 'Yürüyüş';
  check('Yaptım: açık rutin bugün yapılır', decideAction('DONE', 'DUE', day(16), day(16), T).run === 'DONE_TODAY');
  check('Yaptım: zaten yapılmışsa dokunmaz', decideAction('DONE', 'DONE', day(16), day(16), T).run === 'NONE');
  check('Yaptım: dünkü bildirim dünü işaretler', decideAction('DONE', 'DUE', day(15), day(16), T).run === 'DONE_PAST');
  check('Yaptım: gelecek gün reddedilir', decideAction('DONE', 'DUE', day(17), day(16), T).run === 'NONE');
  check('Yapacağım: açık rutin kabul edilir', decideAction('ACCEPT', 'DUE', day(16), day(16), T).run === 'ACCEPT');
  check('Yapacağım: henüz sorulma saati gelmemişken de çalışır (WAITING)', decideAction('ACCEPT', 'WAITING', day(16), day(16), T).run === 'ACCEPT' && decideAction('DONE', 'WAITING', day(16), day(16), T).run === 'DONE_TODAY');
  check('Yapacağım: sonra denmişse de kabul edilir', decideAction('ACCEPT', 'SNOOZED', null, day(16), T).run === 'ACCEPT');
  check('Yapacağım: zaten kabulse / yapılmışsa dokunmaz', decideAction('ACCEPT', 'ACCEPTED', null, day(16), T).run === 'NONE' && decideAction('ACCEPT', 'DONE', null, day(16), T).run === 'NONE');
  check('Yapacağım: geçmiş gün için plan yapılmaz', decideAction('ACCEPT', 'DUE', day(15), day(16), T).run === 'NONE');
  check('Bugün değil: açık rutin geçilir', decideAction('SKIP', 'DUE', day(16), day(16), T).run === 'SKIP');
  check('Bugün değil: yapılmış rutini bozmaz', decideAction('SKIP', 'DONE', day(16), day(16), T).run === 'NONE');
  check('Bugün değil: zaten geçilmişse dokunmaz', decideAction('SKIP', 'SKIPPED', null, day(16), T).run === 'NONE');
  check('planlı olmayan günde (OFF) dokunmaz', decideAction('ACCEPT', 'OFF', null, day(16), T).run === 'NONE' && decideAction('SKIP', 'OFF', null, day(16), T).run === 'NONE');
  const skipMsg = decideAction('SKIP', 'DUE', null, day(16), T).message;
  check('geçme mesajı yargısız', skipMsg.includes('Sorun değil') && !/kötü|başarısız|boşa|yetersiz/i.test(skipMsg));

  console.log('Kuyruk');
  resetActionQueue();
  let notified = 0;
  const unsub = subscribeActions(() => {
    notified += 1;
  });
  const act = { routineId: 'r1', day: day(16), kind: 'DONE' as const };
  check('ilk cevap kuyruğa girer ve haber verir', enqueueAction({ key: 'k1', action: act }) === true && notified === 1);
  check('aynı anahtar ikinci kez girmez', enqueueAction({ key: 'k1', action: act }) === false && notified === 1);
  enqueueAction({ key: 'k2', action: { ...act, kind: 'SKIP' } });
  const drained = drainActions();
  check('kuyruk sırayla boşalır', drained.map((d) => d.key).join() === 'k1,k2' && drainActions().length === 0);
  check('boşalan anahtar yeniden girmez (oturum içi)', enqueueAction({ key: 'k1', action: act }) === false);
  unsub();
  enqueueAction({ key: 'k3', action: act });
  check('abonelik bırakılınca haber gitmez', notified === 2 && drainActions().length === 1);

  console.log('Kayıt');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const mk = (title: string, hour: number, days: string | null = null) =>
    createRoutine(db, { title, category: 'SAGLIK', estimatedDuration: 15, cognitiveWeight: 'LOW', askHour: hour, askMinute: 0, days });
  const walk = await mk('Yürüyüş', 18);
  const read = await mk('Kitap', 21);
  const sunday = await mk('Pazar planı', 10, '0');
  const NOW = at(16, 12); // Pazartesi öğle
  const logsOf = async (id: string, d: number) => (await listRoutineLogsSince(db, day(d))).filter((l) => l.routineId === id && l.day === day(d));

  let r = await runRoutineAction(db, { routineId: walk.id, day: day(16), kind: 'DONE' }, NOW);
  check('Yaptım: kayıt yazılır', r.changed && (await logsOf(walk.id, 16)).some((l) => l.outcome === 'DONE') && r.message.includes('yapıldı'));
  r = await runRoutineAction(db, { routineId: walk.id, day: day(16), kind: 'DONE' }, NOW);
  check('Yaptım ikinci kez: değişmez, tek kayıt', !r.changed && (await logsOf(walk.id, 16)).filter((l) => l.outcome === 'DONE').length === 1);
  r = await runRoutineAction(db, { routineId: walk.id, day: day(16), kind: 'SKIP' }, NOW);
  check('yapılmış rutin sonradan "Bugün değil" ile bozulmaz', !r.changed && !(await logsOf(walk.id, 16)).some((l) => l.outcome === 'SKIPPED'));

  r = await runRoutineAction(db, { routineId: read.id, day: day(16), kind: 'ACCEPT' }, NOW);
  const acceptLog = (await logsOf(read.id, 16)).find((l) => l.outcome === 'ACCEPTED');
  check('Yapacağım: kabul kaydı ve görev', r.changed && !!acceptLog && !!acceptLog.taskId && (await getTask(db, acceptLog.taskId)) !== null);
  r = await runRoutineAction(db, { routineId: read.id, day: day(16), kind: 'ACCEPT' }, NOW);
  check('Yapacağım ikinci kez: değişmez', !r.changed);
  r = await runRoutineAction(db, { routineId: read.id, day: day(16), kind: 'DONE' }, at(16, 21, 30));
  check('kabul edilmiş rutin sonra "Yaptım" ile tamamlanır', r.changed && (await logsOf(read.id, 16)).some((l) => l.outcome === 'DONE'));

  const walk2 = await mk('Esneme', 8);
  r = await runRoutineAction(db, { routineId: walk2.id, day: day(16), kind: 'SKIP' }, NOW);
  check('Bugün değil: SKIPPED yazılır', r.changed && (await logsOf(walk2.id, 16)).some((l) => l.outcome === 'SKIPPED'));
  r = await runRoutineAction(db, { routineId: walk2.id, day: day(16), kind: 'SKIP' }, NOW);
  check('Bugün değil ikinci kez: değişmez', !r.changed);

  r = await runRoutineAction(db, { routineId: sunday.id, day: day(16), kind: 'ACCEPT' }, NOW);
  check('Pazar rutini Pazartesi kabul edilmez', !r.changed && r.message.includes('planlı değil'));

  const water = await mk('Su iç', 10);
  r = await runRoutineAction(db, { routineId: water.id, day: day(15), kind: 'DONE' }, NOW);
  check('dünkü bildirimden Yaptım dünü işaretler', r.changed && (await logsOf(water.id, 15)).some((l) => l.outcome === 'DONE') && !(await logsOf(water.id, 16)).some((l) => l.outcome === 'DONE'));
  r = await runRoutineAction(db, { routineId: water.id, day: day(15), kind: 'DONE' }, NOW);
  check('aynı gün ikinci kez işaretlenmez', !r.changed && (await logsOf(water.id, 15)).filter((l) => l.outcome === 'DONE').length === 1);
  r = await runRoutineAction(db, { routineId: water.id, day: day(15), kind: 'SKIP' }, NOW);
  check('dünkü bildirimden "Bugün değil" bugüne dokunmaz', !r.changed && !(await logsOf(water.id, 16)).some((l) => l.outcome === 'SKIPPED'));
  r = await runRoutineAction(db, { routineId: 'yok', day: null, kind: 'DONE' }, NOW);
  check('olmayan rutin: nazik mesaj', !r.changed && r.message.includes('aktif değil'));
  const briefs = await loadRoutineBriefs(db, NOW);
  check('durumlar ana ekranla tutarlı', briefs.find((b) => b.routine.id === walk.id)?.state === 'DONE' && briefs.find((b) => b.routine.id === walk2.id)?.state === 'SKIPPED');

  console.log('Hatırlatma planı');
  const plan = planReminders(await loadRoutineBriefs(db, at(17, 6)), at(17, 6), 3, 60, { review: true, morning: { hour: 8, minute: 0 } });
  const routineOnes = plan.filter((p) => p.routineId);
  check('rutin hatırlatmaları rutin kimliği ve günü taşır', routineOnes.length > 0 && routineOnes.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day ?? '') && p.id.includes(p.routineId)));
  check('gün, bildirimin kendi günüdür', routineOnes.every((p) => p.day === `${p.at.getFullYear()}-${String(p.at.getMonth() + 1).padStart(2, '0')}-${String(p.at.getDate()).padStart(2, '0')}`));
  check('rutin olmayanlarda (gün sonu, sabah) rutin kimliği yok → düğme çıkmaz', plan.filter((p) => !p.routineId).length > 0 && plan.filter((p) => !p.routineId).every((p) => p.day === undefined));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
