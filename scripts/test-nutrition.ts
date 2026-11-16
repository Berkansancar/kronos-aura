/**
 * Su, yemek ve kalori testi (saf mantık + gerçek SQLite). Çalıştırmak için:  npm run test:nutrition
 */
import { listMealLogs, listWaterLogs } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { describeSituation } from '../services/ai/coachAI';
import { getAuraMessage, type CoachContext } from '../services/coachEngine';
import { gatherDayFacts } from '../services/dayReview';
import { buildReviewPrompt, factChips, hasBannedWords } from '../services/dayReviewLogic';
import { gatherWeekFacts, loadWeekSummary } from '../services/weekly';
import { buildWeekSummary } from '../services/weeklyLogic';
import { detectGroups, estimateMeal, normalizeText, FOODS } from '../services/foodTable';
import { addDrink, addMeal, addWater, loadDayLogs, loadDayNutrition, removeMeal, removeWater } from '../services/nutrition';
import {
  analyzeNutrition,
  clockOfMinute,
  formatKcal,
  formatWater,
  minuteInDay,
  nutritionDay,
  nutritionPromptLines,
  suggestMealKind,
  validateKcalTarget,
  type NutritionFacts,
} from '../services/nutritionLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16, month = 10) => new Date(2026, month, d, h, m);

// ───────────── Yemek tablosu ve kalori tahmini ─────────────

const e1 = estimateMeal('2 yumurta, 3 dilim ekmek, çay');
check('2 yumurta + 3 dilim ekmek + çay ≈ 402', e1.kcal === 402, String(e1.kcal));
check('miktar yazılınca tahmini değil', e1.items[0].assumed === false && e1.items[1].assumed === false);
check('çay miktarı yazılmadı: varsayılan', e1.items[2].assumed === true);
check('gruplar: protein, tahıl, kafein', ['PROTEIN', 'TAHIL', 'KAFEIN'].every((g) => (e1.groups as string[]).includes(g)));

check('Türkçe büyük harf (İ, I, Ş)', normalizeText('İŞTE IRMAK ÇORBASI') === 'iste irmak corbasi');
check('büyük harfli yazı tanınır', estimateMeal('MERCİMEK ÇORBASI, PİLAV').kcal === 350);
check('uzun anahtar önce: mercimek çorbası ayrıca çorba sayılmaz', estimateMeal('mercimek çorbası').items.length === 1);
check('"yarım ekmek" bir somunun yarısı', estimateMeal('yarım ekmek').kcal === 280);
check('"üç yumurta" yazıyla sayı', estimateMeal('üç yumurta').kcal === 240);
check('"1,5 tabak makarna" ondalık', estimateMeal('1,5 tabak makarna').kcal === 450);
check('sayı sonda: "ekmek 2 dilim"', estimateMeal('ekmek 2 dilim').kcal === 160);
check('gram: 150 gr tavuk', estimateMeal('150 gr tavuk').kcal === 285);
check('gram: 100 gr tavuk (190) + 200 gr pilav (267) = 457', estimateMeal('100 gr tavuk ve 200 gr pilav').kcal === 457);
check('mantıksız sayı yok sayılır (100 yumurta)', estimateMeal('100 yumurta').kcal === 80);
check('ekli sözcük: tavuğu, balığı', estimateMeal('Tavuğu, balığı').items.length === 2);
check('tanınmayan yemek: kalori yok (uydurma sayı yazılmaz)', estimateMeal('bilinmeyen yemek').kcal === null);
check('boş metin: kalori yok', estimateMeal('   ').kcal === null && estimateMeal('').items.length === 0);
check('yanlış eşleşme yok: "kolay" kola değil', estimateMeal('kolay bir gün').kcal === null);
check('yanlış eşleşme yok: balık bal değil', !estimateMeal('balık').items.some((i) => i.name === 'bal'));
check('yanlış eşleşme yok: "etki" et değil', estimateMeal('etki').kcal === null);
check('"et" tek başına et', estimateMeal('et').items[0]?.name === 'et');
check('ıhlamur çayı: kafein değil, çifte sayılmaz', estimateMeal('ihlamur çayı').items.length === 1 && !estimateMeal('ihlamur çayı').groups.includes('KAFEIN'));
check('süt ve sütlaç ayrı', estimateMeal('sütlaç').items[0].name === 'sütlaç' && estimateMeal('süt').items[0].name === 'süt');
check('hamburger + patates + kola: kızartma ve şekerli içecek grubu', (() => { const r = estimateMeal('hamburger, patates kızartması, kola'); return r.kcal === 970 && r.groups.includes('KIZARTMA') && r.groups.includes('SEKERLI_ICECEK'); })());
check('detectGroups sebze ve protein', (() => { const g = detectGroups('tavuk ve salata'); return g.includes('PROTEIN') && g.includes('SEBZE'); })());
check('tablo: her yemeğin pozitif kalorisi, anahtarı var', FOODS.every((f) => f.kcal > 0 && f.keys.length > 0 && f.name.length > 0));
check('tablo: her anahtar normalleştirilmiş', FOODS.every((f) => f.keys.every((k) => normalizeText(k.replace(/^=/, '')) === k.replace(/^=/, ''))));
check('üst sınır 6000', estimateMeal('10 hamburger 10 kebap 10 iskender').kcal === 6000);

