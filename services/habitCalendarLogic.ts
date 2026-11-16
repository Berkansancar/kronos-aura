/**
 * Alışkanlık takvimi: ay ızgarası, günlük yapılanlar, seri ve oranlar.
 * Saf mantık; veritabanından ve React Native'den bağımsız, terminalde test edilebilir.
 *
 * "Yapıldı" tanımı rutin istatistiğiyle aynıdır: o gün `DONE` kaydı olan rutin. Yapılmayan gün bir kusur değil,
 * yalnızca boş bir hücredir; takvim kimseyi suçlamaz.
 */
import type { MoodLog, Routine, RoutineLog } from '../database/types';
import { dayKey, parseDayKey } from './activityLogic';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11" biçimi */
export const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function splitMonth(key: string): { y: number; m: number } {
  const [y, m] = key.split('-').map(Number);
  return { y, m: m - 1 };
}

export function shiftMonth(key: string, delta: number): string {
  const { y, m } = splitMonth(key);
  return monthKeyOf(new Date(y, m + delta, 1));
}

export function monthTitle(key: string): string {
  const { y, m } = splitMonth(key);
  return `${MONTHS[m]} ${y}`;
}

export function daysInMonth(key: string): number {
  const { y, m } = splitMonth(key);
  return new Date(y, m + 1, 0).getDate();
}

/** Pazartesi ile başlayan haftalar; ay dışındaki hücreler null. */
export function monthGrid(key: string): (string | null)[][] {
  const { y, m } = splitMonth(key);
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Pzt=0
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(key); d += 1) cells.push(dayKey(new Date(y, m, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** gün -> o gün yapılan rutin id'leri. `routineId` verilirse yalnızca o rutin sayılır. */
export function doneByDay(logs: RoutineLog[], routineId?: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const l of logs) {
    if (l.outcome !== 'DONE') continue;
    if (routineId && l.routineId !== routineId) continue;
    const set = map.get(l.day) ?? new Set<string>();
    set.add(l.routineId);
    map.set(l.day, set);
  }
  return map;
}

/** 0 = hiç yok, 1..4 = yapılan oranına göre koyuluk. */
export function intensity(done: number, total: number): 0 | 1 | 2 | 3 | 4 {
  if (done <= 0 || total <= 0) return 0;
  const f = Math.min(1, done / total);
  if (f >= 1) return 4;
  if (f >= 0.67) return 3;
  if (f >= 0.34) return 2;
  return 1;
}

/** Üst üste yapılan en uzun gün sayısı. */
export function bestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sorted) {
    const d = parseDayKey(k);
    if (prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1) run += 1;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Bugünden (yapıldıysa) ya da dünden geriye doğru üst üste yapılan günler. */
export function currentStreak(days: Set<string>, now: Date): number {
  let cursor = days.has(dayKey(now)) ? 0 : 1;
  let streak = 0;
  while (cursor < 3650) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - cursor);
    if (!days.has(dayKey(d))) break;
    streak += 1;
    cursor += 1;
  }
  return streak;
}

export interface CalendarCell {
  day: string;
  /** Ayın kaçıncı günü */
  dom: number;
  done: number;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
  mood: number | null;
}

/**
 * Bir ayın hücreleri. `routines` aktif rutinlerdir; `routineId` verilirse yalnızca o rutin gösterilir
 * (total = 1). `moods` günlük ruh hali kayıtlarıdır.
 */
export function buildMonth(
  key: string,
  routines: Routine[],
  logs: RoutineLog[],
  moods: MoodLog[],
  now: Date,
  routineId?: string
): { weeks: (CalendarCell | null)[][]; doneDays: number; activeDays: number } {
  const done = doneByDay(logs, routineId);
  const moodByDay = new Map(moods.map((m) => [m.day, m.mood as number]));
  const total = routineId ? 1 : routines.length;
  const today = dayKey(now);
  let doneDays = 0;
  let activeDays = 0;
  const weeks = monthGrid(key).map((week) =>
    week.map((day) => {
      if (!day) return null;
      const ids = done.get(day);
      const n = ids ? (routineId ? ids.size : [...ids].filter((id) => routines.some((r) => r.id === id)).length) : 0;
      const isFuture = day > today;
      if (!isFuture) activeDays += 1;
      if (n > 0) doneDays += 1;
      return {
        day,
        dom: Number(day.slice(8, 10)),
        done: n,
        total,
        level: intensity(n, total),
        isToday: day === today,
        isFuture,
        mood: moodByDay.get(day) ?? null,
      } satisfies CalendarCell;
    })
  );
  return { weeks, doneDays, activeDays };
}

export interface HabitSummary {
  /** Seçilen ayda en az bir rutin yapılan gün sayısı */
  doneDays: number;
  /** Ayın bugüne kadar geçen gün sayısı */
  activeDays: number;
  currentStreak: number;
  bestStreak: number;
  /** Seçilen ayda toplam "yapıldı" sayısı (rutin x gün) */
  totalDone: number;
}

export function summarize(
  key: string,
  logs: RoutineLog[],
  now: Date,
  routineId?: string
): HabitSummary {
  const done = doneByDay(logs, routineId);
  const allDays = new Set(done.keys());
  const inMonth = [...done.entries()].filter(([d]) => d.startsWith(key));
  const today = dayKey(now);
  const { y, m } = splitMonth(key);
  const last = dayKey(new Date(y, m, daysInMonth(key)));
  const upTo = today < last ? today : last;
  const activeDays = today < `${key}-01` ? 0 : Number(upTo.slice(8, 10));
  return {
    doneDays: inMonth.length,
    activeDays,
    currentStreak: currentStreak(allDays, now),
    bestStreak: bestStreak(allDays),
    totalDone: inMonth.reduce((a, [, ids]) => a + ids.size, 0),
  };
}

/** Bir günde yapılan ve yapılmayan rutinler (gün ayrıntısı için). */
export function dayDetail(
  day: string,
  routines: Routine[],
  logs: RoutineLog[]
): { done: Routine[]; notDone: Routine[] } {
  const ids = doneByDay(logs).get(day) ?? new Set<string>();
  return {
    done: routines.filter((r) => ids.has(r.id)),
    notDone: routines.filter((r) => !ids.has(r.id)),
  };
}
