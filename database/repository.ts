import type { SQLiteDatabase } from 'expo-sqlite';
import { newId } from './ids';
import type {
  ChatMessage,
  Chronotype,
  CoachId,
  CognitiveWeight,
  DailyStat,
  DurationSample,
  EnergyState,
  PlannedSlot,
  Routine,
  RoutineCategory,
  RoutineLog,
  RoutineOutcome,
  RoutineStatus,
  SleepLog,
  Task,
  TaskStatus,
  TimeBlockRow,
  TimeLog,
  UserProfile,
} from './types';

// ───────────────────────── Kullanıcı ─────────────────────────

const LOCAL_USER_ID = 'local-user';

/** Kronotipe göre varsayılan tepe enerji pencereleri. Kullanıcı sonradan ayarlayabilir. */
export const CHRONOTYPE_PRESETS: Record<
  Chronotype,
  { label: string; peakStartHour: number; peakEndHour: number }
> = {
  MORNING: { label: 'Sabahçı', peakStartHour: 8, peakEndHour: 12 },
  BALANCED: { label: 'Dengeli', peakStartHour: 10, peakEndHour: 14 },
  NIGHT: { label: 'Gececi', peakStartHour: 19, peakEndHour: 23 },
};

export async function getOrCreateUser(db: SQLiteDatabase): Promise<UserProfile> {
  const existing = await db.getFirstAsync<UserProfile>('SELECT * FROM User WHERE id = ?', [
    LOCAL_USER_ID,
  ]);
  if (existing) return existing;

  const preset = CHRONOTYPE_PRESETS.BALANCED;
  const created: UserProfile = {
    id: LOCAL_USER_ID,
    chronotype: 'BALANCED',
    peakStartHour: preset.peakStartHour,
    peakEndHour: preset.peakEndHour,
  };
  await db.runAsync(
    'INSERT INTO User (id, chronotype, peakStartHour, peakEndHour) VALUES (?, ?, ?, ?)',
    [created.id, created.chronotype, created.peakStartHour, created.peakEndHour]
  );
  return created;
}

export async function saveUserProfile(
  db: SQLiteDatabase,
  input: { chronotype: Chronotype; peakStartHour: number; peakEndHour: number }
): Promise<void> {
  const { chronotype, peakStartHour, peakEndHour } = input;
  if (peakStartHour < 0 || peakStartHour > 23 || peakEndHour < 1 || peakEndHour > 24) {
    throw new Error('Tepe enerji saatleri geçersiz.');
  }
  if (peakEndHour <= peakStartHour) {
    throw new Error('Tepe enerji bitişi başlangıçtan sonra olmalı.');
  }
  await getOrCreateUser(db);
  await db.runAsync(
    'UPDATE User SET chronotype = ?, peakStartHour = ?, peakEndHour = ? WHERE id = ?',
    [chronotype, peakStartHour, peakEndHour, LOCAL_USER_ID]
  );
}

// ───────────────────────── Görevler ─────────────────────────

