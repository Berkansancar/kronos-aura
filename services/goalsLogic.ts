/**
 * Hedefler (saf mantık, test edilebilir; internet ya da yapay zekâ gerekmez).
 *
 *  - Hedef ayarları: yemek saatleri, ekran sınırı, yatış saati, günlük "dolu zaman" (odak) hedefi.
 *  - Kalori hesabı: boy, kilo, yaş ile günlük ihtiyaç tahmini ve isteğe bağlı kilo hedefi. Hesap GÜVENLİK
 *    SINIRLARIYLA yapılır: reşit olmayanlar için hesap yok, çok düşük kalori yok, hedef kilo çok düşük olamaz.
 *  - İlerleme: bugünkü durumun hedeflere göre dürüst, yargısız özeti.
 *  - Zaman dengesi: günün boş pencereleri, bitmiş iş ve akıp giden zaman; boş zamanı dolu geçirmeye yardım eder.
 *
 * Aura'nın dilinde "tembel", "başarısız", "boşa" gibi sözler yoktur; renk de kırmızı değil, sakin tondur.
 */
import { formatDuration } from './format';
import { formatKcal, formatWater, KCAL_TARGET_MAX, KCAL_TARGET_MIN, type DayNutrition } from './nutritionLogic';

const pad = (n: number) => String(n).padStart(2, '0');

// ───────────────────────── Gün dakikası ─────────────────────────

/** Gece 04:00'e kadar hâlâ önceki günün sayılır; bu yüzden o saatler 1440'ın üstüne taşınır. */
export function dayMinute(now: Date): number {
  const m = now.getHours() * 60 + now.getMinutes();
  return now.getHours() < 4 ? m + 1440 : m;
}

/** Yatış saati 20:00–04:00 arasıdır; gece yarısından sonrası 1440+ olarak tutulur (00:30 = 1470). */
export function normalizeBedMinute(m: number): number {
  return m < 240 ? m + 1440 : m;
}

export const hhmm = (m: number): string => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;

// ───────────────────────── Hedef ayarları ─────────────────────────

export interface GoalSettings {
  /** İlk yemek en geç bu dakikada (0..1439); null = hedef yok */
  firstMealBy: number | null;
  /** Son yemek en geç bu dakikada */
  lastMealBy: number | null;
  /** Günlük ekran süresi sınırı (dk) */
  screenLimitMin: number | null;
  /** Yatış saati: 1200..1680 (gece yarısından sonrası 1440+) */
  bedtime: number | null;
  /** Günlük "dolu zaman" hedefi: biten işlerin toplam süresi (dk) */
  focusMin: number | null;
  /** Hedef hatırlatma bildirimleri (varsayılan kapalı) */
  reminders: boolean;
}

export const EMPTY_GOALS: GoalSettings = {
  firstMealBy: null,
  lastMealBy: null,
  screenLimitMin: null,
  bedtime: null,
  focusMin: null,
  reminders: false,
};

export const FIRST_MEAL_CHOICES = [8 * 60, 9 * 60, 10 * 60, 11 * 60];
export const LAST_MEAL_CHOICES = [19 * 60, 20 * 60, 21 * 60, 22 * 60];
export const SCREEN_LIMIT_CHOICES = [120, 180, 240, 300, 360];
export const BEDTIME_CHOICES = [22 * 60, 22 * 60 + 30, 23 * 60, 23 * 60 + 30, 24 * 60, 24 * 60 + 30];
export const FOCUS_CHOICES = [120, 180, 240, 300, 360];

function inRange(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
}

/** Kayıtlı JSON'u okur; bozuk ya da eksik alanlar sessizce "hedef yok" olur. */
export function parseGoals(raw: string | null | undefined): GoalSettings {
  if (!raw) return { ...EMPTY_GOALS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      firstMealBy: inRange(o.firstMealBy, 4 * 60, 13 * 60),
      lastMealBy: inRange(o.lastMealBy, 15 * 60, 24 * 60 + 120),
      screenLimitMin: inRange(o.screenLimitMin, 30, 16 * 60),
      bedtime: inRange(o.bedtime, 20 * 60, 28 * 60),
      focusMin: inRange(o.focusMin, 15, 12 * 60),
      reminders: o.reminders === true,
    };
  } catch {
    return { ...EMPTY_GOALS };
  }
}

