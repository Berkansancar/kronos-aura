/** Sakin Mod'un veritabanı işlemleri (ayarlar, gün enerjisi, geri sayım, adımlar, başlama günleri). Mantık: services/calmLogic.ts */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting, setTaskStatus } from '../database/repository';
import type { EnergyState, Task } from '../database/types';
import { dayKey } from './activityLogic';
import {
  CALM_ENERGY_KEY,
  CALM_PREFS_KEY,
  CALM_STARTS_KEY,
  CALM_TIMER_KEY,
  addStartDay,
  newTimer,
  parseDayEnergy,
  parsePrefs,
  parseStartDays,
  parseSteps,
  parseTimer,
  serializeDayEnergy,
  serializePrefs,
  serializeSteps,
  serializeTimer,
  startsInWindow,
  stepsKey,
  type CalmPrefs,
  type CalmStep,
  type CalmTimer,
  type DayEnergy,
  type TimerKind,
} from './calmLogic';
import { planningDay, replanDay } from './planner';
import { completeTask, startTask } from './taskFlow';

const deleteKey = (db: SQLiteDatabase, key: string) => db.runAsync('DELETE FROM Setting WHERE key = ?', [key]);

// ───────────────────────── Rahatlık ayarları ─────────────────────────

export async function getCalmPrefs(db: SQLiteDatabase): Promise<CalmPrefs> {
  return parsePrefs(await getSetting(db, CALM_PREFS_KEY).catch(() => null));
}

export async function saveCalmPrefs(db: SQLiteDatabase, prefs: CalmPrefs): Promise<CalmPrefs> {
  // Kayıttan önce temizlenir: bozuk bir değer asla yazılmaz
  const clean = parsePrefs(serializePrefs(prefs));
  await setSetting(db, CALM_PREFS_KEY, serializePrefs(clean));
  return clean;
}

// ───────────────────────── Gün enerjisi ─────────────────────────

/** Planın gününe (gece geç saatte "yarın") ait enerji seçimi; seçilmediyse null. */
export async function getDayEnergy(db: SQLiteDatabase, now: Date): Promise<DayEnergy | null> {
  return parseDayEnergy(await getSetting(db, CALM_ENERGY_KEY).catch(() => null), dayKey(planningDay(now)));
}

export async function setDayEnergy(db: SQLiteDatabase, energy: DayEnergy, now: Date): Promise<void> {
  await setSetting(db, CALM_ENERGY_KEY, serializeDayEnergy(dayKey(planningDay(now)), energy));
}

// ───────────────────────── Geri sayım ─────────────────────────

/** Kayıtlı sayaç; bozuksa ya da eskimişse silinir ve null döner. */
export async function getTimer(db: SQLiteDatabase, nowMs: number): Promise<CalmTimer | null> {
  const raw = await getSetting(db, CALM_TIMER_KEY).catch(() => null);
  if (raw === null) return null;
  const timer = parseTimer(raw, nowMs);
  if (!timer) await deleteKey(db, CALM_TIMER_KEY).catch(() => undefined);
  return timer;
}

export async function clearTimer(db: SQLiteDatabase): Promise<void> {
  await deleteKey(db, CALM_TIMER_KEY);
}

// ───────────────────────── Adımlar ─────────────────────────

export async function getTaskSteps(db: SQLiteDatabase, taskId: string): Promise<CalmStep[]> {
  return parseSteps(await getSetting(db, stepsKey(taskId)).catch(() => null));
}

/** Adım listesi boşsa kayıt silinir. */
export async function saveTaskSteps(db: SQLiteDatabase, taskId: string, steps: CalmStep[]): Promise<void> {
  if (steps.length === 0) await deleteKey(db, stepsKey(taskId));
  else await setSetting(db, stepsKey(taskId), serializeSteps(steps));
}

// ───────────────────────── Yumuşak ilerleme ─────────────────────────

/** Son 7 günde (bugün dahil) kaç gün bir işe başlanmış. */
export async function getWeekStarts(db: SQLiteDatabase, now: Date): Promise<number> {
  const days = parseStartDays(await getSetting(db, CALM_STARTS_KEY).catch(() => null));
  return startsInWindow(days, dayKey(now), 7);
}

async function recordStart(db: SQLiteDatabase, now: Date): Promise<void> {
  const days = parseStartDays(await getSetting(db, CALM_STARTS_KEY).catch(() => null));
  await setSetting(db, CALM_STARTS_KEY, JSON.stringify(addStartDay(days, dayKey(now))));
}

// ───────────────────────── Eylemler ─────────────────────────

/**
 * Süreyi başlatır ("sadece 2 dakika" ya da 10 dakika odak). Görev henüz başlamamışsa "başladı" olur;
 * zaten başlamışsa (süre uzatma) yeniden başlatılmaz, böylece gerçek süre bozulmaz. Başlanan gün kaydedilir.
 */
export async function beginFocus(db: SQLiteDatabase, task: Task, kind: TimerKind, now: Date): Promise<CalmTimer> {
  if (task.status === 'PENDING') await startTask(db, task, now);
  const timer = newTimer(task.id, kind, now.getTime());
  await setSetting(db, CALM_TIMER_KEY, serializeTimer(timer));
  await recordStart(db, now);
  return timer;
}

/** "Burada bırakıyorum": sayaç kapanır, iş bekleyene döner. Hiçbir şey kaçırılmış sayılmaz. */
export async function leaveFocus(db: SQLiteDatabase, task: Task, now: Date): Promise<void> {
  await clearTimer(db);
  if (task.status === 'IN_PROGRESS') {
    await setTaskStatus(db, task.id, 'PENDING', now);
    await replanDay(db, now, 'MANUAL');
  }
}

/** "Bitirdim": iş tamamlanır, sayaç ve adımlar temizlenir. */
export async function finishFocus(db: SQLiteDatabase, task: Task, energy: EnergyState, now: Date): Promise<void> {
  await completeTask(db, task, energy, now);
  await clearTimer(db);
  await saveTaskSteps(db, task.id, []);
}
