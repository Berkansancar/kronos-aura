/** Zor gün modunu açar/kapatır. Mantık: services/hardDayLogic.ts */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getHardDay, getTask, listVisibleTasks, setHardDay, setTaskStatus } from '../database/repository';
import type { Task } from '../database/types';
import { dayKey } from './activityLogic';
import { chooseHardDayKeep } from './hardDayLogic';
import { dayBounds, planningDay, replanDay } from './planner';
import { postponeTasks } from './taskFlow';

export interface HardDayResult {
  kept: Task[];
  deferred: Task[];
}

/** Zor gün modunu açar: planda hafif işler kalır, gerisi bugünlük ertelenir ve plan yeniden kurulur. */
export async function startHardDay(db: SQLiteDatabase, now: Date): Promise<HardDayResult> {
  const day = planningDay(now);
  const { start } = dayBounds(day);
  const tasks = await listVisibleTasks(db, start.toISOString());
  const { keep, defer } = chooseHardDayKeep(tasks);
  await setHardDay(
    db,
    dayKey(day),
    true,
    now,
    defer.map((t) => t.id)
  );
  if (defer.length > 0) {
    await postponeTasks(
      db,
      defer.map((t) => t.id),
      now
    );
  } else {
    await replanDay(db, now, 'MANUAL');
  }
  return { kept: keep, deferred: defer };
}

/** Normal güne döner ve zor gün modunun ertelediği görevleri geri alır. Geri alınan görev sayısını verir. */
export async function endHardDay(db: SQLiteDatabase, now: Date): Promise<number> {
  const key = dayKey(planningDay(now));
  const record = await getHardDay(db, key);
  await setHardDay(db, key, false);
  let restored = 0;
  for (const id of record?.postponedIds ?? []) {
    const t = await getTask(db, id);
    // Kullanıcı bu arada başka bir şey yaptıysa (sildi, bitirdi) dokunulmaz
    if (t && t.status === 'POSTPONED') {
      await setTaskStatus(db, id, 'PENDING', now);
      restored += 1;
    }
  }
  await replanDay(db, now, 'MANUAL');
  return restored;
}