export const serializeGoals = (g: GoalSettings): string => JSON.stringify(g);

// ───────────────────────── Vücut profili ve kalori hesabı ─────────────────────────

export type Sex = 'F' | 'M';
export type ActivityLevel = 'LOW' | 'LIGHT' | 'MODERATE' | 'HIGH';

export const ACTIVITY_LEVELS: { id: ActivityLevel; label: string; hint: string; factor: number }[] = [
  { id: 'LOW', label: 'Az hareketli', hint: 'masa başı, az yürüyüş', factor: 1.2 },
  { id: 'LIGHT', label: 'Hafif', hint: 'haftada 1–3 gün hareket', factor: 1.375 },
  { id: 'MODERATE', label: 'Orta', hint: 'haftada 3–5 gün spor', factor: 1.55 },
  { id: 'HIGH', label: 'Çok hareketli', hint: 'her gün spor ya da ağır iş', factor: 1.725 },
];

export interface BodyProfile {
  sex: Sex;
  /** Yaş yerine doğum yılı saklanır; böylece yıllar geçince güncel kalır */
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
}

export type BodyCheck = { ok: true; profile: BodyProfile } | { ok: false; message: string };

const num = (s: string): number => Number(s.trim().replace(',', '.'));

/** Ekrandaki metin alanlarından vücut profilini doğrular. Makul olmayan değer kaydedilmez. */
export function validateBodyInput(
  i: { sex: Sex | null; age: string; heightCm: string; weightKg: string; activity: ActivityLevel | null },
  now: Date
): BodyCheck {
  if (!i.sex) return { ok: false, message: 'Cinsiyeti seç (formül buna ihtiyaç duyar).' };
  const age = num(i.age);
  if (!Number.isFinite(age) || age < 5 || age > 110) return { ok: false, message: 'Yaşını sayı olarak yaz.' };
  if (age < 18) {
    return {
      ok: false,
      message: '18 yaşın altında kalori hesabı yapmıyorum; büyüme çağında bunu bir doktor ya da diyetisyen belirlemeli.',
    };
  }
  if (age > 80) return { ok: false, message: '80 yaşın üstünde hesap yapmıyorum; bunu bir doktor ya da diyetisyenle konuş.' };
  const h = num(i.heightCm);
  if (!Number.isFinite(h) || h < 120 || h > 230) return { ok: false, message: 'Boyunu cm olarak yaz (120–230).' };
  const w = num(i.weightKg);
  if (!Number.isFinite(w) || w < 35 || w > 250) return { ok: false, message: 'Kilonu kg olarak yaz (35–250).' };
  if (!i.activity) return { ok: false, message: 'Hareket düzeyini seç.' };
  return {
    ok: true,
    profile: {
      sex: i.sex,
      birthYear: now.getFullYear() - Math.round(age),
      heightCm: Math.round(h * 10) / 10,
      weightKg: Math.round(w * 10) / 10,
      activity: i.activity,
    },
  };
}

export function parseBody(raw: string | null | undefined): BodyProfile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const activity = ACTIVITY_LEVELS.find((a) => a.id === o.activity)?.id;
    const birthYear = inRange(o.birthYear, 1900, 2100);
    const heightCm = inRange(o.heightCm, 120, 230);
    const weightKg = inRange(o.weightKg, 35, 250);
    if ((o.sex !== 'F' && o.sex !== 'M') || !activity || birthYear === null || heightCm === null || weightKg === null) {
      return null;
    }
    return { sex: o.sex, birthYear, heightCm: Number(o.heightCm), weightKg: Number(o.weightKg), activity };
  } catch {
    return null;
  }
}

