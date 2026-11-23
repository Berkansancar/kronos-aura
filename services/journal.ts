/**
 * Akşam günlüğü ve "seni ne iyi yapıyor" için veriyi toplar ve kaydeder.
 * Mantık services/journalLogic.ts ve services/insightLogic.ts içindedir.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { JournalEntry, MoodLog, MoodValue } from '../database/types';
import { deleteJournalEntry, getJournalEntry, listJournalSince, listMoodLogsSince, listWaterLogsSince, saveJournalEntry, setMoodLog } from '../database/repository';
import { dayKey } from './activityLogic';
import { waterGoalDays } from './effectsLogic';
import { loadExercise } from './exercise';
import { languageForDays } from './language';
import { getWaterGoal } from './nutritionSettings';
import { moodInsights, type InsightResult } from './insightLogic';
import {
  auraJournalReply,
  cleanFields,
  fieldsOf,
  goalForToday,
  isEmptyFields,
  journalDay,
  journalStreak,
  monthSummary,
  recentEntries,
  type JournalFields,
  type MonthSummary,
} from './journalLogic';
import { windowKeys } from './weeklyLogic';

/** Karşılaştırma ve geçmiş listesi için bakılan gün sayısı */
export const JOURNAL_WINDOW_DAYS = 90;

export interface JournalScreenData {
  /** Yazılan günün anahtarı (gece 04:00'e kadar dün) */
  day: string;
  fields: JournalFields;
  mood: MoodLog | null;
  /** Dün yazılan "yarının tek hedefi" */
  todayGoal: string | null;
  history: JournalEntry[];
  summary: MonthSummary;
  streakDays: number;
  insights: InsightResult;
}

export async function loadJournal(db: SQLiteDatabase, now: Date = new Date()): Promise<JournalScreenData> {
  const day = journalDay(now);
  const calendarToday = dayKey(now);
  const keys = windowKeys(calendarToday, JOURNAL_WINDOW_DAYS);
  const [entries, moods, exercise, waterLogs, goalMl, lang] = await Promise.all([
    listJournalSince(db, keys[0]),
    listMoodLogsSince(db, keys[0]),
    loadExercise(db),
    listWaterLogsSince(db, keys[0]),
    getWaterGoal(),
    languageForDays(db, keys).catch(() => []),
  ]);
  const streak = journalStreak(entries, calendarToday);
  return {
    day,
    fields: fieldsOf(entries.find((e) => e.day === day) ?? null),
    mood: moods.find((m) => m.day === day) ?? null,
    todayGoal: goalForToday(entries, calendarToday),
    history: recentEntries(entries, 30),
    summary: monthSummary(entries, moods, day.slice(0, 7)),
    streakDays: streak.alive ? streak.spanDays : 0,
    insights: moodInsights({
      moods: moods.map((m) => ({ day: m.day, mood: m.mood })),
      exerciseDays: exercise.sessions.map((s) => s.day),
      waterGoalDays: waterGoalDays(
        waterLogs.map((w) => ({ day: w.day, ml: w.amountMl })),
        goalMl
      ),
      studyDays: lang.filter((d) => d.summary.total > 0).map((d) => d.day),
    }),
  };
}

/** Günlüğü ve (seçildiyse) ruh halini kaydeder; boş yazı kaydedilmez ama ruh hali tek başına kaydedilebilir. */
export async function saveJournal(
  db: SQLiteDatabase,
  now: Date,
  input: Partial<JournalFields>,
  mood: MoodValue | null
): Promise<{ reply: string; saved: boolean }> {
  const day = journalDay(now);
  const fields = cleanFields(input);
  if (mood !== null) await setMoodLog(db, day, mood, now);
  if (isEmptyFields(fields)) {
    // Daha önce yazılmış bir kayıt tamamen silinirse kayıt da kaldırılır
    if (await getJournalEntry(db, day)) await deleteJournalEntry(db, day);
    return { reply: auraJournalReply(fields, mood, 0), saved: false };
  }
  await saveJournalEntry(db, day, fields, now);
  const entries = await listJournalSince(db, windowKeys(dayKey(now), 30)[0]);
  const streak = journalStreak(entries, dayKey(now));
  return { reply: auraJournalReply(fields, mood, streak.alive ? streak.spanDays : 0), saved: true };
}
