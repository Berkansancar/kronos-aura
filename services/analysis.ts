/**
 * Analiz için veriyi toplar (veritabanı katmanı; SecureStore kullanmaz, testlerde çalışır). Mantık services/analysisLogic.ts içindedir.
 * Günlük yazısının metni ekrana ya da başka yere taşınmaz; yalnızca gün başına kelime sayısı tutulur.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listDailyStats, listJournalSince, listVocab, listWaterLogsSince } from '../database/repository';
import { analyze, emptyData, spanDays, type AnalysisData, type WindowAnalysis } from './analysisLogic';
import { getLanguageSettings, languageForDays } from './language';
import { nutritionDay } from './nutritionLogic';
import { isLearned } from './vocabLogic';
import { windowKeys } from './weeklyLogic';

/** Boşluklarla ayrılmış kelime sayısı */
export function countWords(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

async function minDay(db: SQLiteDatabase, sql: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ d: string | null }>(sql).catch(() => null);
  return row?.d ?? null;
}

/** Uygulamada bu analizlerden herhangi birine ait en eski kayıt günü (yoksa null). */
export async function firstAnalysisDay(db: SQLiteDatabase, vocabDays: string[]): Promise<string | null> {
  const days = (
    await Promise.all([
      minDay(db, 'SELECT MIN(day) AS d FROM StudyLog'),
      minDay(db, 'SELECT MIN(day) AS d FROM DailyStat WHERE steps > 0'),
      minDay(db, 'SELECT MIN(day) AS d FROM WaterLog'),
      minDay(db, "SELECT MIN(day) AS d FROM Journal WHERE good <> '' OR grateful <> '' OR goal <> ''"),
    ])
  ).filter((d): d is string => d !== null);
  days.push(...vocabDays);
  days.sort();
  return days[0] ?? null;
}

export async function loadAnalysisData(db: SQLiteDatabase, now: Date, heightCm: number | null): Promise<AnalysisData> {
  // Gün sınırı diğer ekranlarla aynı: gece 04:00'ten önceki kayıtlar bir önceki güne yazılır.
  const today = nutritionDay(now);
  const data = emptyData(today);
  data.heightCm = heightCm;

  const vocab = await listVocab(db).catch(() => []);
  data.addedDays = vocab.map((c) => nutritionDay(new Date(c.createdAt)));
  data.learned = vocab.filter(isLearned).map((c) => ({ day: c.lastDay }));

  const first = await firstAnalysisDay(db, data.addedDays);
  data.firstDay = first;
  if (!first) return data;

  const span = spanDays(first, today);
  const keys = windowKeys(today, span);

  for (const d of await languageForDays(db, keys).catch(() => [])) {
    // Uygulama (Duolingo) süresi ana çalışma süresidir; kalem-kağıt ve dinleme ayrı tutulur, toplanmaz.
    if (d.summary.appMinutes > 0) data.appByDay[d.day] = d.summary.appMinutes;
    if (d.summary.paperMinutes > 0) data.paperByDay[d.day] = d.summary.paperMinutes;
    if (d.summary.otherMinutes > 0) data.otherByDay[d.day] = d.summary.otherMinutes;
  }
  for (const s of await listDailyStats(db, span + 7)) {
    if (s.steps > 0) data.stepsByDay[s.day] = s.steps;
  }
  for (const w of await listWaterLogsSince(db, first)) {
    data.waterByDay[w.day] = (data.waterByDay[w.day] ?? 0) + w.amountMl;
  }
  for (const j of await listJournalSince(db, first)) {
    const words = countWords(j.good) + countWords(j.grateful) + countWords(j.goal);
    if (words > 0) data.journalByDay[j.day] = words;
  }
  return data;
}

export interface AnalysisScreenData {
  data: AnalysisData;
  span: number;
  /** Ekran süresinde aranan dil uygulaması adı (ayarlardaki liste), örn. "Duolingo" */
  appLabel: string;
}

export async function loadAnalysis(db: SQLiteDatabase, now: Date, heightCm: number | null): Promise<AnalysisScreenData> {
  const data = await loadAnalysisData(db, now, heightCm);
  const apps = (await getLanguageSettings(db).catch(() => null))?.apps ?? [];
  return { data, span: spanDays(data.firstDay, data.today), appLabel: apps.length > 0 ? apps.join(', ') : 'Dil uygulaması' };
}

export { analyze };
export type { WindowAnalysis };