export const ageOf = (p: BodyProfile, now: Date): number => now.getFullYear() - p.birthYear;
export const bmiOf = (weightKg: number, heightCm: number): number => weightKg / ((heightCm / 100) * (heightCm / 100));

/** Mifflin-St Jeor: dinlenme enerjisi (kcal/gün). */
export function bmrOf(p: BodyProfile, now: Date): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * ageOf(p, now) + (p.sex === 'M' ? 5 : -161);
}

const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

export interface NeedEstimate {
  age: number;
  bmr: number;
  tdee: number;
  bmi: number;
  /** Kilodan yola çıkan günlük su önerisi (ml) */
  waterMl: number;
}

export function estimateNeed(p: BodyProfile, now: Date): NeedEstimate {
  const factor = ACTIVITY_LEVELS.find((a) => a.id === p.activity)?.factor ?? 1.2;
  const bmr = bmrOf(p, now);
  return {
    age: ageOf(p, now),
    bmr: roundTo(bmr, 10),
    tdee: roundTo(bmr * factor, 10),
    bmi: Math.round(bmiOf(p.weightKg, p.heightCm) * 10) / 10,
    // Genel kural: kilo başına ~33 ml; 1,5–3,5 L aralığında tutulur
    waterMl: Math.min(3500, Math.max(1500, roundTo(p.weightKg * 33, 250))),
  };
}

export type Pace = 'MAINTAIN' | 'EASY' | 'MODERATE';
export const PACES: { id: Pace; label: string; hint: string; kgPerWeek: number }[] = [
  { id: 'MAINTAIN', label: 'Mevcut kilomu koruyayım', hint: 'günlük ihtiyaç kadar', kgPerWeek: 0 },
  { id: 'EASY', label: 'Hafif tempo', hint: 'haftada ~0,25 kg', kgPerWeek: 0.25 },
  { id: 'MODERATE', label: 'Ilımlı tempo', hint: 'haftada ~0,5 kg', kgPerWeek: 0.5 },
];

/** 1 kg yaklaşık 7700 kcal sayılır (genel kabul; kişiden kişiye değişir). */
const KCAL_PER_KG = 7700;
const MIN_TARGET_BMI = 19;
const MAX_LOSS_FRACTION = 0.3;

export const BODY_DISCLAIMER =
  'Bunlar genel formüllerle yapılmış tahminlerdir, tıbbi tavsiye değildir. Hamilelik, emzirme, kronik hastalık ya da ilaç kullanımında bir doktor ya da diyetisyene danış. Yemek düşünceleri seni germeye başlarsa hesabı bırakıp bir uzmanla konuşmak iyi bir adımdır.';

export type KcalPlan =
  | {
      ok: true;
      kcal: number;
      tdee: number;
      bmr: number;
      /** Günlük fark: eksi = açık (kilo verme), artı = fazla (kilo alma), 0 = koruma */
      deltaPerDay: number;
      /** Hedefe tahmini süre (hafta); koruma ise null */
      weeks: number | null;
      notes: string[];
    }
  | { ok: false; message: string };

/**
 * Günlük kalori hedefi. `targetKg` boşsa ya da tempo "koru" ise günlük ihtiyaç kadar önerilir.
 * Kilo verme: açık ihtiyacın %20'sini ve tempo sınırını aşmaz; kadınlarda 1.200, erkeklerde 1.500 kcal ile
 * dinlenme enerjisinin altına inmez. Hedef kilo (BMI < 19) çok düşükse ya da kilonun %30'undan fazla vermek
 * isteniyorsa hesap yapılmaz.
 */
