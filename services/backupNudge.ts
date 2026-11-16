/** Son yedek zamanı ve ana ekrandaki yedek hatırlatması (veritabanı katmanı; SecureStore kullanmaz). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { NUDGE_SNOOZE_DAYS, backupNudge } from './backupLogic';

export const LAST_BACKUP_KEY = 'last_backup';
const NUDGE_SNOOZE_KEY = 'backup_nudge_until';

const parseDate = (v: string | null): Date | null => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export async function getLastBackup(db: SQLiteDatabase): Promise<Date | null> {
  try {
    return parseDate(await getSetting(db, LAST_BACKUP_KEY));
  } catch {
    return null;
  }
}

/** Ana ekranda gösterilecek yedek hatırlatması (yoksa null). Hata verirse sessizce null. */
export async function loadBackupNudge(db: SQLiteDatabase, now: Date = new Date()): Promise<string | null> {
  try {
    let records = 0;
    for (const table of ['TimeLog', 'TaskOutcome', 'WaterLog', 'MealLog', 'SmokeLog']) {
      const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      records += r?.n ?? 0;
    }
    return backupNudge({
      lastBackup: await getLastBackup(db),
      snoozeUntil: parseDate(await getSetting(db, NUDGE_SNOOZE_KEY)),
      now,
      records,
    });
  } catch {
    return null;
  }
}

/** "Şimdi değil": hatırlatma bir hafta sessiz kalır. */
export async function snoozeBackupNudge(db: SQLiteDatabase, now: Date = new Date()): Promise<void> {
  const until = new Date(now.getTime() + NUDGE_SNOOZE_DAYS * 86_400_000);
  await setSetting(db, NUDGE_SNOOZE_KEY, until.toISOString());
}
