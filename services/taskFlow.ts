/**
 * Kullanıcı eylemleri: görevi başlat, bitir, ertele, geri al, "zaman akıp gitti" notu düş.
 * Her eylem veritabanını günceller ve gerekirse Kronos'a günü yeniden planlatır.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addTimeLog,
  createTask,
  deleteTask,
  pauseOtherInProgress,
  setTaskStatus,
} from '../database/repository';
import type { CognitiveWeight, EnergyState, Task } from '../database/types';
import { buildCompletionNotes, buildDriftNote } from './coachEngine';
import { replanDay } from './planner';
import { recordRoutineDoneFromTask } from './routineFlow';

export async function addTask(
  db: SQLiteDatabase,
  input: { title: string; estimatedDuration: number; cognitiveWeight: CognitiveWeight },
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

/** Görevi bitirir, gerçek süreyi ve enerji durumunu TimeLog'a yazar, kalan günü yeniden dizer. */
export async function completeTask(
  db: SQLiteDatabase,
  task: Task,
  energy: EnergyState,
  now: Date = new Date()
): Promise<void> {
  const actual = task.startedAt
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
    loggedAt: now,
  });
  await setTaskStatus(db, task.id, 'COMPLETED', now);
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