export async function createTask(
  db: SQLiteDatabase,
  input: {
    title: string;
    estimatedDuration: number;
    cognitiveWeight: CognitiveWeight;
    /** Rutinden doğan görevlerde rutinin id'si */
    routineId?: string | null;
  }
): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new Error('Görev başlığı boş olamaz.');
  const task: Task = {
    id: newId('tsk'),
    title,
    estimatedDuration: Math.max(5, Math.round(input.estimatedDuration)),
    cognitiveWeight: input.cognitiveWeight,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    startedAt: null,
    routineId: input.routineId ?? null,
  };
  await db.runAsync(
    `INSERT INTO Task (id, title, estimatedDuration, cognitiveWeight, status, createdAt, startedAt, routineId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.title,
      task.estimatedDuration,
      task.cognitiveWeight,
      task.status,
      task.createdAt,
      task.startedAt,
      task.routineId ?? null,
    ]
  );
  return task;
}

/**
 * Ekranda görünecek görevler: tamamlanmamış hepsi + bugün tamamlananlar.
 * (Dünkü tamamlanmışlar listeyi kirletmesin diye gizlenir, veritabanında kalır.)
 */
export async function listVisibleTasks(
  db: SQLiteDatabase,
  dayStartISO: string
): Promise<Task[]> {
  return db.getAllAsync<Task>(
    `SELECT t.* FROM Task t
     WHERE t.status != 'COMPLETED'
        OR EXISTS (SELECT 1 FROM TimeLog l WHERE l.taskId = t.id AND l.loggedAt >= ?)
     ORDER BY t.createdAt ASC`,
    [dayStartISO]
  );
}

export async function setTaskStatus(
  db: SQLiteDatabase,
  id: string,
  status: TaskStatus,
  now: Date = new Date()
): Promise<void> {
  if (status === 'IN_PROGRESS') {
    await db.runAsync('UPDATE Task SET status = ?, startedAt = ? WHERE id = ?', [
      status,
      now.toISOString(),
      id,
    ]);
  } else if (status === 'PENDING' || status === 'POSTPONED') {
    await db.runAsync('UPDATE Task SET status = ?, startedAt = NULL WHERE id = ?', [status, id]);
  } else {
    await db.runAsync('UPDATE Task SET status = ? WHERE id = ?', [status, id]);
  }
}

/** Aynı anda tek görev üzerinde çalışılır: yeni görev başlarken öncekini beklemeye alır. */
export async function pauseOtherInProgress(db: SQLiteDatabase, exceptId: string): Promise<void> {
  await db.runAsync(
    `UPDATE Task SET status = 'PENDING', startedAt = NULL
     WHERE status = 'IN_PROGRESS' AND id != ?`,
    [exceptId]
  );
}

export async function deleteTask(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM Task WHERE id = ?', [id]);
}

// ───────────────────────── Zaman blokları ─────────────────────────

/** Verilen günün planını tamamen değiştirir (tek transaction). */
export async function replaceDayBlocks(
  db: SQLiteDatabase,
  dayStart: Date,
  dayEnd: Date,
  blocks: PlannedSlot[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM TimeBlock WHERE startTime >= ? AND startTime < ?', [
      dayStart.toISOString(),
      dayEnd.toISOString(),
    ]);
    for (const b of blocks) {
      await db.runAsync(
        'INSERT INTO TimeBlock (id, taskId, startTime, endTime, bufferTime) VALUES (?, ?, ?, ?, ?)',
        [newId('blk'), b.taskId, b.startTime.toISOString(), b.endTime.toISOString(), b.bufferTime]
      );
    }
  });
}

export async function listDayBlocks(
  db: SQLiteDatabase,
  dayStart: Date,
  dayEnd: Date
): Promise<TimeBlockRow[]> {
  return db.getAllAsync<TimeBlockRow>(
    'SELECT * FROM TimeBlock WHERE startTime >= ? AND startTime < ? ORDER BY startTime ASC',
    [dayStart.toISOString(), dayEnd.toISOString()]
  );
}

export function rowToSlot(row: TimeBlockRow): PlannedSlot {
  return {
    taskId: row.taskId,
    startTime: new Date(row.startTime),
    endTime: new Date(row.endTime),
    bufferTime: row.bufferTime,
  };
}

// ───────────────────────── Zaman kayıtları ─────────────────────────

export async function addTimeLog(
  db: SQLiteDatabase,
  input: {
    taskId: string | null;
    actualDuration: number;
    energyStateAtCompletion: EnergyState;
    coachNotes?: string | null;
    loggedAt?: Date;
  }
): Promise<TimeLog> {
  const log: TimeLog = {
    id: newId('log'),
    taskId: input.taskId,
    actualDuration: Math.max(0, Math.round(input.actualDuration)),
    energyStateAtCompletion: input.energyStateAtCompletion,
    coachNotes: input.coachNotes ?? null,
    loggedAt: (input.loggedAt ?? new Date()).toISOString(),
  };
  await db.runAsync(
    `INSERT INTO TimeLog (id, taskId, actualDuration, energyStateAtCompletion, coachNotes, loggedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.taskId,
      log.actualDuration,
      log.energyStateAtCompletion,
      log.coachNotes,
      log.loggedAt,
    ]
  );
  return log;
}

export async function listRecentLogs(db: SQLiteDatabase, limit = 10): Promise<TimeLog[]> {
  return db.getAllAsync<TimeLog>('SELECT * FROM TimeLog ORDER BY loggedAt DESC LIMIT ?', [limit]);
}

/** Süre kalibrasyonu için son gözlemler (görevle ilişkili kayıtlar). */
export async function listDurationSamples(
  db: SQLiteDatabase,
  limit = 60
): Promise<DurationSample[]> {
  return db.getAllAsync<DurationSample>(
    `SELECT t.cognitiveWeight AS cognitiveWeight,
            t.estimatedDuration AS estimatedDuration,
            l.actualDuration AS actualDuration
     FROM TimeLog l
     JOIN Task t ON t.id = l.taskId
     WHERE l.taskId IS NOT NULL AND l.actualDuration > 0
     ORDER BY l.loggedAt DESC
     LIMIT ?`,
    [limit]
  );
}

// ───────────────────────── Koç sohbeti ─────────────────────────

