/**
 * Analiz testi (saf mantık + gerçek SQLite). Çalıştırmak için:  npm run test:analysis
 */
import { addStudyLog, addWaterLog, insertVocab, saveJournalEntry, upsertDailyStat } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { countWords, loadAnalysis } from '../services/analysis';
import {
  DAMACANA_ML,
  DEFAULT_STRIDE_M,
  LANDMARKS,
  analyze,
  clampDays,
  compareDistance,
  compareJournal,
  compareWater,
  daysFromFraction,
  emptyData,
  fmtKm,
  fmtLiters,
  fmtNum,
  fractionFromDays,
  journalCompareText,
  quickPicks,
  spanDays,
  strideFromHeight,
  windowLabel,
  wordRateText,
} from '../services/analysisLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('Aralık ve sürgü');
check('kayıt yoksa 1 gün', spanDays(null, '2026-11-26') === 1);
check('ilk kayıt bugünse 1 gün', spanDays('2026-11-26', '2026-11-26') === 1);
check('11 gün önceki kayıt 12 gün (bugün dahil)', spanDays('2026-11-15', '2026-11-26') === 12);
check('ay ve yıl geçişi', spanDays('2025-12-31', '2026-01-02') === 3);
check('gelecekteki ilk gün 1 gün', spanDays('2026-12-01', '2026-11-26') === 1);
check('sınır: en az 1, en çok span', clampDays(0, 30) === 1 && clampDays(99, 30) === 30 && clampDays(12.4, 30) === 12 && clampDays(NaN, 30) === 1);
check('sürgü uçları', daysFromFraction(0, 48) === 1 && daysFromFraction(1, 48) === 48);
check('sürgü taşması kırpılır', daysFromFraction(-3, 48) === 1 && daysFromFraction(9, 48) === 48);
check('span 1 iken hep 1', daysFromFraction(0.7, 1) === 1 && fractionFromDays(1, 1) === 0);
let roundTrip = true;
for (const span of [2, 7, 48, 365, 2000]) for (let d = 1; d <= span; d += Math.max(1, Math.floor(span / 37))) if (daysFromFraction(fractionFromDays(d, span), span) !== d) roundTrip = false;
check('gün -> konum -> gün her değerde aynı', roundTrip);
check('sürgü yekpare ve artan', (() => {
  let prev = 0;
  for (let i = 0; i <= 100; i++) {
    const d = daysFromFraction(i / 100, 500);
    if (d < prev) return false;
    prev = d;
  }
  return true;
})());
check('hızlı seçimler sınırın altındakiler + Tümü', quickPicks(48).map((p) => p.label).join() === '1 gün,1 hafta,1 ay,Tümü');
check('uzun sürede yıl da var', quickPicks(800).map((p) => p.label).join() === '1 gün,1 hafta,1 ay,3 ay,1 yıl,Tümü');
check('span 1 iken yalnızca Bugün', quickPicks(1).length === 1 && quickPicks(1)[0].label === 'Bugün' && quickPicks(1)[0].days === 1);
check('tümü seçeneği span gündür', quickPicks(48)[quickPicks(48).length - 1].days === 48);
check('etiket: bugün', windowLabel(1, 48, '2026-11-26') === 'Bugün');
check('etiket: son N gün', windowLabel(30, 48, '2026-11-26') === 'Son 30 gün · 28 Eki – 26 Kas', windowLabel(30, 48, '2026-11-26'));
check('etiket: tüm zamanlar', windowLabel(48, 48, '2026-11-26') === 'Tüm zamanlar · 48 gün');

console.log('Sayı biçimi');
check('virgüllü ondalık', fmtNum(3.26, 1) === '3,3' && fmtNum(0.6, 1) === '0,6', fmtNum(3.26, 1));
check('tam sayı ondalıksız', fmtNum(12, 1) === '12');
check('büyük sayıda binlik nokta', fmtNum(12345.6) === '12.346');
check('km biçimi', fmtKm(3.456) === '3,46 km' && fmtKm(12.34) === '12,3 km');
check('litre biçimi', fmtLiters(1500) === '1,5 L' && fmtLiters(120_000) === '120 L', fmtLiters(120_000));

