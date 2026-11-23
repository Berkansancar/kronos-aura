/**
 * "Etki" ekranı için veriyi toplar: egzersiz seansları, su kayıtları, dil çalışması ve (varsa) kilo.
 * Mantık services/effectsLogic.ts içindedir. Yeni tablo gerekmez; her şey zaten kayıtlı verilerden hesaplanır.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listWaterLogsSince } from '../database/repository';
import { dayKey } from './activityLogic';
import { buildEffects, type EffectView } from './effectsLogic';
import { loadExercise } from './exercise';
import { getBody } from './goalsSettings';
import { languageForDays } from './language';
import { getWaterGoal } from './nutritionSettings';
import { windowKeys } from './weeklyLogic';

/** Seri ve aşamalar için bakılan en uzun geçmiş (gün): 12 haftalık aşamadan biraz fazla */
export const EFFECT_HISTORY_DAYS = 120;

export async function loadEffects(db: SQLiteDatabase, now: Date = new Date()): Promise<EffectView[]> {
  const today = dayKey(now);
  const keys = windowKeys(today, EFFECT_HISTORY_DAYS);
  const [exercise, waterLogs, waterGoalMl, body, lang] = await Promise.all([
    loadExercise(db),
    listWaterLogsSince(db, keys[0]),
    getWaterGoal(),
    getBody().catch(() => null),
    languageForDays(db, keys).catch(() => []),
  ]);
  return buildEffects({
    exercise,
    water: waterLogs.map((w) => ({ day: w.day, ml: w.amountMl })),
    waterGoalMl,
    study: lang.map((d) => ({ day: d.day, minutes: d.summary.total })),
    today,
    weightKg: body ? body.weightKg : null,
  });
}
