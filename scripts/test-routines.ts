/**
 * Rutin katmanı testi: durum mantığı, analiz, öneriler ve (gerçek SQLite ile) eylemler.
 * Çalıştırmak için:  npm run test:routines
 */
import { migrateDbIfNeeded } from '../database/schema';
import {
  addRoutineLog,
  createRoutine,
  getRoutine,
  getTask,
  listDayBlocks,
  listRoutines,
  listVisibleTasks,
} from '../database/repository';
import type { Routine, RoutineBrief, RoutineLog, SleepSummary, TaskStatus } from '../database/types';
import { dayKey } from '../services/activityLogic';
import { dayBounds, planningDay } from '../services/planner';
import {
  acceptRoutine,
  addRoutineFromTemplate,
  markRoutineDone,
  restoreRoutine,
  retireRoutine,
  skipRoutineToday,
  snoozeRoutine,
} from '../services/routineFlow';
import { loadRoutineBriefs } from '../services/routineBriefs';
import {
  availableSnoozeOptions,
  buildRoutineBrief,
  computeRoutineStats,
  dueBriefs,
  formatAskTime,
  routineDayState,
  snoozeTarget,
  suggestForRoutine,
  todayProgress,
} from '../services/routineLogic';
import { CATEGORY_LABEL, ROUTINE_TEMPLATES } from '../services/routineTemplates';
import { completeTask } from '../services/taskFlow';
import { planReminders, reminderSignature } from '../services/routineRemindersLogic';
import { getAuraMessage, getKronosMessage, type CoachContext } from '../services/coachEngine';
import { describeSituation } from '../services/ai/coachAI';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m);
const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  title: 'Sabah yürüyüşü',
  category: 'SAGLIK',
  estimatedDuration: 20,
  cognitiveWeight: 'LOW',
  askHour: 8,
  askMinute: 30,
  status: 'ACTIVE',
  createdAt: new Date(2026, 9, 1).toISOString(),
  retiredAt: null,
  templateId: null,
  ...over,
});
let logSeq = 0;
const log = (
  day: number,
  outcome: RoutineLog['outcome'],
  hour = 9,
  extra: Partial<RoutineLog> = {}
): RoutineLog => ({
  id: `l${(logSeq += 1)}`,
  routineId: 'r1',
  day: dayKey(at(12, 0, day)),
  outcome,
  taskId: null,
  snoozeUntil: null,
  loggedAt: at(hour, 0, day).toISOString(),
  ...extra,
});
const noTask = () => null;

// ───────────── Şablonlar ─────────────
console.log('Örnek rutinler');
check('en az 10 örnek var', ROUTINE_TEMPLATES.length >= 10);
check('örnek id\'leri benzersiz', new Set(ROUTINE_TEMPLATES.map((t) => t.id)).size === ROUTINE_TEMPLATES.length);
check(
  'her örneğin kategorisi, saati ve süresi geçerli',
  ROUTINE_TEMPLATES.every(
    (t) =>
      CATEGORY_LABEL[t.category] !== undefined &&
      t.askHour >= 0 &&
      t.askHour < 22 &&
      t.askMinute >= 0 &&
      t.askMinute < 60 &&
      t.estimatedDuration >= 5
  )
);
check('dört kategori de kullanılıyor', new Set(ROUTINE_TEMPLATES.map((t) => t.category)).size === 4);
check('formatAskTime', formatAskTime(routine()) === '08:30');

// ───────────── Bugünkü durum ─────────────
console.log('Bugünkü durum');
const r = routine();
check('saat gelmeden: bekliyor', routineDayState(r, [], noTask, at(8, 0)).state === 'WAITING');
check('saat gelince: soruluyor', routineDayState(r, [], noTask, at(8, 30)).state === 'DUE');

const snoozed = [log(16, 'SNOOZED', 9, { snoozeUntil: at(10, 0).toISOString() })];
check('ertelendi: süre dolmadan gizli', routineDayState(r, snoozed, noTask, at(9, 30)).state === 'SNOOZED');
check('ertelendi: süre dolunca yeniden soruluyor', routineDayState(r, snoozed, noTask, at(10, 1)).state === 'DUE');
check('bugün değil: atlandı', routineDayState(r, [log(16, 'SKIPPED')], noTask, at(15)).state === 'SKIPPED');
check('yapıldı her şeyi geçer', routineDayState(r, [log(16, 'DONE'), log(16, 'SNOOZED')], noTask, at(15)).state === 'DONE');