export async function addChatMessage(
  db: SQLiteDatabase,
  coach: CoachId,
  role: ChatMessage['role'],
  content: string
): Promise<ChatMessage> {
  const msg: ChatMessage = {
    id: newId('msg'),
    coach,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO CoachChat (id, coach, role, content, createdAt) VALUES (?, ?, ?, ?, ?)',
    [msg.id, msg.coach, msg.role, msg.content, msg.createdAt]
  );
  return msg;
}

/** En yeni `limit` mesaj, eskiden yeniye sıralı. */
export async function listChatMessages(
  db: SQLiteDatabase,
  coach: CoachId,
  limit = 40
): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<ChatMessage>(
    'SELECT * FROM CoachChat WHERE coach = ? ORDER BY createdAt DESC LIMIT ?',
    [coach, limit]
  );
  return rows.reverse();
}

export async function clearChat(db: SQLiteDatabase, coach: CoachId): Promise<void> {
  await db.runAsync('DELETE FROM CoachChat WHERE coach = ?', [coach]);
}

// ───────────────────────── Günlük aktivite ─────────────────────────

interface DailyStatRow {
  day: string;
  steps: number;
  screenMinutes: number | null;
  topApps: string;
  updatedAt: string;
}

function rowToDailyStat(r: DailyStatRow): DailyStat {
  let topApps: DailyStat['topApps'] = [];
  try {
    const parsed = JSON.parse(r.topApps);
    if (Array.isArray(parsed)) topApps = parsed;
  } catch {
    topApps = [];
  }
  return { day: r.day, steps: r.steps, screenMinutes: r.screenMinutes, topApps, updatedAt: r.updatedAt };
}

/**
 * Günün özetini yazar. Adım sayısı gün içinde yalnızca artabilir (en büyük değer korunur);
 * ekran süresi okunamadıysa (null) önceki değer ve uygulama listesi bozulmaz.
 */
export async function upsertDailyStat(
  db: SQLiteDatabase,
  stat: Omit<DailyStat, 'updatedAt'>
): Promise<void> {
  await db.runAsync(
    `INSERT INTO DailyStat (day, steps, screenMinutes, topApps, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       steps = MAX(DailyStat.steps, excluded.steps),
       screenMinutes = COALESCE(excluded.screenMinutes, DailyStat.screenMinutes),
       topApps = CASE WHEN excluded.screenMinutes IS NULL THEN DailyStat.topApps ELSE excluded.topApps END,
       updatedAt = excluded.updatedAt`,
    [
      stat.day,
      Math.max(0, Math.round(stat.steps)),
      stat.screenMinutes === null ? null : Math.max(0, Math.round(stat.screenMinutes)),
      JSON.stringify(stat.topApps),
      new Date().toISOString(),
    ]
  );
}

export async function getDailyStat(db: SQLiteDatabase, day: string): Promise<DailyStat | null> {
  const r = await db.getFirstAsync<DailyStatRow>('SELECT * FROM DailyStat WHERE day = ?', [day]);
  return r ? rowToDailyStat(r) : null;
}

