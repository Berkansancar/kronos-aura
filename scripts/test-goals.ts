/**
 * Hedefler testi: ayarlar, kalori hesabı (güvenlik sınırları), ilerleme, zaman dengesi ve veritabanı.
 * Çalıştırmak için:  npm run test:goals
 */
import { createTask, upsertDailyStat, upsertSleepLog } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { loadGoalState } from '../services/goals';
import {
  ACTIVITY_LEVELS,
  EMPTY_GOALS,
  analyzeGoals,
  bmrOf,
  buildTimeBalance,
  dayMinute,
  estimateNeed,
  normalizeBedMinute,
  parseBody,
  parseGoals,
  planCalories,
  serializeGoals,
  validateBodyInput,
  type ActivityLevel,
  type BodyProfile,
  type GoalInputs,
  type GoalSettings,
  type Pace,
} from '../services/goalsLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { analyzeNutrition, validateKcalTarget, type NutritionFacts } from '../services/nutritionLogic';
import { replanDay } from '../services/planner';
import { WATER_NUDGES, WIND_DOWN_MINUTES, planReminders, type GoalReminders } from '../services/routineRemindersLogic';
import { completeTask } from '../services/taskFlow';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16, month = 10) => new Date(2026, month, d, h, m);
const NOW = at(12, 0);

// ───────────── Ayarlar ─────────────

const g: GoalSettings = { firstMealBy: 540, lastMealBy: 1260, screenLimitMin: 180, bedtime: 1410, focusMin: 240, reminders: true };
check('ayarlar gidiş-dönüş', JSON.stringify(parseGoals(serializeGoals(g))) === JSON.stringify(g));
check('boş ya da bozuk kayıt: hedef yok, bildirim kapalı', JSON.stringify(parseGoals(null)) === JSON.stringify(EMPTY_GOALS) && JSON.stringify(parseGoals('{bozuk')) === JSON.stringify(EMPTY_GOALS) && EMPTY_GOALS.reminders === false);
check('makul olmayan değerler sessizce kapanır', (() => { const p = parseGoals(JSON.stringify({ screenLimitMin: 5, bedtime: 100, focusMin: 'x', reminders: 'evet' })); return p.screenLimitMin === null && p.bedtime === null && p.focusMin === null && p.reminders === false; })());
check('gün dakikası: 02:00 = 1560', dayMinute(at(2, 0)) === 1560 && dayMinute(at(12, 0)) === 720);
check('yatış normalleştirme: 00:30 = 1470, 23:00 = 1380', normalizeBedMinute(30) === 1470 && normalizeBedMinute(1380) === 1380);

// ───────────── Vücut profili ve kalori hesabı ─────────────

const ok = (i: Parameters<typeof validateBodyInput>[0]) => validateBodyInput(i, NOW);
const base = { sex: 'F' as const, age: '30', heightCm: '165', weightKg: '60', activity: 'LOW' as ActivityLevel };
check('geçerli profil: doğum yılı yaştan hesaplanır', (() => { const r = ok(base); return r.ok && r.profile.birthYear === 1996 && r.profile.heightCm === 165; })());
check('virgüllü ondalık kabul edilir', (() => { const r = ok({ ...base, weightKg: '60,5', heightCm: '165,5' }); return r.ok && r.profile.weightKg === 60.5 && r.profile.heightCm === 165.5; })());
check('cinsiyet seçilmeden olmaz', !ok({ ...base, sex: null }).ok);
check('18 yaş altı reddedilir, doktora yönlendirir', (() => { const r = ok({ ...base, age: '16' }); return !r.ok && /doktor/.test(r.message) && /18/.test(r.message); })());
check('18 yaş kabul edilir; 81 reddedilir', ok({ ...base, age: '18' }).ok && !ok({ ...base, age: '81' }).ok);
check('boy, kilo, hareket doğrulanır', !ok({ ...base, heightCm: '90' }).ok && !ok({ ...base, weightKg: '20' }).ok && !ok({ ...base, activity: null }).ok && !ok({ ...base, age: 'abc' }).ok);

