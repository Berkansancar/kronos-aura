/**
 * Egzersiz durumunu veritabanındaki Setting tablosunda saklar. Yedeğe kendiliğinden dahildir
 * (Setting tablosu yedeklenir), yeni tablo ya da veritabanı sürümü gerekmez.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { dayKey } from './activityLogic';
import type { Level, MoveId } from './exerciseData';
import {
  EXERCISE_KEY,
  parseState,
  recordSession,
  serializeState,
  setLevel,
  type ExerciseState,
  type LevelUp,
  type SessionItem,
} from './exerciseLogic';

export async function loadExercise(db: SQLiteDatabase): Promise<ExerciseState> {
  return parseState(await getSetting(db, EXERCISE_KEY));
}

export async function saveExerciseSession(
  db: SQLiteDatabase,
  items: SessionItem[],
  now: Date = new Date()
): Promise<{ state: ExerciseState; levelUps: LevelUp[] }> {
  const current = await loadExercise(db);
  const res = recordSession(current, dayKey(now), items);
  if (res.state !== current) await setSetting(db, EXERCISE_KEY, serializeState(res.state));
  return res;
}

export async function chooseExerciseLevel(db: SQLiteDatabase, move: MoveId, level: Level): Promise<ExerciseState> {
  const next = setLevel(await loadExercise(db), move, level);
  await setSetting(db, EXERCISE_KEY, serializeState(next));
  return next;
}

/** Durumu okuyup verilen işlevle değiştirir ve kaydeder (gün, güne başlama saati, hatırlatma ayarları için). */
export async function updateExercise(db: SQLiteDatabase, change: (s: ExerciseState) => ExerciseState): Promise<ExerciseState> {
  const next = change(await loadExercise(db));
  await setSetting(db, EXERCISE_KEY, serializeState(next));
  return next;
}
