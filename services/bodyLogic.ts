/**
 * Kilo ve rekor ekranının saf mantığı: kilo girişi, eğilim, çizgi grafik geometrisi ve egzersiz rekorları.
 * React Native ve veritabanına bağlı değildir; terminalde test edilir (npm run test:body).
 *
 * Kilo yargısızdır: günlük dalgalanmalar normal sayılır, hiçbir değer "iyi" ya da "kötü" diye damgalanmaz.
 * Tıbbi tavsiye verilmez; hedef kilo yalnızca grafikte çizgi olarak gösterilir.
 */
import type { WeightLog } from '../database/types';
import { parseDayKey } from './activityLogic';
import { EXERCISES, EXERCISE_BY_ID, type Level, type MoveId } from './exerciseData';
import { recordKey, variantFor, type ExerciseState } from './exerciseLogic';

export const MIN_KG = 30;
export const MAX_KG = 300;

/** "78,4", "78.4", "78" -> 78.4 / 78. Aralık dışı ya da bozuk girdi için null. */
export function parseKg(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{2,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < MIN_KG || n > MAX_KG) return null;
  return Math.round(n * 10) / 10;
}

export const formatKg = (kg: number): string => `${(Math.round(kg * 10) / 10).toFixed(1).replace('.', ',')} kg`;

const dayDiff = (a: string, b: string): number => Math.round((parseDayKey(b).getTime() - parseDayKey(a).getTime()) / 86_400_000);

/**
 * Son `windowDays` gündeki kayıtlara en küçük kareler doğrusu uydurur ve haftalık eğimi (kg/hafta, tek ondalık) verir.
 * En az 3 kayıt ve ilk ile son kayıt arasında en az 7 gün yoksa null (az veriyle eğim yanıltır).
 */
export function trendPerWeek(logs: WeightLog[], today: string, windowDays = 28): number | null {
  const pts = logs.filter((l) => l.day <= today && dayDiff(l.day, today) < windowDays).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (pts.length < 3) return null;
  const x0 = pts[0].day;
  const xs = pts.map((p) => dayDiff(x0, p.day));
  if (xs[xs.length - 1] < 7) return null;
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.kg, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (pts[i].kg - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 7 * 10) / 10;
}

export interface WeightStats {
  count: number;
  latest: WeightLog | null;
  first: WeightLog | null;
  /** Son - ilk (kg, tek ondalık); tek kayıtta null */
  changeSinceFirst: number | null;
  perWeek: number | null;
  targetKg: number | null;
  /** Hedefe kalan (hedef - şimdi), işaretli; hedef ya da kayıt yoksa null */
  toTarget: number | null;
}

