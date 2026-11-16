/**
 * İlerleme ve geçmiş testi (günlük seriler, ortalamalar, sebepler, veri toplama).
 * Çalıştırmak için:  npm run test:history
 */
import { addDayEvent, createTask, upsertDailyStat } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { addWater } from '../services/nutrition';
import { gatherHistory } from '../services/history';
import {
  HISTORY_METRICS,
  MIN_TRACKED_DAYS,
  breakdownOutcomes,
  buildSeries,
  metricDef,
  type HistoryDay,
  type HistoryMetricId,
} from '../services/historyLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { addSmoke } from '../services/dayFlow';
import { completeTask, markTaskMissed } from '../services/taskFlow';
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
const empty = (day: string): HistoryDay => ({
  day,
  taskMinutes: 0,
  tasksDone: 0,
  routinesDone: 0,
  waterMl: null,
  kcal: null,
  smoke: null,
  screenMinutes: null,
  steps: null,
  sleepMinutes: null,
  wakeMin: null,
  shopMinutes: null,
  commuteMinutes: null,
});

console.log('Seriler');
const week: HistoryDay[] = [10, 11, 12, 13, 14, 15, 16].map((d, i) => ({ ...empty(key(d)), screenMinutes: [120, 180, 240, null, 200, 60, 300][i], wakeMin: [420, 430, 440, null, 410, 480, 425][i] }));
const sc = buildSeries(week, 'SCREEN', 7);
check('çubuk sayısı gün sayısı kadar, hafta günü etiketleri', sc.bars.length === 7 && sc.bars[0].weekday === 'Sal' && sc.bars[6].weekday === 'Pzt');
check('kayıt olmayan gün boş çubuk (null, oran 0)', sc.bars[3].value === null && sc.bars[3].ratio === 0 && sc.bars[3].label === '');
check('en yüksek değerin oranı 1, diğerleri orantılı', sc.bars[6].ratio === 1 && Math.abs(sc.bars[0].ratio - 120 / 300) < 1e-9);
check('ortalama yalnızca kayıtlı günlerden (6 gün)', sc.trackedDays === 6 && sc.avg === 183 && sc.avgLabel === '3 sa 3 dk', JSON.stringify([sc.trackedDays, sc.avg, sc.avgLabel]));
check('en yüksek gün', sc.maxDay === key(16) && sc.maxLabel === '5 sa');
check('karşılaştırma: son yarı ve önceki yarı (en az 3 günlük)', sc.compare === null || (sc.compare.recent > 0 && sc.compare.earlier > 0));
check('aralık etiketi', sc.rangeLabel === '10–16 Kasım');
const few = buildSeries(week.map((d, i) => ({ ...d, screenMinutes: i < 2 ? 100 : null })), 'SCREEN', 7);
check(`kayıt ${MIN_TRACKED_DAYS} günden azsa ortalama verilmez, nedeni söylenir`, few.avg === null && /en az 3 gün/.test(few.summary), few.summary);
check('hiç kayıt yoksa "kayıt yok"', /kayıt yok/.test(buildSeries(week, 'STEPS', 7).summary));
const wk = buildSeries(week, 'WAKE', 7);
check('uyanış saati: ortalama saat olarak yazılır (07:14)', wk.avg === 434 && wk.avgLabel === '07:14' && /ortalama saat 07:14/.test(wk.summary), JSON.stringify([wk.avg, wk.avgLabel, wk.summary]));
check('uyanış çubukları tabana oturmaz: en erken gün en kısa, en geç gün en uzun', wk.bars[5].ratio === 1 && wk.bars[4].ratio < wk.bars[5].ratio && wk.bars[4].ratio >= 0.06);
const long = Array.from({ length: 30 }, (_, i) => ({ ...empty(`2026-10-${String(18 + i).slice(-2)}`), taskMinutes: i < 15 ? 30 : 60 }));
const s14 = buildSeries(long, 'TASK_MIN', 14);
check('son 14 gün dilimlenir; karşılaştırma son yarı 60, önceki yarı 30..60', s14.bars.length === 14 && s14.compare !== null);
const cmp = buildSeries(Array.from({ length: 14 }, (_, i) => ({ ...empty(key(1 + i)), waterMl: i < 7 ? 1000 : 1500 })), 'WATER', 14);
check('karşılaştırma metni yalnızca sayı: "Son günlerin ortalaması 1,5 L, öncesininki 1,0 L"', cmp.compare?.recent === 1500 && cmp.compare?.earlier === 1000 && /Son günlerin ortalaması 1,5 L, öncesininki 1,0 L/.test(cmp.summary), cmp.summary);
check('yargı sözcüğü yok', HISTORY_METRICS.every((m) => !hasBannedWords(buildSeries(week, m.id, 7).summary)));
check('tüm metrikler tanımlı ve çevrilir', (['TASK_MIN', 'ROUTINES', 'WATER', 'KCAL', 'SMOKE', 'SCREEN', 'STEPS', 'SLEEP', 'WAKE', 'SHOP', 'COMMUTE'] as HistoryMetricId[]).every((id) => metricDef(id).id === id && metricDef(id).label.length > 0));