const F: BodyProfile = { sex: 'F', birthYear: 1996, heightCm: 165, weightKg: 60, activity: 'LOW' };
const M: BodyProfile = { sex: 'M', birthYear: 1996, heightCm: 180, weightKg: 80, activity: 'MODERATE' };
check('Mifflin-St Jeor: kadın 1320, erkek 1780', Math.round(bmrOf(F, NOW)) === 1320 && Math.round(bmrOf(M, NOW)) === 1780);
check('günlük ihtiyaç: kadın az hareketli 1580, erkek orta 2760', estimateNeed(F, NOW).tdee === 1580 && estimateNeed(M, NOW).tdee === 2760);
check('su önerisi kilodan: 60 kg = 2,0 L, 80 kg = 2,75 L, sınırlar 1,5–3,5 L', estimateNeed(F, NOW).waterMl === 2000 && estimateNeed(M, NOW).waterMl === 2750 && estimateNeed({ ...F, weightKg: 40 }, NOW).waterMl === 1500 && estimateNeed({ ...M, weightKg: 200 }, NOW).waterMl === 3500);
check('profil gidiş-dönüş ve bozuk kayıt', JSON.stringify(parseBody(JSON.stringify(F))) === JSON.stringify(F) && parseBody('x') === null && parseBody(JSON.stringify({ ...F, sex: 'X' })) === null);
check('hareket düzeyi çarpanları artan', ACTIVITY_LEVELS.every((a, i) => i === 0 || a.factor > ACTIVITY_LEVELS[i - 1].factor));

const keep = planCalories(F, null, 'MAINTAIN', NOW);
check('koruma: günlük ihtiyaç kadar', keep.ok && keep.kcal === 1580 && keep.deltaPerDay === 0 && keep.weeks === null);
const easy = planCalories(F, 55, 'EASY', NOW);
check('kilo verme (kadın 60→55, hafif): dinlenme enerjisinin altına inmez (1320)', easy.ok && easy.kcal === 1320 && easy.deltaPerDay === -260 && easy.weeks === 22, JSON.stringify(easy));
check('kilo verme: güvenlik notu verilir', easy.ok && easy.notes.some((n) => /1\.200|1\.320/.test(n) || /yavaşlar/.test(n)));
const mod = planCalories(F, 55, 'MODERATE', NOW);
check('ılımlı tempo de aynı tabanda kalır', mod.ok && mod.kcal === 1320);
const male = planCalories({ ...M, activity: 'LOW', weightKg: 70, heightCm: 170 }, 65, 'MODERATE', NOW);
check('erkek tabanı 1.500 ve dinlenme enerjisi (1.620)', male.ok && male.kcal === 1620, JSON.stringify(male));
check('hedef kilo çok düşükse reddedilir', (() => { const r = planCalories(F, 45, 'EASY', NOW); return !r.ok && /çok düşük/.test(r.message); })());
check('kilonun %30undan fazlası reddedilir', (() => { const r = planCalories({ ...F, weightKg: 100, heightCm: 170 }, 65, 'EASY', NOW); return !r.ok && /doktor/.test(r.message); })());
const gain = planCalories({ ...F, weightKg: 50 }, 55, 'EASY', NOW);
check('kilo alma (sağlıklı aralıkta): fazlalık %20 sınırında', gain.ok && gain.deltaPerDay === 275 && gain.kcal === 1740 && gain.weeks === 20, JSON.stringify(gain));
check('kilo alma BMI 25 üstünde reddedilir', !planCalories({ ...F, weightKg: 80 }, 85, 'EASY', NOW).ok && !planCalories({ ...F, weightKg: 50 }, 70, 'EASY', NOW).ok);
check('hedefe çok yakınsa koruma', (() => { const r = planCalories(F, 59.8, 'EASY', NOW); return r.ok && r.deltaPerDay === 0 && r.notes.length > 0; })());
check('geçersiz hedef kilo reddedilir', !planCalories(F, 10, 'EASY', NOW).ok);
check('yaş dışı: hesap yok', !planCalories({ ...F, birthYear: 2015 }, 55, 'EASY', NOW).ok);