const acc = [log(16, 'ACCEPTED', 9, { taskId: 't1' })];
const st = (s: TaskStatus | null) => () => s;
check('kabul + görev açık: kabul edildi', routineDayState(r, acc, st('PENDING'), at(10)).state === 'ACCEPTED');
check('kabul + görev bitti: yapıldı', routineDayState(r, acc, st('COMPLETED'), at(10)).state === 'DONE');
check('kabul + görev ertelendi: atlandı', routineDayState(r, acc, st('POSTPONED'), at(10)).state === 'SKIPPED');
check('kabul + görev silindi: yeniden soruluyor', routineDayState(r, acc, st(null), at(10)).state === 'DUE');
check(
  'görevsiz kabul (gün sonu): kabul edildi',
  routineDayState(r, [log(16, 'ACCEPTED')], noTask, at(23)).state === 'ACCEPTED'
);

// ───────────── Sonra seçenekleri ─────────────
console.log('Sonra seçenekleri');
check('30 dk', snoozeTarget('MIN30', at(10))?.getTime() === at(10, 30).getTime());
check('1 saat', snoozeTarget('HOUR1', at(10))?.getTime() === at(11).getTime());
check('akşam 19:30', snoozeTarget('EVENING', at(10))?.getTime() === at(19, 30).getTime());
check('19:00 sonrası akşam seçeneği yok', snoozeTarget('EVENING', at(19, 5)) === null);
check('yarın: null', snoozeTarget('TOMORROW', at(10)) === null);
check('seçenek listesi sabah: 4', availableSnoozeOptions(at(10)).length === 4);
check('seçenek listesi gece: akşamsız', !availableSnoozeOptions(at(21)).includes('EVENING'));

// ───────────── Analiz ─────────────
console.log('Analiz');
const history: RoutineLog[] = [
  log(10, 'DONE', 9),
  log(11, 'DONE', 9),
  log(12, 'DONE', 9),
  log(13, 'SKIPPED'),
  log(14, 'SNOOZED', 9, { snoozeUntil: at(12, 0, 14).toISOString() }),
  log(15, 'DONE', 18),
  log(16, 'DONE', 9),
];
const stats = computeRoutineStats(r, history, at(20), 14);
check('yapılan gün sayısı', stats.doneDays === 5, JSON.stringify(stats));
check('atlanan gün (cevapsız ertelenen dahil)', stats.skippedDays === 2, JSON.stringify(stats));
check('erteleme sayısı', stats.snoozeCount === 1);
check('başarı oranı 5/7', Math.abs(stats.rate - 5 / 7) < 1e-9);
check('seri: bugün + dün = 2', stats.streak === 2, String(stats.streak));
check('en sık yapılan saat 9', stats.bestHour === 9);
const open = computeRoutineStats(r, [log(16, 'SNOOZED', 9, { snoozeUntil: at(12).toISOString() })], at(10), 14);
check('bugün bitmediyse gün kapanmış sayılmaz', open.closedDays === 0);
const streakFromYesterday = computeRoutineStats(r, [log(14, 'DONE'), log(15, 'DONE')], at(10), 14);
check('bugün yapılmadıysa seri dünden sayılır', streakFromYesterday.streak === 2);
const fewDone = computeRoutineStats(r, [log(15, 'DONE', 7), log(16, 'DONE', 7)], at(20), 14);
check('az veriyle en iyi saat tahmin edilmez', fewDone.bestHour === null);

