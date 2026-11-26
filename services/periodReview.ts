/**
 * "Tüm günlerin değerlendirmesi" için veriyi toplar ve cevabı saklar. Mantık services/periodLogic.ts içindedir.
 * Bu dosya services/dayReview.ts'yi içe aktarmaz (dayReview bu dosyayı kullanır).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getSetting,
  listDailyStats,
  listDayEventsSince,
  listHardDaysSince,
  listMoodLogsSince,
  listRoutineLogsSince,
  listRoutines,
  listSleepLogs,
  listSmokeLogsSince,
  listTimeLogsSince,
  listWaterLogsSince,
  setSetting,
} from '../database/repository';
import { dayKey, parseDayKey } from './activityLogic';
import { buildFlow } from './dayFlowLogic';
import { loadExercise } from './exercise';
import { isExerciseDay } from './exerciseLogic';
import { languageForDays } from './language';
import type { NutritionOptions } from './nutrition';
import { DEFAULT_WATER_GOAL } from './nutritionLogic';
import { parseDays } from './routineDaysLogic';
import {
  MIN_PERIOD_DAYS,
  PERIOD_KEY,
  addStored,
  parsePeriodExtras,
  parseStored,
  periodSpan,
  periodStats,
  routineChancesOn,
  serializeStored,
  statLines,
  type PeriodDay,
  type PeriodExtras,
  type PeriodFacts,
  type PeriodSpan,
  type StoredPeriodReview,
} from './periodLogic';
import { weekEndDate, windowKeys, type WeekRoutineInput } from './weeklyLogic';

/** Uygulamada kaydı olan en eski gün (yoksa null). Yalnızca gün sütunu olan tablolara bakılır. */
export async function firstDataDay(db: SQLiteDatabase): Promise<string | null> {
  const tables = ['DayReview', 'RoutineLog', 'DailyStat', 'MoodLog', 'SleepLog', 'WaterLog', 'DayEvent', 'SmokeLog', 'StudyLog'];
  const days: string[] = [];
  for (const t of tables) {
    const row = await db.getFirstAsync<{ d: string | null }>(`SELECT MIN(day) AS d FROM ${t}`).catch(() => null);
    if (row?.d) days.push(row.d);
  }
  const tl = await db.getFirstAsync<{ d: string | null }>('SELECT MIN(loggedAt) AS d FROM TimeLog').catch(() => null);
  if (tl?.d) days.push(dayKey(new Date(tl.d)));
  const ex = await loadExercise(db).catch(() => null);
  if (ex && ex.sessions.length > 0) days.push(ex.sessions.map((s) => s.day).sort()[0]);
  days.sort();
  return days[0] ?? null;
}

/** Komutun kaç günü kapsayacağı (ekranda "N gün" yazmak için). */
export async function describePeriod(db: SQLiteDatabase, now: Date): Promise<PeriodSpan & { to: string; enough: boolean }> {
  const to = dayKey(weekEndDate(now));
  const span = periodSpan(await firstDataDay(db), to);
  return { ...span, to, enough: span.days >= MIN_PERIOD_DAYS };
}