// Özellik testi: hangi profil olursa olsun öneri güvenli aralıkta
let grid = 0;
let safe = true;
let neverBelowBmr = true;
for (const sex of ['F', 'M'] as const) {
  for (const age of [18, 30, 45, 60, 80]) {
    for (const h of [150, 165, 180, 195]) {
      for (const w of [45, 60, 80, 110, 150]) {
        for (const activity of ['LOW', 'LIGHT', 'MODERATE', 'HIGH'] as ActivityLevel[]) {
          for (const pace of ['MAINTAIN', 'EASY', 'MODERATE'] as Pace[]) {
            for (const target of [null, w - 10, w - 3, w + 5]) {
              const p: BodyProfile = { sex, birthYear: 2026 - age, heightCm: h, weightKg: w, activity };
              const r = planCalories(p, target, pace, NOW);
              grid += 1;
              if (!r.ok) continue;
              if (!validateKcalTarget(String(r.kcal)).ok) safe = false;
              if (target !== null && target < w && pace !== 'MAINTAIN' && r.deltaPerDay < 0 && r.kcal < Math.round(bmrOf(p, NOW) / 10) * 10) neverBelowBmr = false;
              if (r.deltaPerDay < 0 && r.kcal < (sex === 'M' ? 1500 : 1200)) safe = false;
              if (-r.deltaPerDay > r.tdee * 0.2 + 10) safe = false;
            }
          }
        }
      }
    }
  }
}
check(`${grid} profil: öneri hep 1.200–4.500 aralığında ve açık ihtiyacın %20sini aşmıyor`, safe);
check('kilo verirken öneri dinlenme enerjisinin altına inmez', neverBelowBmr);

// ───────────── İlerleme ─────────────

const nf = (over: Partial<NutritionFacts> = {}): NutritionFacts => ({
  day: '2026-11-16', now: NOW, waterGoalMl: 2000, kcalTarget: null, water: [], meals: [], peakStartHour: 10, peakEndHour: 14, ...over,
});
const gi = (over: Partial<GoalInputs> & { now?: Date; nut?: Partial<NutritionFacts> } = {}): GoalInputs => {
  const now = over.now ?? NOW;
  return {
    now,
    settings: { ...EMPTY_GOALS },
    waterGoalMl: 2000,
    kcalTarget: null,
    nutrition: analyzeNutrition(nf({ now, kcalTarget: over.kcalTarget ?? null, ...(over.nut ?? {}) })),
    screenMinutes: null,
    lastBedMinute: null,
    doneMinutes: 0,
    ...over,
  };
};
const item = (p: ReturnType<typeof analyzeGoals>, id: string) => p.items.find((i) => i.id === id);
const texts = (p: ReturnType<typeof analyzeGoals>) => [p.aura, ...p.kronos, ...p.items.map((i) => i.line)].join(' ');

const only = analyzeGoals(gi());
check('yalnızca su hedefi varken tek madde', only.items.length === 1 && only.items[0].id === 'water' && only.total === 1);
check('su: yolunda, tamam, akşam geride', item(only, 'water')?.status === 'ON_TRACK'
  && item(analyzeGoals(gi({ nut: { water: [{ ml: 2000, minute: 600 }] } })), 'water')?.status === 'DONE'
  && item(analyzeGoals(gi({ now: at(19, 0), nut: { water: [{ ml: 400, minute: 600 }] } })), 'water')?.status === 'WATCH');

const kc = (kcal: number | null, target: number | null = 2000) =>
  item(analyzeGoals(gi({ kcalTarget: target, nut: kcal === null ? {} : { meals: [{ kind: 'OGLE', minute: 700, groups: [], kcal }] } })), 'kcal');
check('kalori: hedef yoksa madde yok', kc(1000, null) === undefined);
check('kalori: kayıt yoksa bekler', kc(null)?.status === 'WAITING');
check('kalori: 1200/2000 yolunda, kalan 800', kc(1200)?.status === 'ON_TRACK' && /800 kcal/.test(kc(1200)?.line ?? ''));
check('kalori: 1900 hedef aralığı, 2500 hafifçe üstünde (suçlamadan)', kc(1900)?.status === 'DONE' && kc(2500)?.status === 'WATCH' && /Tek gün/.test(kc(2500)?.line ?? ''));

