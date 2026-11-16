/**
 * İlerleme ve geçmiş (saf mantık, test edilebilir): günlük serileri, ortalamaları ve olmayan işlerin sebeplerini
 * hesaplar. Hiçbir metrik "iyi" ya da "kötü" diye renklenmez; metinler yalnızca sayıları söyler.
 */
import type { TaskOutcomeKind, TaskOutcomeReason } from '../database/types';
import { formatSteps } from './activityLogic';
import { formatDuration } from './format';
import { clockOfMinute, formatKcal, formatWater } from './nutritionLogic';
import { reasonLabel } from './taskOutcomeLogic';
import { rangeLabel, weekdayShort } from './weeklyLogic';

export type HistoryMetricId =
  | 'TASK_MIN'
  | 'ROUTINES'
  | 'WATER'
  | 'KCAL'
  | 'SMOKE'
  | 'SCREEN'
  | 'STEPS'
  | 'SLEEP'
  | 'WAKE'
  | 'SHOP'
  | 'COMMUTE';

/** Bir günün ölçülen değerleri; ölçülmeyen (kayıt yok) değer null. */
export interface HistoryDay {
  /** yyyy-mm-dd */
  day: string;
  taskMinutes: number;
  tasksDone: number;
  routinesDone: number;
  waterMl: number | null;
  kcal: number | null;
  /** Sayaç o gün kullanıldıysa sayı; kullanılmadıysa null */
  smoke: number | null;
  screenMinutes: number | null;
  steps: number | null;
  sleepMinutes: number | null;
  /** Uyanış, gün başından dakika */
  wakeMin: number | null;
  /** Dükkanda geçen süre (çıkış damgası varsa) */
  shopMinutes: number | null;
  /** Yol (işe + eve), en az biri hesaplanabildiyse */
  commuteMinutes: number | null;
}

export interface HistoryOutcome {
  day: string;
  outcome: TaskOutcomeKind;
  reason: TaskOutcomeReason | null;
}

interface MetricDef {
  id: HistoryMetricId;
  label: string;
  /** Çubuk grafikte ve özette kullanılan kısa sözcük: "günlük ortalama" ya da "ortalama saat" */
  avgWord: string;
  value: (d: HistoryDay) => number | null;
  format: (v: number) => string;
  /** Çubukların tabanı sabit mi (0), yoksa veriye göre mi (saatler gibi) */
  floating?: boolean;
}