/** En yeni `limit` gün, yeniden eskiye sıralı. */
export async function listDailyStats(db: SQLiteDatabase, limit = 7): Promise<DailyStat[]> {
  const rows = await db.getAllAsync<DailyStatRow>(
    'SELECT * FROM DailyStat ORDER BY day DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToDailyStat);
}

export async function getTask(db: SQLiteDatabase, id: string): Promise<Task | null> {
  return db.getFirstAsync<Task>('SELECT * FROM Task WHERE id = ?', [id]);
}

// ───────────────────────── Rutinler ─────────────────────────

export interface NewRoutine {
  title: string;
  category: RoutineCategory;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  askHour: number;
  askMinute?: number;
  templateId?: string | null;
}

export async function createRoutine(db: SQLiteDatabase, input: NewRoutine): Promise<Routine> {
  const title = input.title.trim();
  if (!title) throw new Error('Rutin adı boş olamaz.');
  const askMinute = input.askMinute ?? 0;
  if (input.askHour < 0 || input.askHour > 23 || askMinute < 0 || askMinute > 59) {
    throw new Error('Saat 00:00 ile 23:59 arasında olmalı.');
  }
  const routine: Routine = {
    id: newId('rtn'),
    title,
    category: input.category,
    estimatedDuration: Math.max(5, Math.round(input.estimatedDuration)),
    cognitiveWeight: input.cognitiveWeight,
    askHour: input.askHour,
    askMinute,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    retiredAt: null,
    templateId: input.templateId ?? null,
  };
  await db.runAsync(
    `INSERT INTO Routine (id, title, category, estimatedDuration, cognitiveWeight, askHour, askMinute,
                          status, createdAt, retiredAt, templateId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      routine.id,
      routine.title,
      routine.category,
      routine.estimatedDuration,
      routine.cognitiveWeight,
      routine.askHour,
      routine.askMinute,
      routine.status,
      routine.createdAt,
      routine.retiredAt,
      routine.templateId,
    ]
  );
  return routine;
}

export async function getRoutine(db: SQLiteDatabase, id: string): Promise<Routine | null> {
  return db.getFirstAsync<Routine>('SELECT * FROM Routine WHERE id = ?', [id]);
}

export async function listRoutines(
  db: SQLiteDatabase,
  status: RoutineStatus = 'ACTIVE'
): Promise<Routine[]> {
  return db.getAllAsync<Routine>(
    'SELECT * FROM Routine WHERE status = ? ORDER BY askHour ASC, askMinute ASC, createdAt ASC',
    [status]
  );
}

export async function updateRoutine(
  db: SQLiteDatabase,
  id: string,
  patch: Partial<
    Pick<Routine, 'title' | 'category' | 'estimatedDuration' | 'cognitiveWeight' | 'askHour' | 'askMinute'>
  >
): Promise<void> {
  const current = await getRoutine(db, id);
  if (!current) throw new Error('Rutin bulunamadı.');
  const next = { ...current, ...patch };
  const title = next.title.trim();
  if (!title) throw new Error('Rutin adı boş olamaz.');
  if (next.askHour < 0 || next.askHour > 23 || next.askMinute < 0 || next.askMinute > 59) {
    throw new Error('Saat 00:00 ile 23:59 arasında olmalı.');
  }
  await db.runAsync(
    `UPDATE Routine SET title = ?, category = ?, estimatedDuration = ?, cognitiveWeight = ?,
                        askHour = ?, askMinute = ? WHERE id = ?`,
    [
      title,
      next.category,
      Math.max(5, Math.round(next.estimatedDuration)),
      next.cognitiveWeight,
      next.askHour,
      next.askMinute,
      id,
    ]
  );
}

export async function setRoutineStatus(
  db: SQLiteDatabase,
  id: string,
  status: RoutineStatus,
  now: Date = new Date()
): Promise<void> {
  await db.runAsync('UPDATE Routine SET status = ?, retiredAt = ? WHERE id = ?', [
    status,
    status === 'RETIRED' ? now.toISOString() : null,
    id,
  ]);
}

export async function deleteRoutine(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM Routine WHERE id = ?', [id]);
}

export async function addRoutineLog(
  db: SQLiteDatabase,
  input: {
    routineId: string;
    day: string;
    outcome: RoutineOutcome;
    taskId?: string | null;
    snoozeUntil?: Date | null;
    loggedAt?: Date;
  }
): Promise<RoutineLog> {
  const log: RoutineLog = {
    id: newId('rlg'),
    routineId: input.routineId,
    day: input.day,
    outcome: input.outcome,
    taskId: input.taskId ?? null,
    snoozeUntil: input.snoozeUntil ? input.snoozeUntil.toISOString() : null,
    loggedAt: (input.loggedAt ?? new Date()).toISOString(),
  };
  await db.runAsync(
    `INSERT INTO RoutineLog (id, routineId, day, outcome, taskId, snoozeUntil, loggedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [log.id, log.routineId, log.day, log.outcome, log.taskId, log.snoozeUntil, log.loggedAt]
  );
  return log;
}

/** `sinceDay` (YYYY-MM-DD, dahil) ve sonrasındaki tüm rutin cevapları, eskiden yeniye. */
export async function listRoutineLogsSince(
  db: SQLiteDatabase,
  sinceDay: string
): Promise<RoutineLog[]> {
  return db.getAllAsync<RoutineLog>(
    'SELECT * FROM RoutineLog WHERE day >= ? ORDER BY loggedAt ASC, rowid ASC',
    [sinceDay]
  );
}

// ───────────────────────── Uyku ─────────────────────────

export async function upsertSleepLog(db: SQLiteDatabase, log: SleepLog): Promise<void> {
  await db.runAsync(
    `INSERT INTO SleepLog (day, bedtime, wakeTime, durationMinutes, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       bedtime = excluded.bedtime,
       wakeTime = excluded.wakeTime,
       durationMinutes = excluded.durationMinutes,
       updatedAt = excluded.updatedAt`,
    [log.day, log.bedtime, log.wakeTime, Math.max(1, Math.round(log.durationMinutes)), new Date().toISOString()]
  );
}

/** En yeni `limit` gece, yeniden eskiye sıralı. */
export async function listSleepLogs(db: SQLiteDatabase, limit = 14): Promise<SleepLog[]> {
  return db.getAllAsync<SleepLog>(
    'SELECT day, bedtime, wakeTime, durationMinutes FROM SleepLog ORDER BY day DESC LIMIT ?',
    [limit]
  );
}
