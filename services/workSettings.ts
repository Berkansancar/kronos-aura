/** İş saatleri ayarı (veritabanında durur; planlayıcı da okur). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { WORK_SETTING_KEY, parseWork, serializeWork, type WorkSchedule } from './workLogic';

export async function getWork(db: SQLiteDatabase): Promise<WorkSchedule> {
  return parseWork(await getSetting(db, WORK_SETTING_KEY).catch(() => null));
}

export async function saveWork(db: SQLiteDatabase, patch: Partial<WorkSchedule>): Promise<WorkSchedule> {
  const next = parseWork(serializeWork({ ...(await getWork(db)), ...patch }));
  await setSetting(db, WORK_SETTING_KEY, serializeWork(next));
  return next;
}
