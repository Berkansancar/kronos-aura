/**
 * Haftalık özet testi (saf mantık + gerçek SQLite). Çalıştırmak için:  npm run test:weekly
 */
import { createTask, setHardDay, upsertDailyStat, upsertSleepLog } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { hasBannedWords } from '../services/dayReviewLogic';
import { acceptRoutine, addRoutineFromTemplate, markRoutineDone } from '../services/routineFlow';
import { completeTask } from '../services/taskFlow';
import { gatherWeekFacts, loadWeekSummary } from '../services/weekly';
import {
  buildWeekSummary,
  rangeLabel,
  totalsOf,
  weekdayLong,
  weekdayShort,
  weekEndDate,
  windowKeys,
  type WeekDay,
  type WeekFacts,
} from '../services/weeklyLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16, month = 10) => new Date(2026, month, d, h, m);

console.log('Takvim');
check('gece 03:00 hâlâ dünün haftasıdır', weekEndDate(at(3, 0)).getDate() === 15);
check('04:00 bugündür', weekEndDate(at(4, 0)).getDate() === 16);
check('yedi günlük pencere', windowKeys('2026-11-16').join() === '2026-11-10,2026-11-11,2026-11-12,2026-11-13,2026-11-14,2026-11-15,2026-11-16');
check('pencere ay sınırını aşar', windowKeys('2026-11-02')[0] === '2026-10-27');
check('on dört günlük pencere', windowKeys('2026-11-16', 14).length === 14 && windowKeys('2026-11-16', 14)[0] === '2026-11-03');
check('aralık etiketi', rangeLabel(windowKeys('2026-11-16')) === '10–16 Kasım');
check('ay değişen aralık etiketi', rangeLabel(windowKeys('2026-11-02')) === '27 Ekim – 2 Kasım');
check('gün adları', weekdayShort('2026-11-16') === 'Pzt' && weekdayLong('2026-11-16') === 'Pazartesi' && weekdayLong('2026-11-15') === 'Pazar');

const mkDays = (end: string, over: Record<string, Partial<WeekDay>> = {}): WeekDay[] =>
  windowKeys(end).map((day) => ({
    day,
    tasksDone: 0,
    taskMinutes: 0,
    routinesDone: 0,
    steps: null,
    screenMinutes: null,
    sleepMinutes: null,
    hardDay: false,
    ...over[day],
  }));

const baseFacts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
  endDay: '2026-11-16',
  days: mkDays('2026-11-16'),
  prevDays: mkDays('2026-11-09'),
  routines: [],
  energy: { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 },
  driftMinutes: 0,
  peakStartHour: 9,
  peakEndHour: 12,
  countEndDay: true,
  ...over,
});

