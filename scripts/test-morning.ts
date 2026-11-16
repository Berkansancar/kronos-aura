/**
 * Sabah brifingi testi (saf mantık + gerçek SQLite). Çalıştırmak için:  npm run test:morning
 */
import { createTask, getDayReview, isHardDay, setHardDay, upsertDayReview, upsertSleepLog } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { gatherMorningFacts, loadMorningBrief } from '../services/morning';
import {
  buildMorningBrief,
  greetingFor,
  pickTopTask,
  SHORT_SLEEP_MINUTES,
  type MorningFacts,
  type MorningTask,
} from '../services/morningLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { replanDay } from '../services/planner';
import { addRoutineFromTemplate } from '../services/routineFlow';
import { isEssentialRoutine, planReminders } from '../services/routineRemindersLogic';
import { loadRoutineBriefs } from '../services/routineBriefs';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m);

const task = (id: string, over: Partial<MorningTask> = {}): MorningTask => ({
  id,
  title: `Görev ${id}`,
  minutes: 30,
  weight: 'MEDIUM',
  status: 'PENDING',
  start: null,
  ...over,
});

const facts = (over: Partial<MorningFacts> = {}): MorningFacts => ({
  day: '2026-11-16',
  hour: 8,
  tasks: [],
  doneTaskCount: 0,
  peakStartHour: 9,
  peakEndHour: 12,
  routines: [],
  note: null,
  sleepMinutes: null,
  hardDay: false,
  ...over,
});

// ───────────── Selamlama ─────────────
console.log('Selamlama');
check('sabah', greetingFor(5) === 'Günaydın' && greetingFor(11) === 'Günaydın');
check('öğleden sonra', greetingFor(12) === 'İyi günler' && greetingFor(17) === 'İyi günler');
check('akşam', greetingFor(18) === 'İyi akşamlar' && greetingFor(21) === 'İyi akşamlar');
check('gece', greetingFor(23) === 'Merhaba' && greetingFor(2) === 'Merhaba');

// ───────────── En önemli iş ─────────────
console.log('En önemli iş');
check('görev yoksa null', pickTopTask([], false) === null);
check('başlamış görev öne geçer', pickTopTask([task('a', { weight: 'HIGH' }), task('b', { status: 'IN_PROGRESS', weight: 'LOW' })], false)?.id === 'b');
check('en ağır iş seçilir', pickTopTask([task('a', { weight: 'LOW' }), task('b', { weight: 'HIGH' }), task('c', { weight: 'MEDIUM' })], false)?.id === 'b');
check('eşit ağırlıkta planda en erken olan', pickTopTask([task('a', { weight: 'HIGH', start: '14:00' }), task('b', { weight: 'HIGH', start: '09:30' })], false)?.id === 'b');
check('planı olmayan, planı olandan sonra gelir', pickTopTask([task('a', { weight: 'HIGH' }), task('b', { weight: 'HIGH', start: '16:00' })], false)?.id === 'b');
check('zor günde en hafif ve kısa iş seçilir', pickTopTask([task('a', { weight: 'HIGH', minutes: 90 }), task('b', { weight: 'LOW', minutes: 25 }), task('c', { weight: 'LOW', minutes: 10 })], true)?.id === 'c');
check('ertelenmiş ve biten görev seçilmez', pickTopTask([task('a', { status: 'POSTPONED' }), task('b', { status: 'COMPLETED' })], false) === null);

// ───────────── Brifing metni ─────────────
console.log('Brifing');
const empty = buildMorningBrief(facts());
check('görev yoksa açıklayıcı satır', empty.kronos[0].includes('açık görev yok') && empty.top === null);
const allDone = buildMorningBrief(facts({ doneTaskCount: 3 }));
check('hepsi bitmişse söyler', allDone.kronos[0].includes('bitmiş (3)'));

const busy = buildMorningBrief(
  facts({
    tasks: [
      task('a', { title: 'Rapor', minutes: 90, weight: 'HIGH', start: '09:30' }),
      task('b', { title: 'Mail', minutes: 15, weight: 'LOW', start: '13:00' }),
      task('c', { title: 'Arama', minutes: 20, weight: 'LOW' }),
    ],
    routines: [
      { title: 'Bir bardak su iç', time: '08:00', state: 'DONE' },
      { title: 'Nefes ve meditasyon', time: '10:00', state: 'WAITING' },
      { title: 'Kitap oku', time: '21:00', state: 'SKIPPED' },
    ],
    note: '  Yarın ilk işin rapor olsun.  ',
  })
);
check('görev sayısı ve toplam süre', busy.kronos[0] === 'Bugün 3 görev açık, toplam 2 sa 5 dk.', busy.kronos[0]);
check('en önemli iş ve saati', busy.top?.id === 'a' && busy.kronos[1].includes('"Rapor"') && busy.kronos[1].includes('planda 09:30'), busy.kronos[1]);
check('tepe saati söylenir', busy.kronos.some((l) => l.includes('09:00–12:00')));
check('sığmayan görev söylenir', busy.kronos.some((l) => l.includes('1 görev bugüne sığmadı')));
check('planlı görevler saate göre dizilir', busy.planned.map((t) => t.id).join() === 'a,b' && busy.unplanned.map((t) => t.id).join() === 'c');
check('rutinler: yapılan sayılır, kapanan gizlenir', busy.routinesDone === 1 && busy.routinesOpen.length === 1 && busy.routinesOpen[0].title === 'Nefes ve meditasyon');
check('dünkü not kırpılır ve taşınır', busy.note === 'Yarın ilk işin rapor olsun.');
check('tek görev tekil söylenir', buildMorningBrief(facts({ tasks: [task('a')] })).kronos[0].startsWith('Bugün 1 görev açık'));

