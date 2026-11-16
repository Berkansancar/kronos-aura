/** Rutin modu için veritabanı bağlantısı (mantık routineModeLogic'te). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getRoutine } from '../database/repository';
import type { RoutineBrief } from '../database/types';
import { loadRoutineBriefs } from './routineBriefs';
import { markRoutineDone, skipRoutineToday } from './routineFlow';
import { todayProgress } from './routineLogic';
import { type RunAnswer } from './routineModeLogic';

export const loadRunBriefs = (db: SQLiteDatabase, now: Date): Promise<RoutineBrief[]> => loadRoutineBriefs(db, now);

/** Bir adımın cevabını kaydeder. "Sonra" hiçbir şey yazmaz (rutin açık kalır). Rutin bulunamazsa false. */
export async function applyRunAnswer(
  db: SQLiteDatabase,
  routineId: string,
  answer: RunAnswer,
  now: Date
): Promise<boolean> {
  if (answer === 'LATER') return true;
  const routine = await getRoutine(db, routineId);
  if (!routine || routine.status !== 'ACTIVE') return false;
  if (answer === 'DONE') await markRoutineDone(db, routine, now);
  else await skipRoutineToday(db, routine, now);
  return true;
}

export interface RunOutcome {
  /** Bugün biten / toplam planlı rutin */
  done: number;
  planned: number;
  /** Bu turda tamamlananlar arasında en uzun güncel seri (gün) */
  bestStreak: number;
}

/** Tur bitince bugünün özetini döndürür (hatırlatıcıları tazelemek ekranın işi: bildirim modülü Node'da yok). */
export async function finishRun(db: SQLiteDatabase, doneIds: string[], now: Date): Promise<RunOutcome> {
  const briefs = await loadRoutineBriefs(db, now);
  const p = todayProgress(briefs);
  const streaks = briefs.filter((b) => doneIds.includes(b.routine.id)).map((b) => b.stats.streak);
  return { done: p.done, planned: p.done + p.open + p.skipped, bestStreak: streaks.length ? Math.max(...streaks) : 0 };
}