console.log('Toplamlar');
const days = mkDays('2026-11-16');
const rs = [
  { title: 'Su', createdDay: '2026-11-01', doneDays: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-16'] },
  { title: 'Yeni', createdDay: '2026-11-14', doneDays: ['2026-11-15'] },
];
const tot = totalsOf(days, rs, true);
check('şans: eski rutin 7 gün, yeni rutin eklendiği günden itibaren 3 gün', tot.routineChances === 10, String(tot.routineChances));
check('yapılan günler', tot.routinesDone === 5, String(tot.routinesDone));
const totMorning = totalsOf(days, rs, false);
check('bitmemiş son gün, yapılmadıysa şansa girmez; yapıldıysa girer', totMorning.routineChances === 9 && totMorning.routinesDone === 5, `${totMorning.routineChances}/${totMorning.routinesDone}`);
const early = totalsOf(days, [{ title: 'E', createdDay: '2026-11-15', doneDays: ['2026-11-12'] }], true);
check('eklenmeden önceki yapılan gün oranı bozmaz', early.routinesDone <= early.routineChances);
const sleepy = totalsOf(mkDays('2026-11-16', { '2026-11-12': { sleepMinutes: 400 }, '2026-11-13': { sleepMinutes: 420 } }), [], true);
check('üç geceden azsa uyku ortalaması verilmez', sleepy.sleepAvg === null && sleepy.sleepNights === 2);
const sleepy3 = totalsOf(mkDays('2026-11-16', { '2026-11-12': { sleepMinutes: 400 }, '2026-11-13': { sleepMinutes: 420 }, '2026-11-14': { sleepMinutes: 380 } }), [], true);
check('üç geceyle ortalama', sleepy3.sleepAvg === 400);

console.log('Özet metni');
const q = buildWeekSummary(baseFacts());
check('boş hafta sessiz sayılır', q.quiet && q.aura.includes('sorun değil') && q.highlights.length === 0 && q.bestDay === null);

const busyDays = mkDays('2026-11-16', {
  '2026-11-11': { tasksDone: 2, taskMinutes: 75, routinesDone: 1, steps: 5000, sleepMinutes: 420 },
  '2026-11-12': { tasksDone: 1, taskMinutes: 30, routinesDone: 1, steps: 6000, sleepMinutes: 400, hardDay: true },
  '2026-11-13': { tasksDone: 3, taskMinutes: 120, routinesDone: 2, steps: 7000, sleepMinutes: 380, screenMinutes: 200 },
  '2026-11-14': { steps: 8000, screenMinutes: 240 },
  '2026-11-15': { screenMinutes: 180 },
});
const prevDays = mkDays('2026-11-09', {
  '2026-11-05': { tasksDone: 2, taskMinutes: 50, sleepMinutes: 300 },
  '2026-11-06': { sleepMinutes: 300 },
  '2026-11-07': { sleepMinutes: 300 },
});
const routines = [
  { title: 'Bir bardak su iç', createdDay: '2026-11-01', doneDays: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'] },
  { title: 'Kitap oku', createdDay: '2026-11-01', doneDays: ['2026-11-11'] },
];
const s = buildWeekSummary(baseFacts({ days: busyDays, prevDays, routines }));
check('görev toplamı', s.totals.tasksDone === 6 && s.totals.taskMinutes === 225);
check('rutin oranı', s.totals.routinesDone === 7 && s.totals.routineChances === 14 && Math.abs((s.routineRate ?? 0) - 0.5) < 1e-9);
check('en hareketli gün', s.bestDay === 'Cuma' && s.bars.find((b) => b.day === '2026-11-13')?.value === 5, String(s.bestDay));
check('çubuk grafiği yedi gün ve en büyük değer', s.bars.length === 7 && s.maxBar === 5);
check('zor gün çubukta işaretlenir', s.bars.find((b) => b.day === '2026-11-12')?.hardDay === true);
check('kıyas: geçen hafta görev sayısı yazılır', s.highlights[0].includes('6 görev bitti') && s.highlights[0].includes('geçen hafta 2'), s.highlights[0]);
check('uyku ortalaması ve kıyası', s.highlights.some((h) => h.startsWith('Ortalama uyku 6 sa 40 dk') && h.includes('geçen haftadan 1 sa 40 dk fazla')), s.highlights.join(' | '));
check('adım ve ekran ortalaması', s.highlights.some((h) => h.includes('6.500 adım')) && s.highlights.some((h) => h.includes('ekran süresi 3 sa 27 dk')), s.highlights.join(' | '));
check('zor gün sayısı söylenir', s.highlights.some((h) => h.includes('1 gün zor gün modunda')));
check('Aura zor günü takdir eder', s.aura.includes('Zor günlerin') && s.aura.includes('6 görev') && s.aura.includes('7 kez'));
check('tutarlı rutin', s.kronos.some((l) => l.includes('"Bir bardak su iç" 6/7')));
check('ayarlanacak rutin', s.routineToAdjust?.title === 'Kitap oku' && s.kronos.some((l) => l.includes('"Kitap oku" 1/7') && l.includes('Saatini değiştirmeyi')));
check('gelecek hafta önerisi tepe saatini söyler', s.kronos[s.kronos.length - 1].includes('09:00–12:00'));
check('rutin satırları çoktan aza', s.routines[0].title === 'Bir bardak su iç' && s.routines[1].title === 'Kitap oku');
check('aralık etiketi', s.rangeLabel === '10–16 Kasım');

const tired = buildWeekSummary(baseFacts({ days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 3, taskMinutes: 90 } }), energy: { HIGH: 0, EXHAUSTED: 3, DISTRACTED: 0 } }));
check('yorgunluk sinyal olarak çerçevelenir', tired.aura.includes('sinyal') && tired.highlights.some((h) => h.includes('tükendim')));
const shortSleep = buildWeekSummary(
  baseFacts({ days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 1, taskMinutes: 20, sleepMinutes: 300 }, '2026-11-12': { sleepMinutes: 320 }, '2026-11-13': { sleepMinutes: 330 } }) })
);
check('kısa uyku nazikçe söylenir', shortSleep.aura.includes('Uyku ortalaman'));
const better = buildWeekSummary(baseFacts({ days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 4, taskMinutes: 100 } }), prevDays: mkDays('2026-11-09', { '2026-11-05': { tasksDone: 1, taskMinutes: 20 } }) }));
check('geçen haftadan çok iş bitince söylenir', better.aura.includes('Geçen haftadan daha çok'));
const fewer = buildWeekSummary(baseFacts({ days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 1, taskMinutes: 20 } }), prevDays: mkDays('2026-11-09', { '2026-11-05': { tasksDone: 5, taskMinutes: 200 } }) }));
check('daha az iş bitince karşılaştırma yargısı yok', !fewer.aura.includes('Geçen') && !fewer.aura.includes('daha az') && fewer.aura.includes('1 görev'));
check(
  'hiçbir metinde yargılayıcı sözcük yok',
  [s, q, tired, shortSleep, better, fewer].every((x) => !hasBannedWords(x.aura) && x.kronos.every((l) => !hasBannedWords(l)) && x.highlights.every((l) => !hasBannedWords(l)))
);
const lowRate = buildWeekSummary(baseFacts({ routines: [{ title: 'Yürüyüş', createdDay: '2026-11-01', doneDays: [] }], days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 1, taskMinutes: 10 } }) }));
check('hiç yapılmayan rutin ayarlanacak diye önerilir, suçlanmaz', lowRate.routineToAdjust?.title === 'Yürüyüş' && !hasBannedWords(lowRate.kronos.join(' ')));
const fresh = buildWeekSummary(baseFacts({ routines: [{ title: 'Yeni', createdDay: '2026-11-15', doneDays: [] }], days: mkDays('2026-11-16', { '2026-11-11': { tasksDone: 1, taskMinutes: 10 } }) }));
check('yeni rutin için 3 şans dolmadan öneri yok', fresh.routineToAdjust === null);

