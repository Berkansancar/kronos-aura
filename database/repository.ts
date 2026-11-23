import type { SQLiteDatabase } from 'expo-sqlite';
import { parseDays, serializeDays } from '../services/routineDaysLogic';
import { newId } from './ids';
import type {
  ChatMessage,
  Chronotype,
  CoachId,
  CognitiveWeight,
  DailyStat,
  DayEvent,
  DayEventKind,
  DurationSample,
  EnergyState,
  PlannedSlot,
  Routine,
  RoutineCategory,
  RoutineLog,
  RoutineOutcome,
  RoutineStatus,
  SleepLog,
  SmokeLog,
  StudyKind,
  StudyLog,
  Task,
  TaskOutcome,
  TaskOutcomeKind,
  TaskOutcomeReason,
  TaskStatus,
  TimeBlockRow,
  TimeLog,
  UserProfile,
  DayReview,
  DayReviewPayload,
  MealKind,
  MealLog,
  WaterLog,
  MoodLog,
  JournalEntry,
  WeightLog,
  MoodValue,
  VocabCard,
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
    /** İş saatlerinde de yapılabilir mi? Varsayılan: hayır */
    workOk?: boolean;
    /** Minibüste yapılabilir mi? Varsayılan: hayır */
    commuteOk?: boolean;
    /** Yapılacağı gün (yyyy-mm-dd); verilirse görev o güne kadar plana girmez */
    plannedDay?: string | null;
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
    workOk: input.workOk === true,
    commuteOk: input.commuteOk === true,
    plannedDay: input.plannedDay ?? null,
  };
  await db.runAsync(
    `INSERT INTO Task (id, title, estimatedDuration, cognitiveWeight, status, createdAt, startedAt, routineId, workOk, commuteOk, plannedDay)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.title,
      task.estimatedDuration,
      task.cognitiveWeight,
      task.status,
      task.createdAt,
      task.startedAt,
      task.routineId ?? null,
      task.workOk ? 1 : 0,
      task.commuteOk ? 1 : 0,
      task.plannedDay ?? null,
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
  // Başka bir güne ayrılmış (plannedDay ileride) işler o güne kadar görünmez; bitenler her zaman görünür.
  const dayStart = new Date(dayStartISO);
  const today = Number.isNaN(dayStart.getTime()) ? '9999-12-31' : localDayKey(dayStart);
  const rows = await db.getAllAsync<Task>(
    `SELECT t.* FROM Task t
     WHERE (t.status != 'COMPLETED'
        OR EXISTS (SELECT 1 FROM TimeLog l WHERE l.taskId = t.id AND l.loggedAt >= ?))
       AND (t.plannedDay IS NULL OR t.plannedDay <= ? OR t.status = 'COMPLETED')
     ORDER BY t.createdAt ASC`,
    [dayStartISO, today]
  );
  return rows.map(normalizeTask);
}

/** Başka bir güne ayrılmış, henüz bitmemiş işler (Hafta planı ekranı için), gün sırasıyla. */
export async function listParkedTasks(db: SQLiteDatabase, todayKey: string): Promise<Task[]> {
  const rows = await db.getAllAsync<Task>(
    `SELECT * FROM Task WHERE status != 'COMPLETED' AND plannedDay IS NOT NULL AND plannedDay > ?
     ORDER BY plannedDay ASC, createdAt ASC`,
    [todayKey]
  );
  return rows.map(normalizeTask);
}

/** Bir görevin yapılacağı günü değiştirir (null: belirli gün yok / bugüne al). */
export async function setTaskPlannedDay(db: SQLiteDatabase, id: string, day: string | null): Promise<void> {
  await db.runAsync('UPDATE Task SET plannedDay = ? WHERE id = ?', [day, id]);
}

/** Yerel takvim günü anahtarı (yyyy-mm-dd) */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SQLite'ta 0/1 duran işareti gerçek boolean'a çevirir. */
function normalizeTask(row: Task): Task {
  return { ...row, workOk: Boolean(row.workOk), commuteOk: Boolean(row.commuteOk), plannedDay: row.plannedDay ?? null };
}

/** İş vaktinde yapılabilir işaretini değiştirir. */
export async function setTaskWorkOk(db: SQLiteDatabase, id: string, workOk: boolean): Promise<void> {
  await db.runAsync('UPDATE Task SET workOk = ? WHERE id = ?', [workOk ? 1 : 0, id]);
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

/** Görevin adını, süresini, yükünü ve (verilirse) iş vaktinde / yolda yapılabilir işaretlerini değiştirir. */
export async function updateTask(
  db: SQLiteDatabase,
  id: string,
  patch: {
    title: string;
    estimatedDuration: number;
    cognitiveWeight: CognitiveWeight;
    workOk?: boolean;
    commuteOk?: boolean;
    /** Verilirse yapılacağı gün değişir (null: belirli gün yok) */
    plannedDay?: string | null;
  }
): Promise<void> {
  const title = patch.title.trim();
  if (!title) throw new Error('Görev başlığı boş olamaz.');
  const sets = ['title = ?', 'estimatedDuration = ?', 'cognitiveWeight = ?'];
  const params: (string | number | null)[] = [title, Math.max(5, Math.round(patch.estimatedDuration)), patch.cognitiveWeight];
  if (patch.workOk !== undefined) {
    sets.push('workOk = ?');
    params.push(patch.workOk ? 1 : 0);
  }
  if (patch.commuteOk !== undefined) {
    sets.push('commuteOk = ?');
    params.push(patch.commuteOk ? 1 : 0);
  }
  if (patch.plannedDay !== undefined) {
    sets.push('plannedDay = ?');
    params.push(patch.plannedDay);
  }
  await db.runAsync(`UPDATE Task SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
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
  const row = await db.getFirstAsync<Task>('SELECT * FROM Task WHERE id = ?', [id]);
  return row ? normalizeTask(row) : null;
}

