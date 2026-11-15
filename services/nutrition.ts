/**
 * Su ve yemek kayıtlarını veritabanından okuyup yazar; analiz mantığı services/nutritionLogic.ts içindedir.
 * Ayarlar (su hedefi, kalori hedefi) burada değil, services/nutritionSettings.ts içindedir; böylece bu dosya
 * terminalde de test edilebilir.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addMealLog,
  addWaterLog,
  deleteMealLog,
  deleteWaterLog,
  getOrCreateUser,
  listMealLogs,
  listWaterLogs,
} from '../database/repository';
import type { MealKind, MealLog, WaterLog } from '../database/types';
import {
  DRINK_PRESETS,
  analyzeNutrition,
  minuteInDay,
  nutritionDay,
  type DayNutrition,
  type NutritionFacts,
} from './nutritionLogic';

export interface NutritionOptions {
  waterGoalMl: number;
  kcalTarget: number | null;
}

export async function gatherNutritionFacts(
  db: SQLiteDatabase,
  now: Date,
  opts: NutritionOptions,
  day: string = nutritionDay(now)
): Promise<NutritionFacts> {
  const user = await getOrCreateUser(db);
  const water = await listWaterLogs(db, day);
  const meals = await listMealLogs(db, day);
  return {
    day,
    now,
    waterGoalMl: opts.waterGoalMl,
    kcalTarget: opts.kcalTarget,
    water: water.map((w) => ({ ml: w.amountMl, minute: minuteInDay(new Date(w.loggedAt), day) })),
    meals: meals.map((m) => ({
      kind: m.kind,
      minute: minuteInDay(new Date(m.eatenAt), day),
      groups: m.groups,
      kcal: m.kcal,
    })),
    peakStartHour: user.peakStartHour,
    peakEndHour: user.peakEndHour,
  };
}

export async function loadDayNutrition(
  db: SQLiteDatabase,
  now: Date,
  opts: NutritionOptions,
  day: string = nutritionDay(now)
): Promise<DayNutrition> {
  return analyzeNutrition(await gatherNutritionFacts(db, now, opts, day));
}

export async function loadDayLogs(
  db: SQLiteDatabase,
  day: string
): Promise<{ water: WaterLog[]; meals: MealLog[] }> {
  return { water: await listWaterLogs(db, day), meals: await listMealLogs(db, day) };
}

export async function addWater(db: SQLiteDatabase, now: Date, ml: number): Promise<WaterLog> {
  return addWaterLog(db, nutritionDay(now), ml, now);
}

export interface MealInput {
  kind: MealKind;
  note: string;
  groups: string[];
  kcal: number | null;
  /** Kaç dakika önce yendi (0 = şimdi) */
  minutesAgo?: number;
}

export async function addMeal(db: SQLiteDatabase, now: Date, m: MealInput): Promise<MealLog> {
  const at = new Date(now.getTime() - Math.max(0, m.minutesAgo ?? 0) * 60000);
  return addMealLog(db, {
    day: nutritionDay(at),
    kind: m.kind,
    note: m.note,
    groups: m.groups,
    kcal: m.kcal,
    eatenAt: at,
  });
}

/** Tek dokunuşla çay, kahve ya da şekerli içecek kaydı. */
export async function addDrink(db: SQLiteDatabase, now: Date, presetId: string): Promise<MealLog | null> {
  const p = DRINK_PRESETS.find((d) => d.id === presetId);
  if (!p) return null;
  return addMeal(db, now, { kind: 'ICECEK', note: p.note, groups: p.groups, kcal: p.kcal });
}

export async function removeWater(db: SQLiteDatabase, id: string): Promise<void> {
  await deleteWaterLog(db, id);
}

export async function removeMeal(db: SQLiteDatabase, id: string): Promise<void> {
  await deleteMealLog(db, id);
}