console.log('Görev sonuçları');
const bo = breakdownOutcomes([
  { day: key(10), outcome: 'DONE', reason: null },
  { day: key(11), outcome: 'COULD_NOT', reason: 'WORK' },
  { day: key(12), outcome: 'COULD_NOT', reason: 'WORK' },
  { day: key(13), outcome: 'COULD_NOT', reason: 'ENERGY' },
  { day: key(14), outcome: 'COULD_NOT', reason: null },
  { day: key(14), outcome: 'NOT_DONE', reason: null },
]);
check('sayılar', bo.done === 1 && bo.notDone === 1 && bo.couldNot === 4);
check('sebepler çoktan aza; sebepsiz "Sebep söylenmedi"', bo.reasons[0].reason === 'WORK' && bo.reasons[0].count === 2 && bo.reasons.some((r) => r.label === 'Sebep söylenmedi' && r.count === 1));
check('iş vaktiyse Kronos işaret ipucu verir', !!bo.hint && /vaktinde de yapılabilecek/.test(bo.hint) && !hasBannedWords(bo.hint));
check('tek sebep yetmez: ipucu yok', breakdownOutcomes([{ day: key(1), outcome: 'COULD_NOT', reason: 'WORK' }]).hint === null);
check('hiç sonuç yoksa boş', breakdownOutcomes([]).reasons.length === 0 && breakdownOutcomes([]).hint === null);

async function dbTests(): Promise<void> {
  console.log('Veri toplama');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);

  // 14, 15 ve 16 Kasım için kayıtlar
  const t1 = await createTask(db, { title: 'Rapor', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Mail', estimatedDuration: 20, cognitiveWeight: 'LOW' });
  const t3 = await createTask(db, { title: 'Arama', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  await completeTask(db, t1, 'HIGH', at(20, 0, 14), { loggedAt: at(19, 0, 14), minutes: 50 });
  await completeTask(db, t2, 'HIGH', at(21, 0, 15), { loggedAt: at(20, 0, 15), minutes: 25 });
  await markTaskMissed(db, t3, 'COULD_NOT', 'WORK', at(21, 0, 15));
  await addWater(db, at(9, 0, 15), 300);
  await addWater(db, at(15, 0, 15), 500);
  await upsertDailyStat(db, { day: key(15), steps: 7000, screenMinutes: 150, topApps: [] });
  await upsertDailyStat(db, { day: key(14), steps: 0, screenMinutes: null, topApps: [] });
  for (const [k, h, m] of [['WAKE', 7, 0], ['BUS', 8, 0], ['SHOP_IN', 8, 40], ['SHOP_OUT', 18, 0], ['BUS', 18, 10], ['HOME', 18, 45]] as const) {
    await addDayEvent(db, key(15), k, at(h, m, 15));
  }
  await addSmoke(db, at(10, 0, 15), 0);
  await addSmoke(db, at(12, 0, 15), 0);
  await addDayEvent(db, key(16), 'WAKE', at(7, 30, 16));
  await addDayEvent(db, key(16), 'BUS', at(8, 10, 16));
  await addDayEvent(db, key(16), 'SHOP_IN', at(8, 50, 16));

  const h = await gatherHistory(db, at(12, 0, 16), 30);
  const byDay = new Map(h.days.map((d) => [d.day, d]));
  check('30 gün, son gün bugün', h.days.length === 30 && h.endDay === key(16) && h.days[29].day === key(16));
  check('biten işler: gün başına süre ve sayı', byDay.get(key(14))?.taskMinutes === 50 && byDay.get(key(15))?.taskMinutes === 25 && byDay.get(key(15))?.tasksDone === 1);
  check('kayıtsız gün: iş 0, su/ekran/uyku boş', byDay.get(key(10))?.taskMinutes === 0 && byDay.get(key(10))?.waterMl === null && byDay.get(key(10))?.screenMinutes === null && byDay.get(key(10))?.smoke === null);
  check('su toplanır', byDay.get(key(15))?.waterMl === 800);
  check('adım 0 ise boş, ekran okunamıyorsa boş', byDay.get(key(14))?.steps === null && byDay.get(key(14))?.screenMinutes === null && byDay.get(key(15))?.steps === 7000 && byDay.get(key(15))?.screenMinutes === 150);
  check('sigara: sayı; gün akışı kullanılmış günde 0; hiç kullanılmamışta boş', byDay.get(key(15))?.smoke === 2 && byDay.get(key(16))?.smoke === 0 && byDay.get(key(12))?.smoke === null);
  check('uyanış damgadan', byDay.get(key(15))?.wakeMin === 420 && byDay.get(key(16))?.wakeMin === 450);
  check('dükkanda 9 sa 20 dk; yol 40+35 = 75 dk', byDay.get(key(15))?.shopMinutes === 560 && byDay.get(key(15))?.commuteMinutes === 75, JSON.stringify(byDay.get(key(15))));
  check('çıkış damgası yoksa dükkan süresi boş (süren gün yanıltmaz); yol işe 40 dk', byDay.get(key(16))?.shopMinutes === null && byDay.get(key(16))?.commuteMinutes === 40);
  check('sonuçlar günleriyle: 15 Kasım Yapamadım (iş vaktindeydi)', h.outcomes.some((o) => o.day === key(15) && o.outcome === 'COULD_NOT' && o.reason === 'WORK') && h.outcomes.filter((o) => o.outcome === 'DONE').length === 2);

  const sw = buildSeries(h.days, 'SHOP', 7);
  check('seri: dükkanda yalnızca kayıtlı gün', sw.trackedDays === 1 && sw.avg === null);
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
