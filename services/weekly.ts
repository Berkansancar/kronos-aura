/** Haftalık özet için veriyi veritabanından toplar. Mantık: services/weeklyLogic.ts */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getOrCreateUser,
  listDailyStats,
  listHardDaysSince,
  listRoutineLogsSince,
  listRoutines,
  listSleepLogs,
  listTimeLogsSince,
} from '../database/repository';
import type { EnergyState } from '../database/types';
import { dayKey } from './activityLogic';
import {
  buildWeekSummary,
  weekEndDate,
  windowKeys,
  type WeekDay,
  type WeekFacts,
  type WeekSummary,
} from './weeklyLogic';

export async function gatherWeekFacts(db: SQLiteDatabase, now: Date): Promise<WeekFacts> {
  const end = weekEndDate(now);
  const endDay = dayKey(end);
  const keys = windowKeys(endDay, 14);
  const startKey = keys[0];
  const startDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 13);

  const user = await getOrCreateUser(db);
  const logs = await listTimeLogsSince(db, startDate.toISOString());
  const routineLogs = await listRoutineLogsSince(db, startKey);
  const routines = await listRoutines(db, 'ACTIVE');
  const stats = await listDailyStats(db, 20);
  const sleeps = await listSleepLogs(db, 20);
  const hardDays = new Set(await listHardDaysSince(db, startKey));

  const doneByDay = new Map<string, number>();
  // Bir rutin aynı gün birden çok kez "yapıldı" yazabilir; gün başına bir kez sayılır.
  const doneSets = new Map<string, Set<string>>();
  for (const l of routineLogs) {
    if (l.outcome !== 'DONE') continue;
    const set = doneSets.get(l.routineId) ?? new Set<string>();
    set.add(l.day);
    doneSets.set(l.routineId, set);
  }
  for (const set of doneSets.values()) {
    for (const d of set) doneByDay.set(d, (doneByDay.get(d) ?? 0) + 1);
  }

  const statByDay = new Map(stats.map((s) => [s.day, s]));
  const sleepByDay = new Map(sleeps.map((s) => [s.day, s.durationMinutes]));

  const dayInfo = new Map<string, { tasks: number; minutes: number }>();
  const energy: Record<EnergyState, number> = { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 };
  let driftMinutes = 0;
  const thisWeek = new Set(keys.slice(7));
  for (const l of logs) {
    const k = dayKey(new Date(l.loggedAt));
    if (l.taskId === null) {
      if (thisWeek.has(k)) driftMinutes += l.actualDuration;
      continue;
    }
    // Rutinden gelen görevler "rutin" olarak sayılır, ikinci kez görev diye sayılmaz.
    if (l.routineId) continue;
    const cur = dayInfo.get(k) ?? { tasks: 0, minutes: 0 };
    cur.tasks += 1;
    cur.minutes += l.actualDuration;
    dayInfo.set(k, cur);
    if (thisWeek.has(k) && l.energyStateAtCompletion in energy) energy[l.energyStateAtCompletion] += 1;
  }

  const toDay = (k: string): WeekDay => {
    const st = statByDay.get(k);
    const info = dayInfo.get(k);
    return {
      day: k,
      tasksDone: info?.tasks ?? 0,
      taskMinutes: info?.minutes ?? 0,
      routinesDone: doneByDay.get(k) ?? 0,
      steps: st && st.steps > 0 ? st.steps : null,
      screenMinutes: st?.screenMinutes ?? null,
      sleepMinutes: sleepByDay.get(k) ?? null,
      hardDay: hardDays.has(k),
    };
  };

  return {
    endDay,
    days: keys.slice(7).map(toDay),
    prevDays: keys.slice(0, 7).map(toDay),
    routines: routines.map((r) => ({
      title: r.title,
      createdDay: dayKey(new Date(r.createdAt)),
      doneDays: [...(doneSets.get(r.id) ?? [])],
    })),
    energy,
    driftMinutes,
    peakStartHour: user.peakStartHour,
    peakEndHour: user.peakEndHour,
    countEndDay: now.getHours() >= 20 || now.getHours() < 4,
  };
}

export async function loadWeekSummary(
  db: SQLiteDatabase,
  now: Date
): Promise<{ facts: WeekFacts; summary: WeekSummary }> {
  const facts = await gatherWeekFacts(db, now);
  return { facts, summary: buildWeekSummary(facts) };
}
