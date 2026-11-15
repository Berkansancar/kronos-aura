import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getOrCreateUser,
  isHardDay,
  listDayBlocks,
  listRecentLogs,
  listVisibleTasks,
} from '../database/repository';
import { dayKey } from './activityLogic';
import { isSharingWithAi, loadActivitySummary, loadSleepSummary } from './activity';
import type { CoachContext } from './coachEngine';
import { DAY_END_HOUR, dayBounds, planningDay } from './planner';
import { loadRoutineBriefs } from './routineBriefs';

/** Sohbet ekranı gibi, ana ekran dışındaki yerlerde koçlara güncel durumu vermek için. */
export async function loadCoachContext(db: SQLiteDatabase, now: Date): Promise<CoachContext> {
  const { start, end } = dayBounds(planningDay(now));
  const user = await getOrCreateUser(db);
  const tasks = await listVisibleTasks(db, start.toISOString());
  const rows = await listDayBlocks(db, start, end);
  const recentLogs = await listRecentLogs(db, 10);
  const activity = await loadActivitySummary(db, now);
  const shareActivityWithAi = activity ? await isSharingWithAi() : false;
  const routines = await loadRoutineBriefs(db, now);
  const sleep = await loadSleepSummary(db, now);
  return {
    now,
    user,
    tasks,
    blocks: rows.map((b) => ({
      taskId: b.taskId,
      startTime: new Date(b.startTime),
      endTime: new Date(b.endTime),
    })),
    recentLogs,
    dayEndHour: DAY_END_HOUR,
    activity,
    shareActivityWithAi,
    routines,
    sleep,
    hardDay: await isHardDay(db, dayKey(planningDay(now))),
  };
}
