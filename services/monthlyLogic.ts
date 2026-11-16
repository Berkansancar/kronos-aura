/**
 * Aylık karne: bir ayın tek sayfalık özeti ve önceki ayla yumuşak karşılaştırma.
 * Saf mantık; veritabanından ve React Native'den bağımsız, terminalde test edilebilir.
 *
 * Karne bir not değildir. Düşüş "kötü" diye sunulmaz; iş ve yol yoğun bir ay sakin geçebilir.
 * Süren ay, önceki ayın aynı sayıda gününe göre karşılaştırılır (haksız kıyas olmasın).
 */
import type { MoodLog } from '../database/types';
import { dayKey } from './activityLogic';
import { dayXp, levelFromXp, type GameGoals } from './gameLogic';
import { daysInMonth, monthTitle } from './habitCalendarLogic';
import type { HistoryDay } from './historyLogic';
import { formatDuration } from './format';
import { MOODS, formatMood, moodAverage, type MoodInfo } from './moodLogic';

export interface MonthReport {
  month: string;
  title: string;
  /** Saydığımız gün sayısı (süren ayda bugüne kadar; sınır verildiyse o kadar) */
  elapsedDays: number;
  totalDays: number;
  isCurrent: boolean;
  tasksDone: number;
  taskMinutes: number;
  routinesDone: number;
  /** En az bir iş, rutin ya da dil çalışması olan gün */
  activeDays: number;
  /** En az bir rutin yapılan gün */
  routineDays: number;
  /** Rutin yapılan ardışık gün sayısının ay içindeki en uzunu */
  bestStreak: number;
  languageMinutes: number;
  languageDays: number;
  moodCount: number;
  moodAvg: number | null;
  moodTop: { info: MoodInfo; count: number } | null;
  /** Ruh hali dağılımı: dizin 0 → 1 (Çok zor) … dizin 4 → 5 (Harika) */
  moodDist: number[];
  sleepAvgMin: number | null;
  stepsAvg: number | null;
  waterAvgMl: number | null;
  bestDay: { day: string; tasks: number; routines: number } | null;
  xp: number;
  /** Ayın sonunda (süren ayda bugün) Kahraman seviyesi */
  level: number;
  hasData: boolean;
}

const avgOf = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * `days`: geçmiş günleri (ay dışı olanlar da olabilir; seviye hesabı için ayın sonuna kadar hepsi gerekir).
 * `limitDays`: yalnızca ayın ilk N gününü say (önceki ayla eşit uzunlukta karşılaştırma için).
 */
