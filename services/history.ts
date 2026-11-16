/** İlerleme ve geçmiş için veriyi veritabanından toplar. Mantık: services/historyLogic.ts */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  listDailyStats,
  listDayEventsSince,
  listMealLogsSince,
  listRoutineLogsSince,
  listSleepLogs,
  listSmokeLogsSince,
  listTaskOutcomesSince,
  listTimeLogsSince,
  listWaterLogsSince,
} from '../database/repository';
import type { DayEvent } from '../database/types';
import { dayKey } from './activityLogic';
import { buildFlow } from './dayFlowLogic';
import { languageForDays } from './language';
import type { HistoryDay, HistoryOutcome } from './historyLogic';
import { nutritionDay } from './nutritionLogic';
import { weekEndDate, windowKeys } from './weeklyLogic';

export const HISTORY_DAYS = 30;

const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

export async function gatherHistory(
  db: SQLiteDatabase,
  now: Date,
  nDays = HISTORY_DAYS
): Promise<{ days: HistoryDay[]; outcomes: HistoryOutcome[]; endDay: string }> {
  const end = weekEndDate(now);
  const endDay = dayKey(end);
  const keys = windowKeys(endDay, nDays);
  const startKey = keys[0];
  const startDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (nDays - 1));

  const logs = await listTimeLogsSince(db, startDate.toISOString());
  const routineLogs = await listRoutineLogsSince(db, startKey);
  const stats = new Map((await listDailyStats(db, nDays + 7)).map((s) => [s.day, s]));
  const sleeps = new Map((await listSleepLogs(db, nDays + 7)).map((s) => [s.day, s]));

  const water = new Map<string, number>();
  for (const w of await listWaterLogsSince(db, startKey)) water.set(w.day, (water.get(w.day) ?? 0) + w.amountMl);
  const kcal = new Map<string, number>();
  for (const m of await listMealLogsSince(db, startKey)) {
    if (m.kcal !== null) kcal.set(m.day, (kcal.get(m.day) ?? 0) + m.kcal);
  }

  // Bir rutin aynı gün birden çok kez "yapıldı" yazabilir; gün başına bir kez sayılır.
  const routineDone = new Map<string, Set<string>>();
  for (const l of routineLogs) {
    if (l.outcome !== 'DONE') continue;
    const set = routineDone.get(l.day) ?? new Set<string>();
    set.add(l.routineId);
    routineDone.set(l.day, set);
  }

  const tasks = new Map<string, { n: number; minutes: number }>();
  for (const l of logs) {
    // Akıp giden zaman ve rutinden gelen görevler "biten iş" sayılmaz
    if (l.taskId === null || l.routineId) continue;
    const k = nutritionDay(new Date(l.loggedAt));
    const cur = tasks.get(k) ?? { n: 0, minutes: 0 };
    cur.n += 1;
    cur.minutes += l.actualDuration;
    tasks.set(k, cur);
  }

  const smoke = new Map<string, number>();
  for (const s of await listSmokeLogsSince(db, startKey)) smoke.set(s.day, (smoke.get(s.day) ?? 0) + 1);
  const events = new Map<string, DayEvent[]>();
  for (const e of await listDayEventsSince(db, startKey)) {
    const list = events.get(e.day) ?? [];
    list.push(e);
    events.set(e.day, list);
  }

  // Dil öğrenme (hata verirse bu ölçü boş kalır, diğerleri çalışır)
  const lang = new Map(
    (await languageForDays(db, keys).catch(() => [])).map((x) => [x.day, x.summary.measured ? x.summary.total : null])
  );

  const days: HistoryDay[] = keys.map((k) => {
    const st = stats.get(k);
    const sl = sleeps.get(k);
    const flow = events.has(k) ? buildFlow(events.get(k) ?? [], now) : null;
    let wakeMin: number | null = null;
    if (flow?.wakeAt) wakeMin = minuteOf(flow.wakeAt);
    else if (sl) {
      const t = new Date(sl.wakeTime);
      if (!Number.isNaN(t.getTime())) wakeMin = minuteOf(t);
    }
    const commuteParts = flow ? [flow.commuteToMinutes, flow.commuteBackMinutes].filter((v): v is number => v !== null) : [];
    return {
      day: k,
      taskMinutes: tasks.get(k)?.minutes ?? 0,
      tasksDone: tasks.get(k)?.n ?? 0,
      routinesDone: routineDone.get(k)?.size ?? 0,
      waterMl: water.get(k) ?? null,
      kcal: kcal.get(k) ?? null,
      // Sayaç kullanıldıysa (sigara ya da gün akışı damgası) 0 da gerçek bir değerdir
      smoke: smoke.has(k) ? (smoke.get(k) as number) : events.has(k) ? 0 : null,
      screenMinutes: st?.screenMinutes ?? null,
      steps: st && st.steps > 0 ? st.steps : null,
      sleepMinutes: sl?.durationMinutes ?? null,
      wakeMin,
      shopMinutes: flow && !flow.shopOpen ? flow.shopMinutes : null,
      commuteMinutes: commuteParts.length > 0 ? commuteParts.reduce((a, b) => a + b, 0) : null,
      languageMinutes: lang.get(k) ?? null,
    };
  });

  // Aynı iş aynı gün yeniden işaretlenirse veritabanı eski kaydı değiştirir; farklı günlerin kayıtları ayrı sayılır
  const outcomes: HistoryOutcome[] = (await listTaskOutcomesSince(db, startKey)).map((o) => ({
    day: o.day,
    outcome: o.outcome,
    reason: o.reason,
  }));

  return { days, outcomes, endDay };
}