async function dbTests(): Promise<void> {
  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);

  const water = await addRoutineFromTemplate(db, 'su-ic');
  const walk = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  raw.exec("UPDATE Routine SET createdAt = '2026-11-01T08:00:00.000Z'");

  for (const d of [10, 11, 12, 13, 14, 15]) await markRoutineDone(db, water, at(9, 0, d));
  await markRoutineDone(db, water, at(9, 30, 15)); // aynı gün ikinci kez: tek sayılır
  await markRoutineDone(db, walk, at(7, 30, 11));

  const t1 = await createTask(db, { title: 'Rapor', estimatedDuration: 30, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Mail', estimatedDuration: 45, cognitiveWeight: 'LOW' });
  const t3 = await createTask(db, { title: 'Sunum', estimatedDuration: 20, cognitiveWeight: 'MEDIUM' });
  const t4 = await createTask(db, { title: 'Geçen hafta işi', estimatedDuration: 20, cognitiveWeight: 'MEDIUM' });
  await completeTask(db, t1, 'HIGH', at(10, 0, 11));
  await completeTask(db, t2, 'HIGH', at(11, 0, 11));
  await completeTask(db, t3, 'EXHAUSTED', at(14, 0, 13));
  await completeTask(db, t4, 'HIGH', at(14, 0, 5));

  // Rutinden gelen görev: görev olarak sayılmaz
  const waterTaskRoutine = await addRoutineFromTemplate(db, 'gunluk-notu');
  raw.exec(`UPDATE Routine SET createdAt = '2026-11-01T08:00:00.000Z' WHERE id = '${waterTaskRoutine.id}'`);
  const acc = await acceptRoutine(db, waterTaskRoutine, at(8, 0, 14));
  void acc;
  const rows = raw.prepare('SELECT id, title, estimatedDuration, cognitiveWeight, status, createdAt, startedAt, routineId FROM Task WHERE routineId IS NOT NULL').all() as Array<Record<string, unknown>>;
  check('rutin görevi oluştu', rows.length === 1);
  await completeTask(db, rows[0] as never, 'HIGH', at(8, 30, 14));

  for (const [d, steps] of [[11, 5000], [12, 6000], [13, 7000], [14, 8000]] as const) {
    await upsertDailyStat(db, { day: `2026-11-${d}`, steps, screenMinutes: 200, topApps: [] });
  }
  for (const [d, mins] of [[11, 420], [12, 400], [13, 380], [14, 360], [5, 300], [6, 300], [7, 300]] as const) {
    await upsertSleepLog(db, { day: `2026-11-${String(d).padStart(2, '0')}`, bedtime: at(0, 0, d).toISOString(), wakeTime: at(7, 0, d).toISOString(), durationMinutes: mins });
  }
  await setHardDay(db, '2026-11-12', true, at(8, 0, 12));

  const f = await gatherWeekFacts(db, at(21, 0));
  check('hafta 10–16 Kasım', f.endDay === '2026-11-16' && f.days[0].day === '2026-11-10' && f.prevDays[0].day === '2026-11-03');
  check('görev sayısı: yalnızca rutin dışı görevler', f.days.reduce((a, d) => a + d.tasksDone, 0) === 3, String(f.days.map((d) => d.tasksDone)));
  check('görev süreleri gün gün', f.days.find((d) => d.day === '2026-11-11')?.tasksDone === 2);
  check('geçen haftanın görevi geçen haftaya yazılır', f.prevDays.reduce((a, d) => a + d.tasksDone, 0) === 1);
  check('enerji sayımı yalnızca bu hafta', f.energy.EXHAUSTED === 1 && f.energy.HIGH === 2, JSON.stringify(f.energy));
  check('rutin yapılan günler tekrarsız', f.routines.find((r) => r.title === 'Bir bardak su iç')?.doneDays.length === 6);
  check('adım, ekran ve uyku gün gün', f.days.find((d) => d.day === '2026-11-13')?.steps === 7000 && f.days.find((d) => d.day === '2026-11-13')?.sleepMinutes === 380);
  check('zor gün işaretlenir', f.days.find((d) => d.day === '2026-11-12')?.hardDay === true);
  check('akşam 21:00 son gün şansa katılır', f.countEndDay === true);
  check('sabah son gün şansa katılmaz', (await gatherWeekFacts(db, at(9, 0))).countEndDay === false);

  const { summary } = await loadWeekSummary(db, at(21, 0));
  check('özet: görev ve rutin', summary.totals.tasksDone === 3 && summary.totals.routinesDone >= 7);
  check('özet: uyku ortalaması geçen haftadan fazla', summary.totals.sleepAvg === 390 && summary.prev.sleepAvg === 300);
  check('özet: yazı üretildi', summary.aura.length > 20 && summary.kronos.length >= 1 && summary.highlights.length >= 3);
  const empty = makeTestDb();
  await migrateDbIfNeeded(empty.db);
  const none = await loadWeekSummary(empty.db, at(21, 0));
  check('boş veritabanında özet sessiz', none.summary.quiet);
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