export function buildMonthReport(
  month: string,
  days: HistoryDay[],
  moods: MoodLog[],
  goals: GameGoals,
  now: Date,
  limitDays?: number
): MonthReport {
  const total = daysInMonth(month);
  const today = dayKey(now);
  const isCurrent = today.slice(0, 7) === month;
  let elapsed = isCurrent ? Number(today.slice(8, 10)) : today.slice(0, 7) < month ? 0 : total;
  if (limitDays !== undefined) elapsed = Math.min(elapsed, Math.max(0, limitDays), total);
  const lastDay = `${month}-${String(Math.max(1, elapsed)).padStart(2, '0')}`;
  const inMonth = elapsed === 0 ? [] : days.filter((d) => d.day.slice(0, 7) === month && d.day <= lastDay);
  const byDay = [...inMonth].sort((a, b) => a.day.localeCompare(b.day));

  const tasksDone = byDay.reduce((a, d) => a + d.tasksDone, 0);
  const taskMinutes = byDay.reduce((a, d) => a + d.taskMinutes, 0);
  const routinesDone = byDay.reduce((a, d) => a + d.routinesDone, 0);
  const lang = (d: HistoryDay) => d.languageMinutes ?? 0;
  const activeDays = byDay.filter((d) => d.tasksDone > 0 || d.routinesDone > 0 || lang(d) > 0).length;
  const routineDays = byDay.filter((d) => d.routinesDone > 0).length;

  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of byDay) {
    if (d.routinesDone <= 0) {
      run = 0;
      prev = null;
      continue;
    }
    const consecutive = prev !== null && dayDiff(prev, d.day) === 1;
    run = consecutive ? run + 1 : 1;
    prev = d.day;
    bestStreak = Math.max(bestStreak, run);
  }

  const monthMoods = moods.filter((m) => m.day.slice(0, 7) === month && m.day <= lastDay && elapsed > 0);
  const counts = MOODS.map((info) => ({ info, count: monthMoods.filter((m) => m.mood === info.value).length })).filter((c) => c.count > 0);
  const moodTop = counts.length ? counts.reduce((a, b) => (b.count > a.count ? b : a)) : null;

  const present = (f: (d: HistoryDay) => number | null): number[] =>
    byDay.map(f).filter((v): v is number => v !== null && v > 0);

  const best = byDay.reduce<HistoryDay | null>((acc, d) => {
    const score = d.tasksDone + d.routinesDone;
    if (score <= 0) return acc;
    return !acc || score > acc.tasksDone + acc.routinesDone ? d : acc;
  }, null);

  // Seviye: ayın sonuna kadar biriken tüm XP
  const gameDays = (d: HistoryDay) => ({
    day: d.day,
    tasksDone: d.tasksDone,
    taskMinutes: d.taskMinutes,
    routinesDone: d.routinesDone,
    waterMl: d.waterMl,
    languageMinutes: d.languageMinutes ?? null,
  });
  const xpOf = (d: HistoryDay) => dayXp(gameDays(d), goals).xp;
  const cutoff = `${month}-${String(Math.max(1, elapsed)).padStart(2, '0')}`;
  const cumulative = days.filter((d) => d.day <= (elapsed === 0 ? '0000-00-00' : cutoff)).reduce((a, d) => a + xpOf(d), 0);

  return {
    month,
    title: monthTitle(month),
    elapsedDays: elapsed,
    totalDays: total,
    isCurrent,
    tasksDone,
    taskMinutes,
    routinesDone,
    activeDays,
    routineDays,
    bestStreak,
    languageMinutes: byDay.reduce((a, d) => a + lang(d), 0),
    languageDays: byDay.filter((d) => lang(d) > 0).length,
    moodCount: monthMoods.length,
    moodAvg: moodAverage(monthMoods),
    moodTop,
    moodDist: MOODS.map((info) => monthMoods.filter((m) => m.mood === info.value).length),
    sleepAvgMin: avgOf(present((d) => d.sleepMinutes)),
    stepsAvg: avgOf(present((d) => d.steps)),
    waterAvgMl: avgOf(present((d) => d.waterMl)),
    bestDay: best ? { day: best.day, tasks: best.tasksDone, routines: best.routinesDone } : null,
    xp: byDay.reduce((a, d) => a + xpOf(d), 0),
    level: levelFromXp(cumulative).level,
    hasData: activeDays > 0 || monthMoods.length > 0,
  };
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000);
}

// ───────────────────────── Karşılaştırma ─────────────────────────

export type MonthMetricId = 'activeDays' | 'routinesDone' | 'tasksDone' | 'languageMinutes' | 'routineDays';

export interface MonthCompareRow {
  id: MonthMetricId;
  label: string;
  cur: number;
  prev: number;
  delta: number;
  direction: 'UP' | 'DOWN' | 'SAME';
  /** Gösterim: "12 → 18" gibi, dil dakikası için süre biçimiyle */
  text: string;
}

const METRICS: { id: MonthMetricId; label: string; get: (r: MonthReport) => number; fmt?: (n: number) => string }[] = [
  { id: 'activeDays', label: 'Etkin gün', get: (r) => r.activeDays },
  { id: 'routineDays', label: 'Rutin yapılan gün', get: (r) => r.routineDays },
  { id: 'routinesDone', label: 'Tamamlanan rutin', get: (r) => r.routinesDone },
  { id: 'tasksDone', label: 'Biten iş', get: (r) => r.tasksDone },
  { id: 'languageMinutes', label: 'Dil çalışması', get: (r) => r.languageMinutes, fmt: (n) => formatDuration(n) },
];

