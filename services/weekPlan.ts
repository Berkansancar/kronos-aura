/** Hafta planı: veriyi okur, işleri günlere ayırır. Mantık: services/weekPlanLogic.ts */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listParkedTasks, listVisibleTasks, setTaskPlannedDay } from '../database/repository';
import type { Task } from '../database/types';
import { dayKey } from './activityLogic';
import { dayBounds, planningDay, replanDay } from './planner';
import { autoDistribute, buildWeekPlan, type Assignment, type WeekDayPlan } from './weekPlanLogic';
import { getWork } from './workSettings';

export interface WeekData {
  plan: WeekDayPlan[];
  tasks: Task[];
  todayKey: string;
}

export async function loadWeek(db: SQLiteDatabase, now: Date): Promise<WeekData> {
  const today = planningDay(now);
  const todayKey = dayKey(today);
  const visible = (await listVisibleTasks(db, dayBounds(today).start.toISOString())).filter((t) => t.status !== 'COMPLETED');
  const parked = await listParkedTasks(db, todayKey);
  const tasks = [...visible, ...parked];
  const plan = buildWeekPlan({ now, today, work: await getWork(db), tasks });
  return { plan, tasks, todayKey };
}

/** Görevi bir güne ayırır (bugünün ya da geçmiş bir günün anahtarı ya da null: bugüne al). */
export async function moveTaskToDay(db: SQLiteDatabase, taskId: string, day: string | null, now: Date = new Date()): Promise<void> {
  const todayKey = dayKey(planningDay(now));
  await setTaskPlannedDay(db, taskId, day !== null && day <= todayKey ? null : day);
  await replanDay(db, now, 'MANUAL');
}

/** Otomatik dağıtım önerisi (kaydetmez). */
export async function suggestWeek(db: SQLiteDatabase, now: Date): Promise<{ data: WeekData; assignments: Assignment[] }> {
  const data = await loadWeek(db, now);
  return { data, assignments: autoDistribute(data.plan, data.tasks) };
}

/** Öneriyi uygular: bugünden sonraki günlere ayrılanlar kaydedilir; bugünde kalanlara dokunulmaz. */
export async function applyAssignments(db: SQLiteDatabase, assignments: Assignment[], now: Date = new Date()): Promise<number> {
  const todayKey = dayKey(planningDay(now));
  let moved = 0;
  for (const a of assignments) {
    if (a.day <= todayKey) continue;
    await setTaskPlannedDay(db, a.taskId, a.day);
    moved += 1;
  }
  if (moved > 0) await replanDay(db, now, 'MANUAL');
  return moved;
}

/** Başka güne ayrılan bütün işleri bugüne alır. */
export async function pullAllToToday(db: SQLiteDatabase, now: Date = new Date()): Promise<number> {
  const parked = await listParkedTasks(db, dayKey(planningDay(now)));
  for (const t of parked) await setTaskPlannedDay(db, t.id, null);
  if (parked.length > 0) await replanDay(db, now, 'MANUAL');
  return parked.length;
}

/** Ana ekrandaki ipucu için: başka güne ayrılmış iş sayısı */
export async function countParked(db: SQLiteDatabase, now: Date): Promise<number> {
  return (await listParkedTasks(db, dayKey(planningDay(now)))).length;
}