console.log('Adım uzunluğu');
check('boyu 175 cm olanın adımı ≈ 72,6 cm', near(strideFromHeight(175).m, 0.726, 0.002) && !strideFromHeight(175).assumed);
check('boy yoksa varsayılan', strideFromHeight(null).m === DEFAULT_STRIDE_M && strideFromHeight(null).assumed);
check('saçma boy varsayılana döner', strideFromHeight(40).assumed && strideFromHeight(400).assumed && strideFromHeight(NaN).assumed);
check('çok uzun boyda sınır', strideFromHeight(229).m <= 1.1);

console.log('Yol kıyası');
check('sıfır yol kıyaslanmaz', compareDistance(0) === null && compareDistance(-3) === null && compareDistance(NaN) === null);
const d50 = compareDistance(0.05)!;
check('50 m: sahanın yüzde 48 kadarı', d50.text === 'bir futbol sahası boyunun yüzde 48 kadarı', d50.text);
check('çok kısa yolda en az yüzde 1', compareDistance(0.0001)!.text.includes('yüzde 1 '), compareDistance(0.0001)!.text);
const d1 = compareDistance(1)!;
check('1 km: Burj Khalifa’nın 1,2 katı', d1.landmark.id === 'burj' && d1.text === "Burj Khalifa'nın yüksekliğinin 1,2 katı", d1.text);
check('sıradaki hedef 15 Temmuz Köprüsü', d1.next?.landmark.id === 'koprusu' && near(d1.next!.ratio, 1000 / 1560) && near(d1.next!.remainingKm, 0.56));
check('maraton tam sınırda', compareDistance(42.195)!.landmark.id === 'maraton');
check('maratonun hemen altında Everest’in katı', compareDistance(42.0)!.landmark.id === 'everest');
check('200 km İstanbul–Edirne’nin yüzde değil, maratonun katı', compareDistance(200)!.landmark.id === 'maraton' && compareDistance(200)!.text.includes('katı'));
check('1000 km Dünya çevresine yaklaşırken son küçük hedef', compareDistance(1000)!.landmark.id === 'izmir');
check('Dünya çevresi geçilince Ay hedefi', compareDistance(41_000)!.landmark.id === 'dunya' && compareDistance(41_000)!.next?.landmark.id === 'ay');
check('Ay’ı geçince sıradaki hedef yok', compareDistance(500_000)!.next === null);
check('yapılar artan sıralı', LANDMARKS.every((l, i) => i === 0 || LANDMARKS[i - 1].m < l.m));
check('hedef oranı 0-1', (() => {
  for (const km of [0.01, 0.3, 5, 40, 300, 5000, 100000]) {
    const r = compareDistance(km)!.next;
    if (r && (r.ratio < 0 || r.ratio > 1 || r.remainingKm <= 0)) return false;
  }
  return true;
})());

console.log('Su kıyası');
check('1 damacana', compareWater(DAMACANA_ML).damacana === 1 && compareWater(DAMACANA_ML).full === 1 && compareWater(DAMACANA_ML).fraction === 0);
check('yarım damacana', compareWater(9500).text === 'bir damacananın yüzde 50 kadarı' && compareWater(9500).full === 0 && near(compareWater(9500).fraction, 0.5));
check('2,5 damacana', compareWater(47_500).text === '2,5 damacana' && compareWater(47_500).full === 2 && near(compareWater(47_500).fraction, 0.5));
check('3 damacana tam (kayan nokta hatası yok)', compareWater(57_000).full === 3 && compareWater(57_000).fraction === 0);
check('sıfır su', compareWater(0).damacana === 0 && compareWater(-5).damacana === 0);
check('küçük hacim yüzdesi', compareWater(1900).text === 'bir damacananın yüzde 10 kadarı');

console.log('Günlük kıyası');
check('yazı yok', compareJournal(0).text === 'henüz yazı yok');
check('250 kelime = 1 sayfa', near(compareJournal(250).pages, 1) && compareJournal(250).text.startsWith('yaklaşık 1 kitap sayfası'));
check('50 bin kelime = 200 sayfa = 1 roman', near(compareJournal(50_000).novels, 1) && compareJournal(50_000).text.includes('1 kısa roman'), compareJournal(50_000).text);
check('kelime sayısı', countWords('  bugün  hava güzeldi \n çok ') === 4 && countWords('') === 0 && countWords('   ') === 0);