export function planCalories(p: BodyProfile, targetKg: number | null, pace: Pace, now: Date): KcalPlan {
  const age = ageOf(p, now);
  if (age < 18 || age > 80) {
    return { ok: false, message: 'Bu yaş aralığı için hesap yapmıyorum; bir doktor ya da diyetisyenle konuş.' };
  }
  const need = estimateNeed(p, now);
  const floor = Math.max(p.sex === 'M' ? 1500 : 1200, need.bmr);
  const notes: string[] = [];

  const maintain = (extra?: string): KcalPlan => {
    if (extra) notes.push(extra);
    return { ok: true, kcal: clampKcal(need.tdee), tdee: need.tdee, bmr: need.bmr, deltaPerDay: 0, weeks: null, notes };
  };

  const kgPerWeek = PACES.find((x) => x.id === pace)?.kgPerWeek ?? 0;
  if (targetKg === null || pace === 'MAINTAIN' || kgPerWeek === 0) return maintain();

  if (!Number.isFinite(targetKg) || targetKg < 35 || targetKg > 250) {
    return { ok: false, message: 'Hedef kiloyu kg olarak yaz (35–250).' };
  }
  const diff = targetKg - p.weightKg;
  if (Math.abs(diff) < 0.5) return maintain('Hedef kilon şu anki kilona çok yakın; mevcut kiloyu koruyacak miktar önerildi.');

  const targetBmi = bmiOf(targetKg, p.heightCm);
  if (diff < 0) {
    if (targetBmi < MIN_TARGET_BMI) {
      return {
        ok: false,
        message:
          'Bu hedef kilo boyuna göre çok düşük kalıyor; hesaplamıyorum. Hedefini bir doktor ya da diyetisyenle belirlemeni öneririm.',
      };
    }
    if (-diff > p.weightKg * MAX_LOSS_FRACTION) {
      return {
        ok: false,
        message: 'Bu kadar büyük bir kilo vermek için hesaplayıcı yetmez; bir doktor ya da diyetisyenle birlikte plan yapmak gerekir.',
      };
    }
    const wanted = Math.round((kgPerWeek * KCAL_PER_KG) / 7);
    const deficit = Math.min(wanted, Math.round(need.tdee * 0.2));
    const kcal = Math.max(roundTo(need.tdee - deficit, 10), floor);
    const actual = need.tdee - kcal;
    if (actual < 100) {
      return maintain('Bu bedende güvenli bir açık bırakacak kadar alan yok; koruma miktarı önerildi. Kilo konusunda bir uzmanla konuşabilirsin.');
    }
    if (actual < deficit) notes.push(`Güvenlik için günlük miktar ${formatKcal(floor)} altına indirilmedi; bu yüzden tempo biraz yavaşlar.`);
    if (deficit < wanted) notes.push('Açık, günlük ihtiyacın %20 sınırında tutuldu.');
    const weeks = Math.ceil((-diff * KCAL_PER_KG) / (actual * 7));
    return { ok: true, kcal: clampKcal(kcal), tdee: need.tdee, bmr: need.bmr, deltaPerDay: -actual, weeks, notes };
  }

  // Kilo alma: yalnızca sağlıklı aralıkta
  if (targetBmi > 25 || need.bmi >= 25) {
    return {
      ok: false,
      message: 'Kilo alma hedefini yalnızca sağlıklı aralıkta (BMI 25 altı) hesaplıyorum; farklı bir durumda bir doktora danış.',
    };
  }
  const wanted = Math.round((kgPerWeek * KCAL_PER_KG) / 7);
  const surplus = Math.min(wanted, Math.round(need.tdee * 0.2));
  const kcal = roundTo(need.tdee + surplus, 10);
  const weeks = Math.ceil((diff * KCAL_PER_KG) / (surplus * 7));
  if (surplus < wanted) notes.push('Fazlalık, günlük ihtiyacın %20 sınırında tutuldu.');
  return { ok: true, kcal: clampKcal(kcal), tdee: need.tdee, bmr: need.bmr, deltaPerDay: surplus, weeks, notes };
}

const clampKcal = (v: number): number => Math.min(KCAL_TARGET_MAX, Math.max(KCAL_TARGET_MIN, Math.round(v)));

// ───────────────────────── Günlük ilerleme ─────────────────────────