// ───────────── Gün anahtarı ve biçimler ─────────────

check('gün anahtarı: 02:00 önceki gün', nutritionDay(at(2, 0)) === '2026-11-15');
check('gün anahtarı: 04:00 aynı gün', nutritionDay(at(4, 0)) === '2026-11-16');
check('dakika: 01:30, önceki güne yazılan kayıt 1530', minuteInDay(at(1, 30, 16), '2026-11-15') === 1530);
check('saat metni 1530 -> 01:30', clockOfMinute(1530) === '01:30' && clockOfMinute(485) === '08:05');
check('su biçimi', formatWater(800) === '800 ml' && formatWater(1400) === '1,4 L' && formatWater(2000) === '2,0 L');
check('kalori biçimi', formatKcal(1450) === '1.450 kcal' && formatKcal(80) === '80 kcal');
check('öğün önerisi', suggestMealKind(at(8)) === 'KAHVALTI' && suggestMealKind(at(13)) === 'OGLE' && suggestMealKind(at(19)) === 'AKSAM' && suggestMealKind(at(16)) === 'ARA' && suggestMealKind(at(2)) === 'ARA');

check('hedef: boş kapatır', (() => { const c = validateKcalTarget('  '); return c.ok && c.value === null; })());
check('hedef: 2000 ve 2.000', (() => { const a = validateKcalTarget('2000'); const b = validateKcalTarget('2.000'); return a.ok && a.value === 2000 && b.ok && b.value === 2000; })());
check('hedef: çok düşük reddedilir, uzmana yönlendirir', (() => { const c = validateKcalTarget('900'); return !c.ok && /diyetisyen/.test(c.message); })());
check('hedef: çok yüksek ve anlamsız reddedilir', !validateKcalTarget('9000').ok && !validateKcalTarget('abc').ok);

// ───────────── Analiz ─────────────

const base = (over: Partial<NutritionFacts> = {}): NutritionFacts => ({
  day: '2026-11-16',
  now: at(14, 0),
  waterGoalMl: 2000,
  kcalTarget: null,
  water: [],
  meals: [],
  peakStartHour: 10,
  peakEndHour: 14,
  ...over,
});
const allText = (n: ReturnType<typeof analyzeNutrition>) => [n.aura, ...n.kronos, ...n.chips].join(' ');

const quiet = analyzeNutrition(base());
check('kayıt yok: sessiz', quiet.quiet && quiet.waterMl === 0 && quiet.kcalTotal === null);
check('kayıt yok: yönlendirici ama yargısız', /bir bardak suyla/i.test(quiet.aura) && !hasBannedWords(allText(quiet)));