const meal = (first: number | null, last: number | null, now: Date, set: Partial<GoalSettings>) =>
  analyzeGoals(gi({ now, settings: { ...EMPTY_GOALS, ...set }, nut: { meals: [first, last].filter((x): x is number => x !== null).map((m) => ({ kind: 'OGLE' as const, minute: m, groups: [], kcal: null })) } }));
check('ilk yemek: 08:40 hedefe uydu', item(meal(520, null, at(12), { firstMealBy: 540 }), 'firstMeal')?.status === 'DONE');
check('ilk yemek: 10:40 geç, hedef söylenir', (() => { const i = item(meal(640, null, at(12), { firstMealBy: 540 }), 'firstMeal'); return i?.status === 'WATCH' && /hedef en geç 09:00/.test(i.line); })());
check('ilk yemek: kayıt yok sabah bekler, sonra nazik not', item(meal(null, null, at(8), { firstMealBy: 540 }), 'firstMeal')?.status === 'WAITING' && /ekleyebilirsin/.test(item(meal(null, null, at(10), { firstMealBy: 540 }), 'firstMeal')?.line ?? ''));
check('son yemek: 21:30 hedef 21:00 aşıldı', item(meal(null, 1290, at(22), { lastMealBy: 1260 }), 'lastMeal')?.status === 'WATCH');
check('son yemek: akşam 20:00, 1 sa var', (() => { const i = item(meal(null, 1000, at(20), { lastMealBy: 1260 }), 'lastMeal'); return i?.status === 'ON_TRACK' && /1 sa var/.test(i.line); })());
check('son yemek: saatten sonra uyuldu', item(meal(null, 1200, at(22), { lastMealBy: 1260 }), 'lastMeal')?.status === 'DONE');
check('gece 00:30 yemek, hedef 21:00: aşıldı', item(meal(null, 1470, at(0, 40, 17), { lastMealBy: 1260 }), 'lastMeal')?.status === 'WATCH');

const scr = (s: number | null, now = NOW) => item(analyzeGoals(gi({ now, screenMinutes: s, settings: { ...EMPTY_GOALS, screenLimitMin: 180 } })), 'screen');
check('ekran: bilinmiyorsa madde yok', scr(null) === undefined);
check('ekran: 100/180 yolunda, 160 sınıra yakın, 200 aşıldı', scr(100)?.status === 'ON_TRACK' && scr(160)?.status === 'WATCH' && /20 dk aştın/.test(scr(200)?.line ?? ''));
check('ekran: gün sonunda sınırın altı tamam', scr(100, at(22, 30))?.status === 'DONE');

const bed = (now: Date, last: number | null) => item(analyzeGoals(gi({ now, lastBedMinute: last, settings: { ...EMPTY_GOALS, bedtime: 1410 } })), 'bedtime');
check('yatış: sabah dünkü gece hedefe yakın', bed(at(9), 1380)?.status === 'DONE' && /23:00/.test(bed(at(9), 1380)?.line ?? ''));
check('yatış: sabah dünkü gece geç (01:00)', bed(at(9), 1500)?.status === 'WATCH' && /01:00/.test(bed(at(9), 1500)?.line ?? ''));
check('yatış: sabah veri yok bekler', bed(at(9), null)?.status === 'WAITING');
check('yatış: akşam 20:00 3 sa 30 dk var', /3 sa 30 dk var/.test(bed(at(20), null)?.line ?? ''));
check('yatış: 22:45 hazırlanma zamanı', /hazırlanma zamanı/.test(bed(at(22, 45), null)?.line ?? ''));
check('yatış: 23:45 geçti, 00:30 geçti', bed(at(23, 45), null)?.status === 'WATCH' && bed(at(0, 30, 17), null)?.status === 'WATCH');

const foc = (d: number) => item(analyzeGoals(gi({ doneMinutes: d, settings: { ...EMPTY_GOALS, focusMin: 240 } })), 'focus');
check('dolu zaman: 90/240 yolunda, 240 tamam', foc(90)?.status === 'ON_TRACK' && /2 sa 30 dk/.test(foc(90)?.line ?? '') && foc(240)?.status === 'DONE');

