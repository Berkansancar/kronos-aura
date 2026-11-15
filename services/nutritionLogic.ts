/**
 * Su ve yemek analizi (saf mantık, test edilebilir; internet ya da yapay zekâ gerekmez).
 *
 * İlkeler: Aura yargılamaz. "Çok yedin", "az içtin", "kötü" gibi cümle kurulmaz; kalori sayıları yaklaşıktır
 * ve yalnızca bilgi içindir. Kalori hedefi yalnızca kullanıcı kendisi koyarsa gösterilir ve ayarlanan hedef
 * çok düşük olamaz. Kayıt eksik olabilir; toplamlar "kayıtlı" olarak anılır.
 */
import type { MealKind } from '../database/types';
import { dayKey, parseDayKey } from './activityLogic';
import { FOOD_GROUPS } from './foodTable';
import { formatDuration } from './format';

// ───────────────────────── Sabitler ─────────────────────────

/** Gece 04:00'e kadar yazılan kayıtlar önceki güne sayılır (hafta ve gün sonu mantığıyla aynı). */
export const NUTRITION_DAY_ROLLOVER_HOUR = 4;

export const WATER_PRESETS: { ml: number; label: string }[] = [
  { ml: 200, label: 'Bardak' },
  { ml: 330, label: 'Küçük şişe' },
  { ml: 500, label: 'Şişe' },
  { ml: 750, label: 'Büyük şişe' },
];
export const WATER_GOALS = [1500, 2000, 2500, 3000] as const;
export const DEFAULT_WATER_GOAL = 2000;

/** Çok düşük bir hedef kaydedilmez: bu sınırın altı için bir uzmana danışmak gerekir. */
export const KCAL_TARGET_MIN = 1200;
export const KCAL_TARGET_MAX = 4500;

export const MEAL_KINDS: { id: MealKind; label: string }[] = [
  { id: 'KAHVALTI', label: 'Kahvaltı' },
  { id: 'OGLE', label: 'Öğle' },
  { id: 'AKSAM', label: 'Akşam' },
  { id: 'ARA', label: 'Ara öğün' },
];
export const mealKindLabel = (k: MealKind): string =>
  k === 'ICECEK' ? 'İçecek' : (MEAL_KINDS.find((m) => m.id === k)?.label ?? k);

export interface DrinkPreset {
  id: string;
  label: string;
  note: string;
  kcal: number;
  groups: string[];
}
export const DRINK_PRESETS: DrinkPreset[] = [
  { id: 'cay', label: 'Çay', note: 'Çay', kcal: 2, groups: ['KAFEIN'] },
  { id: 'kahve', label: 'Kahve', note: 'Kahve', kcal: 5, groups: ['KAFEIN'] },
  { id: 'sekerli', label: 'Şekerli içecek', note: 'Şekerli içecek', kcal: 140, groups: ['SEKERLI_ICECEK'] },
];

/** Şu ana göre en olası öğün türü (kullanıcı değiştirebilir). */
export function suggestMealKind(now: Date): MealKind {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'KAHVALTI';
  if (h >= 11 && h < 15) return 'OGLE';
  if (h >= 17 && h < 23) return 'AKSAM';
  return 'ARA';
}

/** Yemek gününün anahtarı: gece 04:00'e kadar önceki gün. */
export function nutritionDay(now: Date): string {
  const back = now.getHours() < NUTRITION_DAY_ROLLOVER_HOUR ? 1 : 0;
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
}

/** Kaydın, ait olduğu günün gece yarısından itibaren kaçıncı dakikada olduğu (gece 04:00'ten önce 1440+). */
export function minuteInDay(at: Date, day: string): number {
  return Math.round((at.getTime() - parseDayKey(day).getTime()) / 60000);
}

// ───────────────────────── Biçimlendirme ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export function formatWater(ml: number): string {
  const v = Math.max(0, Math.round(ml));
  if (v < 1000) return `${v} ml`;
  return `${(v / 1000).toFixed(1).replace('.', ',')} L`;
}

export function formatKcal(kcal: number): string {
  return `${String(Math.max(0, Math.round(kcal))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} kcal`;
}

/** 1500 dakika -> "01:00" (gece yarısını geçen kayıtlar için) */
export function clockOfMinute(m: number): string {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;
}

// ───────────────────────── Girdi ve çıktı ─────────────────────────

export interface NutritionFacts {
  /** Analiz edilen gün (yyyy-mm-dd) */
  day: string;
  now: Date;
  waterGoalMl: number;
  kcalTarget: number | null;
  water: { ml: number; minute: number }[];
  meals: { kind: MealKind; minute: number; groups: string[]; kcal: number | null }[];
  peakStartHour: number;
  peakEndHour: number;
}