const mid = analyzeNutrition(base({ water: [{ ml: 600, minute: 9 * 60 }] }));
check('su toplamı ve oranı', mid.waterMl === 600 && Math.abs(mid.waterRatio - 0.3) < 1e-9 && mid.waterLeftMl === 1400);
check('su hızı: 14:00, 1,4 L kaldı, 21:00e kadar saatte ~200 ml', mid.kronos.some((l) => /1,4 L kaldı/.test(l) && /21:00/.test(l) && /200 ml/.test(l)), mid.kronos.join(' | '));
check('su dağılımı sabah', mid.waterBy.morning === 600 && mid.waterBy.afternoon === 0);

const done = analyzeNutrition(base({ water: [{ ml: 1000, minute: 500 }, { ml: 1000, minute: 800 }, { ml: 500, minute: 1100 }] }));
check('hedef tamam: oran 1, kalan 0, kutlama', done.waterRatio === 1 && done.waterLeftMl === 0 && /tamamladın/.test(done.aura));
check('hedef tamam: su hızı mesajı yok', !done.kronos.some((l) => /kaldı/.test(l)));
check('su dağılımı öğleden sonra ve akşam', done.waterBy.afternoon === 1000 && done.waterBy.evening === 500);

const evening = analyzeNutrition(base({ now: at(19, 0), water: [{ ml: 400, minute: 600 }] }));
check('akşam az su: yargısız, yarına yönlendirir', /sorun değil/.test(evening.aura) && !hasBannedWords(evening.aura));

const early = analyzeNutrition(base({ now: at(8, 0) }));
check('sabah erken: tepe saatinden önce bir bardak su önerisi', early.kronos.some((l) => /tepe saatin 10:00–14:00 başlamadan/i.test(l)));

const meals = analyzeNutrition(
  base({
    now: at(18, 0),
    meals: [
      { kind: 'KAHVALTI', minute: 8 * 60, groups: ['PROTEIN', 'TAHIL'], kcal: 400 },
      { kind: 'OGLE', minute: 13 * 60, groups: ['PROTEIN'], kcal: 650 },
      { kind: 'ICECEK', minute: 17 * 60 + 30, groups: ['KAFEIN'], kcal: 2 },
    ],
  })
);
check('öğün sayıları: 2 ana öğün, içecek yemek sayılmaz', meals.mainMeals === 2 && meals.foodEntries === 2);
check('yemek arası 5 sa', meals.longestGapMinutes === 300 && meals.longestGapFrom === 480 && meals.longestGapTo === 780);
check('kalori toplamı içecek dahil', meals.kcalTotal === 1052);
check('18:00, son yemek 13:00: ara öğün önerisi', meals.kronos.some((l) => /5 sa geçti/.test(l)));
check('sebze/meyve yok: nazik öneri', meals.kronos.some((l) => /Sebze ya da meyve kaydı yok/.test(l)));
check('son çay 17:30: uyku uyarısı (kesin değil, "zorlaştırabilir")', meals.kronos.some((l) => /saat 17:30/.test(l) && /zorlaştırabilir/.test(l)));
check('çay/kahve sayısı özet satırında', meals.chips.some((c) => /1 çay\/kahve/.test(c)) && meals.chips.some((c) => /≈1\.052 kcal/.test(c)));

const veg = analyzeNutrition(base({ now: at(18, 0), meals: [{ kind: 'OGLE', minute: 750, groups: ['SEBZE', 'PROTEIN'], kcal: null }] }));
check('sebze varsa sebze uyarısı yok', !veg.kronos.some((l) => /Sebze ya da meyve/.test(l)));
check('kalori bilinmiyorsa toplam null', veg.kcalTotal === null && veg.kcalMissingEntries === 1);

const missing = analyzeNutrition(base({ meals: [{ kind: 'OGLE', minute: 750, groups: [], kcal: 500 }, { kind: 'ARA', minute: 800, groups: [], kcal: null }] }));
check('kalori eksik kayıt uyarısı', missing.kcalTotal === 500 && missing.kronos.some((l) => /1 kayıtta kalori yok/.test(l)));

