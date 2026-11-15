/**
 * Zor gün modu (saf mantık). Aura günü hafifletir: planda en fazla iki hafif iş kalır, diğerleri bugünlük
 * ertelenir (geri alınabilir), uzun rutinler sorulmaz. Hiçbir şey "kaçırılmış" ya da "başarısız" sayılmaz.
 */
import type { CognitiveWeight, Task } from '../database/types';
import { SHORT_SLEEP_MINUTES } from './morningLogic';

export const HARD_DAY_MAX_TASKS = 2;
export const HARD_DAY_MAX_MINUTES = 90;
/** Bugün bu kadar "tükendim" kaydı olunca zor gün modu önerilir. */
export const EXHAUSTED_SUGGEST_COUNT = 2;

const WEIGHT_RANK: Record<CognitiveWeight, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export interface HardDayChoice {
  keep: Task[];
  defer: Task[];
}

/**
 * Planda kalacak görevler: başlamış olan her zaman kalır; sonra en hafif ve en kısa olanlar, en fazla
 * HARD_DAY_MAX_TASKS görev ve toplam HARD_DAY_MAX_MINUTES dakika. Hepsi uzunsa en kısa tek görev kalır.
 * Bir rutinin "yapacağım" cevabıyla gelen görevlere dokunulmaz (söz verilmiş ve kısa olanlardır).
 */
export function chooseHardDayKeep(tasks: Task[]): HardDayChoice {
  const open = tasks.filter((t) => (t.status === 'PENDING' || t.status === 'IN_PROGRESS') && !t.routineId);
  const keep = open.filter((t) => t.status === 'IN_PROGRESS');
  let minutes = keep.reduce((a, t) => a + t.estimatedDuration, 0);

  const rest = open
    .filter((t) => t.status !== 'IN_PROGRESS')
    .sort(
      (a, b) =>
        WEIGHT_RANK[b.cognitiveWeight] - WEIGHT_RANK[a.cognitiveWeight] ||
        a.estimatedDuration - b.estimatedDuration ||
        a.createdAt.localeCompare(b.createdAt)
    );
  for (const t of rest) {
    if (keep.length >= HARD_DAY_MAX_TASKS) break;
    if (keep.length === 0 || minutes + t.estimatedDuration <= HARD_DAY_MAX_MINUTES) {
      keep.push(t);
      minutes += t.estimatedDuration;
    }
  }
  return { keep, defer: open.filter((t) => !keep.includes(t)) };
}

export function shouldSuggestHardDay(p: {
  hardDay: boolean;
  sleepMinutes: number | null;
  exhaustedToday: number;
}): boolean {
  if (p.hardDay) return false;
  if (p.sleepMinutes !== null && p.sleepMinutes < SHORT_SLEEP_MINUTES) return true;
  return p.exhaustedToday >= EXHAUSTED_SUGGEST_COUNT;
}

/** Bugün "tükendim" diyerek biten iş sayısı. `logs` her sırada olabilir. */
export function countExhaustedSince(
  logs: Array<{ energyStateAtCompletion: string; loggedAt: string }>,
  since: Date
): number {
  return logs.filter(
    (l) => l.energyStateAtCompletion === 'EXHAUSTED' && new Date(l.loggedAt).getTime() >= since.getTime()
  ).length;
}