console.log('Uyku ve zor gün');
check('çok kısa uyku: nazik ve süreyi söyler', buildMorningBrief(facts({ sleepMinutes: 250 })).aura.includes('4 sa 10 dk'));
check('biraz kısa uyku', buildMorningBrief(facts({ sleepMinutes: 360 })).aura.includes('biraz kısa'));
check('iyi uyku', buildMorningBrief(facts({ sleepMinutes: 480 })).aura.includes('iyi dinlenmişsin') || buildMorningBrief(facts({ sleepMinutes: 480 })).aura.includes('İyi dinlenmişsin'));
check('uyku bilinmiyorsa sade mesaj', buildMorningBrief(facts()).aura.includes('Yeni bir gün'));
check('kısa uykuda zor gün önerilir', buildMorningBrief(facts({ sleepMinutes: SHORT_SLEEP_MINUTES - 1 })).suggestHardDay);
check('yeterli uykuda önerilmez', !buildMorningBrief(facts({ sleepMinutes: SHORT_SLEEP_MINUTES + 30 })).suggestHardDay && !buildMorningBrief(facts()).suggestHardDay);
const hard = buildMorningBrief(
  facts({ hardDay: true, sleepMinutes: 200, tasks: [task('a', { weight: 'HIGH', minutes: 90 }), task('b', { weight: 'LOW', minutes: 15, title: 'Kısa mail' })] })
);
check('zor gün açıkken tekrar önerilmez', !hard.suggestHardDay);
check('zor günde Aura sakinleştirir', hard.aura.includes('zor gün modundayız'));
check('zor günde tek hedef en hafif iş', hard.top?.id === 'b' && hard.kronos.some((l) => l.includes('tek hedefi: "Kısa mail"')));
check('zor günde tepe saati baskısı yok', !hard.kronos.some((l) => l.includes('Tepe saatin')));

const everything: MorningFacts[] = [
  facts(),
  facts({ sleepMinutes: 200 }),
  facts({ sleepMinutes: 350 }),
  facts({ sleepMinutes: 500 }),
  facts({ hardDay: true, tasks: [task('a')] }),
  facts({ tasks: [task('a', { weight: 'HIGH' }), task('b')], doneTaskCount: 2 }),
];
check(
  'hiçbir metinde yargılayıcı sözcük yok',
  everything.every((f) => {
    const b = buildMorningBrief(f);
    return !hasBannedWords(b.aura) && b.kronos.every((l) => !hasBannedWords(l));
  })
);