// ───────────── Öneriler ─────────────
console.log('Öneriler');
const mk = (over: Partial<ReturnType<typeof computeRoutineStats>>) => ({
  closedDays: 7,
  doneDays: 3,
  skippedDays: 3,
  snoozeCount: 0,
  acceptedNotDone: 0,
  rate: 0.4,
  streak: 0,
  bestHour: null,
  ...over,
});
check('çok az tutan rutin: bırakmayı da seçenek yapar', suggestForRoutine(r, mk({ doneDays: 1, skippedDays: 6, snoozeCount: 0 }))?.kind === 'RETIRE');
const move = suggestForRoutine(r, mk({ snoozeCount: 4 }));
check('çok ertelenen: saat önerir', move?.kind === 'MOVE_TIME' && move.hour === 18 && move.minute === 30, JSON.stringify(move));
const moveBest = suggestForRoutine(r, mk({ snoozeCount: 4, bestHour: 19 }));
check('en iyi saat biliniyorsa onu önerir', moveBest?.hour === 19);
const eveningRoutine = routine({ askHour: 20 });
check('akşam rutini sabaha önerilir', suggestForRoutine(eveningRoutine, mk({ snoozeCount: 3 }))?.hour === 9);
const shrink = suggestForRoutine(r, mk({ acceptedNotDone: 3 }));
check('kabul edip yapamayan: süreyi yarıya indirir', shrink?.kind === 'SHRINK' && shrink.minutes === 10, JSON.stringify(shrink));
check('kısa rutin için küçültme önerilmez', suggestForRoutine(routine({ estimatedDuration: 10 }), mk({ acceptedNotDone: 3 })) === null);
check('seri varsa teşvik eder', suggestForRoutine(r, mk({ doneDays: 6, skippedDays: 1, streak: 4 }))?.kind === 'KEEP_GOING');
check('sorun yoksa öneri yok', suggestForRoutine(r, mk({ doneDays: 5, skippedDays: 1 })) === null);
const allText = [move, shrink, suggestForRoutine(r, mk({ doneDays: 1, skippedDays: 6 }))]
  .map((x) => x?.text ?? '')
  .join(' ');
