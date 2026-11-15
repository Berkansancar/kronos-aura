/** Su ve kalori hedefi ayarları (telefonun güvenli deposunda; internet gerekmez). */
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_WATER_GOAL, KCAL_TARGET_MAX, KCAL_TARGET_MIN, type TargetCheck, validateKcalTarget } from './nutritionLogic';
import type { NutritionOptions } from './nutrition';

const K_WATER_GOAL = 'water_goal_ml';
const K_KCAL_TARGET = 'kcal_target';

export async function getWaterGoal(): Promise<number> {
  try {
    const n = Number(await SecureStore.getItemAsync(K_WATER_GOAL));
    return Number.isFinite(n) && n >= 500 && n <= 6000 ? Math.round(n) : DEFAULT_WATER_GOAL;
  } catch {
    return DEFAULT_WATER_GOAL;
  }
}

export async function setWaterGoal(ml: number): Promise<void> {
  await SecureStore.setItemAsync(K_WATER_GOAL, String(Math.round(ml)));
}

/** Kalori hedefi isteğe bağlıdır; boşsa null (hiçbir yerde hedef gösterilmez). */
export async function getKcalTarget(): Promise<number | null> {
  try {
    const n = Number(await SecureStore.getItemAsync(K_KCAL_TARGET));
    return Number.isFinite(n) && n >= KCAL_TARGET_MIN && n <= KCAL_TARGET_MAX ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** Girişi doğrular, geçerliyse kaydeder (boş = hedefi kapat). */
export async function saveKcalTarget(input: string): Promise<TargetCheck> {
  const check = validateKcalTarget(input);
  if (!check.ok) return check;
  if (check.value === null) await SecureStore.deleteItemAsync(K_KCAL_TARGET);
  else await SecureStore.setItemAsync(K_KCAL_TARGET, String(check.value));
  return check;
}

export async function getNutritionOptions(): Promise<NutritionOptions> {
  return { waterGoalMl: await getWaterGoal(), kcalTarget: await getKcalTarget() };
}
