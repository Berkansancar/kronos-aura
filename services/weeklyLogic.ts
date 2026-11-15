/**
 * Haftalık özet (saf mantık, test edilebilir). Son 7 günün görev, rutin, uyku, adım ve enerji verisini
 * önceki 7 günle yan yana koyar. Yapay zekâ gerekmez; yargılamayan, kısa, emojisiz Türkçe kuralları kullanır.
 * Kıyaslar yalnızca bilgi içindir: "az yaptın" gibi bir cümle kurulmaz.
 */
import type { EnergyState } from '../database/types';
import { formatSteps } from './activityLogic';
import { formatDuration } from './format';
import { DEFAULT_WATER_GOAL, formatKcal, formatWater } from './nutritionLogic';

export interface WeekDay {
  /** yyyy-mm-dd */
  day: string;
  tasksDone: number;
  taskMinutes: number;
  routinesDone: number;
  steps: number | null;
  screenMinutes: number | null;
  sleepMinutes: number | null;
  hardDay: boolean;
  /** Su ve yemek (kayıt tutulduysa; eski veriler için isteğe bağlı) */
  waterMl?: number;
  foodEntries?: number;
  /** Kayıtlı yaklaşık kalori (bilinmiyorsa null) */
  kcal?: number | null;
}

export interface WeekRoutineInput {
  title: string;
  /** Rutinin eklendiği gün (yyyy-mm-dd): öncesi "yapma şansı" sayılmaz */
  createdDay: string;
  /** İki haftalık pencerede yapıldığı günler */
  doneDays: string[];
}

export interface WeekFacts {
  /** Bu haftanın son günü (yyyy-mm-dd) */
  endDay: string;
  /** Bu hafta ve önceki hafta, eskiden yeniye 7'şer gün */
  days: WeekDay[];
  prevDays: WeekDay[];
  routines: WeekRoutineInput[];
  energy: Record<EnergyState, number>;
  driftMinutes: number;
  peakStartHour: number;
  peakEndHour: number;
  /** Son günün rutinleri şansa katılsın mı? (akşam 20:00'den sonra evet) */
  countEndDay: boolean;
  /** Günlük su hedefi (ml); verilmezse varsayılan */
  waterGoalMl?: number;
}

export interface WeekTotals {
  tasksDone: number;
  taskMinutes: number;
  routinesDone: number;
  routineChances: number;
  hardDays: number;
  sleepAvg: number | null;
  sleepNights: number;
  stepsAvg: number | null;
  screenAvg: number | null;
  /** Su kaydı olan gün sayısı ve (en az 3 gün varsa) günlük ortalama */
  waterDays: number;
  waterAvg: number | null;
  waterGoalDays: number;
  /** Yemek kaydı olan gün sayısı; kalori ortalaması yalnızca en az 3 günde 2+ yemek kaydı varsa */
  foodDays: number;
  kcalAvg: number | null;
}

export interface WeekRoutineRow {
  title: string;
  done: number;
  chances: number;
}

export interface WeekBar {
  day: string;
  weekday: string;
  value: number;
  hardDay: boolean;
}

export interface WeekSummary {
  rangeLabel: string;
  totals: WeekTotals;
  prev: WeekTotals;
  /** 0..1; hiç şans yoksa null */
  routineRate: number | null;
  bars: WeekBar[];
  maxBar: number;
  bestDay: string | null;
  routines: WeekRoutineRow[];
  routineToAdjust: WeekRoutineRow | null;
  highlights: string[];
  aura: string;
  kronos: string[];
  /** Hafta boyunca hiçbir kayıt yok */
  quiet: boolean;
}

const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const WEEKDAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const pad = (n: number) => String(n).padStart(2, '0');

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Haftanın son günü: gece 04:00'e kadar hâlâ dünün sayılır. */
export function weekEndDate(now: Date): Date {
  const back = now.getHours() < 4 ? 1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
}

/** `endDay` dahil geriye doğru `n` günün anahtarları, eskiden yeniye. */
export function windowKeys(endDay: string, n = 7): string[] {
  const end = parseKey(endDay);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(keyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)));
  return out;
}

export const weekdayShort = (key: string): string => WEEKDAYS[parseKey(key).getDay()];
export const weekdayLong = (key: string): string => WEEKDAYS_LONG[parseKey(key).getDay()];