export type GoalStatus = 'DONE' | 'ON_TRACK' | 'WAITING' | 'WATCH';

export interface GoalItem {
  id: 'water' | 'kcal' | 'firstMeal' | 'lastMeal' | 'screen' | 'bedtime' | 'focus';
  title: string;
  /** Şu anki değer ve hedef, ekranda gösterilecek kısa metin */
  value: string;
  target: string;
  /** 0..1 (ilerleme çubuğu); anlamsızsa null */
  ratio: number | null;
  status: GoalStatus;
  line: string;
}

export interface GoalInputs {
  now: Date;
  settings: GoalSettings;
  waterGoalMl: number;
  kcalTarget: number | null;
  nutrition: DayNutrition | null;
  screenMinutes: number | null;
  /** Dün gece tahmini yatış dakikası (20:00 sonrası = 1200+, gece yarısından sonrası 1440+); bilinmiyorsa null */
  lastBedMinute: number | null;
  /** Bugün biten işlerin toplam süresi (dk) */
  doneMinutes: number;
}

export interface GoalProgress {
  items: GoalItem[];
  /** WATCH olmayan hedef sayısı */
  onTrack: number;
  total: number;
  aura: string;
  kronos: string[];
}

export function analyzeGoals(g: GoalInputs): GoalProgress {
  const nowMin = dayMinute(g.now);
  const n = g.nutrition;
  const items: GoalItem[] = [];

  // Su
  {
    const ml = n?.waterMl ?? 0;
    const goal = g.waterGoalMl;
    const ratio = Math.min(1, ml / goal);
    const status: GoalStatus = ml >= goal ? 'DONE' : nowMin >= 18 * 60 && ratio < 0.5 ? 'WATCH' : 'ON_TRACK';
    items.push({
      id: 'water',
      title: 'Su',
      value: formatWater(ml),
      target: formatWater(goal),
      ratio,
      status,
      line:
        status === 'DONE'
          ? 'Hedefe ulaştın.'
          : status === 'WATCH'
            ? `Biraz geride; kalan ${formatWater(goal - ml)}. Akşam yavaş yavaş içebilirsin.`
            : `Kalan ${formatWater(goal - ml)}.`,
    });
  }

  // Kalori (yalnızca kullanıcı hedef koyduysa)
  if (g.kcalTarget !== null) {
    const total = n?.kcalTotal ?? null;
    const target = g.kcalTarget;
    if (total === null) {
      items.push({
        id: 'kcal',
        title: 'Kalori',
        value: 'kayıt yok',
        target: formatKcal(target),
        ratio: 0,
        status: 'WAITING',
        line: 'Henüz kalori kaydı yok. Yemek eklediğinde burada görünür.',
      });
    } else {
      const ratio = total / target;
      const status: GoalStatus = ratio > 1.15 ? 'WATCH' : ratio >= 0.85 ? 'DONE' : 'ON_TRACK';
      items.push({
        id: 'kcal',
        title: 'Kalori',
        value: `≈${formatKcal(total)}`,
        target: formatKcal(target),
        ratio: Math.min(1, ratio),
        status,
        line:
          status === 'WATCH'
            ? 'Hedefin biraz üstünde. Tek gün bütün resmi belirlemez.'
            : status === 'DONE'
              ? 'Hedef aralığındasın.'
              : `Kalan yaklaşık ${formatKcal(target - total)} (kayıtlar eksik olabilir).`,
      });
    }
  }

  // İlk yemek
  if (g.settings.firstMealBy !== null) {
    const target = g.settings.firstMealBy;
    const first = n?.firstFoodMinute ?? null;
    let status: GoalStatus;
    let line: string;
    if (first !== null) {
      status = first <= target ? 'DONE' : 'WATCH';
      line = first <= target ? `İlk yemek ${hhmm(first)}, hedefe uydu.` : `İlk yemek ${hhmm(first)} oldu; hedef en geç ${hhmm(target)}.`;
    } else if (nowMin < target) {
      status = 'WAITING';
      line = `Hedef: ilk yemek en geç ${hhmm(target)}.`;
    } else {
      status = 'WATCH';
      line = 'Henüz yemek kaydı yok; yediysen ekleyebilirsin.';
    }
    items.push({
      id: 'firstMeal',
      title: 'İlk yemek',
      value: first !== null ? hhmm(first) : '—',
      target: `en geç ${hhmm(target)}`,
      ratio: null,
      status,
      line,
    });
  }

  // Son yemek
  if (g.settings.lastMealBy !== null) {
    const target = g.settings.lastMealBy;
    const last = n?.lastFoodMinute ?? null;
    let status: GoalStatus;
    let line: string;
    if (last !== null && last > target) {
      status = 'WATCH';
      line = `Son yemek ${hhmm(last)} oldu; hedef en geç ${hhmm(target)}.`;
    } else if (nowMin >= target) {
      status = 'DONE';
      line = last !== null ? 'Son yemek saatine uydun.' : 'Yemek kaydı yok; son yemek saatine uyulmuş sayılır.';
    } else {
      status = 'ON_TRACK';
      line = `Son yemek saatine ${formatDuration(target - nowMin)} var.`;
    }
    items.push({
      id: 'lastMeal',
      title: 'Son yemek',
      value: last !== null ? hhmm(last) : '—',
      target: `en geç ${hhmm(target)}`,
      ratio: null,
      status,
      line,
    });
  }

  // Ekran süresi
  if (g.settings.screenLimitMin !== null && g.screenMinutes !== null) {
    const limit = g.settings.screenLimitMin;
    const s = g.screenMinutes;
    let status: GoalStatus;
    let line: string;
    if (s > limit) {
      status = 'WATCH';
      line = `Sınırı ${formatDuration(s - limit)} aştın; kısa bir ekran arası iyi gelir.`;
    } else if (s >= limit * 0.85) {
      status = 'WATCH';
      line = `Sınıra yaklaştın; kalan ${formatDuration(limit - s)}.`;
    } else if (nowMin >= 22 * 60) {
      status = 'DONE';
      line = 'Bugün sınırın altında kaldın.';
    } else {
      status = 'ON_TRACK';
      line = `Kalan ${formatDuration(limit - s)}.`;
    }
    items.push({
      id: 'screen',
      title: 'Ekran süresi',
      value: formatDuration(s),
      target: `en çok ${formatDuration(limit)}`,
      ratio: Math.min(1, s / limit),
      status,
      line,
    });
  }

  // Yatış saati
  if (g.settings.bedtime !== null) {
    const bed = g.settings.bedtime;
    let status: GoalStatus;
    let line: string;
    if (nowMin < 12 * 60) {
      // Sabah: dünkü geceye bakılır
      if (g.lastBedMinute === null) {
        status = 'WAITING';
        line = `Hedef yatış ${hhmm(bed)}. Dün geceyi tahmin edecek veri yok.`;
      } else if (g.lastBedMinute <= bed + 30) {
        status = 'DONE';
        line = `Dün gece tahmini yatış ${hhmm(g.lastBedMinute)}, hedefe yakındı.`;
      } else {
        status = 'WATCH';
        line = `Dün gece tahmini yatış ${hhmm(g.lastBedMinute)}; hedef ${hhmm(bed)}. Bu akşam biraz erken hazırlanmayı dene.`;
      }
    } else if (nowMin > bed) {
      status = 'WATCH';
      line = 'Yatış saatin geçti; ekranı bırakıp yatmak yarın için iyi gelir.';
    } else if (bed - nowMin <= 60) {
      status = 'ON_TRACK';
      line = `Yatışa ${formatDuration(bed - nowMin)} var; ekranı bırakıp hazırlanma zamanı.`;
    } else {
      status = 'ON_TRACK';
      line = `Yatışa ${formatDuration(bed - nowMin)} var.`;
    }
    items.push({
      id: 'bedtime',
      title: 'Yatış saati',
      value: nowMin < 12 * 60 && g.lastBedMinute !== null ? hhmm(g.lastBedMinute) : '—',
      target: hhmm(bed),
      ratio: null,
      status,
      line,
    });
  }

  // Dolu zaman (odak)
  if (g.settings.focusMin !== null) {
    const target = g.settings.focusMin;
    const d = g.doneMinutes;
    items.push({
      id: 'focus',
      title: 'Dolu zaman',
      value: formatDuration(d),
      target: formatDuration(target),
      ratio: Math.min(1, d / target),
      status: d >= target ? 'DONE' : 'ON_TRACK',
      line: d >= target ? 'Günün odak hedefi tamam.' : `Kalan ${formatDuration(target - d)} bitmiş iş süresi.`,
    });
  }

  const watch = items.filter((i) => i.status === 'WATCH');
  const onTrack = items.length - watch.length;

  let aura: string;
  if (items.length === 0) {
    aura = 'Henüz hedef koymadın. Su ile başlayabilirsin; hepsi isteğe bağlı ve istediğin zaman değişir.';
  } else if (items.every((i) => i.status === 'DONE')) {
    aura = 'Bugünkü hedeflerin tamam. Kendine iyi baktığın belli.';
  } else if (watch.length === 0) {
    aura = 'Hedeflerin yolunda. Küçük adımlar yeterli.';
  } else {
    aura = 'Bazı hedefler bugün geride kaldı, sorun değil. Birini seç, tek bir küçük adım at; gerisi yarın da yerinde.';
  }

  const kronos: string[] = watch.slice(0, 3).map((i) => `${i.title}: ${i.line}`);
  if (kronos.length === 0 && items.length > 0) kronos.push('Hedeflerin dengede. Şu an yeni bir şey yapmana gerek yok.');
  if (items.length === 0) kronos.push('Önce bir hedef seç: su, yemek saatleri, ekran sınırı ya da yatış saati.');

  return { items, onTrack, total: items.length, aura, kronos };
}

