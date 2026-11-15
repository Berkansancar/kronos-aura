/**
 * Hedef ilerlemesi ve zaman dengesi için veriyi veritabanından toplar. Mantık: services/goalsLogic.ts.
 * Ayarlar dışarıdan verilir; böylece bu dosya terminalde de test edilebilir.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getDailyStat,
  listDayBlocks,
  listRecentLogs,
  listSleepLogs,
  listVisibleTasks,
} from '../database/repository';
import { parseDayKey } from './activityLogic';
import {
  analyzeGoals,
  buildTimeBalance,
  DEFAULT_END_MINUTE,
  normalizeBedMinute,
  type GoalProgress,
  type GoalSettings,
  type TimeBalance,
} from './goalsLogic';
import { loadDayNutrition } from './nutrition';
import { nutritionDay, type DayNutrition } from './nutritionLogic';
import { dayBounds, planningDay } from './planner';

export interface GoalBundle {
  settings: GoalSettings;
  waterGoalMl: number;
  kcalTarget: number | null;
}

export interface GoalState {
  day: string;
  nutrition: DayNutrition;
  progress: GoalProgress;
  balance: TimeBalance;
}

const minuteOfLocalDay = (iso: string, dayStart: Date): number =>
  Math.round((new Date(iso).getTime() - dayStart.getTime()) / 60000);

export async function loadGoalState(db: SQLiteDatabase, now: Date, cfg: GoalBundle): Promise<GoalState> {
  const day = nutritionDay(now);
  const dayStart = parseDayKey(day);
  const windowEnd = new Date(dayStart.getTime() + 28 * 3600_000);

  const nutrition = await loadDayNutrition(db, now, { waterGoalMl: cfg.waterGoalMl, kcalTarget: cfg.kcalTarget }, day);
  const stat = await getDailyStat(db, day);

  // Uyku: bugün uyanılan geceden dünkü yatış ve bugünkü uyanış
  const sleep = (await listSleepLogs(db, 3)).find((s) => s.day === day) ?? null;
  let lastBed: number | null = null;
  let wake: number | null = null;
  if (sleep) {
    const bed = new Date(sleep.bedtime);
    lastBed = normalizeBedMinute(bed.getHours() * 60 + bed.getMinutes());
    wake = minuteOfLocalDay(sleep.wakeTime, dayStart);
    if (wake < 0 || wake > 14 * 60) wake = null;
  }

  // Biten işler ve akıp giden zaman
  const logs = (await listRecentLogs(db, 120)).filter(
    (l) => l.loggedAt >= dayStart.toISOString() && l.loggedAt < windowEnd.toISOString()
  );
  let done = 0;
  let drift = 0;
  for (const l of logs) {
    if (l.taskId) done += l.actualDuration;
    else drift += l.actualDuration;
  }

  // Plan: gün kapandıysa (22:00 sonrası) planlanan gün yarındır; bugünün penceresi hesaba katılmaz
  const planDay = planningDay(now);
  const planIsToday = planDay.getTime() === dayStart.getTime();
  const { start, end } = dayBounds(planDay);
  const rows = planIsToday ? await listDayBlocks(db, start, end) : [];
  const blocks = rows.map((r) => ({
    startMin: minuteOfLocalDay(r.startTime, dayStart),
    endMin: minuteOfLocalDay(r.endTime, dayStart),
  }));
  const planned = new Set(rows.map((r) => r.taskId));
  const open = planIsToday ? (await listVisibleTasks(db, start.toISOString())).filter((t) => t.status === 'PENDING' && !planned.has(t.id)) : [];

  const progress = analyzeGoals({
    now,
    settings: cfg.settings,
    waterGoalMl: cfg.waterGoalMl,
    kcalTarget: cfg.kcalTarget,
    nutrition,
    screenMinutes: stat?.screenMinutes ?? null,
    lastBedMinute: lastBed,
    doneMinutes: done,
  });
  const balance = buildTimeBalance({
    now,
    wakeMinute: wake,
    endMinute: cfg.settings.bedtime ?? DEFAULT_END_MINUTE,
    doneMinutes: done,
    driftMinutes: drift,
    blocks,
    unplanned: { count: open.length, minutes: open.reduce((a, t) => a + t.estimatedDuration, 0) },
    focusMin: cfg.settings.focusMin,
  });
  return { day, nutrition, progress, balance };
}
