/** İş saatleri ayarı (veritabanında durur; planlayıcı da okur). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { PERSONAL_WORK, WORK_SETTING_KEY, parseWork, serializeWork, type WorkSchedule } from './workLogic';

export async function getWork(db: SQLiteDatabase): Promise<WorkSchedule> {
  return parseWork(await getSetting(db, WORK_SETTING_KEY).catch(() => null));
}

export async function saveWork(db: SQLiteDatabase, patch: Partial<WorkSchedule>): Promise<WorkSchedule> {
  const next = parseWork(serializeWork({ ...(await getWork(db)), ...patch }));
  await setSetting(db, WORK_SETTING_KEY, serializeWork(next));
  return next;
}

export const WORK_SEED_KEY = 'work_seed_v1';

/**
 * Uygulamanın sahibinin haftasını (Pzt–Cum 07:40–18:00, Cmt 08:30–13:30, Pazar boş) bir kez kaydeder.
 * Sonra Hedefler > İş saatleri'nden değiştirilebilir; bayrak kaydedildiği için bir daha üzerine yazılmaz.
 */
export async function ensureWorkSeed(db: SQLiteDatabase): Promise<boolean> {
  if ((await getSetting(db, WORK_SEED_KEY).catch(() => null)) !== null) return false;
  await setSetting(db, WORK_SETTING_KEY, serializeWork(PERSONAL_WORK));
  await setSetting(db, WORK_SEED_KEY, '1');
  return true;
}
