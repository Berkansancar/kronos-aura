/**
 * İş saatleri (saf mantık, test edilebilir).
 *
 * Kullanıcı gündüz çalışıyorsa o saatlerde yalnızca "iş vaktinde yapılabilir" işaretli işler plana girer;
 * diğer işler iş saatinin dışına (akşama) yerleştirilir. Ayar veritabanında durur (planlayıcı okuyabilsin diye).
 */
import { formatDuration } from './format';
import { hhmm } from './goalsLogic';

export interface DayWindow {
  startMin: number;
  endMin: number;
}

export interface WorkSchedule {
  enabled: boolean;
  /** Ortak iş saati: özel saati olmayan tüm iş günleri için (gün başından dakika, ör. 09:00 = 540) */
  startMin: number;
  endMin: number;
  /** Çalışılan günler: 0 = Pazar ... 6 = Cumartesi (JS getDay). Listede olmayan gün tamamen boştur. */
  days: number[];
  /** Günlere özel saatler (ör. Cumartesi yarım gün); yoksa ortak saat geçerlidir. Anahtar: 0..6 */
  special?: Record<number, DayWindow>;
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
/** Özel (kısa) günlerin en kısa süresi */
export const MIN_SPECIAL_MINUTES = 120;

/**
 * Bu uygulamanın sahibinin haftası: Pzt–Cum 07:40–18:00, Cumartesi 08:30–13:30, Pazar tamamen boş.
 * Uygulama ilk açıldığında bir kez uygulanır (workSettings.ensureWorkSeed); sonra Hedefler'den değiştirilebilir.
 */
export const PERSONAL_WORK: WorkSchedule = {
  enabled: true,
  startMin: 7 * 60 + 40,
  endMin: 18 * 60,
  days: [1, 2, 3, 4, 5, 6],
  special: { 6: { startMin: 8 * 60 + 30, endMin: 13 * 60 + 30 } },
};

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
    const special: Record<number, DayWindow> = {};
    if (o.special && typeof o.special === 'object' && !Array.isArray(o.special)) {
      for (const [k, v] of Object.entries(o.special as Record<string, unknown>)) {
        const d = Number(k);
        if (!Number.isInteger(d) || d < 0 || d > 6 || !v || typeof v !== 'object') continue;
        const win = v as Record<string, unknown>;
        const s0 = inRange(win.startMin, 5 * 60, 14 * 60);
        const e0 = inRange(win.endMin, 8 * 60, 23 * 60);
        if (s0 !== null && e0 !== null && e0 - s0 >= MIN_SPECIAL_MINUTES) special[d] = { startMin: s0, endMin: e0 };
      }
    }
    return {
      enabled: o.enabled === true,
      startMin: start,
      endMin: end,
      days: days.length > 0 ? days : [...DEFAULT_WORK.days],
      ...(Object.keys(special).length > 0 ? { special } : {}),
    };
  } catch {
    return { ...DEFAULT_WORK, days: [...DEFAULT_WORK.days] };
  }
}

export const serializeWork = (w: WorkSchedule): string => JSON.stringify(w);

/** Haftanın bir günü (0 = Pazar) için iş penceresi; o gün çalışılmıyorsa null. `enabled`e bakmaz. */
export function windowForDow(w: WorkSchedule, dow: number): DayWindow | null {
  if (!w.days.includes(dow)) return null;
  return w.special?.[dow] ?? { startMin: w.startMin, endMin: w.endMin };
}

/** `day` bir iş günüyse o günün iş penceresi (gün başından dakika), değilse ya da kapalıysa null. */
export function workWindowFor(day: Date, w: WorkSchedule): DayWindow | null {
  if (!w.enabled) return null;
  return windowForDow(w, day.getDay());
}

/** İş saatleri açık ve `day` iş günü değil mi? (ör. Pazar) */
export function isFreeDay(day: Date, w: WorkSchedule): boolean {
  return w.enabled && !w.days.includes(day.getDay());
}

/** Şu an iş saati mi? */
export function isWorkTime(at: Date, w: WorkSchedule): boolean {
  const win = workWindowFor(at, w);
  if (!win) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return m >= win.startMin && m < win.endMin;
}

export const workMinutes = (w: WorkSchedule): number => Math.max(0, w.endMin - w.startMin);

