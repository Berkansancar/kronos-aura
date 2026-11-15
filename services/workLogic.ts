/**
 * İş saatleri (saf mantık, test edilebilir).
 *
 * Kullanıcı gündüz çalışıyorsa o saatlerde yalnızca "iş vaktinde yapılabilir" işaretli işler plana girer;
 * diğer işler iş saatinin dışına (akşama) yerleştirilir. Ayar veritabanında durur (planlayıcı okuyabilsin diye).
 */
import { hhmm } from './goalsLogic';

export interface WorkSchedule {
  enabled: boolean;
  /** Gün başından dakika (ör. 09:00 = 540) */
  startMin: number;
  endMin: number;
  /** Çalışılan günler: 0 = Pazar ... 6 = Cumartesi (JS getDay) */
  days: number[];
}

export const WORK_SETTING_KEY = 'work_v1';

export const DEFAULT_WORK: WorkSchedule = { enabled: false, startMin: 9 * 60, endMin: 18 * 60, days: [1, 2, 3, 4, 5] };

export const WORK_START_CHOICES = [7 * 60, 8 * 60, 9 * 60, 10 * 60];
export const WORK_END_CHOICES = [16 * 60, 17 * 60, 18 * 60, 19 * 60, 20 * 60];
/** Görünüm sırası: Pazartesi'den Pazar'a */
export const WORK_DAYS: { day: number; label: string }[] = [
  { day: 1, label: 'Pzt' },
  { day: 2, label: 'Sal' },
  { day: 3, label: 'Çar' },
  { day: 4, label: 'Per' },
  { day: 5, label: 'Cum' },
  { day: 6, label: 'Cmt' },
  { day: 0, label: 'Paz' },
];

export const MIN_WORK_MINUTES = 240;

const inRange = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;

export function parseWork(raw: string | null): WorkSchedule {
  if (!raw) return { ...DEFAULT_WORK, days: [...DEFAULT_WORK.days] };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const start = inRange(o.startMin, 5 * 60, 12 * 60) ?? DEFAULT_WORK.startMin;
    let end = inRange(o.endMin, 13 * 60, 23 * 60) ?? DEFAULT_WORK.endMin;
    if (end - start < MIN_WORK_MINUTES) end = Math.min(23 * 60, start + MIN_WORK_MINUTES);
    const days = Array.isArray(o.days)
      ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    return { enabled: o.enabled === true, startMin: start, endMin: end, days: days.length > 0 ? days : [...DEFAULT_WORK.days] };
  } catch {
    return { ...DEFAULT_WORK, days: [...DEFAULT_WORK.days] };
  }
}

export const serializeWork = (w: WorkSchedule): string => JSON.stringify(w);

/** `day` bir iş günüyse o günün iş penceresi (gün başından dakika), değilse ya da kapalıysa null. */
export function workWindowFor(day: Date, w: WorkSchedule): { startMin: number; endMin: number } | null {
  if (!w.enabled || !w.days.includes(day.getDay())) return null;
  return { startMin: w.startMin, endMin: w.endMin };
}

/** Şu an iş saati mi? */
export function isWorkTime(at: Date, w: WorkSchedule): boolean {
  const win = workWindowFor(at, w);
  if (!win) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return m >= win.startMin && m < win.endMin;
}

export const workMinutes = (w: WorkSchedule): number => Math.max(0, w.endMin - w.startMin);

/** "09:00–18:00 · Pzt–Cum" gibi kısa özet. */
export function workSummary(w: WorkSchedule): string {
  const names = WORK_DAYS.filter((d) => w.days.includes(d.day)).map((d) => d.label);
  const weekdays = [1, 2, 3, 4, 5].every((d) => w.days.includes(d)) && w.days.length === 5;
  const daysText = weekdays ? 'Pzt–Cum' : names.join(' ');
  return `${hhmm(w.startMin)}–${hhmm(w.endMin)} · ${daysText}`;
}
