/**
 * Rutinlerin hangi günlerde yapılacağı (saf mantık). Gün numaraları JavaScript'in `getDay()` değeridir:
 * 0 = Pazar, 1 = Pazartesi … 6 = Cumartesi (iş saatleri ayarıyla aynı).
 *
 * Veritabanında "1,2,3,4,5" gibi virgüllü metin olarak durur; boş (null) her gün demektir.
 */
import type { Routine } from '../database/types';

/** Ekranda gösterim sırası: Pzt … Paz */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_SHORT: Record<number, string> = { 0: 'Paz', 1: 'Pzt', 2: 'Sal', 3: 'Çar', 4: 'Per', 5: 'Cum', 6: 'Cmt' };
export const DAY_LONG: Record<number, string> = {
  0: 'Pazar',
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
};

export interface DaysPreset {
  id: string;
  label: string;
  /** null = her gün */
  days: number[] | null;
}

export const DAYS_PRESETS: DaysPreset[] = [
  { id: 'every', label: 'Her gün', days: null },
  { id: 'work', label: 'İş günleri (Pzt–Cmt)', days: [1, 2, 3, 4, 5, 6] },
  { id: 'weekdays', label: 'Hafta içi', days: [1, 2, 3, 4, 5] },
  { id: 'weekend', label: 'Hafta sonu', days: [6, 0] },
  { id: 'sunday', label: 'Yalnız Pazar', days: [0] },
];

/** "1,2,5" -> [1,2,5]. Boş, bozuk ya da yedi günün hepsi: null (her gün). */
export function parseDays(text: string | null | undefined): number[] | null {
  if (!text) return null;
  const list = [
    ...new Set(
      text
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    ),
  ].sort((a, b) => a - b);
  if (list.length === 0 || list.length === 7) return null;
  return list;
}

/** [5,1] -> "1,5". Boş ya da yedi günün hepsi: null. */
export function serializeDays(days: number[] | null | undefined): string | null {
  if (!days) return null;
  const clean = parseDays(days.join(','));
  return clean ? clean.join(',') : null;
}

/** Bu rutin verilen gün yapılır mı? */
export function isRoutineDay(r: Pick<Routine, 'days'>, date: Date): boolean {
  const days = parseDays(r.days);
  return days === null || days.includes(date.getDay());
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Kısa, okunur etiket: "Her gün", "Hafta içi", "Pazar", "Pzt, Çar, Cum" … */
export function daysLabel(days: number[] | null): string {
  if (days === null) return 'Her gün';
  const sorted = [...days].sort((a, b) => a - b);
  for (const p of DAYS_PRESETS) {
    if (p.days && same([...p.days].sort((a, b) => a - b), sorted)) {
      return p.id === 'sunday' ? 'Pazar' : p.label;
    }
  }
  return WEEK_ORDER.filter((d) => sorted.includes(d))
    .map((d) => DAY_SHORT[d])
    .join(', ');
}

export const routineDaysLabel = (r: Pick<Routine, 'days'>): string => daysLabel(parseDays(r.days));

/** Bir sonraki planlı gün (bugün dahil değil); her gün ise yarın. Hiç planlı gün yoksa null. */
export function nextRoutineDay(r: Pick<Routine, 'days'>, from: Date): Date | null {
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (isRoutineDay(r, d)) return d;
  }
  return null;
}