/** Her iş gününün bitiş dakikası (hatırlatmalar için); çalışılmayan günler yoktur. */
export function workEndsByDay(w: WorkSchedule): Record<number, number> {
  const out: Record<number, number> = {};
  for (const d of w.days) {
    const win = windowForDow(w, d);
    if (win) out[d] = win.endMin;
  }
  return out;
}

/** Haftalık toplam iş dakikası */
export function weeklyWorkMinutes(w: WorkSchedule): number {
  return w.days.reduce((a, d) => {
    const win = windowForDow(w, d);
    return a + (win ? (win.endMin - win.startMin) : 0);
  }, 0);
}

/** Pazartesiden Pazar'a gün gün özet: "07:40–18:00 · 10 sa 20 dk" ya da "Boş gün". */
export function workWeekLines(w: WorkSchedule): { day: number; label: string; text: string; free: boolean }[] {
  return WORK_DAYS.map((d) => {
    const win = windowForDow(w, d.day);
    return win
      ? { day: d.day, label: d.label, text: `${hhmm(win.startMin)}–${hhmm(win.endMin)} · ${formatDuration(win.endMin - win.startMin)}`, free: false }
      : { day: d.day, label: d.label, text: 'Boş gün', free: true };
  });
}

const daysLabel = (days: number[]): string =>
  days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
    ? 'Pzt–Cum'
    : WORK_DAYS.filter((d) => days.includes(d.day)).map((d) => d.label).join(' ');

/** "07:40–18:00 · Pzt–Cum · Cmt 08:30–13:30 · Boş: Paz" gibi kısa özet. */
export function workSummary(w: WorkSchedule): string {
  const specialDays = WORK_DAYS.filter((d) => w.days.includes(d.day) && w.special?.[d.day]);
  const common = w.days.filter((d) => !w.special?.[d]);
  const parts: string[] = [];
  if (common.length > 0) parts.push(`${hhmm(w.startMin)}–${hhmm(w.endMin)} · ${daysLabel(common)}`);
  for (const d of specialDays) {
    const win = w.special![d.day];
    parts.push(`${d.label} ${hhmm(win.startMin)}–${hhmm(win.endMin)}`);
  }
  if (specialDays.length > 0) {
    const off = WORK_DAYS.filter((d) => !w.days.includes(d.day)).map((d) => d.label);
    if (off.length > 0) parts.push(`Boş: ${off.join(' ')}`);
  }
  return parts.join(' · ');
}

export type WindowTarget = number | 'COMMON';
export type WindowEdge = 'start' | 'end';

/** Ortak saatin ya da bir günün özel saatinin başlangıcını/bitişini `delta` dakika kaydırır (sınırlar içinde). */
export function adjustWork(w: WorkSchedule, target: WindowTarget, edge: WindowEdge, delta: number): WorkSchedule {
  const common = target === 'COMMON' || !w.special?.[target];
  const cur: DayWindow = target === 'COMMON' ? { startMin: w.startMin, endMin: w.endMin } : (w.special?.[target] ?? { startMin: w.startMin, endMin: w.endMin });
  if (common && target !== 'COMMON') return w; // özel saati olmayan güne dokunulmaz; önce özel saat verilmeli
  const minLen = target === 'COMMON' ? MIN_WORK_MINUTES : MIN_SPECIAL_MINUTES;
  const startLo = 5 * 60;
  const startHi = target === 'COMMON' ? 12 * 60 : 14 * 60;
  const endLo = target === 'COMMON' ? 13 * 60 : 8 * 60;
  const endHi = 23 * 60;
  let { startMin, endMin } = cur;
  if (edge === 'start') startMin = Math.min(Math.max(startMin + delta, startLo), Math.min(startHi, endMin - minLen));
  else endMin = Math.max(Math.min(endMin + delta, endHi), Math.max(endLo, startMin + minLen));
  if (target === 'COMMON') return parseWork(serializeWork({ ...w, startMin, endMin }));
  return parseWork(serializeWork({ ...w, special: { ...w.special, [target]: { startMin, endMin } } }));
}

/** Bir güne özel saat verir (ortak saatin kopyası) ya da özel saati kaldırıp ortak saate döndürür. */
export function setSpecial(w: WorkSchedule, dow: number, on: boolean): WorkSchedule {
  const special = { ...(w.special ?? {}) };
  if (on) special[dow] = { startMin: w.startMin, endMin: w.endMin };
  else delete special[dow];
  return parseWork(serializeWork({ ...w, special }));
}
