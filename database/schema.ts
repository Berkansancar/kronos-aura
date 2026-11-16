import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'kronos-aura.db';
export const DATABASE_VERSION = 10;

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
/** Zor gün modu: o gün için kullanıcı Aura'dan planı hafifletmesini istedi. Gün başına tek kayıt. */
const CREATE_TABLES_V6 = `
CREATE TABLE IF NOT EXISTS DayMode (
  day       TEXT PRIMARY KEY NOT NULL,
  mode      TEXT NOT NULL CHECK (mode IN ('HARD')),
  /** Zor gün modu açılırken ertelenen görevlerin id listesi (JSON); kapanınca geri alınır */
  postponedIds TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL
);
`;

/** Sürüm 7: su ve yemek kayıtları. `day` yerel gün anahtarıdır (gece 04:00'e kadar önceki güne yazılır). */
const CREATE_TABLES_V7 = `
CREATE TABLE IF NOT EXISTS WaterLog (
  id       TEXT PRIMARY KEY NOT NULL,
  day      TEXT NOT NULL,
  amountMl INTEGER NOT NULL CHECK (amountMl > 0 AND amountMl <= 5000),
  loggedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waterlog_day ON WaterLog(day);

CREATE TABLE IF NOT EXISTS MealLog (
  id       TEXT PRIMARY KEY NOT NULL,
  day      TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('KAHVALTI', 'OGLE', 'AKSAM', 'ARA', 'ICECEK')),
  note     TEXT NOT NULL DEFAULT '',
  groups   TEXT NOT NULL DEFAULT '[]',
  kcal     INTEGER CHECK (kcal IS NULL OR (kcal >= 0 AND kcal <= 6000)),
  eatenAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meallog_day ON MealLog(day);
`;

/**
 * Sürüm 8: görev sonuçları (Yaptım / Yapmadım / Yapamadım), iş vaktinde yapılabilir işaret, ayar tablosu,
 * gün akışı damgaları ve sigara sayacı.
 * TaskOutcome görev silinse de kalır (gün sonu analizi geçmişi görebilsin diye taskId yabancı anahtar değildir).
 * `day` mantıksal gündür (gece 04:00'e kadar önceki gün). `carried`: ertesi gün plana geri alındı mı.
 */
const CREATE_TABLES_V8 = `
CREATE TABLE IF NOT EXISTS TaskOutcome (
  id       TEXT PRIMARY KEY NOT NULL,
  taskId   TEXT,
  title    TEXT NOT NULL,
  day      TEXT NOT NULL,
  outcome  TEXT NOT NULL CHECK (outcome IN ('DONE', 'NOT_DONE', 'COULD_NOT')),
  reason   TEXT CHECK (reason IS NULL OR reason IN ('WORK', 'ENERGY', 'TIME', 'OTHER')),
  minutes  INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  workOk   INTEGER NOT NULL DEFAULT 0,
  carried  INTEGER NOT NULL DEFAULT 0,
  loggedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_taskoutcome_day  ON TaskOutcome(day);
CREATE INDEX IF NOT EXISTS idx_taskoutcome_task ON TaskOutcome(taskId, day);

CREATE TABLE IF NOT EXISTS Setting (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

/** Gün akışı damgaları: uyandım, duş, minibüs, dükkan... Aynı tür gün içinde birden çok kez olabilir (gidiş ve dönüş). */
CREATE TABLE IF NOT EXISTS DayEvent (
  id   TEXT PRIMARY KEY NOT NULL,
  day  TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('WAKE', 'SHOWER', 'BUS', 'SHOP_IN', 'SHOP_OUT', 'HOME')),
  at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dayevent_day ON DayEvent(day);

/** Sigara sayacı: her içilen için bir satır. */
CREATE TABLE IF NOT EXISTS SmokeLog (
  id  TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smokelog_day ON SmokeLog(day);
`;

const ADD_TASK_WORK_OK = `
ALTER TABLE Task ADD COLUMN workOk INTEGER NOT NULL DEFAULT 0;
`;

/** Sürüm 9: "yolda yapılabilir" işareti (minibüste telefonla yapılabilen hafif işler). */
const ADD_TASK_COMMUTE_OK = `
ALTER TABLE Task ADD COLUMN commuteOk INTEGER NOT NULL DEFAULT 0;
`;

/**
 * Sürüm 10: dil çalışması kayıtları (kalem-kağıt, elle girilen uygulama süresi, dinleme/konuşma).
 * Duolingo gibi uygulamaların süresi ekran süresinden otomatik okunur; burada yalnızca elle eklenenler durur.
 */
const CREATE_TABLES_V10 = `
CREATE TABLE IF NOT EXISTS StudyLog (
  id       TEXT PRIMARY KEY NOT NULL,
  day      TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('PAPER', 'APP', 'OTHER')),
  minutes  INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 600),
  loggedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studylog_day ON StudyLog(day);
`;

const CREATE_TABLES_V5 = `
CREATE TABLE IF NOT EXISTS DayReview (
  day       TEXT PRIMARY KEY NOT NULL,
  payload   TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`;

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

  if (current === 4) {
    await db.execAsync(CREATE_TABLES_V5);
    current = 5;
  }

  if (current === 5) {
    await db.execAsync(CREATE_TABLES_V6);
    current = 6;
  }

  if (current === 6) {
    await db.execAsync(CREATE_TABLES_V7);
    current = 7;
  }

  if (current === 7) {
    await db.execAsync(CREATE_TABLES_V8);
    if (!(await hasColumn(db, 'Task', 'workOk'))) {
      await db.execAsync(ADD_TASK_WORK_OK);
    }
    current = 8;
  }

  if (current === 8) {
    if (!(await hasColumn(db, 'Task', 'commuteOk'))) {
      await db.execAsync(ADD_TASK_COMMUTE_OK);
    }
    current = 9;
  }

  if (current === 9) {
    await db.execAsync(CREATE_TABLES_V10);
    current = 10;
  }

  // Gelecekteki migrasyonlar:
  // if (current === 10) { await db.execAsync(`ALTER TABLE ...`); current = 11; }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
