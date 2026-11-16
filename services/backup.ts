/** Yedek: telefonun güvenli deposundaki ayarları da katarak metni üretir / geri yükler. */
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { setSetting } from '../database/repository';
import { LAST_BACKUP_KEY } from './backupNudge';
import { BACKUP_PREF_KEYS, createBackup, restoreBackup, type RestoreResult } from './backupLogic';
import { refreshReminders } from './reminderSync';

async function readPrefs(): Promise<Record<string, string | null>> {
  const prefs: Record<string, string | null> = {};
  for (const key of BACKUP_PREF_KEYS) {
    try {
      prefs[key] = await SecureStore.getItemAsync(key);
    } catch {
      prefs[key] = null;
    }
  }
  return prefs;
}

/** Yedek metnini üretir ve "son yedek" zamanını kaydeder. */
export async function makeBackupText(db: SQLiteDatabase, now: Date = new Date()): Promise<string> {
  const text = await createBackup(db, await readPrefs(), now);
  // Zaman damgası yedekten SONRA yazılır; yedeğin kendi içinde kendi tarihi durmaz
  await setSetting(db, LAST_BACKUP_KEY, now.toISOString()).catch(() => undefined);
  return text;
}

/** Metinden geri yükler; güvenli depodaki ayarları yedektekine eşitler ve bildirimleri yeniler. */
export async function restoreFromText(db: SQLiteDatabase, text: string): Promise<RestoreResult> {
  const result = await restoreBackup(db, text);
  if (!result.ok) return result;
  for (const key of BACKUP_PREF_KEYS) {
    try {
      const v = result.prefs[key];
      if (v !== undefined) await SecureStore.setItemAsync(key, v);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      // bir ayar yazılamazsa diğerleri yine de yazılır
    }
  }
  await refreshReminders(db).catch(() => undefined);
  return result;
}
