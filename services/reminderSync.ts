/** Bildirim planını güncel veriyle eşitler (ana ekran, rutinler, hedefler ve su kaydı kullanır). */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { RoutineBrief } from '../database/types';
import { dayKey } from './activityLogic';
import { listDayEventsSince } from '../database/repository';
import { typicalWakeMinute } from './dayFlowLogic';
import { reminderExtras } from './dayReview';
import { getWork } from './workSettings';
import { getGoals } from './goalsSettings';
import { loadDayNutrition } from './nutrition';
import { nutritionDay } from './nutritionLogic';
import { getNutritionOptions } from './nutritionSettings';
import { loadRoutineBriefs } from './routineBriefs';
import { syncRoutineReminders, type ReminderStatus } from './routineReminders';
import type { GoalReminders } from './routineRemindersLogic';

/** Hedef hatırlatmaları kapalıysa null; açıksa bugünün su durumu ve yatış saati. */
async function goalReminders(db: SQLiteDatabase, now: Date): Promise<GoalReminders | null> {
  try {
    const goals = await getGoals();
    if (!goals.reminders) return null;
    let waterGoalReached = false;
    const today = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    // Gece 04:00'ten önce su kayıtları dünün sayılır; bugünün hedefi henüz başlamamıştır
    if (nutritionDay(now) === today) {
      const n = await loadDayNutrition(db, now, await getNutritionOptions());
      waterGoalReached = n.waterMl >= n.waterGoalMl;
    }
    // Tipik uyanış (son 7 günün "Uyandım" damgaları) ve iş saatleri: sabah su ve iş sonrası işaretleme hatırlatması
    const since = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
    const wakes = (await listDayEventsSince(db, since)).filter((e) => e.kind === 'WAKE').map((e) => new Date(e.at));
    const w = await getWork(db);
    return {
      waterGoalReached,
      bedtime: goals.bedtime,
      wakeMinute: typicalWakeMinute(wakes),
      work: w.enabled ? { endMin: w.endMin, days: w.days } : null,
    };
  } catch {
    return null;
  }
}

export async function refreshReminders(
  db: SQLiteDatabase,
  now: Date = new Date(),
  briefs?: RoutineBrief[]
): Promise<ReminderStatus> {
  const b = briefs ?? (await loadRoutineBriefs(db, now));
  const extras = await reminderExtras(db, now);
  return syncRoutineReminders(b, now, { ...extras, goals: await goalReminders(db, now) });
}