// ───────────────────────── Zaman dengesi ─────────────────────────

export interface BalanceInputs {
  now: Date;
  /** Bugün uyanılan dakika (bilinmiyorsa null: 07:00 varsayılır) */
  wakeMinute: number | null;
  /** Günün bittiği dakika: yatış hedefi ya da 23:00 */
  endMinute: number;
  doneMinutes: number;
  driftMinutes: number;
  /** Bugünün plan blokları (gün dakikası olarak) */
  blocks: { startMin: number; endMin: number }[];
  /** Planda yeri olmayan bekleyen işler */
  unplanned: { count: number; minutes: number };
  focusMin: number | null;
}

export interface FreeWindow {
  from: number;
  to: number;
  minutes: number;
}

export interface TimeBalance {
  elapsedMinutes: number;
  doneMinutes: number;
  driftMinutes: number;
  /** Uyanıktan bu yana ne işle ne akıp giden zaman olarak kayıtlı olan süre (yemek, yol, dinlenme dahil olabilir) */
  unrecordedMinutes: number;
  plannedLeftMinutes: number;
  freeWindows: FreeWindow[];
  freeTotal: number;
  unplanned: { count: number; minutes: number };
  /** "Günü planla" mantıklı mı: boş pencere ve planda yeri olmayan iş var */
  canPlan: boolean;
  aura: string;
  kronos: string[];
}

