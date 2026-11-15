/** Bildirim planını güncel veriyle eşitler (ana ekran, rutinler ve gün sonu ekranı kullanır). */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { RoutineBrief } from '../database/types';
import { reminderExtras } from './dayReview';
import { loadRoutineBriefs } from './routineBriefs';
import { syncRoutineReminders, type ReminderStatus } from './routineReminders';

export async function refreshReminders(
  db: SQLiteDatabase,
  now: Date = new Date(),
  briefs?: RoutineBrief[]
): Promise<ReminderStatus> {
  const b = briefs ?? (await loadRoutineBriefs(db, now));
  return syncRoutineReminders(b, now, await reminderExtras(db, now));
}
