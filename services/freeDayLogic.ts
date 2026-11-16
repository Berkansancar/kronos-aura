/**
 * Boş gün planı (saf mantık, test edilebilir).
 *
 * İş saatleri açıkken "Pazar" gibi hiç çalışılmayan bir günde, uzun ve odak isteyen işler ile ertelenmiş işler
 * için güne yayılmış rahat bir liste önerir. Günü baştan sona doldurmaz (bir bölümü dinlenmeye kalır); yargı içermez.
 */
import type { CognitiveWeight, TaskStatus } from '../database/types';
import { formatDuration } from './format';

export interface FreeDayTask {
  id: string;
  title: string;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  status: TaskStatus;
}

export interface FreeDayItem {
  id: string;
  title: string;
  minutes: number;
  why: string;
}

export interface FreeDayPlan {
  items: FreeDayItem[];
  totalMinutes: number;
  openCount: number;
  headline: string;
}

/** Bir boş günde önerilen toplam süre (dinlenmeye yer kalsın diye günün tamamı değil) */
export const FREE_DAY_BUDGET_MINUTES = 300;
export const FREE_DAY_MAX_ITEMS = 5;
const LONG_TASK_MINUTES = 45;

function scoreOf(t: FreeDayTask): number {
  return (t.status === 'POSTPONED' ? 3 : 0) + (t.cognitiveWeight === 'HIGH' ? 3 : t.cognitiveWeight === 'MEDIUM' ? 1 : 0) + (t.estimatedDuration >= LONG_TASK_MINUTES ? 2 : 0);
}

function whyOf(t: FreeDayTask): string {
  if (t.status === 'POSTPONED') return 'Ertelenmişti';
  if (t.cognitiveWeight === 'HIGH') return 'Odak isteyen iş';
  if (t.estimatedDuration >= LONG_TASK_MINUTES) return 'Uzun iş';
  return 'Kısa iş';
}

export function freeDayPlan(
  tasks: FreeDayTask[],
  opts: { budgetMin?: number; max?: number } = {}
): FreeDayPlan {
  const budget = opts.budgetMin ?? FREE_DAY_BUDGET_MINUTES;
  const max = opts.max ?? FREE_DAY_MAX_ITEMS;
  const open = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS' || t.status === 'POSTPONED');
  const ranked = [...open].sort((a, b) => scoreOf(b) - scoreOf(a) || b.estimatedDuration - a.estimatedDuration || a.title.localeCompare(b.title, 'tr'));
  const items: FreeDayItem[] = [];
  let total = 0;
  for (const t of ranked) {
    if (items.length >= max) break;
    // İlk iş bütçeyi aşsa da alınır; sonrakiler bütçeye sığıyorsa eklenir
    if (items.length > 0 && total + t.estimatedDuration > budget) continue;
    items.push({ id: t.id, title: t.title, minutes: t.estimatedDuration, why: whyOf(t) });
    total += t.estimatedDuration;
  }
  const headline =
    items.length === 0
      ? 'Bugün iş yok, günün tamamı senin. Dinlenebilir ya da dil çalışmasına zaman ayırabilirsin.'
      : `Bugün iş yok. ${items.length} iş için rahat bir gün (yaklaşık ${formatDuration(total)}); gerisi dinlenmeye kalır.`;
  return { items, totalMinutes: total, openCount: open.length, headline };
}
