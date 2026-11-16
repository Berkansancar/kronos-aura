/**
 * Hafta planı testi (veritabanı v11, güne ayırma, kapasite, otomatik dağıtım, Pazar önerisi).
 * Çalıştırmak için:  npm run test:weekplan
 */
import { createTask, getTask, listVisibleTasks, updateTask } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { hasBannedWords } from '../services/dayReviewLogic';
import { dayBounds, planningDay, replanDay } from '../services/planner';
import { applyAssignments, countParked, loadWeek, moveTaskToDay, pullAllToToday, suggestWeek } from '../services/weekPlan';
import {
  FILL_RATIO,
  assignmentSummary,
  autoDistribute,
  buildWeekPlan,
  dayCapacity,
  dayLine,
  isHeavy,
  moveTargets,
  remainingFreeToday,
  type WeekTask,
} from '../services/weekPlanLogic';
import { PERSONAL_WORK } from '../services/workLogic';
import { ensureWorkSeed } from '../services/workSettings';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// 16 Kasım 2026 Pazartesi
const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const key = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const wt = (id: string, minutes: number, weight: WeekTask['cognitiveWeight'] = 'LOW', over: Partial<WeekTask> = {}): WeekTask => ({
  id,
  title: `İş ${id}`,
  estimatedDuration: minutes,
  cognitiveWeight: weight,
  status: 'PENDING',
  plannedDay: null,
  ...over,
});