export function weightStats(logs: WeightLog[], today: string, targetKg: number | null): WeightStats {
  const sorted = logs.filter((l) => l.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const first = sorted.length ? sorted[0] : null;
  const target = targetKg !== null && Number.isFinite(targetKg) && targetKg >= MIN_KG && targetKg <= MAX_KG ? targetKg : null;
  return {
    count: sorted.length,
    latest,
    first,
    changeSinceFirst: latest && first && latest.day !== first.day ? Math.round((latest.kg - first.kg) * 10) / 10 : null,
    perWeek: trendPerWeek(sorted, today),
    targetKg: target,
    toTarget: latest && target !== null ? Math.round((target - latest.kg) * 10) / 10 : null,
  };
}

const fmtSigned = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1).replace('.', ',')}`;
export { fmtSigned as formatSigned };

/** Yargısız, kısa bir not: değeri iyi ya da kötü diye adlandırmaz. */
export function weightNote(s: WeightStats): string {
  if (s.count === 0) return 'İlk kilonu yazınca grafik burada başlar.';
  if (s.count < 3 || s.perWeek === null) return 'Eğilim için en az 3 kayıt ve bir hafta gerekir. Günlük küçük dalgalanmalar normaldir.';
  if (Math.abs(s.perWeek) < 0.1) return 'Son haftalarda kilon kabaca sabit görünüyor. Günlük dalgalanmalar normaldir.';
  return `Son 4 haftada haftada ortalama ${fmtSigned(s.perWeek)} kg. Günlük dalgalanmalar normaldir; haftalık eğilime bak.`;
}

// ---------------------------------------------------------------------------------------------
// Çizgi grafik geometrisi (react-native-svg olmadan: noktalar ve döndürülmüş ince çizgi parçaları)
// ---------------------------------------------------------------------------------------------

export interface ChartPoint {
  day: string;
  kg: number;
  x: number;
  y: number;
}

export interface ChartSegment {
  /** Parçanın merkezi */
  cx: number;
  cy: number;
  length: number;
  /** Derece; yatayla yapılan açı (aşağı doğru pozitif) */
  angle: number;
}

export interface ChartGeometry {
  points: ChartPoint[];
  segments: ChartSegment[];
  /** Hedef çizgisinin y konumu; hedef yoksa null */
  targetY: number | null;
  minKg: number;
  maxKg: number;
  startDay: string;
  endDay: string;
}

/**
 * Son `rangeDays` günün kayıtlarını `width` x `height` alanına (kenar boşluğu `pad`) yerleştirir. x: tarihe orantılı,
 * y: kg (üstte büyük). Hedef varsa eksene dahil edilir. Boş ya da tek kayıt güvenle işlenir.
 */
export function chartGeometry(
  logs: WeightLog[],
  today: string,
  width: number,
  height: number,
  pad: number,
  targetKg: number | null,
  rangeDays = 90
): ChartGeometry {
  const within = logs.filter((l) => l.day <= today && dayDiff(l.day, today) < rangeDays).sort((a, b) => (a.day < b.day ? -1 : 1));
  const target = targetKg !== null && Number.isFinite(targetKg) && targetKg >= MIN_KG && targetKg <= MAX_KG ? targetKg : null;
  if (within.length === 0) return { points: [], segments: [], targetY: null, minKg: 0, maxKg: 0, startDay: today, endDay: today };

  const kgs = within.map((l) => l.kg).concat(target !== null ? [target] : []);
  let minKg = Math.min(...kgs);
  let maxKg = Math.max(...kgs);
  if (maxKg - minKg < 2) {
    const mid = (maxKg + minKg) / 2;
    minKg = mid - 1;
    maxKg = mid + 1;
  } else {
    minKg -= 0.5;
    maxKg += 0.5;
  }
  const startDay = within[0].day;
  const endDay = within[within.length - 1].day;
  const span = Math.max(1, dayDiff(startDay, endDay));
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  const xOf = (day: string) => (within.length === 1 ? width / 2 : pad + (dayDiff(startDay, day) / span) * innerW);
  const yOf = (kg: number) => pad + ((maxKg - kg) / (maxKg - minKg)) * innerH;

  const points: ChartPoint[] = within.map((l) => ({ day: l.day, kg: l.kg, x: xOf(l.day), y: yOf(l.kg) }));
  const segments: ChartSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    segments.push({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  return { points, segments, targetY: target !== null ? yOf(target) : null, minKg, maxKg, startDay, endDay };
}

// ---------------------------------------------------------------------------------------------
// Egzersiz rekorları
// ---------------------------------------------------------------------------------------------

export interface RecordRow {
  move: MoveId;
  title: string;
  icon: string;
  level: Level;
  variantName: string;
  unitWord: 'tekrar' | 'sn';
  best: number;
  bestDay: string;
  first: number;
  firstDay: string;
  /** best - first */
  gain: number;
  /** Son 7 gün içinde yeni rekor kırıldı mı */
  recent: boolean;
}

/** Her hareket için en yüksek basamakta tutulan rekor satırı; hiç kaydı olmayan hareket listede yer almaz. */
export function recordRows(state: ExerciseState, today: string): RecordRow[] {
  const rows: RecordRow[] = [];
  for (const m of EXERCISES) {
    let pick: { level: Level; r: ExerciseState['records'][string] } | null = null;
    for (const level of [3, 2, 1] as Level[]) {
      const r = state.records[recordKey(m.id, level)];
      if (r) {
        pick = { level, r };
        break;
      }
    }
    if (!pick) continue;
    const v = variantFor(m.id, pick.level);
    rows.push({
      move: m.id,
      title: EXERCISE_BY_ID[m.id].title,
      icon: m.icon,
      level: pick.level,
      variantName: v.name,
      unitWord: v.unit === 'sec' ? 'sn' : 'tekrar',
      best: pick.r.best,
      bestDay: pick.r.bestDay,
      first: pick.r.first,
      firstDay: pick.r.firstDay,
      gain: pick.r.best - pick.r.first,
      recent: pick.r.bestDay <= today && dayDiff(pick.r.bestDay, today) < 7 && pick.r.best > pick.r.first,
    });
  }
  return rows;
}

