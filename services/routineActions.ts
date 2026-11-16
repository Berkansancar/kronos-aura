/** Bildirimden gelen rutin cevabını işler (mantık routineActionLogic'te). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getRoutine } from '../database/repository';
import { dayKey } from './activityLogic';
import { loadRoutineBriefs } from './routineBriefs';
import { acceptRoutine, markRoutineDone, markRoutineDoneOnDay, skipRoutineToday } from './routineFlow';
import { decideAction, type ParsedRoutineAction } from './routineActionLogic';

export interface RoutineActionResult {
  /** Veri değişti mi (hatırlatmaları ve ekranları tazelemek için) */
  changed: boolean;
  /** Kullanıcıya gösterilecek kısa onay */
  message: string;
}

export async function runRoutineAction(
  db: SQLiteDatabase,
  action: ParsedRoutineAction,
  now: Date
): Promise<RoutineActionResult> {
  const routine = await getRoutine(db, action.routineId);
  if (!routine || routine.status !== 'ACTIVE') {
    return { changed: false, message: 'Bu rutin artık aktif değil, bir şey değiştirmedim.' };
  }
  const brief = (await loadRoutineBriefs(db, now)).find((b) => b.routine.id === routine.id);
  const today = dayKey(now);
  const decision = decideAction(action.kind, brief?.state ?? 'DUE', action.day, today, routine.title);

  switch (decision.run) {
    case 'DONE_TODAY':
      await markRoutineDone(db, routine, now);
      return { changed: true, message: decision.message };
    case 'DONE_PAST': {
      const wrote = await markRoutineDoneOnDay(db, routine, decision.day, now);
      return wrote
        ? { changed: true, message: decision.message }
        : { changed: false, message: `✓ ${routine.title}: o gün zaten işaretliydi.` };
    }
    case 'ACCEPT':
      await acceptRoutine(db, routine, now);
      return { changed: true, message: decision.message };
    case 'SKIP':
      await skipRoutineToday(db, routine, now);
      return { changed: true, message: decision.message };
    default:
      return { changed: false, message: decision.message };
  }
}