export interface DayNutrition {
  day: string;
  /** Analiz edilen gün bugün mü (öneriler yalnızca bugün için verilir) */
  isToday: boolean;
  waterMl: number;
  waterGoalMl: number;
  /** 0..1 (hedefi aşınca 1) */
  waterRatio: number;
  waterLeftMl: number;
  waterBy: { morning: number; afternoon: number; evening: number };
  /** İçecek dışındaki yemek kayıtları */
  foodEntries: number;
  /** Kahvaltı, öğle, akşam türünden farklı öğün sayısı */
  mainMeals: number;
  firstFoodMinute: number | null;
  lastFoodMinute: number | null;
  longestGapMinutes: number;
  longestGapFrom: number | null;
  longestGapTo: number | null;
  /** Kaydı olan öğünlerin toplamı; hiçbirinde kalori yoksa null */
  kcalTotal: number | null;
  kcalMissingEntries: number;
  kcalTarget: number | null;
  kcalLeft: number | null;
  groupCounts: Record<string, number>;
  caffeineCount: number;
  lastCaffeineMinute: number | null;
  sugaryDrinkCount: number;
  sweetCount: number;
  friedCount: number;
  lateFood: boolean;
  quiet: boolean;
  /** Ekranda gösterilen kısa özet satırları */
  chips: string[];
  aura: string;
  kronos: string[];
}

const MORNING_END = 12 * 60;
const AFTERNOON_END = 18 * 60;
const LATE_FOOD_MINUTE = 22 * 60;
const WATER_UNTIL_MINUTE = 21 * 60;

