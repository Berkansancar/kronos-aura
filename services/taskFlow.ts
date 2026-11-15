/**
 * Kullanıcı eylemleri: görevi başlat, bitir, ertele, geri al, "zaman akıp gitti" notu düş.
 * Her eylem veritabanını günceller ve gerekirse Kronos'a günü yeniden planlatır.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addTaskOutcome,
  addTimeLog,
  createTask,
  deleteTask,
  getTask,
  listUncarriedMisses,
  markOutcomeCarried,
  pauseOtherInProgress,
  setTaskStatus,
  setTaskWorkOk,
} from '../database/repository';
import type { CognitiveWeight, EnergyState, Task, TaskOutcomeKind, TaskOutcomeReason } from '../database/types';
import { buildCompletionNotes, buildDriftNote } from './coachEngine';
import { dayKey } from './activityLogic';
import { nutritionDay } from './nutritionLogic';
import { planningDay, replanDay } from './planner';
import { recordRoutineDoneFromTask } from './routineFlow';

export async function addTask(
  db: SQLiteDatabase,
  input: { title: string; estimatedDuration: number; cognitiveWeight: CognitiveWeight; workOk?: boolean },
  now: Date = new Date()
): Promise<void> {
  await createTask(db, input);
  await replanDay(db, now, 'TASK_ADDED');
}

export async function startTask(db: SQLiteDatabase, task: Task, now: Date = new Date()): Promise<void> {
  await pauseOtherInProgress(db, task.id);
  await setTaskStatus(db, task.id, 'IN_PROGRESS', now);
  await replanDay(db, now, 'MANUAL');
}

/**
 * Görevi bitirir ("Yaptım"), gerçek süreyi ve enerji durumunu TimeLog'a yazar, kalan günü yeniden dizer.
 * `opts.loggedAt`: gün sonunda geriye dönük işaretlerken kaydın düşeceği an; `opts.minutes`: süreyi elle ver.
 */
export async function completeTask(
  db: SQLiteDatabase,
  task: Task,
  energy: EnergyState,
  now: Date = new Date(),
  opts: { loggedAt?: Date; minutes?: number } = {}
): Promise<void> {
  const loggedAt = opts.loggedAt ?? now;
  const actual =
    opts.minutes !== undefined
      ? Math.max(1, Math.round(opts.minutes))
      : task.startedAt
        ? Math.max(1, Math.round((now.getTime() - new Date(task.startedAt).getTime()) / 60_000))
        : task.estimatedDuration;

  await addTimeLog(db, {
    taskId: task.id,
    actualDuration: actual,
    energyStateAtCompletion: energy,
    coachNotes: buildCompletionNotes({
      estimated: task.estimatedDuration,
      actual,
      energy,
    }),
    loggedAt,
  });
  await setTaskStatus(db, task.id, 'COMPLETED', now);
  await addTaskOutcome(db, {
    taskId: task.id,
    title: task.title,
    day: nutritionDay(loggedAt),
    outcome: 'DONE',
    minutes: actual,
    workOk: task.workOk === true,
    at: loggedAt,
  });
  await recordRoutineDoneFromTask(db, task, now);
  await replanDay(db, now, 'TASK_COMPLETED');
}

export async function postponeTasks(
  db: SQLiteDatabase,
  taskIds: string[],
  now: Date = new Date()
): Promise<void> {
  for (const id of taskIds) await setTaskStatus(db, id, 'POSTPONED', now);
  await replanDay(db, now, 'TASK_POSTPONED');
}

export async function restoreTask(db: SQLiteDatabase, taskId: string, now: Date = new Date()): Promise<void> {
  await setTaskStatus(db, taskId, 'PENDING', now);
  await replanDay(db, now, 'MANUAL');
}

export async function removeTask(db: SQLiteDatabase, taskId: string, now: Date = new Date()): Promise<void> {
  await deleteTask(db, taskId);
  await replanDay(db, now, 'MANUAL');
}

/** Aura: "zaman akıp gitti" hissini suçlamadan veriye çevirir. */
export async function logDrift(
  db: SQLiteDatabase,
  minutes: number,
  now: Date = new Date()
): Promise<void> {
  await addTimeLog(db, {
    taskId: null,
    actualDuration: minutes,
    energyStateAtCompletion: 'DISTRACTED',
    coachNotes: buildDriftNote(minutes),
    loggedAt: now,
  });
}

/**
 * "Yapmadım" (bugün yapmamayı seçti) ya da "Yapamadım" (olmadı). Sonuç kaydedilir, görev bugünün planından çıkar
 * ve ertesi gün kendiliğinden plana geri döner (bkz. carryOverMissed).
 */
export async function markTaskMissed(
  db: SQLiteDatabase,
  task: Task,
  outcome: Exclude<TaskOutcomeKind, 'DONE'>,
  reason: TaskOutcomeReason | null,
  now: Date = new Date(),
  opts: { at?: Date } = {}
): Promise<void> {
  const at = opts.at ?? now;
  await addTaskOutcome(db, {
    taskId: task.id,
    title: task.title,
    day: nutritionDay(at),
    outcome,
    reason,
    workOk: task.workOk === true,
    at,
  });
  await setTaskStatus(db, task.id, 'POSTPONED', now);
  await replanDay(db, now, 'TASK_POSTPONED');
}

/**
 * Dün (ya da daha önce) "yapmadım / yapamadım" denen görevleri yeni günün planına geri alır; her kayıt bir kez.
 * Kullanıcı o arada görevi silmişse ya da kendisi plana almışsa dokunulmaz. Uygulama her yüklendiğinde güvenle çağrılır.
 */
export async function carryOverMissed(db: SQLiteDatabase, now: Date = new Date()): Promise<string[]> {
  // Plan yarına geçtiği (22:00) andan itibaren dünün eksikleri yarının planına döner
  const misses = await listUncarriedMisses(db, dayKey(planningDay(now)));
  const carried: string[] = [];
  for (const m of misses) {
    if (!m.taskId) continue;
    const task = await getTask(db, m.taskId);
    if (task && task.status === 'POSTPONED') {
      await setTaskStatus(db, task.id, 'PENDING', now);
      carried.push(task.title);
    }
    await markOutcomeCarried(db, m.id);
  }
  if (carried.length > 0) await replanDay(db, now, 'MANUAL');
  return carried;
}

/** Görevin "iş vaktinde yapılabilir" işaretini değiştirir ve günü yeniden planlar. */
export async function toggleWorkOk(db: SQLiteDatabase, task: Task, now: Date = new Date()): Promise<void> {
  await setTaskWorkOk(db, task.id, !task.workOk);
  await replanDay(db, now, 'MANUAL');
}

/**
 * Gün içinde ekleyemediği, ama yaptığı bir işi akşam geriye dönük ekler (zaten "Yaptım" sayılır).
 * `loggedAt` verilmezse şimdi; gece yarısından sonra değerlendirilen gün için günün sonunu ver.
 */
export async function addDoneTask(
  db: SQLiteDatabase,
  input: { title: string; minutes: number; energy: EnergyState; workOk?: boolean },
  now: Date = new Date(),
  loggedAt?: Date
): Promise<void> {
  const task = await createTask(db, {
    title: input.title,
    estimatedDuration: input.minutes,
    cognitiveWeight: 'MEDIUM',
    workOk: input.workOk,
  });
  await completeTask(db, task, input.energy, now, { loggedAt, minutes: input.minutes });
}