export const MIN_FREE_WINDOW = 20;
export const DEFAULT_WAKE_MINUTE = 7 * 60;
export const DEFAULT_END_MINUTE = 23 * 60;

export function buildTimeBalance(b: BalanceInputs): TimeBalance {
  const nowMin = dayMinute(b.now);
  const start = b.wakeMinute ?? DEFAULT_WAKE_MINUTE;
  const end = b.endMinute;
  const from = Math.max(nowMin, start);
  const elapsed = Math.max(0, Math.min(nowMin, end) - start);

  // Kalan pencerede plan bloklarının dışında kalan aralıklar
  const clipped = b.blocks
    .map((x) => ({ s: Math.max(x.startMin, from), e: Math.min(x.endMin, end) }))
    .filter((x) => x.e > x.s)
    .sort((a, c) => a.s - c.s);
  const windows: FreeWindow[] = [];
  let cursor = from;
  let plannedLeft = 0;
  for (const x of clipped) {
    if (x.s > cursor && x.s - cursor >= MIN_FREE_WINDOW) windows.push({ from: cursor, to: x.s, minutes: x.s - cursor });
    plannedLeft += Math.max(0, x.e - Math.max(x.s, cursor));
    cursor = Math.max(cursor, x.e);
  }
  if (end > cursor && end - cursor >= MIN_FREE_WINDOW && from < end && nowMin < end - 60) {
    windows.push({ from: cursor, to: end, minutes: end - cursor });
  }
  const freeTotal = windows.reduce((a, w) => a + w.minutes, 0);
  const unrecorded = Math.max(0, elapsed - b.doneMinutes - b.driftMinutes);
  // Yatışa en fazla 1 saat kala gün kapanıyor sayılır: yeni iş ya da boş pencere önerilmez
  const dayOver = nowMin >= end - 60;
  const canPlan = !dayOver && b.unplanned.count > 0 && freeTotal >= 30;

  const kronos: string[] = [];
  if (dayOver) {
    kronos.push('Gün kapanıyor. Yarın için planı gün sonu değerlendirmesinde birlikte hazırlayabiliriz.');
  } else {
    const longest = windows.reduce((m, w) => Math.max(m, w.minutes), 0);
    if (canPlan) {
      kronos.push(
        `Bugün ${formatDuration(freeTotal)} boş pencere var (en uzunu ${formatDuration(longest)}). Planda yeri olmayan ${b.unplanned.count} iş (${formatDuration(b.unplanned.minutes)}) bekliyor; "Günü planla" ile pencereleri doldurabiliriz.`
      );
    } else if (b.unplanned.count === 0 && freeTotal >= 60) {
      kronos.push(
        `Planda ${formatDuration(freeTotal)} boş pencere var. İstersen bir rutine, bir işe ya da bilinçli bir dinlenmeye ayır; boş kalmasın, sana kalsın.`
      );
    } else if (freeTotal < 30) {
      kronos.push('Gün zaten dolu görünüyor. Araya kısa bir mola koymayı unutma.');
    }
    if (b.focusMin !== null && b.doneMinutes < b.focusMin) {
      const need = b.focusMin - b.doneMinutes;
      kronos.push(
        `Odak hedefine ${formatDuration(need)} kaldı; planlı işlerin ${formatDuration(plannedLeft)}.` +
          (plannedLeft < need && freeTotal > 0 ? ' Boş pencerelerden birine bir iş koyarsan hedef tamamlanır.' : '')
      );
    }
  }
  if (b.driftMinutes > 0) {
    kronos.push(
      `Akıp giden zaman ${formatDuration(b.driftMinutes)}. Boş pencereyi önceden bir işe ya da molaya ayırmak bunu azaltır.`
    );
  }

  const aura =
    b.doneMinutes > 0
      ? `Bugün ${formatDuration(b.doneMinutes)} iş bitirdin. Dolu geçmek yalnızca iş demek değil; dinlenmeyi de planlarsan zaman akıp gitmez, sana kalır.`
      : 'Henüz iş kaydı yok, sorun değil. Dolu geçmek yalnızca iş demek değil; küçük bir adım ya da planlı bir dinlenme de günü doldurur.';

  return {
    elapsedMinutes: elapsed,
    doneMinutes: b.doneMinutes,
    driftMinutes: b.driftMinutes,
    unrecordedMinutes: unrecorded,
    plannedLeftMinutes: plannedLeft,
    freeWindows: windows,
    freeTotal,
    unplanned: b.unplanned,
    canPlan,
    aura,
    kronos,
  };
}

