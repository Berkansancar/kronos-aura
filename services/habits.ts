/** Alışkanlık takvimi ve ruh hali için veritabanı bağlantısı (mantık habitCalendarLogic ve moodLogic'te). */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getMoodLog,
  listMoodLogsSince,
  listRoutineLogsSince,
  listRoutines,
  setMoodLog,
} from '../database/repository';
import type { MoodLog, MoodValue, Routine, RoutineLog } from '../database/types';
import { dayKey } from './activityLogic';
import {
  buildMonth,
  doneByDay,
  summarize,
  type CalendarCell,
  type HabitSummary,
} from './habitCalendarLogic';
import {
  moodAverage,
  moodCounts,
  moodInsight,
  moodReply,
  moodSeries,
  moodVsRoutines,
  type MoodReply,
} from './moodLogic';

const HISTORY_DAYS = 400;

const since = (now: Date, days: number): string =>
  dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));

export interface HabitScreenData {
  routines: Routine[];
  weeks: (CalendarCell | null)[][];
  summary: HabitSummary;
  logs: RoutineLog[];
  moods: MoodLog[];
  /** Seçilen aydaki ruh hali kayıtları */
  monthMoods: MoodLog[];
  moodAvg: number | null;
  moodDistribution: ReturnType<typeof moodCounts>;
  week: ReturnType<typeof moodSeries>;
  insight: string | null;
  today: MoodLog | null;
}

export async function loadHabitScreen(
  db: SQLiteDatabase,
  monthKey: string,
  now: Date,
  routineId?: string
): Promise<HabitScreenData> {
  const routines = await listRoutines(db, 'ACTIVE');
  const logs = await listRoutineLogsSince(db, since(now, HISTORY_DAYS));
  const moods = await listMoodLogsSince(db, since(now, HISTORY_DAYS));
  const activeIds = new Set(routines.map((r) => r.id));
  // Takvim ve istatistik aynı kaynaktan beslenir: yalnızca etkin rutinlerin "yapıldı" kayıtları.
  const activeLogs = logs.filter((l) => activeIds.has(l.routineId));
  const month = buildMonth(monthKey, routines, activeLogs, moods, now, routineId);
  const monthMoods = moods.filter((m) => m.day.startsWith(monthKey));
  // Ruh hali bağlantısı: son 60 gün, en az bir (etkin) rutin yapılan günlerle diğerleri
  const recentMoods = moods.filter((m) => m.day >= since(now, 60));
  const doneDays = new Set<string>(doneByDay(activeLogs).keys());
  return {
    routines,
    weeks: month.weeks,
    summary: summarize(monthKey, activeLogs, now, routineId),
    logs: activeLogs,
    moods,
    monthMoods,
    moodAvg: moodAverage(monthMoods),
    moodDistribution: moodCounts(monthMoods),
    week: moodSeries(moods, now, 7),
    insight: moodInsight(moodVsRoutines(recentMoods, doneDays)),
    today: moods.find((m) => m.day === dayKey(now)) ?? null,
  };
}

/** Ruh halini kaydeder ve Aura'nın kısa cevabını döndürür. */
export async function logMood(
  db: SQLiteDatabase,
  now: Date,
  mood: MoodValue,
  note?: string | null
): Promise<{ log: MoodLog; reply: MoodReply }> {
  const log = await setMoodLog(db, dayKey(now), mood, now, note);
  const recent = await listMoodLogsSince(db, since(now, 30));
  return { log, reply: moodReply(mood, recent, now) };
}

export async function saveMoodNote(db: SQLiteDatabase, now: Date, note: string): Promise<MoodLog | null> {
  const current = await getMoodLog(db, dayKey(now));
  if (!current) return null;
  return setMoodLog(db, current.day, current.mood, now, note);
}

export async function todayMood(db: SQLiteDatabase, now: Date): Promise<MoodLog | null> {
  return getMoodLog(db, dayKey(now));
}

/** Geçmiş ya da bugünkü bir günün ruh halini yazar (takvimden düzeltmek için). Gelecek gün yazılamaz. */
export async function setMoodForDay(db: SQLiteDatabase, day: string, mood: MoodValue, now: Date): Promise<MoodLog> {
  if (day > dayKey(now)) throw new Error('Gelecek bir gün için ruh hali yazılamaz.');
  return setMoodLog(db, day, mood, now);
}