const all = analyzeGoals(gi({ nut: { water: [{ ml: 2000, minute: 600 }] }, doneMinutes: 300, settings: { ...EMPTY_GOALS, focusMin: 240 } }));
check('hepsi tamam: Aura kutlar', all.items.every((i) => i.status === 'DONE') && /tamam/.test(all.aura));
const mixed = analyzeGoals(gi({ now: at(19, 0), screenMinutes: 250, settings: { ...EMPTY_GOALS, screenLimitMin: 180, focusMin: 240 }, nut: { water: [{ ml: 300, minute: 600 }] } }));
check('bazıları geride: sayım ve nazik Aura', mixed.total === 3 && mixed.onTrack === 1 && /sorun değil/.test(mixed.aura) && mixed.kronos.length === 2);
const yolunda = analyzeGoals(gi({ now: at(13, 0), nut: { water: [{ ml: 800, minute: 600 }] } }));
check('hiçbiri geride değil: yolunda', /yolunda/.test(yolunda.aura));
check('ilerleme metinlerinde yargılayıcı sözcük yok', [only, mixed, all, yolunda, meal(640, 1290, at(22), { firstMealBy: 540, lastMealBy: 1260 }), bed(at(23, 45), null) ? analyzeGoals(gi({ now: at(23, 45), settings: { ...EMPTY_GOALS, bedtime: 1410 } })) : only].every((p) => !hasBannedWords(texts(p)) && !/tembel|başarısız|ceza|günah|kötü/i.test(texts(p))));

// ───────────── Zaman dengesi ─────────────

const bal = (over: Partial<Parameters<typeof buildTimeBalance>[0]> = {}) =>
  buildTimeBalance({ now: at(14, 0), wakeMinute: 450, endMinute: 1380, doneMinutes: 120, driftMinutes: 30, blocks: [{ startMin: 900, endMin: 960 }, { startMin: 1020, endMin: 1080 }], unplanned: { count: 2, minutes: 60 }, focusMin: null, ...over });
const b1 = bal();
check('boş pencereler: 14:00–15:00, 16:00–17:00, 18:00–23:00', b1.freeWindows.map((w) => `${w.from}-${w.to}`).join() === '840-900,960-1020,1080-1380', b1.freeWindows.map((w) => `${w.from}-${w.to}`).join());
check('boş toplam 7 sa, planlı kalan 2 sa', b1.freeTotal === 420 && b1.plannedLeftMinutes === 120);
check('planda yeri olmayan iş + boş pencere: Günü planla önerilir', b1.canPlan && b1.kronos.some((l) => /7 sa boş pencere/.test(l) && /en uzunu 5 sa/.test(l) && /2 iş \(1 sa\)/.test(l) && /Günü planla/.test(l)));
check('kayıt dışı zaman: uyanıktan bu yana 6 sa 30 dk - 2 sa - 30 dk = 4 sa', b1.elapsedMinutes === 390 && b1.unrecordedMinutes === 240);
check('akıp giden zaman mesajı', b1.kronos.some((l) => /Akıp giden zaman 30 dk/.test(l)));
check('Aura: dinlenme de dolu sayılır, yargısız', /dinlenmeyi de planlarsan/.test(b1.aura) && !hasBannedWords(b1.aura));

