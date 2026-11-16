/** Yolculuk (veritabanı katmanı): son günlerin damgalarından tipik tek yön yol süresi. */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listDayEventsSince } from '../database/repository';
import type { DayEvent } from '../database/types';
import { dayKey } from './activityLogic';
import { buildFlow } from './dayFlowLogic';
import { typicalCommuteMinutes } from './commuteLogic';

const LOOKBACK_DAYS = 14;

export async function loadTypicalCommute(db: SQLiteDatabase, now: Date): Promise<number | null> {
  const since = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - LOOKBACK_DAYS));
  const byDay = new Map<string, DayEvent[]>();
  for (const e of await listDayEventsSince(db, since)) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  const samples: number[] = [];
  for (const events of byDay.values()) {
    const f = buildFlow(events, now);
    if (f.commuteToMinutes !== null) samples.push(f.commuteToMinutes);
    if (f.commuteBackMinutes !== null) samples.push(f.commuteBackMinutes);
  }
  return typicalCommuteMinutes(samples);
}
