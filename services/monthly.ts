/** Aylık karne için veritabanı bağlantısı (mantık monthlyLogic'te). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listMoodLogsSince } from '../database/repository';
import { dayKey } from './activityLogic';
import type { GameGoals } from './gameLogic';
import { GAME_DAYS } from './gameLogic';
import { shiftMonth } from './habitCalendarLogic';
import { gatherHistory } from './history';
import { buildMonthReport, compareMonths, highlights, type MonthCompareRow, type MonthReport } from './monthlyLogic';

export interface MonthlyScreenData {
  report: MonthReport;
  prev: MonthReport | null;
  rows: MonthCompareRow[];
  lines: string[];
  /** Geçmiş kayıt bulunan en eski ay (gezinme sınırı) */
  earliestMonth: string;
}

export async function loadMonthly(db: SQLiteDatabase, month: string, now: Date, goals: GameGoals): Promise<MonthlyScreenData> {
  const { days } = await gatherHistory(db, now, GAME_DAYS);
  const since = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - GAME_DAYS));
  const moods = await listMoodLogsSince(db, since);
  const report = buildMonthReport(month, days, moods, goals, now);
  const prevKey = shiftMonth(month, -1);
  const prevFull = buildMonthReport(prevKey, days, moods, goals, now);
  // Süren ayda önceki ayın aynı sayıdaki gününe göre kıyasla
  const prev = report.isCurrent ? buildMonthReport(prevKey, days, moods, goals, now, report.elapsedDays) : prevFull;
  const first = days.find((d) => d.tasksDone > 0 || d.routinesDone > 0 || (d.languageMinutes ?? 0) > 0);
  const earliestMonth = first ? first.day.slice(0, 7) : month;
  const shown = prev.hasData ? prev : null;
  const rows = compareMonths(report, shown);
  return { report, prev: shown, rows, lines: highlights(report, rows), earliestMonth };
}