export function analyzeNutrition(f: NutritionFacts): DayNutrition {
  const isToday = f.day === nutritionDay(f.now);
  const nowMinute = isToday ? minuteInDay(f.now, f.day) : 24 * 60;

  // ── Su ──
  const waterMl = f.water.reduce((a, w) => a + w.ml, 0);
  const goal = Math.max(500, f.waterGoalMl);
  const waterBy = { morning: 0, afternoon: 0, evening: 0 };
  for (const w of f.water) {
    if (w.minute < MORNING_END) waterBy.morning += w.ml;
    else if (w.minute < AFTERNOON_END) waterBy.afternoon += w.ml;
    else waterBy.evening += w.ml;
  }
  const waterLeftMl = Math.max(0, goal - waterMl);

  // ── Yemek ──
  const food = f.meals.filter((m) => m.kind !== 'ICECEK').sort((a, b) => a.minute - b.minute);
  const drinks = f.meals.filter((m) => m.kind === 'ICECEK');
  const mainKinds = new Set(food.filter((m) => m.kind !== 'ARA').map((m) => m.kind));
  let longestGap = 0;
  let gapFrom: number | null = null;
  let gapTo: number | null = null;
  for (let i = 1; i < food.length; i += 1) {
    const gap = food[i].minute - food[i - 1].minute;
    if (gap > longestGap) {
      longestGap = gap;
      gapFrom = food[i - 1].minute;
      gapTo = food[i].minute;
    }
  }
  const firstFood = food.length > 0 ? food[0].minute : null;
  const lastFood = food.length > 0 ? food[food.length - 1].minute : null;

  // ── Kalori ──
  const known = f.meals.filter((m) => m.kcal !== null);
  const kcalTotal = known.length > 0 ? known.reduce((a, m) => a + (m.kcal ?? 0), 0) : null;
  const kcalMissing = f.meals.length - known.length;
  const kcalLeft = kcalTotal !== null && f.kcalTarget !== null ? f.kcalTarget - kcalTotal : null;

  // ── Besin grupları ──
  const groupCounts: Record<string, number> = {};
  for (const m of f.meals) for (const g of new Set(m.groups)) groupCounts[g] = (groupCounts[g] ?? 0) + 1;
  const has = (g: string) => (groupCounts[g] ?? 0) > 0;

  const caffeine = f.meals.filter((m) => m.groups.includes('KAFEIN')).sort((a, b) => a.minute - b.minute);
  const sugaryDrinks = f.meals.filter((m) => m.groups.includes('SEKERLI_ICECEK')).length;
  const sweets = f.meals.filter((m) => m.groups.includes('TATLI')).length;
  const fried = f.meals.filter((m) => m.groups.includes('KIZARTMA')).length;
  const lateFood = lastFood !== null && lastFood >= LATE_FOOD_MINUTE;
  const quiet = f.water.length === 0 && f.meals.length === 0;

  const base = {
    day: f.day,
    isToday,
    waterMl,
    waterGoalMl: goal,
    waterRatio: Math.min(1, waterMl / goal),
    waterLeftMl,
    waterBy,
    foodEntries: food.length,
    mainMeals: mainKinds.size,
    firstFoodMinute: firstFood,
    lastFoodMinute: lastFood,
    longestGapMinutes: longestGap,
    longestGapFrom: gapFrom,
    longestGapTo: gapTo,
    kcalTotal,
    kcalMissingEntries: kcalMissing,
    kcalTarget: f.kcalTarget,
    kcalLeft,
    groupCounts,
    caffeineCount: caffeine.length,
    lastCaffeineMinute: caffeine.length > 0 ? caffeine[caffeine.length - 1].minute : null,
    sugaryDrinkCount: sugaryDrinks,
    sweetCount: sweets,
    friedCount: fried,
    lateFood,
    quiet,
  };

  // ── Özet satırları ──
  const chips: string[] = [];
  if (waterMl > 0 || isToday) chips.push(`Su ${formatWater(waterMl)} / ${formatWater(goal)}`);
  if (food.length > 0) chips.push(`${food.length} yemek kaydı`);
  if (kcalTotal !== null) chips.push(`≈${formatKcal(kcalTotal)}`);
  if (caffeine.length > 0) chips.push(`${caffeine.length} çay/kahve`);

  // ── Aura ──
  const auraParts: string[] = [];
  if (quiet) {
    auraParts.push(
      isToday
        ? 'Bugün için su ya da yemek kaydı yok. Bir bardak suyla başlayabilirsin; kaydetmek bir dakikanı almaz.'
        : 'O gün için su ya da yemek kaydı yok.'
    );
  } else {
    if (waterMl >= goal) {
      auraParts.push('Su hedefini tamamladın, çok güzel.');
    } else if (waterMl >= goal * 0.6) {
      auraParts.push('Suyun büyük kısmı tamam. Kalanı gün içine yaymak yeter.');
    } else if (isToday && nowMinute >= 18 * 60) {
      auraParts.push('Bugün su biraz geride kaldı, sorun değil. Akşam yavaş yavaş içebilirsin; yarın ilk iş bir bardak su olsun.');
    } else if (waterMl > 0) {
      auraParts.push('Su kaydın başladı, böyle devam. Her bardak sayılır.');
    }

    if (kcalTotal !== null && f.kcalTarget !== null && kcalLeft !== null) {
      if (kcalTotal > f.kcalTarget * 1.15) {
        auraParts.push('Kayıtlar hedefinin biraz üstünde. Tek bir gün bütün resmi belirlemez; yarın yine devam.');
      } else if (isToday && nowMinute >= 20 * 60 && kcalTotal < f.kcalTarget * 0.5) {
        auraParts.push('Kayıtlar hedefinin yarısından az görünüyor; eksik kayıt olabilir. Yemediysen bir şeyler yemek iyi gelir.');
      } else {
        auraParts.push('Beslenme kayıtların yolunda, kendine iyi bakıyorsun.');
      }
    } else if (isToday && food.length === 0 && nowMinute >= 14 * 60) {
      auraParts.push('Henüz yemek kaydı yok. Yediysen ekleyebilirsin; yemediysen bir şeyler yemek enerjine iyi gelir.');
    } else if (sweets + sugaryDrinks + fried >= 3) {
      auraParts.push('Tatlı, şekerli ve kızarmış kayıtları bugün çok. Suçlanacak bir şey yok; bir sonraki öğüne sebze ya da meyve eklemek hoş bir denge olur.');
    } else if (food.length > 0) {
      auraParts.push('Yemek kayıtların da var, bu farkındalık işe yarar.');
    }
  }
  const aura = auraParts.join(' ');

  // ── Kronos (zaman ve düzen) ──
  const kronos: string[] = [];
  if (isToday && waterMl < goal) {
    if (nowMinute < f.peakStartHour * 60 && waterMl < 200) {
      kronos.push(`Tepe saatin ${pad(f.peakStartHour)}:00–${pad(f.peakEndHour % 24)}:00 başlamadan bir bardak su ile başla.`);
    }
    if (nowMinute < WATER_UNTIL_MINUTE - 30) {
      const hoursLeft = Math.max(1, (WATER_UNTIL_MINUTE - nowMinute) / 60);
      const perHour = Math.round(waterLeftMl / hoursLeft / 50) * 50;
      kronos.push(
        `Hedefe ${formatWater(waterLeftMl)} kaldı. ${clockOfMinute(WATER_UNTIL_MINUTE)} olana kadar saatte yaklaşık ${formatWater(Math.max(50, perHour))} yeter.`
      );
    } else {
      kronos.push(`Hedefe ${formatWater(waterLeftMl)} kaldı. Gece uykunu bölmemek için son yudumları ağır ağır iç.`);
    }
  }
  if (isToday && lastFood !== null && nowMinute - lastFood >= 300 && nowMinute >= 8 * 60 && nowMinute < 21 * 60) {
    kronos.push(
      `Son yemeğinden ${formatDuration(nowMinute - lastFood)} geçti. Enerjin düşmeden küçük bir ara öğün iyi olabilir.`
    );
  }
  if (longestGap >= 360 && gapFrom !== null && gapTo !== null) {
    kronos.push(
      `En uzun yemek arası ${formatDuration(longestGap)} (${clockOfMinute(gapFrom)}–${clockOfMinute(gapTo)}). Aralar kısaldıkça enerji daha dengeli kalır.`
    );
  }
  if (f.meals.length > 0 && caffeine.length >= 5) {
    kronos.push(`${caffeine.length} çay/kahve kaydı var. Arada su içmek hem kafeini dengeler hem hedefe yaklaştırır.`);
  }
  if (base.lastCaffeineMinute !== null && base.lastCaffeineMinute >= 16 * 60) {
    kronos.push(
      `Son çay/kahve kaydı saat ${clockOfMinute(base.lastCaffeineMinute)}. Akşam saatlerindeki kafein uykuya dalmayı zorlaştırabilir; akşam için su ya da bitki çayı deneyebilirsin.`
    );
  }
  if (lateFood && lastFood !== null) {
    kronos.push(
      `Son yemek saat ${clockOfMinute(lastFood)}. Yatmadan 2–3 saat önce bitirmek çoğu kişide uykuyu rahatlatır.`
    );
  }
  if (food.length > 0 && !has('SEBZE') && !has('MEYVE') && (!isToday || nowMinute >= 17 * 60)) {
    kronos.push('Sebze ya da meyve kaydı yok. Akşam yemeğine bir salata ya da ara öğüne bir meyve eklemek kolay bir adım.');
  }
  if (kcalTotal !== null && kcalMissing > 0) {
    kronos.push(`${kcalMissing} kayıtta kalori yok; toplam eksik olabilir.`);
  }
  if (kcalLeft !== null && f.kcalTarget !== null && kcalLeft > 0 && isToday && nowMinute < 21 * 60) {
    kronos.push(`Hedefine yaklaşık ${formatKcal(kcalLeft)} kaldı (kayıtlı toplam ≈${formatKcal(kcalTotal ?? 0)}).`);
  }
  if (kronos.length === 0 && !quiet) {
    kronos.push('Düzenin yolunda: suyu gün içine yay, öğünler arasını çok açma.');
  }
  if (kronos.length === 0) {
    kronos.push('Gün içinde su için küçük bir alışkanlık seç: her görev bitişinde bir bardak.');
  }

  return { ...base, chips, aura, kronos };
}

