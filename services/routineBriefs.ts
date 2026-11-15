/** Veritabanından rutinlerin bugünkü özetini (durum, istatistik, öneri) kurar. */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getTask, listRoutineLogsSince, listRoutines } from '../database/repository';
import type { RoutineBrief, TaskStatus } from '../database/types';
import { dayKey } from './activityLogic';
import { buildRoutineBrief } from './routineLogic';

const LOOKBACK_DAYS = 60;

export async function loadRoutineBriefs(db: SQLiteDatabase, now: Date): Promise<RoutineBrief[]> {
  const routines = await listRoutines(db, 'ACTIVE');
  if (routines.length === 0) return [];

  const since = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - LOOKBACK_DAYS));
  const logs = await listRoutineLogsSince(db, since);

  // "Yapacağım" ile eklenen görevlerin bugünkü durumu (tamamlandı mı, ertelendi mi, silindi mi)
  const today = dayKey(now);
  const status = new Map<string, TaskStatus>();
  const taskIds = new Set(logs.filter((l) => l.day === today && l.taskId).map((l) => l.taskId as string));
  for (const id of taskIds) {
    const t = await getTask(db, id);
    if (t) status.set(id, t.status);
  }

  return routines.map((r) => buildRoutineBrief(r, logs, (id) => status.get(id) ?? null, now));
}