export async function gatherPeriodFacts(db: SQLiteDatabase, now: Date, nutritionOpts?: NutritionOptions): Promise<PeriodFacts> {
  const to = dayKey(weekEndDate(now));
  const span = periodSpan(await firstDataDay(db), to);
  const keys = windowKeys(to, span.days);
  const startKey = keys[0];
  const startDate = parseDayKey(startKey);
  const countEndDay = now.getHours() >= 20 || now.getHours() < 4;

  const [logs, routineLogs, routines, stats, sleeps, hardArr, waters, moods, smokes, events, exercise, lang] = await Promise.all([
    listTimeLogsSince(db, startDate.toISOString()),
    listRoutineLogsSince(db, startKey),
    listRoutines(db, 'ACTIVE'),
    listDailyStats(db, span.days + 7),
    listSleepLogs(db, span.days + 7),
    listHardDaysSince(db, startKey),
    listWaterLogsSince(db, startKey),
    listMoodLogsSince(db, startKey),
    listSmokeLogsSince(db, startKey),
    listDayEventsSince(db, startKey),
    loadExercise(db).catch(() => null),
    languageForDays(db, keys).catch(() => []),
  ]);

  // Görevler (rutinden gelenler rutin sayılır, iki kez sayılmaz)
  const taskByDay = new Map<string, { tasks: number; minutes: number }>();
  for (const l of logs) {
    if (l.taskId === null || l.routineId) continue;
    const k = dayKey(new Date(l.loggedAt));
    const cur = taskByDay.get(k) ?? { tasks: 0, minutes: 0 };
    cur.tasks += 1;
    cur.minutes += l.actualDuration;
    taskByDay.set(k, cur);
  }

  const doneSets = new Map<string, Set<string>>();
  for (const l of routineLogs) {
    if (l.outcome !== 'DONE') continue;
    const set = doneSets.get(l.routineId) ?? new Set<string>();
    set.add(l.day);
    doneSets.set(l.routineId, set);
  }
  const weekRoutines: WeekRoutineInput[] = routines.map((r) => ({
    title: r.title,
    createdDay: dayKey(new Date(r.createdAt)),
    doneDays: [...(doneSets.get(r.id) ?? [])],
    days: parseDays(r.days),
  }));

  const statByDay = new Map(stats.map((s) => [s.day, s]));
  const sleepByDay = new Map(sleeps.map((s) => [s.day, s.durationMinutes]));
  const waterByDay = new Map<string, number>();
  for (const w of waters) waterByDay.set(w.day, (waterByDay.get(w.day) ?? 0) + w.amountMl);
  const moodByDay = new Map(moods.map((m) => [m.day, m.mood as number]));
  const smokeByDay = new Map<string, number>();
  for (const s of smokes) smokeByDay.set(s.day, (smokeByDay.get(s.day) ?? 0) + 1);
  const hard = new Set(hardArr);
  const langByDay = new Map(lang.map((d) => [d.day, d.summary]));
  const eventsByDay = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByDay.get(e.day) ?? [];
    list.push(e);
    eventsByDay.set(e.day, list);
  }

  const days: PeriodDay[] = keys.map((k) => {
    const st = statByDay.get(k);
    const info = taskByDay.get(k);
    const dayEvents = eventsByDay.get(k);
    let roadMinutes: number | null = null;
    let siteMinutes: number | null = null;
    if (dayEvents && dayEvents.length > 0) {
      const flow = buildFlow(dayEvents, now);
      if (flow.commuteToMinutes !== null || flow.commuteBackMinutes !== null) {
        roadMinutes = (flow.commuteToMinutes ?? 0) + (flow.commuteBackMinutes ?? 0);
      }
      // Çıkış damgası yoksa geçmiş günün iş süresi bilinmez (şimdiye kadar sayılmaz)
      siteMinutes = flow.shopOpen && k !== to ? null : flow.shopMinutes;
    }
    const session = exercise?.sessions.find((s) => s.day === k);
    const exerciseState: PeriodDay['exercise'] =
      session && session.items.length > 0 ? 'DONE' : exercise && isExerciseDay(exercise.plan, parseDayKey(k)) ? 'PLANNED' : null;
    const l = langByDay.get(k);
    const doneCount = weekRoutines.filter((r) => r.doneDays.includes(k)).length;
    return {
      day: k,
      tasksDone: info?.tasks ?? 0,
      taskMinutes: info?.minutes ?? 0,
      routinesDone: doneCount,
      routineChances: routineChancesOn(weekRoutines, k, to, countEndDay),
      steps: st && st.steps > 0 ? st.steps : null,
      screenMinutes: st?.screenMinutes ?? null,
      sleepMinutes: sleepByDay.get(k) ?? null,
      hardDay: hard.has(k),
      waterMl: waterByDay.get(k) ?? 0,
      exercise: exerciseState,
      mood: moodByDay.get(k) ?? null,
      smoke: smokeByDay.get(k) ?? null,
      languageMinutes: l && l.total > 0 ? l.total : null,
      roadMinutes,
      siteMinutes,
    };
  });

  return {
    from: startKey,
    to,
    days,
    capped: span.capped,
    routines: weekRoutines,
    countEndDay,
    waterGoalMl: nutritionOpts?.waterGoalMl ?? DEFAULT_WATER_GOAL,
  };
}

// ───────────────────────── Saklama ─────────────────────────

export async function loadPeriodReviews(db: SQLiteDatabase): Promise<StoredPeriodReview[]> {
  return parseStored(await getSetting(db, PERIOD_KEY));
}

/**
 * Yapıştırılan cevaptaki dönem alanlarını doğrulayıp saklar. Dönem alanları yoksa ya da uygunsuzsa hiçbir şey yazmaz
 * ve null döner (günün değerlendirmesi bundan etkilenmez).
 */
export async function savePeriodExtras(
  db: SQLiteDatabase,
  now: Date,
  obj: Record<string, unknown> | null,
  nutritionOpts?: NutritionOptions
): Promise<StoredPeriodReview | null> {
  const facts = await gatherPeriodFacts(db, now, nutritionOpts);
  const extras: PeriodExtras | null = parsePeriodExtras(
    obj,
    facts.days.map((d) => d.day)
  );
  if (!extras) return null;
  const item: StoredPeriodReview = {
    from: facts.from,
    to: facts.to,
    days: facts.days.length,
    savedAt: now.toISOString(),
    stats: statLines(periodStats(facts)),
    ...extras,
  };
  const list = addStored(await loadPeriodReviews(db), item);
  await setSetting(db, PERIOD_KEY, serializeStored(list));
  return item;
}
