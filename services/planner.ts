/**
 * Veritabanı ile zamanlama motorunu birbirine bağlar:
 * görevleri/blokları/geçmişi okur, `reoptimize`'ı çalıştırır, sonucu kaydeder.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getOrCreateUser,
  listDayBlocks,
  listDurationSamples,
  listVisibleTasks,
  replaceDayBlocks,
  rowToSlot,
} from '../database/repository';
import { getWork } from './workSettings';
import { workWindowFor } from './workLogic';
import {
  computeDurationFactors,
  reoptimize,
  type ReoptimizeResult,
  type ReplanTrigger,
} from './scheduler';

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 22;

/** Gün kapandıysa (22:00 sonrası) planlanan gün yarındır. Yerel gece yarısı döner. */
export function planningDay(now: Date): Date {
  const d = new Date(now);
  if (now.getHours() >= DAY_END_HOUR) d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Günü (yeniden) planlar ve kaydeder. Kronos'un tek giriş noktası. */
export async function replanDay(
  db: SQLiteDatabase,
  now: Date,
  trigger: ReplanTrigger,
  opts?: { overrunExtraMinutes?: number }
): Promise<ReoptimizeResult> {
  const day = planningDay(now);
  const { start, end } = dayBounds(day);

  const user = await getOrCreateUser(db);
  const tasks = await listVisibleTasks(db, start.toISOString());
  const previousRows = await listDayBlocks(db, start, end);
  const samples = await listDurationSamples(db);
  // İş saatleri açıksa ve o gün çalışılıyorsa, "iş vaktinde yapılabilir" işaretsiz işler o saatlere yerleşmez.
  const workWindow = workWindowFor(day, await getWork(db));

  const result = reoptimize({
    now,
    day,
    user,
    tasks,
    previousBlocks: previousRows.map(rowToSlot),
    trigger,
    overrunExtraMinutes: opts?.overrunExtraMinutes,
    options: {
      dayStartHour: DAY_START_HOUR,
      dayEndHour: DAY_END_HOUR,
      durationFactors: computeDurationFactors(samples),
      workWindow,
    },
  });

  await replaceDayBlocks(db, start, end, result.blocks);
  return result;
}