// ───────────── Bildirim planı ─────────────
console.log('Bildirimler');
async function dbTests(): Promise<void> {
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const ver = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  check('temiz kurulum son sürüm', ver === DATABASE_VERSION && DATABASE_VERSION === 9);
  raw.exec('DROP TABLE DayMode');
  raw.exec('PRAGMA user_version = 5');
  await migrateDbIfNeeded(db);
  check("v5 veritabanı v6'ya yükselir", (raw.prepare("SELECT name FROM sqlite_master WHERE name='DayMode'").get() as unknown) !== undefined);
  await migrateDbIfNeeded(db);

  // Zor gün kaydı
  check('varsayılan: zor gün değil', !(await isHardDay(db, '2026-11-16')));
  await setHardDay(db, '2026-11-16', true, at(8));
  check('zor gün açılır', await isHardDay(db, '2026-11-16'));
  await setHardDay(db, '2026-11-16', true, at(9));
  check('iki kez açmak çoğaltmaz', ((raw.prepare('SELECT COUNT(*) AS n FROM DayMode').get() as { n: number }).n) === 1);
  check('başka gün etkilenmez', !(await isHardDay(db, '2026-11-17')));
  await setHardDay(db, '2026-11-16', false);
  check('zor gün kapanır', !(await isHardDay(db, '2026-11-16')));

  // Gün verisi
  const water = await addRoutineFromTemplate(db, 'su-ic');
  const walk = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  const briefs = await loadRoutineBriefs(db, at(7, 0));

  const plan = planReminders(briefs, at(7, 0), 3, 60, { morning: { hour: 8, minute: 0 } });
  const morning = plan.filter((p) => p.id.startsWith('rtn-morning'));
  check('her gün için sabah bildirimi', morning.length === 3 && morning[0].at.getHours() === 8 && morning[0].at.getDate() === 16);
  check('dokununca sabah ekranı açılır', morning.every((p) => p.route === '/morning'));
  check('gün sonu bildirimi gün sonu ekranını açar', plan.filter((p) => p.id.startsWith('rtn-review')).every((p) => p.route === '/review'));
  check('rutin bildirimi ekran belirtmez', plan.filter((p) => p.routineId === water.id).every((p) => p.route === undefined));
  const late = planReminders(briefs, at(8, 30), 3, 60, { morning: { hour: 8, minute: 0 } });
  check('saati geçmişse bugünün bildirimi gönderilmez', late.filter((p) => p.id.startsWith('rtn-morning')).length === 2 && late.every((p) => !(p.id.startsWith('rtn-morning') && p.at.getDate() === 16)));
  check('kapalıysa sabah bildirimi yok', !planReminders(briefs, at(7, 0), 3, 60, { morning: null }).some((p) => p.id.startsWith('rtn-morning')));
  check('ayar verilmezse sabah bildirimi yok', !planReminders(briefs, at(7, 0), 3, 60).some((p) => p.id.startsWith('rtn-morning')));

  // Zor gün bildirimleri
  check('kısa rutin temel sayılır, uzun sayılmaz', isEssentialRoutine(water) && !isEssentialRoutine(walk), `${water.estimatedDuration}/${walk.estimatedDuration}`);
  const hardPlan = planReminders(briefs, at(6, 0), 2, 60, { review: false, hardDayToday: true });
  check('zor günde uzun rutinin bugünkü bildirimi gitmez', !hardPlan.some((p) => p.routineId === walk.id && p.at.getDate() === 16));
  check('zor günde kısa rutinin bildirimi gider', hardPlan.some((p) => p.routineId === water.id && p.at.getDate() === 16));
  check('zor gün yarını etkilemez', hardPlan.some((p) => p.routineId === walk.id && p.at.getDate() === 17));

  // Brifing verisi
  console.log('Brifing verisi');
  await createTask(db, { title: 'Rapor yaz', estimatedDuration: 90, cognitiveWeight: 'HIGH' });
  await createTask(db, { title: 'Mail', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  await replanDay(db, at(8, 30), 'MANUAL');
  await upsertSleepLog(db, { day: '2026-11-16', bedtime: at(1, 0).toISOString(), wakeTime: at(6, 0).toISOString(), durationMinutes: 300 });
  await upsertDayReview(
    db,
    '2026-11-15',
    { reflection: 'Sakin bir gündü.', tomorrow: 'Yarın ilk iş raporu bitir.', ideas: [], source: 'RULES' },
    at(21, 30, 15)
  );
  await upsertDayReview(
    db,
    '2026-11-16',
    { reflection: 'Başka gün.', tomorrow: 'Bu not bugünün sabahında görünmemeli.', ideas: [], source: 'RULES' },
    at(21, 30)
  );
  check('değerlendirme kaydı var', (await getDayReview(db, '2026-11-15')) !== null);

  const f = await gatherMorningFacts(db, at(8, 45));
  check('bugünün anahtarı', f.day === '2026-11-16' && f.hour === 8);
  check('açık görevler gelir', f.tasks.length === 2 && f.tasks.some((t) => t.title === 'Rapor yaz' && t.weight === 'HIGH'));
  check('planlanan görevlerin saati dolar', f.tasks.every((t) => t.start !== null && /^\d\d:\d\d$/.test(t.start as string)), JSON.stringify(f.tasks.map((t) => t.start)));
  check('rutinler saatiyle gelir', f.routines.length === 2 && f.routines.every((r) => /^\d\d:\d\d$/.test(r.time)));
  check('dünün Kronos notu gelir, bugününki gelmez', f.note === 'Yarın ilk iş raporu bitir.', String(f.note));
  check('son gecenin uykusu gelir', f.sleepMinutes === 300);
  check('zor gün kapalı', f.hardDay === false);

  const { brief } = await loadMorningBrief(db, at(8, 45));
  check('brifingde en önemli iş', brief.top?.title === 'Rapor yaz' && brief.kronos.some((l) => l.includes('"Rapor yaz"')));
  check('kısa uyku zor gün önerir', brief.suggestHardDay && brief.aura.includes('5 sa'));

  await setHardDay(db, '2026-11-16', true, at(8, 50));
  const hardFacts = await gatherMorningFacts(db, at(8, 55));
  check('zor gün brifinge yansır', hardFacts.hardDay && buildMorningBrief(hardFacts).top?.title === 'Mail');

  // 22:00'den sonra plan günü yarındır; dünkü not = bugünün değerlendirmesi
  const evening = await gatherMorningFacts(db, at(22, 30));
  check('akşam 22:00 sonrası yarının planı, bugünün notu', evening.day === '2026-11-17' && evening.note === 'Bu not bugünün sabahında görünmemeli.', `${evening.day} ${evening.note}`);
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
