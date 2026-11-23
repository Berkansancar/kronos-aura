/**
 * Su, içecek ve yemek ekranındaki simgeler (saf veri). Su bardağı ve şişeler services/waterIcon.ts'te
 * çizilir; burada emojiler var. Yalnızca eski telefonlarda da görünen emojiler seçildi (en yeni sürüm: Emoji 11).
 */
import type { MealKind } from '../database/types';
import type { FoodGroupId } from './foodTable';

export const MEAL_ICON: Record<MealKind, string> = {
  KAHVALTI: '🍳',
  OGLE: '🍽️',
  AKSAM: '🍲',
  ARA: '🍪',
  ICECEK: '🥤',
};

export const DRINK_ICON: Record<string, string> = {
  cay: '🍵',
  kahve: '☕',
  sekerli: '🥤',
};

export const FOOD_GROUP_ICON: Record<FoodGroupId, string> = {
  SEBZE: '🥗',
  MEYVE: '🍎',
  PROTEIN: '🍗',
  TAHIL: '🍞',
  SUT: '🥛',
  KURUYEMIS: '🥜',
  TATLI: '🍰',
  KIZARTMA: '🍟',
  SEKERLI_ICECEK: '🥤',
  KAFEIN: '☕',
};

export const mealIcon = (k: MealKind): string => MEAL_ICON[k] ?? '🍽️';
export const groupIcon = (id: string): string => FOOD_GROUP_ICON[id as FoodGroupId] ?? '🍽️';
export const drinkIcon = (id: string): string => DRINK_ICON[id] ?? '🥤';