/** "10–16 Kasım" ya da ay değişiyorsa "28 Ekim – 3 Kasım" */
export function rangeLabel(keys: string[]): string {
  const a = parseKey(keys[0]);
  const b = parseKey(keys[keys.length - 1]);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

function avg(values: number[], minCount: number): number | null {
  return values.length >= minCount ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export function totalsOf(
  days: WeekDay[],
  routines: WeekRoutineInput[],
  countEndDay: boolean,
  waterGoalMl: number = DEFAULT_WATER_GOAL
): WeekTotals {
  const keys = days.map((d) => d.day);
  const last = keys[keys.length - 1];
  let routineChances = 0;
  let routinesDone = 0;
  for (const r of routines) {
    for (const k of keys) {
      const done = r.doneDays.includes(k);
      if (done) routinesDone += 1;
      if (k < r.createdDay) continue;
      // Henüz bitmemiş son gün, yapılmadıysa şansa katılmaz (sabah bakınca oran düşmesin)
      if (k === last && !countEndDay && !done) continue;
      routineChances += 1;
    }
  }
  // Rutin yapıldığı hâlde şans sayılmadıysa (ör. eklenmeden önce) oran 1'i aşmasın
  routinesDone = Math.min(routinesDone, routineChances);
  const sleeps = days.map((d) => d.sleepMinutes).filter((x): x is number => x !== null && x > 0);
  const steps = days.map((d) => d.steps).filter((x): x is number => x !== null && x > 0);
  const screens = days.map((d) => d.screenMinutes).filter((x): x is number => x !== null);
  const waters = days.map((d) => d.waterMl ?? 0).filter((x) => x > 0);
  // Kalori ortalaması yalnızca yeterince kayıt tutulan günlerden alınır (tek öğün yazılan gün ortalamayı bozar)
  const kcals = days
    .filter((d) => (d.foodEntries ?? 0) >= 2 && (d.kcal ?? 0) > 0)
    .map((d) => d.kcal as number);
  return {
    tasksDone: days.reduce((a, d) => a + d.tasksDone, 0),
    taskMinutes: days.reduce((a, d) => a + d.taskMinutes, 0),
    routinesDone,
    routineChances,
    hardDays: days.filter((d) => d.hardDay).length,
    sleepAvg: avg(sleeps, 3),
    sleepNights: sleeps.length,
    stepsAvg: avg(steps, 3),
    screenAvg: avg(screens, 3),
    waterDays: waters.length,
    waterAvg: avg(waters, 3),
    waterGoalDays: waters.filter((w) => w >= waterGoalMl).length,
    foodDays: days.filter((d) => (d.foodEntries ?? 0) > 0).length,
    kcalAvg: avg(kcals, 3),
  };
}

function routineRows(routines: WeekRoutineInput[], days: WeekDay[], countEndDay: boolean): WeekRoutineRow[] {
  const keys = days.map((d) => d.day);
  const last = keys[keys.length - 1];
  return routines
    .map((r) => {
      let done = 0;
      let chances = 0;
      for (const k of keys) {
        const d = r.doneDays.includes(k);
        if (d) done += 1;
        if (k < r.createdDay) continue;
        if (k === last && !countEndDay && !d) continue;
        chances += 1;
      }
      return { title: r.title, done: Math.min(done, chances), chances };
    })
    .filter((r) => r.chances > 0)
    .sort((a, b) => b.done - a.done || b.chances - a.chances);
}

function compare(now: number, before: number, unit: (n: number) => string, more: string, less: string): string {
  const diff = now - before;
  if (diff === 0) return 'geçen haftayla aynı';
  return `geçen haftadan ${unit(Math.abs(diff))} ${diff > 0 ? more : less}`;
}

export function buildWeekSummary(f: WeekFacts): WeekSummary {
  const goal = f.waterGoalMl ?? DEFAULT_WATER_GOAL;
  const totals = totalsOf(f.days, f.routines, f.countEndDay, goal);
  const prev = totalsOf(f.prevDays, f.routines, true, goal);
  const rows = routineRows(f.routines, f.days, f.countEndDay);
  const routineRate = totals.routineChances > 0 ? totals.routinesDone / totals.routineChances : null;

  const bars: WeekBar[] = f.days.map((d) => ({
    day: d.day,
    weekday: weekdayShort(d.day),
    value: d.tasksDone + d.routinesDone,
    hardDay: d.hardDay,
  }));
  const maxBar = Math.max(1, ...bars.map((b) => b.value));
  const best = [...bars].sort((a, b) => b.value - a.value || b.day.localeCompare(a.day))[0];
  const bestDay = best && best.value > 0 ? weekdayLong(best.day) : null;

  const quiet =
    totals.tasksDone === 0 &&
    totals.routinesDone === 0 &&
    totals.sleepAvg === null &&
    totals.stepsAvg === null &&
    totals.waterDays === 0 &&
    totals.foodDays === 0 &&
    f.energy.HIGH + f.energy.EXHAUSTED + f.energy.DISTRACTED === 0;

  // Ayarlanacak rutin: en az 3 şans, yapılma oranı %40'ın altı. Suçlama yok; saat/süre ayarı önerilir.
  const struggling = rows
    .filter((r) => r.chances >= 3 && r.done / r.chances < 0.4)
    .sort((a, b) => a.done / a.chances - b.done / b.chances)[0];
  const routineToAdjust = struggling ?? null;
  const steady = rows.find((r) => r.done >= 3 && r.done / r.chances >= 0.6) ?? null;

  // ── Öne çıkanlar ──
  const highlights: string[] = [];
  if (totals.tasksDone > 0) {
    const cmp = prev.tasksDone > 0 ? ` (geçen hafta ${prev.tasksDone})` : '';
    highlights.push(`${totals.tasksDone} görev bitti, toplam ${formatDuration(totals.taskMinutes)}${cmp}`);
  }
  if (totals.routineChances > 0) {
    highlights.push(
      `Rutinler: ${totals.routinesDone}/${totals.routineChances} gün yapıldı (%${Math.round((routineRate ?? 0) * 100)})`
    );
  }
  if (totals.sleepAvg !== null) {
    const cmp =
      prev.sleepAvg !== null
        ? `, ${compare(totals.sleepAvg, prev.sleepAvg, (n) => formatDuration(n), 'fazla', 'az')}`
        : '';
    highlights.push(`Ortalama uyku ${formatDuration(totals.sleepAvg)}${cmp}`);
  }
  if (totals.stepsAvg !== null) {
    highlights.push(`Günlük ortalama ${formatSteps(totals.stepsAvg)} adım`);
  }
  if (totals.screenAvg !== null) {
    highlights.push(`Günlük ortalama ekran süresi ${formatDuration(totals.screenAvg)}`);
  }
  if (totals.waterAvg !== null) {
    highlights.push(
      `Günlük ortalama ${formatWater(totals.waterAvg)} su` +
        (totals.waterGoalDays > 0 ? `, ${totals.waterGoalDays} gün hedefe (${formatWater(goal)}) ulaştın` : '')
    );
  }
  if (totals.kcalAvg !== null) {
    highlights.push(`Kayıt tuttuğun günlerde ortalama ≈${formatKcal(totals.kcalAvg)} (yaklaşık, kayıt eksik olabilir)`);
  } else if (totals.foodDays > 0) {
    highlights.push(`${totals.foodDays} günde yemek kaydı tuttun`);
  }
  if (totals.hardDays > 0) {
    highlights.push(`${totals.hardDays} gün zor gün modunda hafif ilerledin`);
  }
  if (f.energy.EXHAUSTED >= 3) {
    highlights.push(`${f.energy.EXHAUSTED} işi "tükendim" diyerek bitirdin`);
  }

  // ── Aura ──
  let aura: string;
  if (quiet) {
    aura = 'Bu hafta kayıt az, sorun değil. Yeni haftaya küçük bir adımla başlayabiliriz.';
  } else {
    const parts: string[] = [];
    if (totals.tasksDone > 0 && totals.routinesDone > 0) {
      parts.push(`Bu hafta ${totals.tasksDone} görev bitirdin ve ${totals.routinesDone} kez rutinlerini yaptın.`);
    } else if (totals.tasksDone > 0) {
      parts.push(`Bu hafta ${totals.tasksDone} görev bitirdin.`);
    } else if (totals.routinesDone > 0) {
      parts.push(`Bu hafta ${totals.routinesDone} kez rutinlerini yaptın.`);
    } else {
      parts.push('Bu hafta sakin geçmiş.');
    }
    if (totals.hardDays > 0) {
      parts.push('Zor günlerin de oldu; planı hafifletip devam etmen akıllıca bir seçimdi.');
    } else if (f.energy.EXHAUSTED >= 3) {
      parts.push('Birkaç işi yorgun bitirmişsin. Bunu bir sinyal olarak not aldım; dinlenmeye de yer açalım.');
    } else if (totals.sleepAvg !== null && totals.sleepAvg < 360) {
      parts.push('Uyku ortalaman biraz kısa kalmış. Bu hafta dinlenmeye de yer açmak iyi gelebilir.');
    } else if (prev.tasksDone > 0 && totals.tasksDone > prev.tasksDone) {
      parts.push('Geçen haftadan daha çok iş bitirdin. Bunu fark etmek güzel.');
    } else if (steady) {
      parts.push(`"${steady.title}" rutinin oturmaya başlamış.`);
    } else {
      parts.push('Küçük adımların toplamı bu. Hepsi sayılır.');
    }
    if (totals.waterGoalDays >= 4) parts.push(`Su hedefine ${totals.waterGoalDays} gün ulaştın, bu güzel bir alışkanlık.`);
    aura = parts.join(' ');
  }

  // ── Kronos ──
  const kronos: string[] = [];
  if (bestDay) kronos.push(`En hareketli günün ${bestDay} oldu.`);
  if (steady) kronos.push(`"${steady.title}" ${steady.done}/${steady.chances} gün ile en tutarlı rutinin.`);
  if (routineToAdjust) {
    kronos.push(
      `"${routineToAdjust.title}" ${routineToAdjust.done}/${routineToAdjust.chances} gün yapıldı. Saatini değiştirmeyi ya da süresini kısaltmayı dene.`
    );
  }
  if (totals.waterDays >= 3 && totals.waterGoalDays <= 1) {
    kronos.push('Su hedefine az günde ulaşılmış. Her görev bitişinde bir bardak ekleyerek kolaylaştırabilirsin.');
  }
  kronos.push(
    `Gelecek hafta: en zor işi tepe saatinde (${pad(f.peakStartHour)}:00–${pad(f.peakEndHour % 24)}:00) yap ve her akşam gün sonu değerlendirmesini aç.`
  );

  return {
    rangeLabel: rangeLabel(f.days.map((d) => d.day)),
    totals,
    prev,
    routineRate,
    bars,
    maxBar,
    bestDay,
    routines: rows,
    routineToAdjust,
    highlights,
    aura,
    kronos,
    quiet,
  };
}