export const HISTORY_METRICS: MetricDef[] = [
  { id: 'TASK_MIN', label: 'Biten işler', avgWord: 'günlük ortalama', value: (d) => d.taskMinutes, format: (v) => formatDuration(v) },
  { id: 'ROUTINES', label: 'Rutinler', avgWord: 'günlük ortalama', value: (d) => d.routinesDone, format: (v) => `${round1(v)} rutin` },
  { id: 'WATER', label: 'Su', avgWord: 'günlük ortalama', value: (d) => d.waterMl, format: (v) => formatWater(v) },
  { id: 'KCAL', label: 'Kalori', avgWord: 'günlük ortalama', value: (d) => d.kcal, format: (v) => `yaklaşık ${formatKcal(v)}` },
  { id: 'SMOKE', label: 'Sigara', avgWord: 'günlük ortalama', value: (d) => d.smoke, format: (v) => `${round1(v)} adet` },
  { id: 'SCREEN', label: 'Ekran', avgWord: 'günlük ortalama', value: (d) => d.screenMinutes, format: (v) => formatDuration(v) },
  { id: 'STEPS', label: 'Adım', avgWord: 'günlük ortalama', value: (d) => d.steps, format: (v) => `${formatSteps(v)} adım` },
  { id: 'SLEEP', label: 'Uyku', avgWord: 'gecelik ortalama', value: (d) => d.sleepMinutes, format: (v) => formatDuration(v) },
  { id: 'WAKE', label: 'Uyanış', avgWord: 'ortalama saat', value: (d) => d.wakeMin, format: (v) => clockOfMinute(v), floating: true },
  { id: 'SHOP', label: 'Dükkanda', avgWord: 'günlük ortalama', value: (d) => d.shopMinutes, format: (v) => formatDuration(v) },
  { id: 'COMMUTE', label: 'Yol', avgWord: 'günlük ortalama', value: (d) => d.commuteMinutes, format: (v) => formatDuration(v) },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

export const HISTORY_RANGES = [7, 14, 30] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** Ortalama ve karşılaştırma için gereken en az kayıtlı gün sayısı */
export const MIN_TRACKED_DAYS = 3;

export function metricDef(id: HistoryMetricId): MetricDef {
  return HISTORY_METRICS.find((m) => m.id === id) ?? HISTORY_METRICS[0];
}

export interface HistoryBar {
  day: string;
  weekday: string;
  /** null = kayıt yok */
  value: number | null;
  /** 0..1, kayıt yoksa 0 */
  ratio: number;
  label: string;
}

export interface HistorySeries {
  metric: HistoryMetricId;
  label: string;
  rangeLabel: string;
  bars: HistoryBar[];
  trackedDays: number;
  avg: number | null;
  avgLabel: string | null;
  maxDay: string | null;
  maxLabel: string | null;
  /** Son yarı ile önceki yarının ortalaması (her ikisinde de en az 3 kayıtlı gün varsa) */
  compare: { recent: number; earlier: number; recentLabel: string; earlierLabel: string } | null;
  /** Yargısız, tek bakışta özet */
  summary: string;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Son `range` günün serisi. `days` eskiden yeniye sıralı; yetmiyorsa eldeki kadar gösterilir. */
export function buildSeries(days: HistoryDay[], metric: HistoryMetricId, range: HistoryRange): HistorySeries {
  const def = metricDef(metric);
  const window = days.slice(-range);
  const values = window.map((d) => def.value(d));
  const tracked = values.filter((v): v is number => v !== null);

  // Sabit tabanlı metriklerde 0 kayıtlı sayılır; "kayıt yok" ile "0" ayrımı veri tarafında yapılır.
  let lo = 0;
  let hi = tracked.length > 0 ? Math.max(...tracked) : 0;
  if (def.floating && tracked.length > 0) {
    lo = Math.floor((Math.min(...tracked) - 30) / 30) * 30;
    hi = Math.max(hi, lo + 60);
  }
  const span = hi - lo;

  const bars: HistoryBar[] = window.map((d, i) => {
    const v = values[i];
    const ratio = v === null || span <= 0 ? 0 : Math.min(1, Math.max(0.06, (v - lo) / span));
    return { day: d.day, weekday: weekdayShort(d.day), value: v, ratio, label: v === null ? '' : def.format(v) };
  });

  const avg = tracked.length >= MIN_TRACKED_DAYS ? Math.round(mean(tracked)) : null;
  let maxDay: string | null = null;
  let maxVal = -Infinity;
  window.forEach((d, i) => {
    const v = values[i];
    if (v !== null && v > maxVal) {
      maxVal = v;
      maxDay = d.day;
    }
  });

  let compare: HistorySeries['compare'] = null;
  if (window.length >= 6) {
    const half = Math.floor(window.length / 2);
    const earlier = values.slice(0, window.length - half).filter((v): v is number => v !== null);
    const recent = values.slice(window.length - half).filter((v): v is number => v !== null);
    if (earlier.length >= MIN_TRACKED_DAYS && recent.length >= MIN_TRACKED_DAYS) {
      const e = Math.round(mean(earlier));
      const r = Math.round(mean(recent));
      compare = { recent: r, earlier: e, recentLabel: def.format(r), earlierLabel: def.format(e) };
    }
  }

  const keys = window.map((d) => d.day);
  const rl = keys.length > 0 ? rangeLabel(keys) : '';
  let summary: string;
  if (window.length === 0 || tracked.length === 0) {
    summary = `${def.label} için bu aralıkta kayıt yok.`;
  } else if (avg === null) {
    summary = `${window.length} günde ${tracked.length} günün kaydı var; ortalama için en az ${MIN_TRACKED_DAYS} gün gerekiyor.`;
  } else {
    summary = `${window.length} günün ${tracked.length}'inde kayıt var; ${def.avgWord} ${def.format(avg)}.`;
    if (compare) {
      summary +=
        compare.recent === compare.earlier
          ? ` Son günlerle öncesi aynı.`
          : ` Son günlerin ortalaması ${compare.recentLabel}, öncesininki ${compare.earlierLabel}.`;
    }
  }

  return {
    metric,
    label: def.label,
    rangeLabel: rl,
    bars,
    trackedDays: tracked.length,
    avg,
    avgLabel: avg === null ? null : def.format(avg),
    maxDay,
    maxLabel: maxDay === null ? null : def.format(maxVal),
    compare,
    summary,
  };
}

// ───────────────────────── Görev sonuçları ─────────────────────────

export interface OutcomeBreakdown {
  done: number;
  notDone: number;
  couldNot: number;
  /** "Yapamadım" sebepleri, çoktan aza; sebep söylenmeyenler "Sebep söylenmedi" olarak */
  reasons: { label: string; count: number; reason: TaskOutcomeReason | null }[];
  /** En sık sebep "iş vaktindeydi" ise Kronos'un ipucu cümlesi */
  hint: string | null;
}

/** Aynı iş aynı gün yeniden işaretlendiyse son cevap sayılır; girdi zaten son cevaplar olmalı. */
export function breakdownOutcomes(outcomes: HistoryOutcome[]): OutcomeBreakdown {
  let done = 0;
  let notDone = 0;
  let couldNot = 0;
  const reasonCount = new Map<TaskOutcomeReason | null, number>();
  for (const o of outcomes) {
    if (o.outcome === 'DONE') done += 1;
    else if (o.outcome === 'NOT_DONE') notDone += 1;
    else {
      couldNot += 1;
      reasonCount.set(o.reason, (reasonCount.get(o.reason) ?? 0) + 1);
    }
  }
  const reasons = [...reasonCount.entries()]
    .map(([reason, count]) => ({ reason, count, label: (reason ? reasonLabel(reason) : null) ?? 'Sebep söylenmedi' }))
    .sort((a, b) => b.count - a.count);
  const top = reasons[0];
  const hint =
    top && top.reason === 'WORK' && top.count >= 2
      ? `${top.count} iş iş vaktine denk geldiği için olmadı. İş vaktinde de yapılabilecek olanları öyle işaretlersen gün içine de yer ayırırım.`
      : top && top.reason === 'ENERGY' && top.count >= 3
        ? 'Enerjin yokken zor işleri tepe saatine, hafifleri akşama koymayı deneyebiliriz; saatleri Ayarlar\'dan değiştirebilirsin.'
        : null;
  return { done, notDone, couldNot, reasons, hint };
}
