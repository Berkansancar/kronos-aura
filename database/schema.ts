import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'kronos-aura.db';
export const DATABASE_VERSION = 4;

/**
 * Not: SQLite'ın gerçek bir DATETIME tipi yoktur. Zaman alanlarını ISO-8601 (UTC) TEXT
 * olarak saklıyoruz; bu biçim alfabetik sıralamayla zaman sıralamasını da verir.
 *
 * Şemaya, istenen taslağa göre şu eklemeler yapıldı:
 *  - Task.createdAt / Task.startedAt   -> gerçek süreyi ölçmek ve "bugünün görevleri"ni listelemek için
 *  - TimeLog.loggedAt                  -> öğrenme ve geçmiş sorguları için
 *  - TimeLog.taskId boş olabilir       -> Aura'nın "zaman akıp gitti" kayıtları görevden bağımsızdır
 */
const CREATE_TABLES_V1 = `
CREATE TABLE IF NOT EXISTS User (
  id            TEXT PRIMARY KEY NOT NULL,
  chronotype    TEXT NOT NULL CHECK (chronotype IN ('MORNING', 'NIGHT', 'BALANCED')),
  peakStartHour INTEGER NOT NULL CHECK (peakStartHour BETWEEN 0 AND 23),
  peakEndHour   INTEGER NOT NULL CHECK (peakEndHour BETWEEN 1 AND 24),
  CHECK (peakEndHour > peakStartHour)
);

CREATE TABLE IF NOT EXISTS Task (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  estimatedDuration INTEGER NOT NULL CHECK (estimatedDuration > 0),
  cognitiveWeight   TEXT NOT NULL CHECK (cognitiveWeight IN ('HIGH', 'MEDIUM', 'LOW')),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED')),
  createdAt         TEXT NOT NULL,
  startedAt         TEXT
);

CREATE TABLE IF NOT EXISTS TimeBlock (
  id         TEXT PRIMARY KEY NOT NULL,
  taskId     TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,
  startTime  TEXT NOT NULL,
  endTime    TEXT NOT NULL,
  bufferTime INTEGER NOT NULL DEFAULT 0 CHECK (bufferTime >= 0),
  CHECK (endTime > startTime)
);

CREATE TABLE IF NOT EXISTS TimeLog (
  id                      TEXT PRIMARY KEY NOT NULL,
  taskId                  TEXT REFERENCES Task(id) ON DELETE CASCADE,
  actualDuration          INTEGER NOT NULL CHECK (actualDuration >= 0),
  energyStateAtCompletion TEXT NOT NULL
                          CHECK (energyStateAtCompletion IN ('HIGH', 'EXHAUSTED', 'DISTRACTED')),
  coachNotes              TEXT,
  loggedAt                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_status       ON Task(status);
CREATE INDEX IF NOT EXISTS idx_timeblock_start   ON TimeBlock(startTime);
CREATE INDEX IF NOT EXISTS idx_timeblock_task    ON TimeBlock(taskId);
CREATE INDEX IF NOT EXISTS idx_timelog_task      ON TimeLog(taskId);
CREATE INDEX IF NOT EXISTS idx_timelog_loggedAt  ON TimeLog(loggedAt);
`;

/** Sürüm 2: koç sohbet geçmişi. */
const CREATE_TABLES_V2 = `
CREATE TABLE IF NOT EXISTS CoachChat (
  id        TEXT PRIMARY KEY NOT NULL,
  coach     TEXT NOT NULL CHECK (coach IN ('KRONOS', 'AURA')),
  role      TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content   TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coachchat_coach ON CoachChat(coach, createdAt);
`;

/** Sürüm 3: günlük adım ve ekran süresi özetleri (Gün analizi). */
const CREATE_TABLES_V3 = `
CREATE TABLE IF NOT EXISTS DailyStat (
  day           TEXT PRIMARY KEY NOT NULL,
  steps         INTEGER NOT NULL DEFAULT 0 CHECK (steps >= 0),
  screenMinutes INTEGER CHECK (screenMinutes IS NULL OR screenMinutes >= 0),
  topApps       TEXT NOT NULL DEFAULT '[]',
  updatedAt     TEXT NOT NULL
);
`;

/** Sürüm 4: günlük rutinler, rutin cevapları ve tahmini uyku kayıtları. */
const CREATE_TABLES_V4 = `
CREATE TABLE IF NOT EXISTS Routine (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('SAGLIK', 'ZIHIN', 'ODAK', 'DUZEN')),
  estimatedDuration INTEGER NOT NULL CHECK (estimatedDuration > 0),
  cognitiveWeight   TEXT NOT NULL CHECK (cognitiveWeight IN ('HIGH', 'MEDIUM', 'LOW')),
  askHour           INTEGER NOT NULL CHECK (askHour BETWEEN 0 AND 23),
  askMinute         INTEGER NOT NULL DEFAULT 0 CHECK (askMinute BETWEEN 0 AND 59),
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  createdAt         TEXT NOT NULL,
  retiredAt         TEXT,
  templateId        TEXT
);

CREATE TABLE IF NOT EXISTS RoutineLog (
  id          TEXT PRIMARY KEY NOT NULL,
  routineId   TEXT NOT NULL REFERENCES Routine(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('ACCEPTED', 'DONE', 'SNOOZED', 'SKIPPED', 'RETIRED')),
  taskId      TEXT,
  snoozeUntil TEXT,
  loggedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routinelog_routine ON RoutineLog(routineId, day);
CREATE INDEX IF NOT EXISTS idx_routinelog_day     ON RoutineLog(day);

CREATE TABLE IF NOT EXISTS SleepLog (
  day             TEXT PRIMARY KEY NOT NULL,
  bedtime         TEXT NOT NULL,
  wakeTime        TEXT NOT NULL,
  durationMinutes INTEGER NOT NULL CHECK (durationMinutes > 0),
  updatedAt       TEXT NOT NULL
);
`;

/** Sütun ekleme tekrar çalıştırılırsa hata verir; bu yüzden önce var mı diye bakılır. */
const ADD_TASK_ROUTINE_ID = `
ALTER TABLE Task ADD COLUMN routineId TEXT REFERENCES Routine(id) ON DELETE SET NULL;
`;

async function hasColumn(db: SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

/**
 * SQLiteProvider'ın onInit'ine verilir. Veritabanı ilk açıldığında tabloları kurar,
 * sonraki sürümlerde buraya yeni migrasyon adımları eklenir.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // Yabancı anahtarlar bağlantı başına açılır; her açılışta etkinleştirilmeli.
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  if (current >= DATABASE_VERSION) return;

  if (current === 0) {
    await db.execAsync(`PRAGMA journal_mode = 'wal'; ${CREATE_TABLES_V1}`);
    current = 1;
  }

  if (current === 1) {
    await db.execAsync(CREATE_TABLES_V2);
    current = 2;
  }

  if (current === 2) {
    await db.execAsync(CREATE_TABLES_V3);
    current = 3;
  }

  if (current === 3) {
    await db.execAsync(CREATE_TABLES_V4);
    if (!(await hasColumn(db, 'Task', 'routineId'))) {
      await db.execAsync(ADD_TASK_ROUTINE_ID);
    }
    current = 4;
  }

  // Gelecekteki migrasyonlar:
  // if (current === 4) { await db.execAsync(`ALTER TABLE ...`); current = 5; }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