async function main(): Promise<void> {
  console.log('Kapasite');
  check('Pazar: uyanık 16 sa, hepsi boş', dayCapacity(null) === 960);
  check('hafta içi 07:40–18:00: 16 sa − 10 sa 20 dk − 90 dk yol/hazırlık = 4 sa 10 dk', dayCapacity({ startMin: 460, endMin: 1080 }) === 250);
  check('Cumartesi 08:30–13:30: 9 sa 30 dk', dayCapacity({ startMin: 510, endMin: 810 }) === 570);
  check('bugün: sabah 06:00 Pzt → iş + yol düşülür', remainingFreeToday(at(6), { startMin: 460, endMin: 1080 }) === 960 - 620 - 90);
  check('bugün: 19:00 iş bitmiş → 4 saat', remainingFreeToday(at(19), { startMin: 460, endMin: 1080 }) === 240);
  check('bugün: 23:30 → 0', remainingFreeToday(at(23, 30), null) === 0);
  check('ağır iş: odak isteyen ya da 45 dk ve üstü', isHeavy({ cognitiveWeight: 'HIGH', estimatedDuration: 10 }) && isHeavy({ cognitiveWeight: 'LOW', estimatedDuration: 45 }) && !isHeavy({ cognitiveWeight: 'LOW', estimatedDuration: 44 }));

  console.log('Hafta görünümü');
  const today = new Date(2026, 10, 16);
  const tasks: WeekTask[] = [wt('a', 30), wt('b', 60, 'HIGH', { plannedDay: key(22) }), wt('c', 20, 'LOW', { plannedDay: key(18) }), wt('d', 15, 'LOW', { status: 'COMPLETED' })];
  const plan = buildWeekPlan({ now: at(6), today, work: PERSONAL_WORK, tasks });
  check('7 gün, bugünden başlar', plan.length === 7 && plan[0].key === key(16) && plan[6].key === key(22));
  check('etiketler', plan[0].label === 'Bugün' && plan[1].label === 'Yarın' && plan[2].label === 'Çarşamba' && plan[5].label === 'Cumartesi' && plan[6].label === 'Pazar');
  check('gün türleri: Pzt–Cum iş, Cmt yarım gün, Pazar boş', plan[0].kind === 'WORK' && plan[5].kind === 'HALF' && plan[6].kind === 'FREE' && plan[6].workText === 'Boş gün' && plan[5].workText === '08:30–13:30');
  check('işler günlere göre: bugün a, Çarşamba c, Pazar b; bitenler yok', plan[0].tasks.map((t) => t.id).join() === 'a' && plan[2].tasks.map((t) => t.id).join() === 'c' && plan[6].tasks.map((t) => t.id).join() === 'b' && plan.every((d) => !d.tasks.some((t) => t.id === 'd')));
  check('Pazar boş zamanı 16 sa; ağır iş işaretli', plan[6].freeMinutes === 960 && plan[6].tasks[0].heavy && dayLine(plan[6]) === 'Boş gün · ≈ 16 sa boş · 1 iş (1 sa)', dayLine(plan[6]));
  check('rahat / dolu', plan[6].load === 'ROOMY' && buildWeekPlan({ now: at(6), today, work: PERSONAL_WORK, tasks: [wt('x', 200, 'LOW', { plannedDay: key(17) })] })[1].load === 'FULL');
  check('iş saatleri kapalıysa her gün boş gün sayılır', buildWeekPlan({ now: at(6), today, work: { ...PERSONAL_WORK, enabled: false }, tasks: [] }).every((d) => d.kind === 'FREE'));
  check('geçmiş güne ayrılmış iş bugünün listesine düşer', buildWeekPlan({ now: at(6), today, work: PERSONAL_WORK, tasks: [wt('e', 10, 'LOW', { plannedDay: key(10) })] })[0].tasks.length === 1);
  check('taşıma hedefleri bugünden sonraki 6 gün', moveTargets(plan).length === 6 && moveTargets(plan)[0].label === 'Yarın' && moveTargets(plan)[1].label === 'Çar');

  console.log('Otomatik dağıtım');
  const backlog: WeekTask[] = [
    wt('r1', 90, 'HIGH'), // rapor
    wt('r2', 60, 'MEDIUM'), // ağır (60 dk)
    wt('k1', 10),
    wt('k2', 15),
    wt('k3', 20),
    wt('p1', 30, 'LOW', { status: 'POSTPONED' }),
    wt('ip', 40, 'LOW', { status: 'IN_PROGRESS' }),
  ];
  const p2 = buildWeekPlan({ now: at(8), today, work: PERSONAL_WORK, tasks: backlog });
  const asg = autoDistribute(p2, backlog);
  const to = (id: string) => asg.find((a) => a.taskId === id)?.day;
  check('başlanmış işe dokunulmaz', to('ip') === undefined);
  check('odak isteyen/uzun işler Pazar\'a gider', to('r1') === key(22) && to('r2') === key(22), JSON.stringify(asg.filter((a) => /r/.test(a.taskId))));
  check('kısa işler bugüne/yakın güne sığdıkça orada kalır', ['k1', 'k2', 'k3'].every((id) => (to(id) as string) <= key(17)), JSON.stringify(asg));
  check('hiçbir gün kapasitesini (%60) aşmaz', p2.every((d) => asg.filter((a) => a.day === d.key).reduce((s, a) => s + (backlog.find((t) => t.id === a.taskId)?.estimatedDuration ?? 0), 0) + (d.key === key(16) ? 40 : 0) <= d.freeMinutes * FILL_RATIO + 0.001));
  const summary = assignmentSummary(p2, asg);
  check('özet cümlesi sayıları söyler, yargı içermez', /iş taşınır:/.test(summary) && /Pazar/.test(summary) && !hasBannedWords(summary), summary);
  check('hepsi bugüne sığıyorsa taşınacak iş yok', assignmentSummary(p2, [{ taskId: 'x', day: key(16), reason: '' }]) === 'Taşınacak iş yok; hepsi bugüne sığıyor.');
  const full = buildWeekPlan({ now: at(8), today, work: PERSONAL_WORK, tasks: [] });
  const huge = autoDistribute(full, [wt('h', 900, 'HIGH')]);
  check('hiçbir güne sığmayan iş yerinde (bugün) kalır', huge.length === 1 && huge[0].day === key(16) && /Sığmadı/.test(huge[0].reason));
  check('boş liste ve boş hafta güvenli', autoDistribute([], [wt('a', 10)]).length === 0 && autoDistribute(full, []).length === 0);

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  await ensureWorkSeed(db);
  check('sürüm 12', DATABASE_VERSION === 12);
  const day0 = planningDay(at(9));
  const startISO = dayBounds(day0).start.toISOString();
  const t1 = await createTask(db, { title: 'Bugünkü iş', estimatedDuration: 20, cognitiveWeight: 'LOW' });
  const t2 = await createTask(db, { title: 'Pazar işi', estimatedDuration: 90, cognitiveWeight: 'HIGH', plannedDay: key(22) });
  check('görev günü kaydedilir ve okunur', (await getTask(db, t2.id))?.plannedDay === key(22) && (await getTask(db, t1.id))?.plannedDay === null);
  let vis = await listVisibleTasks(db, startISO);
  check('başka güne ayrılan iş bugün görünmez', vis.map((t) => t.id).join() === t1.id);
  const sunStart = dayBounds(planningDay(at(9, 0, 22))).start.toISOString();
  vis = await listVisibleTasks(db, sunStart);
  check('o güne gelince görünür', vis.some((t) => t.id === t2.id));
  check('ertesi gün de görünmeye devam eder (günü geçmiş iş yuvarlanır)', (await listVisibleTasks(db, dayBounds(planningDay(at(9, 0, 23))).start.toISOString())).some((t) => t.id === t2.id));
  await replanDay(db, at(9), 'MANUAL');
  const blocked = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM TimeBlock WHERE taskId = ?', [t2.id]);
  check('planlayıcı ayrılmış işi bugüne koymaz', blocked[0].n === 0);
  const wk = await loadWeek(db, at(9));
  check('hafta ekranı: bugün 1, Pazar 1 iş', wk.plan[0].tasks.length === 1 && wk.plan[6].tasks.length === 1 && wk.todayKey === key(16));
  check('ayrılan iş sayısı', (await countParked(db, at(9))) === 1);
  await moveTaskToDay(db, t1.id, key(19), at(9));
  check('güne taşıma: iş bugünden çıkar, Cuma\'ya girer', (await loadWeek(db, at(9))).plan[3].tasks.some((t) => t.id === t1.id) && (await countParked(db, at(9))) === 2);
  await moveTaskToDay(db, t1.id, key(16), at(9));
  check('bugüne (ya da geçmişe) taşımak ayrımı kaldırır', (await getTask(db, t1.id))?.plannedDay === null);
  await updateTask(db, t1.id, { title: 'Bugünkü iş', estimatedDuration: 20, cognitiveWeight: 'LOW', plannedDay: key(18) });
  check('düzenlemeyle de gün verilebilir', (await getTask(db, t1.id))?.plannedDay === key(18));
  check('tümünü bugüne al', (await pullAllToToday(db, at(9))) === 2 && (await countParked(db, at(9))) === 0);

  const t3 = await createTask(db, { title: 'Büyük rapor', estimatedDuration: 120, cognitiveWeight: 'HIGH' });
  await createTask(db, { title: 'Kısa mail', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  const sg = await suggestWeek(db, at(9));
  check('öneri: büyük rapor Pazar\'a', sg.assignments.find((a) => a.taskId === t3.id)?.day === key(22), JSON.stringify(sg.assignments));
  const n = await applyAssignments(db, sg.assignments, at(9));
  check('uygulanır: yalnızca bugünden sonraki günlere ayrılanlar kaydedilir', n >= 1 && (await getTask(db, t3.id))?.plannedDay === key(22));
  check('uygulanınca bugünün listesi sadeleşir', (await listVisibleTasks(db, startISO)).every((t) => t.id !== t3.id));

  console.log('Yedek ve geçiş');
  const text = await createBackup(db, {}, at(22));
  const fresh = makeTestDb();
  await migrateDbIfNeeded(fresh.db);
  const res = await restoreBackup(fresh.db, text);
  check('ayrılan günler yedekle geri gelir', res.ok && (await getTask(fresh.db, t3.id))?.plannedDay === key(22), JSON.stringify(res));
  const old = makeTestDb();
  old.raw.exec(`CREATE TABLE Task (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, estimatedDuration INTEGER NOT NULL, cognitiveWeight TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, startedAt TEXT, routineId TEXT, workOk INTEGER NOT NULL DEFAULT 0, commuteOk INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Routine (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, estimatedDuration INTEGER NOT NULL, cognitiveWeight TEXT NOT NULL, askHour INTEGER NOT NULL, askMinute INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', createdAt TEXT NOT NULL, retiredAt TEXT, templateId TEXT);
    INSERT INTO Task (id,title,estimatedDuration,cognitiveWeight,status,createdAt) VALUES ('t1','Eski görev',20,'LOW','PENDING','2026-11-01T08:00:00.000Z');
    PRAGMA user_version = 10;`);
  await migrateDbIfNeeded(old.db);
  const up = await getTask(old.db, 't1');
  check('v10 → son sürüm: görev korunur, günü boş', up?.title === 'Eski görev' && up.plannedDay === null && (old.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === DATABASE_VERSION);
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