const gap = bal({ blocks: [{ startMin: 840, endMin: 850 }, { startMin: 860, endMin: 1380 }] });
check('20 dakikadan kısa boşluklar pencere sayılmaz', gap.freeWindows.length === 0 && gap.freeTotal === 0 && /zaten dolu/.test(gap.kronos.join(' ')));
const past = bal({ blocks: [{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 900 }] });
check('geçmiş bloklar yok sayılır, süren blok kırpılır', past.freeWindows[0]?.from === 900 && past.plannedLeftMinutes === 60);
const noTasks = bal({ unplanned: { count: 0, minutes: 0 }, blocks: [] });
check('bekleyen iş yok, geniş pencere: bilinçli kullan önerisi', !noTasks.canPlan && /boş kalmasın/.test(noTasks.kronos.join(' ')));
const over = bal({ now: at(23, 30) });
check('gün bitti: pencere yok, planla yok', over.freeWindows.length === 0 && !over.canPlan && /Gün kapanıyor/.test(over.kronos.join(' ')));
const foc2 = bal({ focusMin: 240, doneMinutes: 60 });
check('odak hedefi: kalan 3 sa, boş pencereye iş koy', foc2.kronos.some((l) => /Odak hedefine 3 sa kaldı/.test(l) && /Boş pencerelerden birine/.test(l)));
check('bitmiş iş yokken de yargısız', !hasBannedWords(bal({ doneMinutes: 0, driftMinutes: 0 }).aura) && /sorun değil/.test(bal({ doneMinutes: 0, driftMinutes: 0 }).aura));
const night = bal({ now: at(0, 30, 17), endMinute: 1560, wakeMinute: 450, blocks: [], unplanned: { count: 0, minutes: 0 } });
check('gece yarısından sonra bile gün sürer (00:30, yatış 02:00)', night.freeWindows.length === 1 && night.freeWindows[0].minutes === 90);
check('yatışa 1 saatten az kala (00:30, yatış 01:00) gün kapanıyor', bal({ now: at(0, 30, 17), endMinute: 1500 }).freeWindows.length === 0);
check('zaman dengesi metinlerinde yargı yok', [b1, gap, past, noTasks, over, foc2, night].every((b) => !hasBannedWords([b.aura, ...b.kronos].join(' '))));

// ───────────── Hedef hatırlatmaları (isteğe bağlı) ─────────────

const gr = (o: Partial<GoalReminders> = {}): GoalReminders => ({ waterGoalReached: false, bedtime: 1410, ...o });
const plan = (now: Date, extras: Parameters<typeof planReminders>[4], days = 2) => planReminders([], now, days, 60, { review: false, ...extras });
const hh = (d: Date) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

check('hatırlatmalar varsayılan kapalı: hedef bildirimi yok', plan(at(8), {}).length === 0 && plan(at(8), { goals: null }).length === 0);
const on = plan(at(8), { goals: gr() });
check('açıkken: iki günde 2×(2 su + 1 yatış hazırlığı) = 6 bildirim', on.length === 6, on.map((p) => hh(p.at)).join(' | '));
check('saatler: 12:00, 16:30, yatıştan 45 dk önce (22:45)', on.slice(0, 4).map((p) => hh(p.at)).join(' | ') === '16 12:00 | 16 16:30 | 16 22:45 | 17 12:00');
check('su bildirimi Su ve yemek ekranını, hazırlık Hedefler ekranını açar', on.filter((p) => p.id.includes('water')).every((p) => p.route === '/nutrition') && on.filter((p) => p.id.includes('winddown')).every((p) => p.route === '/goals'));
check('kimlikler tekil ve rtn- ile başlar (eski temizleme çalışır)', new Set(on.map((p) => p.id)).size === on.length && on.every((p) => p.id.startsWith('rtn-')));
check('12:00 geçtiyse bugünün öğle bildirimi yok', plan(at(13), { goals: gr() }).filter((p) => p.at.getDate() === 16 && p.id.includes('water')).length === 1);
const reached = plan(at(8), { goals: gr({ waterGoalReached: true }) });
check('su hedefi tamamsa bugünün su bildirimleri susar, yarınınki kalır, hazırlık sürer', reached.filter((p) => p.id.includes('water') && p.at.getDate() === 16).length === 0 && reached.filter((p) => p.id.includes('water') && p.at.getDate() === 17).length === 2 && reached.some((p) => p.id.includes('winddown') && p.at.getDate() === 16));
check('yatış saati yoksa hazırlık bildirimi yok', plan(at(8), { goals: gr({ bedtime: null }) }).every((p) => !p.id.includes('winddown')));
const late = plan(at(8), { goals: gr({ bedtime: 1470 }) }, 1);
check('yatış 00:30 ise hazırlık 23:45 (aynı takvim günü)', late.find((p) => p.id.includes('winddown')) !== undefined && hh(late.find((p) => p.id.includes('winddown'))!.at) === '16 23:45');
check('zor günde bugün için hedef bildirimi yok, yarın var', (() => { const p = plan(at(8), { goals: gr(), hardDayToday: true }); return p.filter((x) => x.at.getDate() === 16).length === 0 && p.filter((x) => x.at.getDate() === 17).length === 3; })());
check('gün sonu bildirimi hedef bildirimleriyle birlikte yaşar', planReminders([], at(8), 1, 60, { review: true, goals: gr() }).some((p) => p.id.includes('review')));
check('sınır (cap) aşılmaz', planReminders([], at(8), 5, 4, { review: false, goals: gr() }).length === 4);
check('bildirim metinlerinde yargı ya da baskı yok', on.every((p) => !hasBannedWords(`${p.title} ${p.body}`) && !/mutlaka|hemen|şart|unutma/i.test(`${p.title} ${p.body}`)));
check('sabitler: iki su saati, 45 dk', WATER_NUDGES.length === 2 && WIND_DOWN_MINUTES === 45);

