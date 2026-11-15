/** Testler için: Node'un yerleşik SQLite'ını expo-sqlite'ın async arayüzüne uyarlar. */
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

export function makeTestDb(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      const r = raw.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      raw.prepare(sql).get(...(params as never[])) ?? null,
    getAllAsync: async (sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...(params as never[])),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
  return { db, raw };
}
