/** Sabah brifingi için veriyi veritabanından toplar. Mantık services/morningLogic.ts içindedir. */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getDayReview,
  getOrCreateUser,
  isHardDay,
  listDayBlocks,
  listSleepLogs,
  listVisibleTasks,
} from '../database/repository';
import { dayKey } from './activityLogic';
import { buildMorningBrief, type MorningBrief, type MorningFacts } from './morningLogic';
import { dayBounds, planningDay } from './planner';
import { formatClock } from './format';
import { loadRoutineBriefs } from './routineBriefs';
import { formatAskTime } from './routineLogic';
import { summarizeSleep } from './sleepLogic';

export async function gatherMorningFacts(db: SQLiteDatabase, now: Date): Promise<MorningFacts> {
  const day = planningDay(now);
  const { start, end } = dayBounds(day);
  const key = dayKey(day);

  const user = await getOrCreateUser(db);
  const tasks = await listVisibleTasks(db, start.toISOString());
  const blocks = await listDayBlocks(db, start, end);

  const firstStart = new Map<string, Date>();
  for (const b of blocks) {
    const s = new Date(b.startTime);
    const prev = firstStart.get(b.taskId);
    if (!prev || s.getTime() < prev.getTime()) firstStart.set(b.taskId, s);
  }

  const open = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const doneTaskCount = tasks.filter((t) => t.status === 'COMPLETED').length;

  const briefs = await loadRoutineBriefs(db, now);

  // Dünün gün sonu değerlendirmesindeki Kronos notu
  const prevDay = dayKey(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1));
  const review = await getDayReview(db, prevDay);

  const sleep = summarizeSleep(await listSleepLogs(db, 14), now);

  return {
    day: key,
    hour: now.getHours(),
    tasks: open.map((t) => {
      const s = firstStart.get(t.id);
      return {
        id: t.id,
        title: t.title,
        minutes: t.estimatedDuration,
        weight: t.cognitiveWeight,
        status: t.status,
        start: s ? formatClock(s) : null,
      };
    }),
    doneTaskCount,
    peakStartHour: user.peakStartHour,
    peakEndHour: user.peakEndHour,
    routines: briefs.map((b) => ({
      title: b.routine.title,
      time: formatAskTime(b.routine),
      state: b.state,
    })),
    note: review?.payload.tomorrow ?? null,
    sleepMinutes: sleep.lastMinutes,
    hardDay: await isHardDay(db, key),
  };
}

export async function loadMorningBrief(
  db: SQLiteDatabase,
  now: Date
): Promise<{ facts: MorningFacts; brief: MorningBrief }> {
  const facts = await gatherMorningFacts(db, now);
  return { facts, brief: buildMorningBrief(facts) };
}