check('öneriler yargılayıcı sözcük içermez', !/(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i.test(allText));

const brief = buildRoutineBrief(r, history, noTask, at(20));
check('özet: durum ve istatistik birlikte', brief.state === 'DONE' && brief.stats.doneDays === 5);
const set = [
  brief,
  buildRoutineBrief(routine({ id: 'r2', askHour: 7 }), [], noTask, at(20)),
  buildRoutineBrief(routine({ id: 'r3', askHour: 6 }), [], noTask, at(20)),
];
check('ilerleme: 1 yapıldı, 2 açık', todayProgress(set).done === 1 && todayProgress(set).open === 2);
check('soru bekleyenler saate göre sıralı', dueBriefs(set).map((b) => b.routine.id).join() === 'r3,r2');

// ───────────── Hatırlatma planı ─────────────
console.log('Hatırlatma planı');
const rb = (id: string, hour: number, state: RoutineBrief['state'], extra: Partial<RoutineBrief> = {}): RoutineBrief => ({
  ...buildRoutineBrief(routine({ id, askHour: hour, askMinute: 0 }), [], noTask, at(7)),
  state,
  ...extra,
});
const morning = planReminders([rb('a', 9, 'WAITING')], at(7), 3);
check('bekleyen rutin: bugün + sonraki günler', morning.length === 3, String(morning.length));
check('ilk bildirim bugün 09:00', morning[0].at.getTime() === at(9).getTime());
const answeredToday = planReminders([rb('a', 9, 'DONE')], at(7), 3);
check('bugün yapıldıysa bugünün bildirimi yok', answeredToday.length === 2 && answeredToday[0].at.getTime() === at(9, 0, 17).getTime());
check('bugün atlandıysa bugünün bildirimi yok', planReminders([rb('a', 9, 'SKIPPED')], at(7), 3).length === 2);
check('bugün kabul edildiyse bugünün bildirimi yok', planReminders([rb('a', 9, 'ACCEPTED')], at(7), 3).length === 2);
check('saati geçen rutin bugün için kurulmaz', planReminders([rb('a', 9, 'DUE')], at(10), 3).length === 2);
const snz = planReminders([rb('a', 9, 'SNOOZED', { snoozeUntil: at(15).toISOString() })], at(11), 2);
check('"sonra" için söz verilen saatte bildirim', snz[0].id.endsWith('-snooze') && snz[0].at.getTime() === at(15).getTime());
check('süresi geçmiş "sonra" bildirimi kurulmaz', planReminders([rb('a', 9, 'SNOOZED', { snoozeUntil: at(10).toISOString() })], at(11), 1).length === 0);
const many = planReminders([rb('a', 9, 'WAITING'), rb('b', 12, 'WAITING')], at(7), 5, 4);
check('üst sınır uygulanır, en yakınlar kalır', many.length === 4 && many[0].at.getTime() <= many[3].at.getTime());
check('bildirim kimlikleri tekil', new Set(planReminders([rb('a', 9, 'WAITING'), rb('b', 9, 'WAITING')], at(7), 5).map((p) => p.id)).size === 10);
check('aynı plan aynı parmak izi', reminderSignature(morning) === reminderSignature(planReminders([rb('a', 9, 'WAITING')], at(7), 3)));
check('bildirim metni yargılamaz', !/(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i.test(morning.map((m) => m.body).join(' ')));
const streakBrief = rb('a', 9, 'WAITING', { stats: { ...brief.stats, streak: 4 } });
check('seri varsa bugünkü bildirim teşvik eder', planReminders([streakBrief], at(7), 2)[0].body.includes('4 gündür'));

// ───────────── Koç entegrasyonu ─────────────
console.log('Koçlar');
const baseCtx = (over: Partial<CoachContext> = {}): CoachContext => ({
  now: at(10, 0),
  user: { id: 'u', chronotype: 'BALANCED', peakStartHour: 9, peakEndHour: 12 },
  tasks: [],
  blocks: [],
  recentLogs: [],
  dayEndHour: 22,
  ...over,
});
const dueOne = rb('a', 9, 'DUE');
const kr = getKronosMessage(baseCtx({ routines: [dueOne] }));
check('boş günde Kronos rutini sorar', kr.headline.startsWith('Rutin zamanı') && kr.body.includes('Yapacağım'));
const krMany = getKronosMessage(baseCtx({ routines: [dueOne, rb('b', 8, 'DUE')] }));
check('birden çok rutin: sayıyı söyler', krMany.headline.startsWith('2 rutin'));
check('cevaplanmış rutin Kronos\'u meşgul etmez', getKronosMessage(baseCtx({ routines: [rb('a', 9, 'DONE')] })).headline === 'Güne hazırım');
const withTask = baseCtx({
  tasks: [
    { id: 't', title: 'Rapor', estimatedDuration: 60, cognitiveWeight: 'HIGH', status: 'IN_PROGRESS', createdAt: at(8).toISOString(), routineId: null } as never,
  ],
  blocks: [{ taskId: 't', startTime: at(9, 30), endTime: at(11, 0) }],
  routines: [dueOne],
});
check('çalışan görev varken rutin onu bölmez', getKronosMessage(withTask).headline.startsWith('Şimdi:'));

const sleepShort: SleepSummary = { lastMinutes: 300, lastBedtime: at(2).toISOString(), lastWake: at(7).toISOString(), avgMinutes: 420, nights: 5 };
const au = getAuraMessage(baseCtx({ sleep: sleepShort }));
check('kısa uyku: Aura nazikçe belirtir', au.headline === 'Kısa bir gece görünüyor' && au.body.includes('tahmin'));
check('kısa uyku akşam gündemde değil', getAuraMessage(baseCtx({ now: at(16), sleep: sleepShort })).headline !== 'Kısa bir gece görünüyor');
check('yeterli uyku: uyarı yok', getAuraMessage(baseCtx({ sleep: { ...sleepShort, lastMinutes: 450 } })).headline !== 'Kısa bir gece görünüyor');

const strugglingBrief = rb('a', 9, 'DUE', { suggestion: { kind: 'MOVE_TIME', text: 'x', hour: 18, minute: 30 } });
const au2 = getAuraMessage(baseCtx({ routines: [strugglingBrief] }));
check('ertelenen rutin: Aura ayarı önerir, suçlamaz', au2.headline.includes('uymuyor') && au2.body.includes('bırakmak da meşru'));
const streakDone = rb('a', 9, 'DONE', { stats: { ...brief.stats, streak: 5 } });
check('seri sürüyorsa Aura takdir eder', getAuraMessage(baseCtx({ routines: [streakDone] })).headline === 'Rutinin yerinde');
const allAura = [au, au2, getAuraMessage(baseCtx({ routines: [streakDone] }))].map((m) => `${m.headline} ${m.body}`).join(' ');
check('Aura yargılayıcı sözcük kullanmaz', !/(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i.test(allAura));
check('Kronos mesajları da sakin kalır', !/(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i.test(`${kr.body} ${krMany.body}`));

const sit = describeSituation(baseCtx({ routines: [dueOne], sleep: sleepShort, shareActivityWithAi: false }));
check('yapay zekâya rutinler her zaman gider', sit.includes('Günlük rutinler') && sit.includes('şimdi cevap bekliyor'));
check('uyku izin yokken yapay zekâya gitmez', !sit.includes('Uyku'));
const sitShared = describeSituation(baseCtx({ sleep: sleepShort, shareActivityWithAi: true, activity: { steps: 100, stepsReliable: true, screenMinutes: 10, topApps: [] } as never }));
check('izin varsa uyku tahmini gider ve tahmin olduğu belirtilir', sitShared.includes('Uyku') && sitShared.includes('kesin değil'));

// ───────────── Veritabanı ve eylemler ─────────────
async function dbTests(): Promise<void> {
  console.log('Eylemler (gerçek SQLite)');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const now = at(10, 0);

  const a = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  const again = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  check('örnekten rutin eklenir', a.title === 'Sabah yürüyüşü' && a.templateId === 'sabah-yuruyus');
  check('aynı örnek iki kez eklenmez', again.id === a.id && (await listRoutines(db)).length === 1);
  let threw = false;
  try {
    await addRoutineFromTemplate(db, 'yok-boyle-bir-sey');
  } catch {
    threw = true;
  }
  check('bilinmeyen örnek hata verir', threw);

  // Yapacağım -> görev + plan
  await acceptRoutine(db, a, now);
  const tasks1 = await listVisibleTasks(db, dayBounds(planningDay(now)).start.toISOString());
  check('"yapacağım" bir görev oluşturur', tasks1.length === 1 && tasks1[0].routineId === a.id);
  const { start, end } = dayBounds(planningDay(now));
  check('görev plana yerleşir', (await listDayBlocks(db, start, end)).length >= 1);
  let briefs = await loadRoutineBriefs(db, now);
  check('durum: kabul edildi', briefs[0].state === 'ACCEPTED');
  await acceptRoutine(db, a, now);
  check(
    'iki kez "yapacağım" görevi çoğaltmaz',
    (await listVisibleTasks(db, start.toISOString())).length === 1
  );

  // Görevi normal akışla bitirmek rutini de yapıldı yapar
  await completeTask(db, tasks1[0], 'HIGH', at(11, 0));
  briefs = await loadRoutineBriefs(db, at(11, 5));
  check('görev bitince rutin "yapıldı" olur', briefs[0].state === 'DONE');
  check('seri ve oran hesaplanır', briefs[0].stats.doneDays === 1 && briefs[0].stats.streak === 1);

  // Sonra / bugün değil / bırak
  const b = await addRoutineFromTemplate(db, 'ogle-yuruyus');
  const until = await snoozeRoutine(db, b, 'MIN30', at(13, 0));
  check('"sonra" yeni saat döndürür', until?.getTime() === at(13, 30).getTime());
  let bb = (await loadRoutineBriefs(db, at(13, 10))).find((x) => x.routine.id === b.id);
  check('süre dolmadan rutin gizli', bb?.state === 'SNOOZED');
  bb = (await loadRoutineBriefs(db, at(13, 31))).find((x) => x.routine.id === b.id);
  check('süre dolunca yeniden sorulur', bb?.state === 'DUE');
  check('"yarın" null döndürür ve bugünü kapatır', (await snoozeRoutine(db, b, 'TOMORROW', at(13, 40))) === null);
  bb = (await loadRoutineBriefs(db, at(14, 0))).find((x) => x.routine.id === b.id);
  check('"yarın" sonrası bugün atlandı', bb?.state === 'SKIPPED');

  const c = await addRoutineFromTemplate(db, 'egzersiz');
  await acceptRoutine(db, c, at(18, 30));
  const taskCount = async () => (await listVisibleTasks(db, start.toISOString())).filter((t) => t.routineId === c.id).length;
  check('egzersiz görevi eklendi', (await taskCount()) === 1);
  await skipRoutineToday(db, c, at(18, 40));
  check('bugün değil: açık görev plandan çıkar', (await taskCount()) === 0);
  check('bugün değil: durum atlandı', (await loadRoutineBriefs(db, at(19))).find((x) => x.routine.id === c.id)?.state === 'SKIPPED');

  const d = await addRoutineFromTemplate(db, 'dil-calis');
  await acceptRoutine(db, d, at(19, 0));
  await retireRoutine(db, d, at(19, 5));
  check('bir daha yapmam: aktif listeden çıkar', !(await listRoutines(db)).some((x) => x.id === d.id));
  check('bırakılan rutin saklanır', (await listRoutines(db, 'RETIRED')).some((x) => x.id === d.id));
  check('bırakılan rutinin açık görevi silinir', (await listVisibleTasks(db, start.toISOString())).every((t) => t.routineId !== d.id));
  await restoreRoutine(db, d.id);
  check('geri alınca yeniden aktif olur', (await getRoutine(db, d.id))?.status === 'ACTIVE');

  // Yaptım (görev olmadan ve görevle)
  const e = await addRoutineFromTemplate(db, 'kitap-oku');
  await markRoutineDone(db, e, at(20, 45));
  check('"yaptım" bugünü kapatır', (await loadRoutineBriefs(db, at(21))).find((x) => x.routine.id === e.id)?.state === 'DONE');
  await markRoutineDone(db, e, at(20, 50));
  const doneCount = (raw.prepare("SELECT COUNT(*) AS n FROM RoutineLog WHERE routineId = ? AND outcome = 'DONE'").get(e.id) as { n: number }).n;
  check('iki kez "yaptım" tek kayıt yazar', doneCount === 1);

  const f = await addRoutineFromTemplate(db, 'gunu-planla');
  await acceptRoutine(db, f, at(8, 20));
  await markRoutineDone(db, f, at(8, 40));
  const fTask = (await listVisibleTasks(db, start.toISOString())).find((t) => t.routineId === f.id);
  check('"yaptım": kabul edilen görev kapanır', fTask === undefined || (await getTask(db, fTask.id))?.status === 'COMPLETED');

  // Gün sonu kabulü görev yaratmaz
  const g = await addRoutineFromTemplate(db, 'uyku-hazirligi');
  const before = (raw.prepare('SELECT COUNT(*) AS n FROM Task').get() as { n: number }).n;
  await acceptRoutine(db, g, at(22, 30));
  const after = (raw.prepare('SELECT COUNT(*) AS n FROM Task').get() as { n: number }).n;
  check('22:00 sonrası "yapacağım" yarının planını kirletmez', before === after);
  check('görevsiz kabul: durum kabul edildi', (await loadRoutineBriefs(db, at(22, 31))).find((x) => x.routine.id === g.id)?.state === 'ACCEPTED');
  await markRoutineDone(db, g, at(23, 0));
  check('görevsiz kabul sonra "yaptım" olur', (await loadRoutineBriefs(db, at(23, 1))).find((x) => x.routine.id === g.id)?.state === 'DONE');

  // Geçmişten öneri: sürekli ertelenen rutin
  const h = await createRoutine(db, {
    title: 'Test rutini',
    category: 'ODAK',
    estimatedDuration: 40,
    cognitiveWeight: 'MEDIUM',
    askHour: 9,
  });
  raw.prepare('UPDATE Routine SET createdAt = ? WHERE id = ?').run(new Date(2026, 9, 1).toISOString(), h.id);
  for (const day of [12, 13, 14, 15]) {
    await addRoutineLog(db, {
      routineId: h.id,
      day: dayKey(at(12, 0, day)),
      outcome: 'SNOOZED',
      snoozeUntil: at(15, 0, day),
      loggedAt: at(9, 0, day),
    });
  }
  const hb = (await loadRoutineBriefs(db, at(10))).find((x) => x.routine.id === h.id);
  check('geçmişten "saati değiştir" önerisi çıkar', hb?.suggestion?.kind === 'MOVE_TIME', JSON.stringify(hb?.suggestion));

  // Rutin silinince kayıtlar gider, görev kalır
  raw.exec('PRAGMA foreign_keys = ON');
  raw.prepare('DELETE FROM Routine WHERE id = ?').run(h.id);
  const orphan = (raw.prepare('SELECT COUNT(*) AS n FROM RoutineLog WHERE routineId = ?').get(h.id) as { n: number }).n;
  check('rutin silinince kayıtları da silinir', orphan === 0);
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