export const GROUP_ORDER: string[] = FOOD_GROUPS.map((g) => g.id);

// ───────────────────────── Gün sonu ve koç için kısa özet ─────────────────────────

/** Yapay zekâya (yalnızca paylaşım açıksa) giden toplu özet; yemek metinleri asla gönderilmez. */
export function nutritionPromptLines(n: DayNutrition): string[] {
  if (n.quiet) return [];
  const lines: string[] = [];
  lines.push(`- Su: ${formatWater(n.waterMl)} (hedef ${formatWater(n.waterGoalMl)})`);
  if (n.foodEntries > 0) {
    const last = n.lastFoodMinute !== null ? `, son yemek ${clockOfMinute(n.lastFoodMinute)}` : '';
    lines.push(`- Yemek kaydı: ${n.foodEntries}${last}`);
  }
  if (n.kcalTotal !== null) lines.push(`- Kayıtlı yaklaşık kalori: ${formatKcal(n.kcalTotal)} (tahmindir, eksik olabilir)`);
  if (n.caffeineCount > 0) lines.push(`- Çay/kahve: ${n.caffeineCount}`);
  return lines;
}

// ───────────────────────── Hedef doğrulama ─────────────────────────

export type TargetCheck = { ok: true; value: number | null } | { ok: false; message: string };

/** Günlük kalori hedefi girişi: boş = kapalı. Çok düşük ya da anlamsız değerler kaydedilmez. */
export function validateKcalTarget(input: string): TargetCheck {
  const t = input.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, message: 'Bir sayı yaz, örneğin 2000.' };
  if (n < KCAL_TARGET_MIN) {
    return {
      ok: false,
      message: `${KCAL_TARGET_MIN} kcal altında hedef koymuyorum. Daha düşük bir hedef düşünüyorsan bir doktor ya da diyetisyenle konuşmanı öneririm.`,
    };
  }
  if (n > KCAL_TARGET_MAX) return { ok: false, message: `En fazla ${KCAL_TARGET_MAX} kcal girebilirsin.` };
  return { ok: true, value: Math.round(n) };
}