// ───────────── Sentetik veri ─────────────
// Bugün 2026-11-26; ilk kayıt 40 gün önce (span 41).
const TODAY = '2026-11-26';
const dayAgo = (n: number): string => {
  const d = new Date(2026, 10, 26 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const base = emptyData(TODAY);
base.firstDay = dayAgo(40);
base.heightCm = 175;
for (let i = 0; i < 41; i++) {
  if (i % 2 === 0) base.stepsByDay[dayAgo(i)] = 8000; // 21 kayıtlı gün
  base.waterByDay[dayAgo(i)] = 2000; // her gün 2 L
}
for (let i = 0; i < 10; i++) base.appByDay[dayAgo(i)] = 30; // son 10 gün, günde 30 dk uygulama (Duolingo)
for (let i = 0; i < 20; i++) base.journalByDay[dayAgo(i)] = 100; // son 20 gün, günde 100 kelime
for (let i = 20; i < 30; i++) base.journalByDay[dayAgo(i)] = 60; // önceki 10 gün
base.learned = [
  { day: dayAgo(1) },
  { day: dayAgo(3) },
  { day: dayAgo(5) },
  { day: dayAgo(25) },
  { day: null },
];
base.addedDays = [dayAgo(2), dayAgo(30), dayAgo(31)];

console.log('Analiz: son 10 gün');
const a10 = analyze(base, 10);
check('pencere 10 gün, bitiş bugün', a10.days === 10 && a10.to === TODAY && a10.from === dayAgo(9));
check('dil: uygulama 300 dk = 5 saat, 10 gün', a10.language.minutes === 300 && near(a10.language.hours, 5) && a10.language.studyDays === 10);
check('dil: aralıktaki öğrenilen 3 (tarihi bilinmeyen ve eskiler hariç)', a10.language.learned === 3, String(a10.language.learned));
check('dil: eklenen 1', a10.language.added === 1);
check('dil: saatte 0,6 kelime (3/5)', a10.language.wordsPerHour !== null && near(a10.language.wordsPerHour, 0.6));
check('adım: 5 kayıtlı gün x 8000', a10.steps.days === 5 && a10.steps.steps === 40_000, `${a10.steps.days} ${a10.steps.steps}`);
check('adım: km = adım x adım uzunluğu', near(a10.steps.km, (40_000 * strideFromHeight(175).m) / 1000, 1e-9));
check('adım: ortalama yalnızca kayıtlı günlerden', a10.steps.avgPerDay === 8000);
check('adım: kıyas var', a10.steps.compare !== null && a10.steps.compare.text.length > 5);
check('su: 10 gün x 2 L', a10.water.ml === 20_000 && a10.water.days === 10 && a10.water.avgMlPerDay === 2000);
check('su: 20 L = 1,1 damacana', a10.water.compare.full === 1 && a10.water.compare.text === '1,1 damacana', a10.water.compare.text);
check('günlük: 10 gün x 100 kelime', a10.journal.entries === 10 && a10.journal.words === 1000 && a10.journal.avgWords === 100);
check('günlük kıyası: önceki 10 günde de 100 kelime x 10', a10.journalVsPrevious !== null && a10.journalVsPrevious.previousWords === 1000 && a10.journalVsPrevious.diffWords === 0, JSON.stringify(a10.journalVsPrevious));

console.log('Analiz: kıyas koşulları');
const a15 = analyze(base, 15);
check('önceki aralık 10 günlük yazı + 5 günlük yazı', a15.journalVsPrevious !== null && a15.journalVsPrevious.previousWords === 5 * 100 + 10 * 60, JSON.stringify(a15.journalVsPrevious));
check('günlük farkı = şimdiki - önceki', a15.journalVsPrevious!.diffWords === 15 * 100 - (5 * 100 + 10 * 60));
check('önceki aralık kayıt öncesine taşarsa kıyas yok (21 gün, span 41)', analyze(base, 21).journalVsPrevious === null);
check('tüm zamanlarda kıyas yok', analyze(base, 41).journalVsPrevious === null);
check('1 gün: önceki gün kıyası', analyze(base, 1).journalVsPrevious !== null && analyze(base, 1).journalVsPrevious!.previousWords === 100);
check('kıyas metni: fazla', journalCompareText({ previousWords: 600, previousEntries: 10, diffWords: 400 }, 10) === 'Önceki 10 güne göre 400 kelime fazla (önceki aralıkta 600 kelime)');
check('kıyas metni: az', journalCompareText({ previousWords: 600, previousEntries: 10, diffWords: -200 }, 7)!.includes('200 kelime az'));
check('kıyas metni: önceki gün', journalCompareText({ previousWords: 100, previousEntries: 1, diffWords: 5 }, 1)!.startsWith('Önceki güne göre'));
check('kıyas metni: ikisi de boşsa yok', journalCompareText({ previousWords: 0, previousEntries: 0, diffWords: 0 }, 7) === null && journalCompareText(null, 7) === null);

console.log('Analiz: tüm zamanlar');
const aAll = analyze(base, 999);
check('sınır span’a kırpılır', aAll.days === 41);
check('tüm zamanlarda tarihi bilinmeyen öğrenilen kelime de sayılır', aAll.language.learned === 5, String(aAll.language.learned));
check('tüm zamanlarda eklenen 3', aAll.language.added === 3);
check('adım: 21 kayıtlı gün', aAll.steps.days === 21 && aAll.steps.steps === 168_000);
check('su: 41 gün', aAll.water.ml === 82_000 && aAll.water.compare.full === 4);
check('dil toplamı sürgü büyüdükçe azalmaz', (() => {
  let prev = 0;
  for (let n = 1; n <= 41; n++) {
    const m = analyze(base, n).language.minutes;
    if (m < prev) return false;
    prev = m;
  }
  return true;
})());
check('adım, su ve günlük toplamları sürgü büyüdükçe azalmaz', (() => {
  let ps = 0;
  let pw = 0;
  let pj = 0;
  for (let n = 1; n <= 41; n++) {
    const r = analyze(base, n);
    if (r.steps.steps < ps || r.water.ml < pw || r.journal.words < pj) return false;
    ps = r.steps.steps;
    pw = r.water.ml;
    pj = r.journal.words;
  }
  return true;
})());

console.log('Kelime hızı');
check('çalışma 1 saatin altındaysa hız yok', analyze(base, 1).language.wordsPerHour === null);
check('hızsız aralıkta açıklama ve tüm zamanlar hızı', (() => {
  const r = analyze(base, 1);
  const t = wordRateText(r.language, r.languageAllTimeRate);
  return t.includes('en az 1 saat') && t.includes('Tüm zamanlarda uygulamada saatte ortalama 1 kelime');
})(), (() => { const r = analyze(base, 1); return wordRateText(r.language, r.languageAllTimeRate); })());
check('çalışma yoksa yargısız açıklama', wordRateText({ minutes: 0, hours: 0, studyDays: 0, paperMinutes: 0, otherMinutes: 0, learned: 0, added: 0, wordsPerHour: null }, null) === 'Bu aralıkta dil uygulaması süresi kaydı yok.');
check('hız varsa cümle', wordRateText(a10.language, a10.languageAllTimeRate) === 'Uygulamada saatte ortalama 0,6 kelime öğrenildi');

console.log('Boş ve kısmi veri');
const empty = analyze(emptyData(TODAY), 1);
check('boş veri çökmez, hepsi sıfır', empty.language.minutes === 0 && empty.steps.steps === 0 && empty.water.ml === 0 && empty.journal.words === 0);
check('boş veride kıyas yok', empty.steps.compare === null && empty.journal.compare.text === 'henüz yazı yok');
check('boş veride ortalama null (sıfır değil)', empty.steps.avgPerDay === null && empty.water.avgMlPerDay === null && empty.journal.avgWords === null);
const noHeight = analyze({ ...base, heightCm: null }, 10);
check('boy yoksa varsayılan adım uzunluğu ve not', noHeight.steps.strideAssumed && near(noHeight.steps.km, (40_000 * 0.75) / 1000));

console.log('Yargısız dil');
const texts = [
  wordRateText(a10.language, a10.languageAllTimeRate),
  wordRateText(empty.language, null),
  a10.steps.compare!.text,
  a10.water.compare.text,
  a10.journal.compare.text,
  journalCompareText(a15.journalVsPrevious, 15) ?? '',
  windowLabel(10, 41, TODAY),
  ...LANDMARKS.map((l) => l.gen + l.short),
];
check('yasak sözcük yok', texts.every((t) => !hasBannedWords(t)));

// ───────────── Gerçek veritabanı ─────────────
async function dbTests(): Promise<void> {
  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const now = new Date(2026, 10, 26, 15, 0);

  const none = await loadAnalysis(db, now, 175);
  check('kayıt yokken span 1 ve ilk gün yok', none.span === 1 && none.data.firstDay === null);

  const when = (n: number) => new Date(2026, 10, 26 - n, 12, 0);
  await addStudyLog(db, dayAgo(10), 'PAPER', 40, when(10)); // ilk kayıt
  await addStudyLog(db, dayAgo(10), 'OTHER', 20, when(10));
  await addStudyLog(db, dayAgo(2), 'APP', 30, when(2));
  await upsertDailyStat(db, { day: dayAgo(5), steps: 9000, screenMinutes: null, topApps: [] });
  await upsertDailyStat(db, { day: dayAgo(3), steps: 7000, screenMinutes: null, topApps: [] });
  await upsertDailyStat(db, { day: dayAgo(30), steps: 0, screenMinutes: 100, topApps: [] }); // adım yok: ilk kayıt sayılmaz
  await addWaterLog(db, dayAgo(4), 500, when(4));
  await addWaterLog(db, dayAgo(4), 750, when(4));
  await addWaterLog(db, dayAgo(1), 300, when(1));
  const secret = 'çok gizli sözcük dizisi';
  await saveJournalEntry(db, dayAgo(6), { good: 'iyi geçen gün', grateful: 'sağlık', goal: secret }, when(6));
  await saveJournalEntry(db, dayAgo(1), { good: '', grateful: '', goal: '' }, when(1)); // boş günlük sayılmaz
  const card = (id: string, box: number, last: string | null, created: Date) => ({ id, word: id, meaning: 'x', note: null, box, dueDay: TODAY, lastDay: last, seen: 3, known: 2, createdAt: created.toISOString() });
  await insertVocab(db, card('a', 5, dayAgo(3), when(9)));
  await insertVocab(db, card('b', 5, dayAgo(40), when(9))); // pencere dışı
  await insertVocab(db, card('c', 2, dayAgo(1), when(8))); // öğrenilmedi

  const res = await loadAnalysis(db, now, 175);
  check('ilk kayıt 10 gün önceki dil kaydı', res.data.firstDay === dayAgo(10), String(res.data.firstDay));
  check('span 11', res.span === 11, String(res.span));
  check('dil: elle girilen uygulama kaydı uygulama süresine, kalem-kağıt ve dinleme ayrı yazılır', res.data.appByDay[dayAgo(2)] === 30 && res.data.appByDay[dayAgo(10)] === undefined && res.data.paperByDay[dayAgo(10)] === 40 && res.data.otherByDay[dayAgo(10)] === 20);
  check('adım yalnızca 0’dan büyük günler', res.data.stepsByDay[dayAgo(5)] === 9000 && res.data.stepsByDay[dayAgo(30)] === undefined);
  check('su gün başına toplanır', res.data.waterByDay[dayAgo(4)] === 1250 && res.data.waterByDay[dayAgo(1)] === 300);
  check('günlük: yalnızca kelime sayısı (iyi geçen gün 3 + sağlık 1 + hedef 4)', res.data.journalByDay[dayAgo(6)] === 8, String(res.data.journalByDay[dayAgo(6)]));
  check('boş günlük sayılmaz', res.data.journalByDay[dayAgo(1)] === undefined);
  check('günlük metni veriye taşınmaz', !JSON.stringify(res.data).includes('gizli') && !JSON.stringify(res.data).includes('sağlık'));
  check('öğrenilen kelimeler (kutu 5)', res.data.learned.length === 2);
  check('deftere eklenen günler', res.data.addedDays.length === 3);

  const r = analyze(res.data, res.span);
  check('tüm zamanlar: uygulama 30 dk, kalem-kağıt 40 ve dinleme 20 ayrı', r.language.minutes === 30 && r.language.studyDays === 1 && r.language.paperMinutes === 40 && r.language.otherMinutes === 20);
  check('tüm zamanlar: 2 öğrenilen; uygulama 1 saatten az olduğu için hız yok (ayrı süreler katılmaz)', r.language.learned === 2 && r.language.wordsPerHour === null);
  check('tüm zamanlar: 16000 adım', r.steps.steps === 16_000 && r.steps.days === 2);
  check('tüm zamanlar: 1550 ml su', r.water.ml === 1550 && r.water.days === 2);
  const r3 = analyze(res.data, 3);
  check('son 3 gün: 30 dk, öğrenilen yok (son çalışma 3 gün önce)', r3.language.minutes === 30 && r3.language.learned === 0 && r3.language.wordsPerHour === null);
  const r4 = analyze(res.data, 4);
  check('son 4 gün: 30 dk, 1 öğrenilen, 300 ml su', r4.language.minutes === 30 && r4.language.learned === 1 && r4.water.ml === 300);

  // Gece 02:00: gün hâlâ dünün sayılır (04:00 sınırı)
  const night = await loadAnalysis(db, new Date(2026, 10, 27, 2, 0), 175);
  check('gece 02:00 bugün = dünün tarihi', night.data.today === TODAY);

  // Yalnızca kelime defteri: ilk kayıt kelimenin eklendiği gün
  const only = makeTestDb();
  await migrateDbIfNeeded(only.db);
  await insertVocab(only.db, card('z', 0, null, when(4)));
  const v = await loadAnalysis(only.db, now, null);
  check('yalnızca kelime eklenmişse ilk gün o gündür', v.data.firstDay === dayAgo(4) && v.span === 5, `${v.data.firstDay} ${v.span}`);
  only.raw.close();

  // Duolingo ekran süresi çalışma süresidir; elle girilen "uygulama" kaydı onunla çift sayılmaz; kalem-kağıt ayrı kalır
  const duo = makeTestDb();
  await migrateDbIfNeeded(duo.db);
  await upsertDailyStat(duo.db, { day: dayAgo(1), steps: 0, screenMinutes: 300, topApps: [{ label: 'Duolingo', minutes: 45 }, { label: 'YouTube', minutes: 90 }] });
  await upsertDailyStat(duo.db, { day: dayAgo(2), steps: 0, screenMinutes: 200, topApps: [{ label: 'duolingo: dil öğren', minutes: 30 }] });
  await addStudyLog(duo.db, dayAgo(1), 'APP', 20, when(1));
  await addStudyLog(duo.db, dayAgo(1), 'PAPER', 15, when(1));
  await addStudyLog(duo.db, dayAgo(2), 'OTHER', 10, when(2));
  await insertVocab(duo.db, card('k1', 5, dayAgo(1), when(3)));
  const dd = await loadAnalysis(duo.db, now, null);
  check('uygulama süresi ekran süresindeki Duolingo’dur (YouTube katılmaz, elle uygulama kaydı çift sayılmaz)', dd.data.appByDay[dayAgo(1)] === 45 && dd.data.appByDay[dayAgo(2)] === 30);
  check('kalem-kağıt ve dinleme ayrı tutulur', dd.data.paperByDay[dayAgo(1)] === 15 && dd.data.otherByDay[dayAgo(2)] === 10);
  const dr = analyze(dd.data, dd.span);
  check('toplam çalışma = yalnızca Duolingo (75 dk); ayrı süreler gösterilir ama katılmaz', dr.language.minutes === 75 && dr.language.paperMinutes === 15 && dr.language.otherMinutes === 10);
  check('kelime hızı Duolingo saatine göre: 1 kelime / 1,25 saat', dr.language.wordsPerHour !== null && near(dr.language.wordsPerHour, 1 / 1.25));
  check('uygulama adı ayarlardan gelir', dd.appLabel === 'Duolingo');
  duo.raw.close();
  raw.close();
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
