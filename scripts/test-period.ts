/**
 * "Tüm günlerin değerlendirmesi" testi: dönem hesabı, toplamlar, gün satırları, komut içeriği (gizlilik dahil),
 * cevabın doğrulanması, saklama, veritabanından toplama, günlük cevapla birlikte kaydetme ve yedek.
 * Çalıştırmak için:  npm run test:period
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addDayEvent,
  createTask,
  saveJournalEntry,
  setMoodLog,
  setWeightLog,
  upsertDailyStat,
  upsertSleepLog,
} from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { buildManualReviewPrompt, buildAllDaysManualPrompt, describePeriod, saveManualReview } from '../services/dayReview';
import { buildReviewPrompt, hasBannedWords, type DayFacts } from '../services/dayReviewLogic';
import { addSmoke } from '../services/dayFlow';
import { saveExerciseSession } from '../services/exercise';
import { addWater } from '../services/nutrition';
import {
  MAX_PERIOD_DAYS,
  MAX_STORED_REVIEWS,
  PERIOD_KEY,
  WORK_NOTE,
  addStored,
  buildPeriodPrompt,
  dayLine,
  dayShortLabel,
  parsePeriodExtras,
  parseStored,
  periodRangeLabel,
  periodSpan,
  periodStats,
  routineChancesOn,
  serializeStored,
  statLines,
  type PeriodDay,
  type PeriodFacts,
  type StoredPeriodReview,
} from '../services/periodLogic';
import { gatherPeriodFacts, loadPeriodReviews } from '../services/periodReview';
import { acceptRoutine, addRoutineFromTemplate, markRoutineDone } from '../services/routineFlow';
import { completeTask } from '../services/taskFlow';
import { windowKeys } from '../services/weeklyLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

const emptyDay = (k: string): PeriodDay => ({
  day: k, tasksDone: 0, taskMinutes: 0, routinesDone: 0, routineChances: 0, steps: null, screenMinutes: null, sleepMinutes: null,
  hardDay: false, waterMl: 0, exercise: null, mood: null, smoke: null, languageMinutes: null, roadMinutes: null, siteMinutes: null,
});

const baseToday = {
  day: day(16), tasksDone: [], tasksOpen: 0, driftMinutes: 0, routinesDone: [], routinesSkipped: [], routinesOpen: [],
  energy: { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 }, steps: null, stepsReliable: false, screenMinutes: null, sleepMinutes: null, sleepBed: null, sleepWake: null,
  peakStartHour: 9, peakEndHour: 12,
} as DayFacts;

async function main(): Promise<void> {
  console.log('Dönem hesabı');
  check('veri yoksa yalnızca bugün', periodSpan(null, day(16)).days === 1 && periodSpan(day(20), day(16)).days === 1);
  check('ilk günden bugüne, bugün dahil', periodSpan(day(12), day(16)).days === 5 && periodSpan(day(12), day(16)).from === day(12));
  check('bugün ilk gün ise 1 gün', periodSpan(day(16), day(16)).days === 1);
  const old = periodSpan('2026-06-01', day(16));
  check('60 günden uzunsa son 60 gün alınır ve belirtilir', old.days === MAX_PERIOD_DAYS && old.capped && old.from === windowKeys(day(16), 60)[0]);
  check('tam 60 gün sınırlanmış sayılmaz', !periodSpan(windowKeys(day(16), 60)[0], day(16)).capped);

  console.log('Rutin şansı');
  const rts = [
    { title: 'A', createdDay: day(10), doneDays: [day(12)], days: null },
    { title: 'B', createdDay: day(14), doneDays: [], days: [1] }, // yalnızca Pazartesi
  ];
  check('eklenmeden önceki gün sayılmaz', routineChancesOn(rts, day(12), day(16), true) === 1);
  check('planlı olmayan gün sayılmaz, planlı gün sayılır', routineChancesOn(rts, day(15), day(16), true) === 1 && routineChancesOn(rts, day(16), day(16), true) === 2);
  check('bitmemiş son gün, yapılmadıysa sayılmaz', routineChancesOn(rts, day(16), day(16), false) === 0);
  check('yapılmış rutin son günde de sayılır', routineChancesOn([{ ...rts[0], doneDays: [day(16)] }], day(16), day(16), false) === 1);

  console.log('Toplamlar ve gün satırları');
  const keys = windowKeys(day(16), 5);
  const days = keys.map(emptyDay);
  days[0] = { ...days[0], mood: 4, steps: 5000, screenMinutes: 120, routinesDone: 1, routineChances: 2, waterMl: 2100, roadMinutes: 80, siteMinutes: 590 };
  days[1] = { ...days[1], mood: 2, exercise: 'DONE', tasksDone: 1, taskMinutes: 30, routinesDone: 1, routineChances: 2, smoke: 6, languageMinutes: 45 };
  days[2] = { ...days[2], mood: 3, hardDay: true, sleepMinutes: 360 };
  days[3] = { ...days[3], exercise: null };
  days[4] = { ...days[4], mood: 5, exercise: 'PLANNED', routinesDone: 1, routineChances: 2 };
  const facts: PeriodFacts = {
    from: keys[0], to: keys[4], days, capped: false, countEndDay: true, waterGoalMl: 2000,
    routines: [
      { title: 'A', createdDay: day(1), doneDays: [day(12), day(13), day(16)], days: null },
      { title: 'B', createdDay: day(1), doneDays: [], days: null },
    ],
  };
  const st = periodStats(facts);
  check('gün sayıları', st.days === 5 && st.recordedDays === 4, `kayıtlı ${st.recordedDays}`);
  check('rutin: yapılan / şans', st.routinesDone === 3 && st.routineChances === 10);
  check('egzersiz: yapılan / program günü', st.exerciseDone === 1 && st.exercisePlanned === 2);
  check('ruh hali: ortalama ve düşük gün', st.moodDays === 4 && st.moodAvg === 3.5 && st.lowMoodDays === 1);
  check('su: hedefe ulaşılan / kayıtlı gün', st.waterDays === 1 && st.waterGoalDays === 1);
  check('dil ve sigara yalnızca kayıtlı günlerden', st.languageDays === 1 && st.languageMinutes === 45 && st.smokeDays === 1 && st.smokeAvg === null);
  check('yolda ve iş yerinde: en az 3 gün olmadıkça ortalama yok', st.roadDays === 1 && st.roadAvg === null && st.siteAvg === null);
  const lines = statLines(st);
  check('"şu kadar günde böyle" satırları', lines[0] === 'Kayıt olan gün: 4 / 5' && lines.includes('Rutin: 3 / 10 (%30)') && lines.includes('Egzersiz: 1 / 2 program günü'));
  check('ruh hali satırı virgüllü ve düşük gün sayılı', lines.some((l) => l.startsWith('Ruh hali: ortalama 3,5 / 5 (4 gün kayıt, 1 gün düşük)')));
  check('zor gün ve su satırı', lines.includes('Zor gün modu: 1 gün') && lines.includes('Su: 1 / 1 kayıtlı günde hedefe ulaşıldı'));
  check('kayıt olmayan konu yazılmaz (adım ortalaması < 3 gün)', !lines.some((l) => l.startsWith('Adım') || l.startsWith('Ekran') || l.startsWith('Uyku')));
  check('satırlarda yargılayıcı sözcük yok', lines.every((l) => !hasBannedWords(l)));
  const l0 = dayLine(days[0]);
  check('gün satırı: tarih, gün adı, alanlar', l0.startsWith('- 2026-11-12 Per:') && l0.includes('5.000 adım') && l0.includes('ekran 2 sa') && l0.includes('yolda 1 sa 20 dk') && l0.includes('iş yerinde 9 sa 50 dk') && l0.includes('ruh hali 4/5') && l0.includes('rutin 1/2') && l0.includes('su 2100 ml'));
  check('egzersiz günü olup yapılmadıysa kayıt yok denir, yapılmadı denmez', dayLine(days[4]).includes('egzersiz günüydü, seans kaydı yok') && !dayLine(days[4]).includes('yapılmadı'));
  check('boş gün: "kayıt yok"', dayLine(days[3]) === '- 2026-11-15 Paz: kayıt yok');
  check('sıfırlar yazılmaz', !l0.includes('görev') && !/(^|[ :])0( |$|\/)/.test(dayLine(days[2]).split(': ').slice(1).join(': ')));
  check('gün etiketi', dayShortLabel('2026-11-12') === '12 Kas Per' && periodRangeLabel(day(12), day(16)) === '12–16 Kasım');

  console.log('Komut');
  const prompt = buildPeriodPrompt(facts, st, baseToday, ['Su iç']);
  check('başlık gün sayısını ve aralığı söyler', prompt.includes('TÜM GÜNLERİN ÖZETİ: 5 gün (2026-11-12 – 2026-11-16)'));
  check('her gün bir satır', keys.every((k) => prompt.includes(`- ${k} `)));
  check('uygulamanın hesapladığı toplamlar komutta', prompt.includes('- Rutin: 3 / 10 (%30)') && prompt.includes('Uygulamanın hesapladığı toplamlar'));
  check('şoför bilgisi ve konum uydurma yasağı', prompt.includes(WORK_NOTE) && prompt.includes('Konum verisi verilmedi') && prompt.includes('yazılmayan şeyi uydurma'));
  check('kayıt yok = sıfır değil kuralı', prompt.includes('sıfır demek değildir') && prompt.includes('"yapılmadı" diye yorumlama'));
  check('dönem alanları istenir', ['periodSummary', 'patterns', 'dayNotes', 'nextPeriod'].every((k) => prompt.includes(`"${k}"`)));
  check('"Son 5 günde" ile başlama kuralı', prompt.includes('"Son 5 günde"'));
  check('günlük alanlar da istenir (bugünün değerlendirmesi kaybolmaz)', ['"reflection"', '"tomorrow"', '"ideas"', '"timeUse"', '"screenAlternatives"'].every((k) => prompt.includes(k)));
  check('bugünün özeti ve var olan rutinler komutta', prompt.includes('Bugünün özeti') && prompt.includes('Zaten var olan rutinler (bunları tekrar önerme): Su iç'));
  check('sürüş sırasında telefon önerme kuralı', prompt.includes('Sürüş sırasında telefon kullanımı gerektiren fikir verme'));
  check('görev satırı dönem görevine çevrildi', prompt.includes('GÖREV: Önce bu 5 günü bir bütün olarak') && !prompt.includes('GÖREV: Günü yargılamadan değerlendir,'));
  check('JSON örneği dönem alanlarını içerir ve tek kod bloğu istenir', prompt.includes('{"periodSummary":') && prompt.trimEnd().endsWith('Kod bloğunun dışına açıklama yazma.'));
  check('yargılayıcı sözcükler yalnızca yasak listesinde geçer', !prompt.replace(/Kullanıcıyı şu sözcüklerle ASLA tanımlama:[^\n]*/, '').split('\n').some((l) => hasBannedWords(l) && !l.includes('"boşa"') && !l.includes('değer yargısı')));
  check('günlük komut değişmedi', buildReviewPrompt(baseToday, [], true).includes('GÖREV: Günü yargılamadan değerlendir,') && !buildReviewPrompt(baseToday, [], true).includes('TÜM GÜNLER'));
  const big: PeriodFacts = { ...facts, days: windowKeys(day(16), 60).map((k) => ({ ...emptyDay(k), mood: 3, steps: 4000, screenMinutes: 100, sleepMinutes: 380, routineChances: 4, routinesDone: 2, waterMl: 1500, roadMinutes: 70, siteMinutes: 500 })), capped: true, from: windowKeys(day(16), 60)[0] };
  const bigPrompt = buildPeriodPrompt(big, periodStats(big), baseToday, []);
  check('60 günlük komut makul boyutta ve "en son 60 gün" der', bigPrompt.length < 20000 && bigPrompt.includes('en son 60 gün') && bigPrompt.includes('"Son 60 günde"'), String(bigPrompt.length));

  console.log('Cevabın doğrulanması');
  const valid = keys;
  const ok = parsePeriodExtras(
    {
      periodSummary: 'Son 5 günde 3 günde rutin yapıldı. Ruh hali dalgalı seyretti.',
      patterns: ['Egzersiz yapılan günde ruh hali ve adım birlikte görünüyor.', 'Egzersiz yapılan günde ruh hali ve adım birlikte görünüyor.', 'x', 'Hafta sonu ekran süresi daha yüksek görünüyor.', 'Üçüncü gözlem burada duruyor.', 'Dördüncü gözlem atılır.'],
      dayNotes: [{ day: day(13), note: 'Egzersiz günü.' }, { day: day(12), note: 'Sakin bir gün.' }, { day: day(12), note: 'Tekrar' }, { day: '2026-10-01', note: 'Dönem dışı' }, { day: day(14), note: 'ab' }, { day: day(15), note: 'Tembel bir gün' }],
      nextPeriod: 'Önümüzdeki günlerde sabah saatlerini koru.',
    },
    valid
  );
  check('geçerli cevap okunur', !!ok && ok.summary.startsWith('Son 5 günde'));
  check('örüntüler: tekrar, kısa ve 3 sınırı', ok?.patterns.length === 3 && new Set(ok.patterns).size === 3);
  check('gün notları: dönem dışı, tekrar, çok kısa, yargılayıcı atılır; tarihe göre sıralı', ok?.dayNotes.map((n) => n.day).join() === `${day(12)},${day(13)}`);
  check('gelecek dönem yaklaşımı', ok?.next.startsWith('Önümüzdeki') === true);
  check('dönem özeti yoksa null', parsePeriodExtras({ reflection: 'a', tomorrow: 'b' }, valid) === null && parsePeriodExtras(null, valid) === null);
  check('özet yargılayıcı sözcük içerirse null', parsePeriodExtras({ periodSummary: 'Bu günlerde çok tembel görünüyorsun.' }, valid) === null);
  check('kısa özet null', parsePeriodExtras({ periodSummary: 'Kısa' }, valid) === null);
  const minimal = parsePeriodExtras({ periodSummary: 'Son 5 günde kayıtlar dengeli görünüyor.' }, valid);
  check('yalnızca özet varsa diğer alanlar boş gelir', !!minimal && minimal.patterns.length === 0 && minimal.dayNotes.length === 0 && minimal.next === '');

  console.log('Saklama');
  const rec = (to: string, i = 0): StoredPeriodReview => ({ from: day(1), to, days: 5, savedAt: `2026-11-16T2${i}:00:00.000Z`, stats: ['a'], summary: 'Özet metni burada', patterns: [], dayNotes: [{ day: day(12), note: 'n' }], next: '' });
  let list: StoredPeriodReview[] = [];
  list = addStored(list, rec(day(10)));
  list = addStored(list, rec(day(11)));
  check('yenisi başa eklenir', list[0].to === day(11) && list.length === 2);
  list = addStored(list, { ...rec(day(11)), summary: 'Yeni özet metni' });
  check('aynı son güne ait kayıt değişir', list.length === 2 && list[0].summary === 'Yeni özet metni');
  for (let i = 12; i < 22; i += 1) list = addStored(list, rec(day(i)));
  check(`en çok ${MAX_STORED_REVIEWS} kayıt`, list.length === MAX_STORED_REVIEWS && list[0].to === day(21));
  const round = parseStored(serializeStored(list));
  check('kaydedip okuyunca aynı', JSON.stringify(round) === JSON.stringify(list));
  check('bozuk metin boş liste verir', parseStored('{bozuk').length === 0 && parseStored(null).length === 0 && parseStored('{"a":1}').length === 0);
  check('bozuk kayıtlar atlanır', parseStored(JSON.stringify([{ from: 'x' }, rec(day(10)), { from: day(1), to: day(2), summary: '' }])).length === 1);

  console.log('Veritabanından toplama');
  const t = makeTestDb();
  const { db, raw } = t;
  await migrateDbIfNeeded(db);
  const none = await describePeriod(db, at(21, 30));
  check('hiç veri yokken 1 gün, yeterli değil', none.days === 1 && !none.enough);

  const rA = await addRoutineFromTemplate(db, 'su-ic');
  const rB = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  raw.exec("UPDATE Routine SET createdAt = '2026-11-01T10:00:00.000Z'");
  await markRoutineDone(db, rA, at(10, 0, 12));
  await markRoutineDone(db, rA, at(10, 0, 13));
  await markRoutineDone(db, rA, at(10, 0, 16));
  await acceptRoutine(db, rB, at(9, 0, 16));
  await setMoodLog(db, day(12), 4, at(20, 0, 12));
  await setMoodLog(db, day(13), 2, at(20, 0, 13), 'gizli-not-ruh-777');
  await setMoodLog(db, day(16), 5, at(20, 0, 16));
  await upsertDailyStat(db, { day: day(12), steps: 5000, screenMinutes: 120, topApps: [] });
  await upsertDailyStat(db, { day: day(13), steps: 3000, screenMinutes: 200, topApps: [] });
  await upsertSleepLog(db, { day: day(13), bedtime: at(0, 30, 13).toISOString(), wakeTime: at(6, 30, 13).toISOString(), durationMinutes: 360 });
  await addWater(db, at(9, 0, 12), 500);
  await addWater(db, at(15, 0, 12), 1700);
  for (const m of [10, 11, 12]) await addSmoke(db, at(m, 0, 13));
  await saveExerciseSession(db, [{ move: 'legs', level: 1, sets: [5, 4, 4] }], at(6, 40, 13));
  const tk = await createTask(db, { title: 'Rapor yaz', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  await completeTask(db, tk, 'HIGH', at(15, 0, 13));
  await addDayEvent(db, day(12), 'BUS', at(7, 0, 12));
  await addDayEvent(db, day(12), 'SHOP_IN', at(7, 40, 12));
  await addDayEvent(db, day(12), 'SHOP_OUT', at(17, 30, 12));
  await addDayEvent(db, day(12), 'BUS', at(17, 35, 12));
  await addDayEvent(db, day(12), 'HOME', at(18, 15, 12));
  await addDayEvent(db, day(13), 'BUS', at(7, 0, 13));
  await addDayEvent(db, day(13), 'SHOP_IN', at(7, 30, 13));
  await saveJournalEntry(db, day(13), { good: 'gizli-gunluk-123', grateful: '', goal: '' }, at(21, 0, 13));
  await setWeightLog(db, day(13), 81.4, at(7, 0, 13));

  const now = at(21, 30, 16);
  const span = await describePeriod(db, now);
  check('ilk veri günü 12 Kasım: 5 gün, yeterli', span.days === 5 && span.from === day(12) && span.to === day(16) && span.enough && !span.capped, JSON.stringify(span));
  const gf = await gatherPeriodFacts(db, now);
  check('5 gün, eskiden yeniye', gf.days.length === 5 && gf.days[0].day === day(12) && gf.days[4].day === day(16));
  const [d12, d13, d14, d15, d16] = gf.days;
  check('adım, ekran, uyku, su', d12.steps === 5000 && d12.screenMinutes === 120 && d12.waterMl === 2200 && d13.sleepMinutes === 360);
  check('ruh hali gün gün', d12.mood === 4 && d13.mood === 2 && d14.mood === null && d16.mood === 5);
  check('sigara yalnızca kullanılan günde', d13.smoke === 3 && d12.smoke === null);
  check('görev 13 Kasım\'da', d13.tasksDone === 1 && d12.tasksDone === 0);
  check('rutin: günde 2 şans, yapılanlar', gf.days.every((d) => d.routineChances === 2) && d12.routinesDone === 1 && d14.routinesDone === 0 && d16.routinesDone === 1);
  check('egzersiz: 13 yapıldı, 16 program günü ama kayıt yok, diğerleri null', d13.exercise === 'DONE' && d16.exercise === 'PLANNED' && d12.exercise === null && d15.exercise === null);
  check('yol ve iş yeri damgalardan: 12 Kasım', d12.roadMinutes === 80 && d12.siteMinutes === 590, `${d12.roadMinutes}/${d12.siteMinutes}`);
  check('çıkış damgası olmayan geçmiş günün iş süresi bilinmez, yol bilinir', d13.roadMinutes === 30 && d13.siteMinutes === null);
  check('damgası olmayan günde ikisi de yok', d14.roadMinutes === null && d14.siteMinutes === null);

  console.log('Komut ve gizlilik (veritabanından)');
  const built = await buildAllDaysManualPrompt(db, now);
  check('komut 5 gün der', built.days === 5 && built.text.includes('TÜM GÜNLERİN ÖZETİ: 5 gün'));
  check('gün satırları gerçek veriyle', built.text.includes('- 2026-11-13 Cum:') && built.text.includes('egzersiz yapıldı') && built.text.includes('sigara 3'));
  check('ruh hali notu, günlük yazısı ve kilo komuta girmez', !built.text.includes('gizli-not-ruh-777') && !built.text.includes('gizli-gunluk-123') && !built.text.includes('81,4') && !built.text.includes('81.4'));
  check('gün komutu yine çalışır ve dönem içermez', !(await buildManualReviewPrompt(db, now)).includes('TÜM GÜNLERİN'));

  console.log('Cevabı kaydetme');
  const answer = (extra: Record<string, unknown>) =>
    '```json\n' +
    JSON.stringify({
      reflection: 'Bugün ruh halin iyiydi. Rutinlerden biri tamam.',
      tomorrow: 'Yarın sabahın ilk işini bitir.',
      ideas: [],
      ...extra,
    }) +
    '\n```';
  const full = answer({
    periodSummary: 'Son 5 günde 3 günde rutin yapıldı. Ruh hali dalgalı seyretti.',
    patterns: ['Egzersiz yapılan günde ruh hali düşük, adım yüksek birlikte görünüyor.'],
    dayNotes: [{ day: day(12), note: 'Yolda geçen süre uzundu.' }, { day: day(13), note: 'Egzersiz günü.' }, { day: '2026-10-01', note: 'dönem dışı' }],
    nextPeriod: 'Önümüzdeki günlerde sabah saatlerini koru.',
  });
  const saved = await saveManualReview(db, now, full);
  check('günün değerlendirmesi eskisi gibi kaydolur', saved.payload.reflection.startsWith('Bugün ruh halin') && saved.payload.source === 'MANUAL');
  const stored = await loadPeriodReviews(db);
  check('dönem değerlendirmesi de saklanır', stored.length === 1 && stored[0].days === 5 && stored[0].from === day(12) && stored[0].to === day(16));
  check('gün notları: dönem dışı atıldı', stored[0].dayNotes.length === 2);
  check('"şu kadar günde böyle" satırları uygulamadan gelir', stored[0].stats[0] === 'Kayıt olan gün: 3 / 5' && stored[0].stats.includes('Egzersiz: 1 / 2 program günü') && stored[0].stats.some((s) => s.startsWith('Rutin: 3 / 10')), JSON.stringify(stored[0].stats));
  await saveManualReview(db, now, answer({}));
  check('yalnızca günlük cevap dönem kaydını silmez ya da çoğaltmaz', (await loadPeriodReviews(db)).length === 1);
  const bad = await saveManualReview(db, now, answer({ periodSummary: 'Bu günlerde çok tembel göründün.' }));
  check('uygunsuz dönem özeti atılır, günlük kayıt kalır', (await loadPeriodReviews(db)).length === 1 && bad.payload.tomorrow.length > 0);
  await saveManualReview(db, now, answer({ periodSummary: 'Son 5 günde kayıtlar dengeli görünüyor.' }));
  const again = await loadPeriodReviews(db);
  check('aynı gün yeniden eklenirse değişir (çoğalmaz)', again.length === 1 && again[0].summary.startsWith('Son 5 günde kayıtlar dengeli'));

  console.log('Yedek');
  check('dönem kaydı Setting tablosunda ve yedeğe girer', (raw.prepare('SELECT COUNT(*) AS n FROM Setting WHERE key = ?').get(PERIOD_KEY) as { n: number }).n === 1);
  const text = await createBackup(db, {}, now);
  const b = makeTestDb();
  await migrateDbIfNeeded(b.db);
  check('geri yükleyince dönem değerlendirmesi gelir', (await restoreBackup(b.db, text)).ok === true && (await loadPeriodReviews(b.db)).length === 1);

  console.log('Ekran ve bağlantılar');
  const screen = readFileSync(join(root, 'app/review.tsx'), 'utf8');
  check('ekranda "Tüm günleri kopyala" ve sonuç kartı', screen.includes('Tüm günleri kopyala') && screen.includes('Tüm günlerin değerlendirmesi') && screen.includes('Gün gün notlar'));
  check('dönem seçimi yok (hepsi otomatik)', !screen.includes('Kendin seç') && !screen.includes('7 gün') && !screen.includes('30 gün'));
  check('şema sürümü 14 (dönem yorumu Setting\'te, konum tabloları v14\'te)', DATABASE_VERSION === 14);
  check('dosyalar var', existsSync(join(root, 'services/periodLogic.ts')) && existsSync(join(root, 'services/periodReview.ts')));
  const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);
  check('metinlerde yeni emoji yok', !tooNew(screen) && !tooNew(readFileSync(join(root, 'services/periodLogic.ts'), 'utf8')));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