// ───────────────────────── Rutinler ─────────────────────────

/** Gün metnini temizler: geçersiz, boş ya da yedi günün hepsi null olur. */
function normalizeDays(text: string | null | undefined): string | null {
  return serializeDays(parseDays(text));
}

export interface NewRoutine {
  title: string;
  category: RoutineCategory;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  askHour: number;
  askMinute?: number;
  templateId?: string | null;
  icon?: string | null;
  color?: string | null;
  /** "1,2,5" (0 = Pazar); boş ya da yedi günün hepsi: her gün */
  days?: string | null;
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
    icon: input.icon ?? null,
    color: input.color ?? null,
    days: normalizeDays(input.days),
  };
  await db.runAsync(
    `INSERT INTO Routine (id, title, category, estimatedDuration, cognitiveWeight, askHour, askMinute,
                          status, createdAt, retiredAt, templateId, icon, color, days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      routine.icon,
      routine.color,
      routine.days,
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
    Pick<
      Routine,
      'title' | 'category' | 'estimatedDuration' | 'cognitiveWeight' | 'askHour' | 'askMinute' | 'icon' | 'color' | 'days'
    >
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
                        askHour = ?, askMinute = ?, icon = ?, color = ?, days = ? WHERE id = ?`,
    [
      title,
      next.category,
      Math.max(5, Math.round(next.estimatedDuration)),
      next.cognitiveWeight,
      next.askHour,
      next.askMinute,
      next.icon ?? null,
      next.color ?? null,
      normalizeDays(next.days),
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

// ───────────────────────── Gün sonu değerlendirmesi ─────────────────────────

export async function upsertDayReview(
  db: SQLiteDatabase,
  day: string,
  payload: DayReviewPayload,
  createdAt: Date = new Date()
): Promise<void> {
  await db.runAsync(
    `INSERT INTO DayReview (day, payload, createdAt) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET payload = excluded.payload, createdAt = excluded.createdAt`,
    [day, JSON.stringify(payload), createdAt.toISOString()]
  );
}

export async function getDayReview(db: SQLiteDatabase, day: string): Promise<DayReview | null> {
  const row = await db.getFirstAsync<{ day: string; payload: string; createdAt: string }>(
    'SELECT day, payload, createdAt FROM DayReview WHERE day = ?',
    [day]
  );
  if (!row) return null;
  try {
    return { day: row.day, payload: JSON.parse(row.payload) as DayReviewPayload, createdAt: row.createdAt };
  } catch {
    return null; // bozuk kayıt varsa yeniden üretilir
  }
}

// ───────────────────────── Zor gün modu ─────────────────────────

export async function getHardDay(db: SQLiteDatabase, day: string): Promise<{ postponedIds: string[] } | null> {
  const row = await db.getFirstAsync<{ postponedIds: string }>(
    "SELECT postponedIds FROM DayMode WHERE day = ? AND mode = 'HARD'",
    [day]
  );
  if (!row) return null;
  try {
    const ids: unknown = JSON.parse(row.postponedIds);
    return { postponedIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [] };
  } catch {
    return { postponedIds: [] };
  }
}

export async function isHardDay(db: SQLiteDatabase, day: string): Promise<boolean> {
  return (await getHardDay(db, day)) !== null;
}

/** Açarken ertelenen görev id'leri öncekilerle birleştirilir; kapatınca kayıt silinir. */
export async function setHardDay(
  db: SQLiteDatabase,
  day: string,
  on: boolean,
  now: Date = new Date(),
  postponedIds: string[] = []
): Promise<void> {
  if (!on) {
    await db.runAsync('DELETE FROM DayMode WHERE day = ?', [day]);
    return;
  }
  const existing = (await getHardDay(db, day))?.postponedIds ?? [];
  const merged = Array.from(new Set([...existing, ...postponedIds]));
  await db.runAsync(
    `INSERT INTO DayMode (day, mode, postponedIds, createdAt) VALUES (?, 'HARD', ?, ?)
     ON CONFLICT(day) DO UPDATE SET mode = 'HARD', postponedIds = excluded.postponedIds`,
    [day, JSON.stringify(merged), now.toISOString()]
  );
}

// ───────────────────────── Haftalık özet için sorgular ─────────────────────────

export type TimeLogWithRoutine = TimeLog & { routineId: string | null };

/** `sinceISO` sonrasındaki zaman kayıtları; görev bir rutinden geldiyse routineId dolu. */
export async function listTimeLogsSince(db: SQLiteDatabase, sinceISO: string): Promise<TimeLogWithRoutine[]> {
  return db.getAllAsync<TimeLogWithRoutine>(
    `SELECT l.*, t.routineId AS routineId
     FROM TimeLog l LEFT JOIN Task t ON t.id = l.taskId
     WHERE l.loggedAt >= ?
     ORDER BY l.loggedAt ASC`,
    [sinceISO]
  );
}

/** `sinceDay` (yyyy-mm-dd) ve sonrasındaki zor gün kayıtları. */
export async function listHardDaysSince(db: SQLiteDatabase, sinceDay: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ day: string }>(
    "SELECT day FROM DayMode WHERE mode = 'HARD' AND day >= ? ORDER BY day ASC",
    [sinceDay]
  );
  return rows.map((r) => r.day);
}


// ───────────────────────── Su ve yemek ─────────────────────────

export async function addWaterLog(db: SQLiteDatabase, day: string, amountMl: number, at: Date): Promise<WaterLog> {
  const row: WaterLog = {
    id: newId('wtr'),
    day,
    amountMl: Math.max(1, Math.min(5000, Math.round(amountMl))),
    loggedAt: at.toISOString(),
  };
  await db.runAsync('INSERT INTO WaterLog (id, day, amountMl, loggedAt) VALUES (?, ?, ?, ?)', [
    row.id,
    row.day,
    row.amountMl,
    row.loggedAt,
  ]);
  return row;
}

export async function listWaterLogs(db: SQLiteDatabase, day: string): Promise<WaterLog[]> {
  return db.getAllAsync<WaterLog>(
    'SELECT id, day, amountMl, loggedAt FROM WaterLog WHERE day = ? ORDER BY loggedAt ASC, rowid ASC',
    [day]
  );
}

export async function listWaterLogsSince(db: SQLiteDatabase, sinceDay: string): Promise<WaterLog[]> {
  return db.getAllAsync<WaterLog>(
    'SELECT id, day, amountMl, loggedAt FROM WaterLog WHERE day >= ? ORDER BY loggedAt ASC, rowid ASC',
    [sinceDay]
  );
}

export async function deleteWaterLog(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM WaterLog WHERE id = ?', [id]);
}

export interface NewMeal {
  day: string;
  kind: MealKind;
  note: string;
  groups: string[];
  kcal: number | null;
  eatenAt: Date;
}

export async function addMealLog(db: SQLiteDatabase, m: NewMeal): Promise<MealLog> {
  const kcal = m.kcal === null || !Number.isFinite(m.kcal) ? null : Math.max(0, Math.min(6000, Math.round(m.kcal)));
  const row: MealLog = {
    id: newId('mel'),
    day: m.day,
    kind: m.kind,
    note: m.note.trim().slice(0, 200),
    groups: Array.from(new Set(m.groups)),
    kcal,
    eatenAt: m.eatenAt.toISOString(),
  };
  await db.runAsync(
    'INSERT INTO MealLog (id, day, kind, note, groups, kcal, eatenAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [row.id, row.day, row.kind, row.note, JSON.stringify(row.groups), row.kcal, row.eatenAt]
  );
  return row;
}

type MealRow = Omit<MealLog, 'groups'> & { groups: string };

function parseMeal(r: MealRow): MealLog {
  let groups: string[] = [];
  try {
    const g: unknown = JSON.parse(r.groups);
    if (Array.isArray(g)) groups = g.filter((x): x is string => typeof x === 'string');
  } catch {
    groups = [];
  }
  return { ...r, groups };
}

export async function listMealLogs(db: SQLiteDatabase, day: string): Promise<MealLog[]> {
  const rows = await db.getAllAsync<MealRow>(
    'SELECT id, day, kind, note, groups, kcal, eatenAt FROM MealLog WHERE day = ? ORDER BY eatenAt ASC, rowid ASC',
    [day]
  );
  return rows.map(parseMeal);
}

export async function listMealLogsSince(db: SQLiteDatabase, sinceDay: string): Promise<MealLog[]> {
  const rows = await db.getAllAsync<MealRow>(
    'SELECT id, day, kind, note, groups, kcal, eatenAt FROM MealLog WHERE day >= ? ORDER BY eatenAt ASC, rowid ASC',
    [sinceDay]
  );
  return rows.map(parseMeal);
}

export async function deleteMealLog(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM MealLog WHERE id = ?', [id]);
}

// ───────────────────────── Görev sonuçları ─────────────────────────

interface TaskOutcomeRow extends Omit<TaskOutcome, 'workOk' | 'carried'> {
  workOk: number;
  carried: number;
}

const rowToOutcome = (r: TaskOutcomeRow): TaskOutcome => ({ ...r, workOk: !!r.workOk, carried: !!r.carried });

export interface NewTaskOutcome {
  taskId: string | null;
  title: string;
  day: string;
  outcome: TaskOutcomeKind;
  reason?: TaskOutcomeReason | null;
  minutes?: number;
  workOk?: boolean;
  at?: Date;
}

/** Aynı görev ve gün için tek sonuç tutulur: yenisi eskisinin yerine geçer. */
export async function addTaskOutcome(db: SQLiteDatabase, o: NewTaskOutcome): Promise<TaskOutcome> {
  const out: TaskOutcome = {
    id: newId('out'),
    taskId: o.taskId,
    title: o.title.trim() || 'Görev',
    day: o.day,
    outcome: o.outcome,
    reason: o.outcome === 'COULD_NOT' ? (o.reason ?? null) : null,
    minutes: Math.max(0, Math.round(o.minutes ?? 0)),
    workOk: o.workOk === true,
    carried: false,
    loggedAt: (o.at ?? new Date()).toISOString(),
  };
  await db.withTransactionAsync(async () => {
    if (out.taskId) await db.runAsync('DELETE FROM TaskOutcome WHERE taskId = ? AND day = ?', [out.taskId, out.day]);
    await db.runAsync(
      `INSERT INTO TaskOutcome (id, taskId, title, day, outcome, reason, minutes, workOk, carried, loggedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [out.id, out.taskId, out.title, out.day, out.outcome, out.reason, out.minutes, out.workOk ? 1 : 0, out.loggedAt]
    );
  });
  return out;
}

export async function listTaskOutcomes(db: SQLiteDatabase, day: string): Promise<TaskOutcome[]> {
  const rows = await db.getAllAsync<TaskOutcomeRow>('SELECT * FROM TaskOutcome WHERE day = ? ORDER BY loggedAt ASC', [day]);
  return rows.map(rowToOutcome);
}

export async function listTaskOutcomesSince(db: SQLiteDatabase, sinceDay: string): Promise<TaskOutcome[]> {
  const rows = await db.getAllAsync<TaskOutcomeRow>('SELECT * FROM TaskOutcome WHERE day >= ? ORDER BY day ASC, loggedAt ASC', [sinceDay]);
  return rows.map(rowToOutcome);
}

/** Bugünden önceki, henüz plana geri alınmamış "yapmadım / yapamadım" sonuçları. */
export async function listUncarriedMisses(db: SQLiteDatabase, beforeDay: string): Promise<TaskOutcome[]> {
  const rows = await db.getAllAsync<TaskOutcomeRow>(
    `SELECT * FROM TaskOutcome
     WHERE day < ? AND carried = 0 AND outcome IN ('NOT_DONE', 'COULD_NOT') AND taskId IS NOT NULL
     ORDER BY day ASC, loggedAt ASC`,
    [beforeDay]
  );
  return rows.map(rowToOutcome);
}

export async function markOutcomeCarried(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE TaskOutcome SET carried = 1 WHERE id = ?', [id]);
}

/**
 * Bir görevin en son sonuç kaydı. `DONE`: "Yaptım" kaydı (hangi günden olursa olsun);
 * `MISSED`: o günkü, henüz plana geri alınmamış "yapmadım / yapamadım" kaydı.
 */
export async function getLatestTaskOutcome(
  db: SQLiteDatabase,
  taskId: string,
  filter: { kind: 'DONE' } | { kind: 'MISSED'; day: string }
): Promise<TaskOutcome | null> {
  const row =
    filter.kind === 'DONE'
      ? await db.getFirstAsync<TaskOutcomeRow>(
          `SELECT * FROM TaskOutcome WHERE taskId = ? AND outcome = 'DONE' ORDER BY loggedAt DESC LIMIT 1`,
          [taskId]
        )
      : await db.getFirstAsync<TaskOutcomeRow>(
          `SELECT * FROM TaskOutcome
           WHERE taskId = ? AND day = ? AND carried = 0 AND outcome IN ('NOT_DONE', 'COULD_NOT')
           ORDER BY loggedAt DESC LIMIT 1`,
          [taskId, filter.day]
        );
  return row ? rowToOutcome(row) : null;
}

export async function deleteTaskOutcome(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM TaskOutcome WHERE id = ?', [id]);
}

/** Görevin, verilen anda yazılmış süre kaydını siler; an verilmezse görevin en son kaydını siler. */
export async function deleteTimeLogForTask(db: SQLiteDatabase, taskId: string, loggedAt: string | null): Promise<void> {
  if (loggedAt) {
    await db.runAsync(
      'DELETE FROM TimeLog WHERE id = (SELECT id FROM TimeLog WHERE taskId = ? AND loggedAt = ? LIMIT 1)',
      [taskId, loggedAt]
    );
  } else {
    await db.runAsync(
      'DELETE FROM TimeLog WHERE id = (SELECT id FROM TimeLog WHERE taskId = ? ORDER BY loggedAt DESC LIMIT 1)',
      [taskId]
    );
  }
}

/** Görev "yapıldı" diye rutine yazılan "bugün yaptım" cevabını siler. */
export async function deleteRoutineDoneLogsForTask(db: SQLiteDatabase, taskId: string): Promise<void> {
  await db.runAsync(`DELETE FROM RoutineLog WHERE taskId = ? AND outcome = 'DONE'`, [taskId]);
}

// ───────────────────────── Ayarlar (anahtar-değer) ─────────────────────────

/** Planlayıcının okuması gereken ayarlar (ör. iş saatleri) veritabanında durur; SecureStore gerekmez. */
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM Setting WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO Setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// ───────────────────────── Gün akışı damgaları ─────────────────────────

export async function addDayEvent(db: SQLiteDatabase, day: string, kind: DayEventKind, at: Date): Promise<DayEvent> {
  const ev: DayEvent = { id: newId('evt'), day, kind, at: at.toISOString() };
  await db.runAsync('INSERT INTO DayEvent (id, day, kind, at) VALUES (?, ?, ?, ?)', [ev.id, ev.day, ev.kind, ev.at]);
  return ev;
}

export async function listDayEvents(db: SQLiteDatabase, day: string): Promise<DayEvent[]> {
  return db.getAllAsync<DayEvent>('SELECT * FROM DayEvent WHERE day = ? ORDER BY at ASC', [day]);
}

export async function listDayEventsSince(db: SQLiteDatabase, sinceDay: string): Promise<DayEvent[]> {
  return db.getAllAsync<DayEvent>('SELECT * FROM DayEvent WHERE day >= ? ORDER BY at ASC', [sinceDay]);
}

export async function deleteDayEvent(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM DayEvent WHERE id = ?', [id]);
}

// ───────────────────────── Sigara sayacı ─────────────────────────

export async function addSmokeLog(db: SQLiteDatabase, day: string, at: Date): Promise<SmokeLog> {
  const log: SmokeLog = { id: newId('smk'), day, at: at.toISOString() };
  await db.runAsync('INSERT INTO SmokeLog (id, day, at) VALUES (?, ?, ?)', [log.id, log.day, log.at]);
  return log;
}

export async function listSmokeLogs(db: SQLiteDatabase, day: string): Promise<SmokeLog[]> {
  return db.getAllAsync<SmokeLog>('SELECT * FROM SmokeLog WHERE day = ? ORDER BY at ASC', [day]);
}

export async function listSmokeLogsSince(db: SQLiteDatabase, sinceDay: string): Promise<SmokeLog[]> {
  return db.getAllAsync<SmokeLog>('SELECT * FROM SmokeLog WHERE day >= ? ORDER BY at ASC', [sinceDay]);
}

export async function deleteSmokeLog(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM SmokeLog WHERE id = ?', [id]);
}

// ───────────────────────── Dil çalışması ─────────────────────────

export async function addStudyLog(
  db: SQLiteDatabase,
  day: string,
  kind: StudyKind,
  minutes: number,
  at: Date
): Promise<StudyLog> {
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m < 1 || m > 600) throw new Error('Süre 1 ile 600 dakika arasında olmalı.');
  const log: StudyLog = { id: newId('std'), day, kind, minutes: m, loggedAt: at.toISOString() };
  await db.runAsync('INSERT INTO StudyLog (id, day, kind, minutes, loggedAt) VALUES (?, ?, ?, ?, ?)', [
    log.id,
    log.day,
    log.kind,
    log.minutes,
    log.loggedAt,
  ]);
  return log;
}

export async function listStudyLogs(db: SQLiteDatabase, day: string): Promise<StudyLog[]> {
  return db.getAllAsync<StudyLog>('SELECT * FROM StudyLog WHERE day = ? ORDER BY loggedAt ASC', [day]);
}

export async function listStudyLogsSince(db: SQLiteDatabase, sinceDay: string): Promise<StudyLog[]> {
  return db.getAllAsync<StudyLog>('SELECT * FROM StudyLog WHERE day >= ? ORDER BY loggedAt ASC', [sinceDay]);
}

export async function deleteStudyLog(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM StudyLog WHERE id = ?', [id]);
}

// ───────────────────────── Ruh hali ─────────────────────────

/** Günün ruh halini yazar; aynı gün tekrar yazılırsa günceller. `note` verilmezse eski not korunur. */
export async function setMoodLog(
  db: SQLiteDatabase,
  day: string,
  mood: MoodValue,
  at: Date,
  note?: string | null
): Promise<MoodLog> {
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) throw new Error('Ruh hali 1 ile 5 arasında olmalı.');
  const current = await db.getFirstAsync<MoodLog>('SELECT * FROM MoodLog WHERE day = ?', [day]);
  const cleaned = note === undefined ? (current?.note ?? null) : note && note.trim() ? note.trim().slice(0, 280) : null;
  const log: MoodLog = { day, mood, note: cleaned, updatedAt: at.toISOString() };
  await db.runAsync(
    `INSERT INTO MoodLog (day, mood, note, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET mood = excluded.mood, note = excluded.note, updatedAt = excluded.updatedAt`,
    [log.day, log.mood, log.note, log.updatedAt]
  );
  return log;
}

export async function getMoodLog(db: SQLiteDatabase, day: string): Promise<MoodLog | null> {
  return db.getFirstAsync<MoodLog>('SELECT * FROM MoodLog WHERE day = ?', [day]);
}

export async function listMoodLogsSince(db: SQLiteDatabase, sinceDay: string): Promise<MoodLog[]> {
  return db.getAllAsync<MoodLog>('SELECT * FROM MoodLog WHERE day >= ? ORDER BY day ASC', [sinceDay]);
}

export async function deleteMoodLog(db: SQLiteDatabase, day: string): Promise<void> {
  await db.runAsync('DELETE FROM MoodLog WHERE day = ?', [day]);
}

/**
 * Bir rutinin o günkü, bir göreve bağlı olmayan "yapıldı" kayıtlarını siler (sonradan işareti geri almak için).
 * Göreve bağlı kayıtlara dokunulmaz. Silinen kayıt sayısını döndürür.
 */
export async function deleteManualRoutineDoneLogs(db: SQLiteDatabase, routineId: string, day: string): Promise<number> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM RoutineLog WHERE routineId = ? AND day = ? AND outcome = 'DONE' AND taskId IS NULL`,
    [routineId, day]
  );
  if (rows.length === 0) return 0;
  await db.runAsync(`DELETE FROM RoutineLog WHERE routineId = ? AND day = ? AND outcome = 'DONE' AND taskId IS NULL`, [
    routineId,
    day,
  ]);
  return rows.length;
}

// ───────────────────────── Kelime defteri ─────────────────────────

export async function insertVocab(db: SQLiteDatabase, card: VocabCard): Promise<void> {
  await db.runAsync(
    `INSERT INTO Vocab (id, word, meaning, note, box, dueDay, lastDay, seen, known, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [card.id, card.word, card.meaning, card.note, card.box, card.dueDay, card.lastDay, card.seen, card.known, card.createdAt]
  );
}

export async function listVocab(db: SQLiteDatabase): Promise<VocabCard[]> {
  return db.getAllAsync<VocabCard>('SELECT * FROM Vocab ORDER BY createdAt DESC, rowid DESC');
}

export async function getVocab(db: SQLiteDatabase, id: string): Promise<VocabCard | null> {
  return db.getFirstAsync<VocabCard>('SELECT * FROM Vocab WHERE id = ?', [id]);
}

export async function saveVocabProgress(
  db: SQLiteDatabase,
  id: string,
  p: Pick<VocabCard, 'box' | 'dueDay' | 'lastDay' | 'seen' | 'known'>
): Promise<void> {
  await db.runAsync('UPDATE Vocab SET box = ?, dueDay = ?, lastDay = ?, seen = ?, known = ? WHERE id = ?', [
    p.box,
    p.dueDay,
    p.lastDay,
    p.seen,
    p.known,
    id,
  ]);
}

export async function updateVocabText(
  db: SQLiteDatabase,
  id: string,
  t: Pick<VocabCard, 'word' | 'meaning' | 'note'>
): Promise<void> {
  await db.runAsync('UPDATE Vocab SET word = ?, meaning = ?, note = ? WHERE id = ?', [t.word, t.meaning, t.note, id]);
}

export async function deleteVocab(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM Vocab WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Kilo kaydı ve akşam günlüğü (günde bir kayıt; aynı gün tekrar yazılırsa güncellenir)
// ---------------------------------------------------------------------------

export async function setWeightLog(db: SQLiteDatabase, day: string, kg: number, at: Date): Promise<WeightLog> {
  const log: WeightLog = { day, kg: Math.round(kg * 10) / 10, updatedAt: at.toISOString() };
  await db.runAsync(
    `INSERT INTO WeightLog (day, kg, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET kg = excluded.kg, updatedAt = excluded.updatedAt`,
    [log.day, log.kg, log.updatedAt]
  );
  return log;
}

export async function listWeightLogs(db: SQLiteDatabase): Promise<WeightLog[]> {
  return db.getAllAsync<WeightLog>('SELECT day, kg, updatedAt FROM WeightLog ORDER BY day ASC');
}

export async function deleteWeightLog(db: SQLiteDatabase, day: string): Promise<void> {
  await db.runAsync('DELETE FROM WeightLog WHERE day = ?', [day]);
}

export async function saveJournalEntry(
  db: SQLiteDatabase,
  day: string,
  fields: { good: string; grateful: string; goal: string },
  at: Date
): Promise<JournalEntry> {
  const entry: JournalEntry = { day, good: fields.good, grateful: fields.grateful, goal: fields.goal, updatedAt: at.toISOString() };
  await db.runAsync(
    `INSERT INTO Journal (day, good, grateful, goal, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET good = excluded.good, grateful = excluded.grateful, goal = excluded.goal, updatedAt = excluded.updatedAt`,
    [entry.day, entry.good, entry.grateful, entry.goal, entry.updatedAt]
  );
  return entry;
}

export async function getJournalEntry(db: SQLiteDatabase, day: string): Promise<JournalEntry | null> {
  return db.getFirstAsync<JournalEntry>('SELECT * FROM Journal WHERE day = ?', [day]);
}

export async function listJournalSince(db: SQLiteDatabase, sinceDay: string): Promise<JournalEntry[]> {
  return db.getAllAsync<JournalEntry>('SELECT * FROM Journal WHERE day >= ? ORDER BY day ASC', [sinceDay]);
}

export async function deleteJournalEntry(db: SQLiteDatabase, day: string): Promise<void> {
  await db.runAsync('DELETE FROM Journal WHERE day = ?', [day]);
}
