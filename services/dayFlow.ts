/** Gün akışı ve sigara sayacı (veritabanı katmanı). SecureStore kullanmaz; testlerde çalışır. */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addDayEvent,
  addSmokeLog,
  deleteDayEvent,
  deleteSmokeLog,
  getSetting,
  listDayEvents,
  listSmokeLogs,
  setSetting,
} from '../database/repository';
import type { DayEvent, DayEventKind, SmokeLog } from '../database/types';
import { buildFlow, nextKind, stampTime, type FlowSummary } from './dayFlowLogic';
import { nutritionDay } from './nutritionLogic';
import { SMOKE_LIMIT_KEY, analyzeSmoking, parseSmokeLimit, type SmokeStats } from './smokeLogic';

export interface DayFlowState {
  day: string;
  events: DayEvent[];
  flow: FlowSummary;
  next: DayEventKind | null;
  smokeLogs: SmokeLog[];
  smoke: SmokeStats;
}

export async function getSmokeLimit(db: SQLiteDatabase): Promise<number | null> {
  return parseSmokeLimit(await getSetting(db, SMOKE_LIMIT_KEY).catch(() => null));
}

export async function setSmokeLimit(db: SQLiteDatabase, limit: number | null): Promise<void> {
  // Sınır kapatılırsa kayıt boş metne çevrilir (okurken null sayılır)
  await setSetting(db, SMOKE_LIMIT_KEY, limit === null ? '' : String(limit));
}

/** `day` verilmezse mantıksal bugün (gece 04:00'e kadar önceki gün). */
export async function loadDayFlow(db: SQLiteDatabase, now: Date, day: string = nutritionDay(now)): Promise<DayFlowState> {
  const events = await listDayEvents(db, day);
  const smokeLogs = await listSmokeLogs(db, day);
  const isToday = day === nutritionDay(now);
  return {
    day,
    events,
    flow: buildFlow(events, now),
    next: nextKind(events),
    smokeLogs,
    smoke: analyzeSmoking(
      smokeLogs.map((l) => new Date(l.at)),
      now,
      await getSmokeLimit(db),
      isToday
    ),
  };
}

/** Damga vurur. `minutesAgo` > 0 ise geriye dönük (ör. "10 dk önce minibüse bindim"). */
export async function stampEvent(db: SQLiteDatabase, kind: DayEventKind, now: Date, minutesAgo = 0): Promise<DayEvent> {
  const at = stampTime(now, minutesAgo);
  return addDayEvent(db, nutritionDay(at), kind, at);
}

export const removeEvent = (db: SQLiteDatabase, id: string): Promise<void> => deleteDayEvent(db, id);

export async function addSmoke(db: SQLiteDatabase, now: Date, minutesAgo = 0): Promise<SmokeLog> {
  const at = stampTime(now, minutesAgo);
  return addSmokeLog(db, nutritionDay(at), at);
}

export const removeSmoke = (db: SQLiteDatabase, id: string): Promise<void> => deleteSmokeLog(db, id);