const late = analyzeNutrition(base({ now: at(23, 30), meals: [{ kind: 'AKSAM', minute: 23 * 60 + 10, groups: [], kcal: 300 }] }));
check('geç yemek: yatmadan 2–3 saat önce notu', late.lateFood && late.kronos.some((l) => /saat 23:10/.test(l) && /2–3 saat/.test(l)));

const manyCaffeine = analyzeNutrition(base({ meals: Array.from({ length: 5 }, (_, i) => ({ kind: 'ICECEK' as const, minute: 480 + i * 90, groups: ['KAFEIN'], kcal: 2 })) }));
check('5 çay/kahve: su dengesi önerisi', manyCaffeine.caffeineCount === 5 && manyCaffeine.kronos.some((l) => /5 çay\/kahve/.test(l)));

// Kalori hedefi
const t = (kcal: number, now = at(15, 0)) => analyzeNutrition(base({ now, kcalTarget: 2000, meals: [{ kind: 'OGLE', minute: 750, groups: [], kcal }] }));
check('hedef yok: hedef cümlesi çıkmaz', !allText(meals).includes('Hedefine'));
check('hedef içinde: kalan gösterilir', t(1200).kcalLeft === 800 && t(1200).kronos.some((l) => /Hedefine yaklaşık 800 kcal kaldı/.test(l)));
check('hedefin üstü: suçlamadan', (() => { const a = t(2500); return a.kcalLeft === -500 && /Tek bir gün/.test(a.aura) && !hasBannedWords(allText(a)); })());
check('hedefin yarısından az, akşam: eksik kayıt olabilir', /eksik kayıt olabilir/.test(t(500, at(21, 0)).aura));
check('hedefin yarısından az ama gündüz: yorum yok', !/eksik kayıt/.test(t(500, at(15, 0)).aura));
check('hedef varken ölçülü kayıt: sıcak cümle', /yolunda/.test(t(1500).aura));

// Geçmiş gün
const past = analyzeNutrition(base({ day: '2026-11-15', now: at(12, 0), water: [{ ml: 800, minute: 600 }], meals: [{ kind: 'OGLE', minute: 700, groups: ['PROTEIN'], kcal: 600 }] }));
check('geçmiş gün: bugün değil', past.isToday === false);
check('geçmiş gün: "kaldı" ya da ara öğün önerisi yok', !past.kronos.some((l) => /kaldı|ara öğün iyi olabilir/.test(l)));

// Gece yarısından sonra (04:00'e kadar önceki gün)
const night = analyzeNutrition(base({ day: '2026-11-15', now: at(1, 0, 16), water: [{ ml: 1000, minute: 600 }] }));
check('gece 01:00: önceki gün hâlâ "bugün"', night.isToday === true);

// Yapay zekâya giden satırlar
const lines = nutritionPromptLines(meals);
check('yapay zekâya: toplu özet satırları', lines.length >= 3 && lines.some((l) => /Su:/.test(l)) && lines.some((l) => /kalori/.test(l)));
check('yapay zekâya: yemek metni/kayıt adı gitmez', !lines.join(' ').includes('yumurta') && nutritionPromptLines(quiet).length === 0);

// Hiçbir üretilen metinde yargılayıcı sözcük yok
const samples = [quiet, mid, done, evening, early, meals, veg, missing, late, manyCaffeine, t(1200), t(2500), t(500, at(21, 0)), past, night];
check('hiçbir metinde yargılayıcı sözcük yok', samples.every((n) => !hasBannedWords(allText(n))));
check('"fazla yedin" / "az içtin" gibi cümleler yok', samples.every((n) => !/fazla yedin|az içtin|çok yedin|obez|kilo ver|şişman|ceza|günah/i.test(allText(n))));

// ───────────── Veritabanı ─────────────