// ───────────── Veritabanı ─────────────

async function dbTests(): Promise<void> {
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const cfg = { settings: { ...EMPTY_GOALS, screenLimitMin: 180, bedtime: 1410, focusMin: 120, lastMealBy: 1260 }, waterGoalMl: 2000, kcalTarget: 2000 };

  const empty = await loadGoalState(db, at(10, 0), cfg);
  check('boş veritabanı: hedefler bekler, hata yok', empty.progress.total >= 4 && empty.balance.doneMinutes === 0 && empty.nutrition.quiet);

  const t1 = await createTask(db, { title: 'Rapor', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Mail', estimatedDuration: 30, cognitiveWeight: 'LOW' });
  await replanDay(db, at(9, 0), 'MANUAL');
  await completeTask(db, t1, 'HIGH', at(11, 0));
  const t3 = await createTask(db, { title: 'Sonradan eklenen', estimatedDuration: 45, cognitiveWeight: 'MEDIUM' });
  void t2; void t3;
  await upsertDailyStat(db, { day: '2026-11-16', steps: 3000, screenMinutes: 200, topApps: [] });
  await upsertSleepLog(db, { day: '2026-11-16', bedtime: at(23, 50, 15).toISOString(), wakeTime: at(7, 30, 16).toISOString(), durationMinutes: 460 });

  const s = await loadGoalState(db, at(12, 0), cfg);
  check('biten iş süresi toplandı (dolu zaman)', s.balance.doneMinutes === 60 && item(s.progress, 'focus')?.value === '1 sa');
  check('ekran sınırı aşıldı (200/180)', item(s.progress, 'screen')?.status === 'WATCH');
  const am = await loadGoalState(db, at(9, 30), cfg);
  check('sabah: dünkü yatış 23:50 (hedef 23:30), 30 dk içinde, hedefe yakın', item(am.progress, 'bedtime')?.status === 'DONE' && /23:50/.test(item(am.progress, 'bedtime')?.line ?? ''), JSON.stringify(item(am.progress, 'bedtime')));
  check('uyanış 07:30 zaman dengesine girer', s.balance.elapsedMinutes === 12 * 60 - 450);
  check('planda yeri olmayan iş sayılır', s.balance.unplanned.count >= 1 && s.balance.unplanned.minutes >= 45, JSON.stringify(s.balance.unplanned));
  check('blok varsa boş pencere hesaplanır', s.balance.freeWindows.length >= 1 && s.balance.freeTotal > 0);

  // Gün kapandı (22:30): bugünün boş pencereleri yok
  const late = await loadGoalState(db, at(22, 30), cfg);
  check('22:30: yatışa 1 sa kala gün kapanıyor, pencere ve planla yok', late.balance.freeWindows.length === 0 && !late.balance.canPlan && /Gün kapanıyor/.test(late.balance.kronos.join(' ')));
  // Gece 01:00: hâlâ önceki günün hedefleri
  const after = await loadGoalState(db, at(1, 0, 17), cfg);
  check('01:00: hâlâ 16 Kasım', after.day === '2026-11-16');
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
