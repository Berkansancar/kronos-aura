/** Oyunlaştırma: veriyi okur, ödül listesini ayarlarda saklar. Mantık: services/gameLogic.ts (SecureStore yok). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { newId } from '../database/ids';
import { gatherHistory } from './history';
import {
  GAME_DAYS,
  GAME_SEEN_KEY,
  GAME_SETTING_KEY,
  addReward,
  buildGame,
  buyReward,
  levelUpMessage,
  parseGameState,
  refundPurchase,
  removeReward,
  serializeGameState,
  type GameDay,
  type GameGoals,
  type GameState,
  type GameSummary,
} from './gameLogic';

export interface GameData {
  summary: GameSummary;
  state: GameState;
}

export async function getGameState(db: SQLiteDatabase): Promise<GameState> {
  return parseGameState(await getSetting(db, GAME_SETTING_KEY).catch(() => null));
}

async function saveGameState(db: SQLiteDatabase, s: GameState): Promise<void> {
  await setSetting(db, GAME_SETTING_KEY, serializeGameState(s));
}

export async function loadGame(db: SQLiteDatabase, now: Date, goals: GameGoals): Promise<GameData> {
  const state = await getGameState(db);
  const { days } = await gatherHistory(db, now, GAME_DAYS);
  const gameDays: GameDay[] = days.map((d) => ({
    day: d.day,
    tasksDone: d.tasksDone,
    taskMinutes: d.taskMinutes,
    routinesDone: d.routinesDone,
    waterMl: d.waterMl,
    languageMinutes: d.languageMinutes ?? null,
  }));
  return { summary: buildGame(gameDays, goals, state), state };
}

export async function addGameReward(db: SQLiteDatabase, title: string, price: number): Promise<GameState> {
  const next = addReward(await getGameState(db), title, price, newId('rwd'));
  await saveGameState(db, next);
  return next;
}

export async function deleteGameReward(db: SQLiteDatabase, id: string): Promise<GameState> {
  const next = removeReward(await getGameState(db), id);
  await saveGameState(db, next);
  return next;
}

/** Ödülü satın alır (altın yetmiyorsa GameError fırlatır). */
export async function buyGameReward(db: SQLiteDatabase, rewardId: string, now: Date, goals: GameGoals): Promise<GameData> {
  const cur = await loadGame(db, now, goals);
  const next = buyReward(cur.state, rewardId, cur.summary.gold, newId('pur'), now);
  await saveGameState(db, next);
  return loadGame(db, now, goals);
}

export async function refundGamePurchase(db: SQLiteDatabase, purchaseId: string): Promise<GameState> {
  const next = refundPurchase(await getGameState(db), purchaseId);
  await saveGameState(db, next);
  return next;
}

/** Seviye atlandıysa (ya da ilk kez açıldıysa) bir kez gösterilecek mesaj; gösterildi diye kaydeder. */
export async function takeLevelUp(db: SQLiteDatabase, level: number): Promise<string | null> {
  const raw = await getSetting(db, GAME_SEEN_KEY).catch(() => null);
  const seen = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const msg = levelUpMessage(seen, level);
  if (seen === null || level > seen) await setSetting(db, GAME_SEEN_KEY, String(level)).catch(() => undefined);
  return msg;
}
