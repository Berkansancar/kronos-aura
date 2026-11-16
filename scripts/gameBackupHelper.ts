/** test-game için: ödül listesi yedekten geri gelir mi? */
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrateDbIfNeeded } from '../database/schema';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { getGameState } from '../services/game';
import { makeTestDb } from './sqliteAdapter';

export async function backupRestoreSmoke(db: SQLiteDatabase, check: (name: string, ok: boolean, detail?: string) => void): Promise<void> {
  const text = await createBackup(db, {}, new Date(2026, 10, 16, 22, 0));
  const fresh = makeTestDb();
  await migrateDbIfNeeded(fresh.db);
  const res = await restoreBackup(fresh.db, text);
  const st = await getGameState(fresh.db);
  check('ödül listesi yedekle geri gelir (Setting tablosu)', res.ok && st.rewards.some((r) => r.title === 'Büyük ödül'), JSON.stringify(res));
}