/** İki ayı satır satır karşılaştırır; ikisinde de sıfır olan satır gösterilmez. */
export function compareMonths(cur: MonthReport, prev: MonthReport | null): MonthCompareRow[] {
  if (!prev) return [];
  const rows: MonthCompareRow[] = [];
  for (const m of METRICS) {
    const c = m.get(cur);
    const p = m.get(prev);
    if (c === 0 && p === 0) continue;
    const fmt = m.fmt ?? ((n: number) => String(n));
    rows.push({
      id: m.id,
      label: m.label,
      cur: c,
      prev: p,
      delta: c - p,
      direction: c > p ? 'UP' : c < p ? 'DOWN' : 'SAME',
      text: `${fmt(p)} → ${fmt(c)}`,
    });
  }
  return rows;
}

/** Karşılaştırmanın tek cümlelik, yargısız özeti. */
export function compareSentence(rows: MonthCompareRow[], cur: MonthReport): string | null {
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.id === 'activeDays');
  const scope = cur.isCurrent ? 'geçen ayın aynı günlerine göre' : 'bir önceki aya göre';
  if (!active) return null;
  if (active.direction === 'UP') return `Etkin gün sayın ${scope} ${active.delta} gün arttı. Ritmin oturuyor.`;
  if (active.direction === 'SAME') return `Etkin gün sayın ${scope} aynı kaldı. İstikrar da bir başarı.`;
  return `Bu ay ${scope} biraz daha sakin geçti. Yoğun dönemler olur; önemli olan yeniden başlayabilmek.`;
}

// ───────────────────────── Öne çıkanlar ─────────────────────────

export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${monthTitle(`${y}-${String(m).padStart(2, '0')}`).split(' ')[0]}`;
}

/** Karnenin üstünde okunacak 2-5 sıcak cümle. Boş ay için nazik bir davet döner. */
export function highlights(r: MonthReport, rows: MonthCompareRow[] = []): string[] {
  if (r.elapsedDays === 0) return ['Bu ay henüz başlamadı.'];
  if (!r.hasData) return ['Bu ayda henüz kayıt yok. Başlamak için her zaman uygun bir gün var.'];
  const out: string[] = [];
  if (r.routineDays > 0) {
    out.push(
      `${r.routineDays} gün rutin yaptın${r.bestStreak >= 2 ? `; en uzun serin ${r.bestStreak} gün` : ''}.`
    );
  }
  if (r.languageMinutes > 0) {
    out.push(`Dil çalışması: toplam ${formatDuration(r.languageMinutes)}, ${r.languageDays} günde.`);
  }
  if (r.moodCount > 0 && r.moodTop) {
    if (r.moodTop.info.value <= 2) {
      out.push(`${r.moodCount} gün ruh halini yazdın. Bazı günler ağır geçmiş olabilir; yazmak kendine bakmanın iyi bir yolu.`);
    } else {
      const avg = r.moodAvg !== null ? ` Ortalaman ${formatMood(r.moodAvg)}/5.` : '';
      out.push(`${r.moodCount} gün ruh halini yazdın; en sık "${r.moodTop.info.label}" ${r.moodTop.info.emoji} dedin.${avg}`);
    }
  }
  if (r.bestDay) {
    const parts: string[] = [];
    if (r.bestDay.tasks > 0) parts.push(`${r.bestDay.tasks} iş`);
    if (r.bestDay.routines > 0) parts.push(`${r.bestDay.routines} rutin`);
    out.push(`En dolu günün ${dayLabel(r.bestDay.day)}: ${parts.join(', ')}.`);
  }
  const cmp = compareSentence(rows, r);
  if (cmp) out.push(cmp);
  return out.slice(0, 5);
}