async function dbTests(): Promise<void> {
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const ver = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  check('temiz kurulum son sürüm (9)', ver === DATABASE_VERSION && DATABASE_VERSION === 9);
  raw.exec('DROP TABLE WaterLog; DROP TABLE MealLog; PRAGMA user_version = 6;');
  await migrateDbIfNeeded(db);
  check("v6 veritabanı v7'ye yükselir", (raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('WaterLog','MealLog')").all() as unknown[]).length === 2);
  await migrateDbIfNeeded(db);

  const now = at(12, 0);
  const opts = { waterGoalMl: 2000, kcalTarget: null };
  await addWater(db, at(8, 0), 200);
  await addWater(db, at(10, 0), 500);
  await addWater(db, at(12, 0), 330);
  const logs = await loadDayLogs(db, '2026-11-16');
  check('su kayıtları sırayla', logs.water.length === 3 && logs.water.map((w) => w.amountMl).join() === '200,500,330');

  await addMeal(db, at(8, 30), { kind: 'KAHVALTI', note: '2 yumurta, ekmek', groups: ['PROTEIN', 'TAHIL', 'PROTEIN'], kcal: 322 });
  await addMeal(db, now, { kind: 'OGLE', note: 'Tavuk pilav', groups: ['PROTEIN'], kcal: null, minutesAgo: 30 });
  const mealRows = await listMealLogs(db, '2026-11-16');
  check('öğün kayıtları ve gruplar (tekrarsız)', mealRows.length === 2 && mealRows[0].groups.join() === 'PROTEIN,TAHIL' && mealRows[0].kcal === 322);
  check('"30 dk önce" saati geriye alır', new Date(mealRows[1].eatenAt).getTime() === at(11, 30).getTime());
  check('kalori bilinmiyorsa null saklanır', mealRows[1].kcal === null);

  const drink = await addDrink(db, at(13, 0), 'cay');
  check('çay tek dokunuş: içecek, kafein, 2 kcal', drink?.kind === 'ICECEK' && drink.groups.join() === 'KAFEIN' && drink.kcal === 2);
  check('bilinmeyen içecek: kayıt yok', (await addDrink(db, now, 'yok')) === null);

  const n = await loadDayNutrition(db, at(14, 0), opts);
  check('bütün kayıtlar analizde: su 1030, 2 yemek, 1 çay', n.waterMl === 1030 && n.foodEntries === 2 && n.caffeineCount === 1, JSON.stringify([n.waterMl, n.foodEntries, n.caffeineCount]));
  check('analizde kalori toplamı yalnızca bilinenler', n.kcalTotal === 324 && n.kcalMissingEntries === 1, String(n.kcalTotal));

  // Gece 01:30: kayıt önceki güne yazılır
  await addWater(db, at(1, 30, 17), 250);
  check('01:30 kaydı önceki güne yazıldı', (await listWaterLogs(db, '2026-11-16')).length === 4 && (await listWaterLogs(db, '2026-11-17')).length === 0);
  const n2 = await loadDayNutrition(db, at(1, 45, 17), opts);
  check('gece 01:45: analiz hâlâ 16 Kasım', n2.day === '2026-11-16' && n2.isToday && n2.waterMl === 1280);

  // Silme
  const w = (await listWaterLogs(db, '2026-11-16'))[0];
  await removeWater(db, w.id);
  await removeMeal(db, mealRows[1].id);
  check('silme', (await listWaterLogs(db, '2026-11-16')).length === 3 && (await listMealLogs(db, '2026-11-16')).length === 2);

  // Sınırlar
  await addWater(db, now, 99999);
  check('su miktarı 5000 ml ile sınırlı', (await listWaterLogs(db, '2026-11-16')).some((x) => x.amountMl === 5000));
  await addMeal(db, now, { kind: 'ARA', note: 'x'.repeat(400), groups: [], kcal: 99999 });
  const big = (await listMealLogs(db, '2026-11-16')).find((m) => m.note.startsWith('xxx'));
  check('uzun not 200 karaktere, kalori 6000e sınırlı', big?.note.length === 200 && big.kcal === 6000);

  const empty = makeTestDb();
  await migrateDbIfNeeded(empty.db);
  const none = await loadDayNutrition(empty.db, at(10, 0), opts);
  check('boş veritabanında sessiz', none.quiet && none.waterMl === 0);
}

// ───────────── Koç, gün sonu ve haftalık özet bağlantıları ─────────────

async function integrationTests(): Promise<void> {
  const user = { id: 'u', chronotype: 'BALANCED' as const, peakStartHour: 10, peakEndHour: 14 };
  const mkCtx = (now: Date, n: ReturnType<typeof analyzeNutrition> | null, share: boolean): CoachContext => ({
    now,
    user,
    tasks: [],
    blocks: [],
    recentLogs: [],
    dayEndHour: 22,
    nutrition: n,
    shareActivityWithAi: share,
  });

  // Aura: öğleden sonra su çok azsa nazik bir hatırlatma
  const lowWater = (now: Date) => analyzeNutrition(base({ now, water: [{ ml: 200, minute: 9 * 60 }], meals: [{ kind: 'KAHVALTI', minute: 8 * 60, groups: [], kcal: 300 }] }));
  check('Aura: 15:00 su çok az: bir bardak önerisi', getAuraMessage(mkCtx(at(15, 0), lowWater(at(15, 0)), false)).headline === 'Bir bardak su iyi gelir');
  check('Aura: sabah 10:00 su önerisi yok', getAuraMessage(mkCtx(at(10, 0), lowWater(at(10, 0)), false)).headline !== 'Bir bardak su iyi gelir');
  check('Aura: akşam 22:00 su önerisi yok', getAuraMessage(mkCtx(at(22, 0), lowWater(at(22, 0)), false)).headline !== 'Bir bardak su iyi gelir');
  check('Aura: kayıt yoksa su önerisi yok', getAuraMessage(mkCtx(at(15, 0), analyzeNutrition(base({ now: at(15, 0) })), false)).headline !== 'Bir bardak su iyi gelir');
  const enough = analyzeNutrition(base({ now: at(15, 0), water: [{ ml: 900, minute: 600 }] }));
  check('Aura: su yeterliyse öneri yok', getAuraMessage(mkCtx(at(15, 0), enough, false)).headline !== 'Bir bardak su iyi gelir');
  check('Aura mesajında yargılayıcı sözcük yok', !hasBannedWords(getAuraMessage(mkCtx(at(15, 0), lowWater(at(15, 0)), false)).body));

  // Yapay zekâya giden durum özeti: yalnızca paylaşım açıksa
  const nut = analyzeNutrition(base({ now: at(18, 0), water: [{ ml: 1500, minute: 600 }], meals: [{ kind: 'OGLE', minute: 750, groups: ['PROTEIN'], kcal: 600 }] }));
  check('yapay zekâ: paylaşım açıkken su ve yemek özeti var', /Su: 1,5 L/.test(describeSituation(mkCtx(at(18, 0), nut, true))));
  check('yapay zekâ: paylaşım kapalıyken su ve yemek yok', !/Su: /.test(describeSituation(mkCtx(at(18, 0), nut, false))));

  // Gün sonu değerlendirmesi
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const opts = { waterGoalMl: 2000, kcalTarget: null };
  await addWater(db, at(9, 0), 1500);
  await addMeal(db, at(13, 0), { kind: 'OGLE', note: 'gizli yemek adı tavuk', groups: ['PROTEIN'], kcal: 600 });
  const facts = await gatherDayFacts(db, at(21, 30), opts);
  check('gün sonu: su ve yemek özeti toplandı', facts.nutrition?.waterMl === 1500 && facts.nutrition.kcalTotal === 600);
  check('gün sonu: seçenek verilmezse özet yok', (await gatherDayFacts(db, at(21, 30))).nutrition === null);
  const shared = buildReviewPrompt(facts, [], true);
  check('gün sonu istemi (paylaşım açık): su, yemek sayısı, kalori', /- Su: 1,5 L/.test(shared) && /Yemek kaydı: 1/.test(shared) && /600 kcal/.test(shared));
  check('gün sonu istemi: yemek adı asla gitmez', !shared.includes('gizli yemek adı') && !shared.includes('tavuk'));
  check('gün sonu istemi (paylaşım kapalı): su/yemek yok', !/- Su:/.test(buildReviewPrompt(facts, [], false)));
  check('gün sonu özet satırlarında su var', factChips(facts).some((c) => /Su 1,5 L/.test(c)));

  // Haftalık özet
  const w = makeTestDb();
  await migrateDbIfNeeded(w.db);
  for (const d of [11, 12, 13, 14, 15]) await addWater(w.db, at(10, 0, d), 2500);
  for (const d of [11, 12, 13]) {
    await addMeal(w.db, at(9, 0, d), { kind: 'KAHVALTI', note: '', groups: [], kcal: 500 });
    await addMeal(w.db, at(13, 0, d), { kind: 'OGLE', note: '', groups: [], kcal: 700 });
  }
  await addMeal(w.db, at(13, 0, 14), { kind: 'OGLE', note: '', groups: [], kcal: 300 });
  await addDrink(w.db, at(15, 0, 14), 'sekerli');
  const wf = await gatherWeekFacts(w.db, at(21, 0), { waterGoalMl: 2000, kcalTarget: null });
  const d13 = wf.days.find((x) => x.day === '2026-11-13');
  check('haftalık: gün başına su ve yemek', d13?.waterMl === 2500 && d13.foodEntries === 2 && d13.kcal === 1200);
  check('haftalık: içecek yemek sayılmaz ama kalorisi toplanır', (() => { const x = wf.days.find((y) => y.day === '2026-11-14'); return x?.foodEntries === 1 && x.kcal === 440; })());
  const { summary } = await loadWeekSummary(w.db, at(21, 0), { waterGoalMl: 2000, kcalTarget: null });
  check('haftalık: su ortalaması ve hedef günleri', summary.totals.waterDays === 5 && summary.totals.waterAvg === 2500 && summary.totals.waterGoalDays === 5);
  check('haftalık: kalori ortalaması yalnızca 2+ kayıtlı günlerden (1.200)', summary.totals.kcalAvg === 1200 && summary.totals.foodDays === 4);
  check('haftalık: özet satırları', summary.highlights.some((h) => /2,5 L su, 5 gün hedefe/.test(h)) && summary.highlights.some((h) => /1\.200 kcal/.test(h) && /eksik olabilir/.test(h)));
  check('haftalık: Aura su alışkanlığını söyler', /Su hedefine 5 gün ulaştın/.test(summary.aura));
  check('haftalık: yalnızca su kaydı olsa bile sessiz değil', summary.quiet === false);
  const lowWeek = buildWeekSummary({ ...wf, waterGoalMl: 3000 });
  check('haftalık: hedef 3 L ise hedef günü 0, Kronos kolaylaştırır', lowWeek.totals.waterGoalDays === 0 && lowWeek.kronos.some((l) => /bir bardak ekleyerek/.test(l)));
  check('haftalık: yargılayıcı sözcük yok', !hasBannedWords([summary.aura, ...summary.kronos, ...summary.highlights, lowWeek.aura, ...lowWeek.kronos].join(' ')));
  const oldDays = buildWeekSummary({ ...wf, days: wf.days.map(({ waterMl, foodEntries, kcal, ...rest }) => rest), prevDays: wf.prevDays.map(({ waterMl, foodEntries, kcal, ...rest }) => rest) });
  check('eski veri (alanlar yok): hata vermez, su satırı çıkmaz', oldDays.totals.waterAvg === null && !oldDays.highlights.some((h) => /su/.test(h)));
}

dbTests()
  .then(integrationTests)
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
