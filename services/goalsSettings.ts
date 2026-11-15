/**
 * Hedef ayarları ve vücut profili (telefonun güvenli deposunda; internet gerekmez).
 * Boy, kilo ve yaş hassas veridir: yalnızca bu telefonda durur, hiçbir yapay zekâ isteğine eklenmez.
 */
import * as SecureStore from 'expo-secure-store';
import {
  parseBody,
  parseGoals,
  serializeGoals,
  type BodyProfile,
  type GoalSettings,
} from './goalsLogic';
import { getKcalTarget, getWaterGoal } from './nutritionSettings';

const K_GOALS = 'goals_v1';
const K_BODY = 'body_profile';

export async function getGoals(): Promise<GoalSettings> {
  try {
    return parseGoals(await SecureStore.getItemAsync(K_GOALS));
  } catch {
    return parseGoals(null);
  }
}

/** Verilen alanları günceller, diğerlerine dokunmaz. */
export async function saveGoals(patch: Partial<GoalSettings>): Promise<GoalSettings> {
  const next = { ...(await getGoals()), ...patch };
  await SecureStore.setItemAsync(K_GOALS, serializeGoals(next));
  return parseGoals(serializeGoals(next));
}

export async function getBody(): Promise<BodyProfile | null> {
  try {
    return parseBody(await SecureStore.getItemAsync(K_BODY));
  } catch {
    return null;
  }
}

export async function saveBody(p: BodyProfile): Promise<void> {
  await SecureStore.setItemAsync(K_BODY, JSON.stringify(p));
}

export async function clearBody(): Promise<void> {
  await SecureStore.deleteItemAsync(K_BODY);
}

/** Ekranların tek seferde ihtiyaç duyduğu hedef paketi. */
export async function getGoalBundle(): Promise<{ settings: GoalSettings; waterGoalMl: number; kcalTarget: number | null }> {
  return { settings: await getGoals(), waterGoalMl: await getWaterGoal(), kcalTarget: await getKcalTarget() };
}
