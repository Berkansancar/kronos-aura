/** Kelime defteri için veritabanı bağlantısı (mantık vocabLogic'te). */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  deleteVocab,
  getVocab,
  insertVocab,
  listVocab,
  saveVocabProgress,
  updateVocabText,
} from '../database/repository';
import type { VocabCard } from '../database/types';
import { newId } from '../database/ids';
import { addStudy } from './language';
import {
  answerCard,
  isDuplicate,
  normalizeText,
  sessionMinutes,
  validateCard,
  vocabStats,
  type VocabStats,
} from './vocabLogic';
import { nutritionDay as logicalDay } from './nutritionLogic';

export interface VocabScreenData {
  cards: VocabCard[];
  stats: VocabStats;
  today: string;
}

export async function loadVocab(db: SQLiteDatabase, now: Date): Promise<VocabScreenData> {
  const cards = await listVocab(db);
  const today = logicalDay(now);
  return { cards, stats: vocabStats(cards, today), today };
}

export type AddVocabResult = { ok: true; card: VocabCard } | { ok: false; error: string };

/** Yeni kelime ekler. Aynı kelime (büyük/küçük harf fark etmez) ikinci kez eklenmez. */
export async function addVocab(
  db: SQLiteDatabase,
  word: string,
  meaning: string,
  note: string | null,
  now: Date
): Promise<AddVocabResult> {
  const error = validateCard(word, meaning, note);
  if (error) return { ok: false, error };
  const existing = await listVocab(db);
  if (isDuplicate(existing, word)) return { ok: false, error: 'Bu kelime zaten defterinde.' };
  const card: VocabCard = {
    id: newId('voc'),
    word: normalizeText(word),
    meaning: normalizeText(meaning),
    note: note && normalizeText(note) ? normalizeText(note) : null,
    box: 0,
    dueDay: logicalDay(now),
    lastDay: null,
    seen: 0,
    known: 0,
    createdAt: now.toISOString(),
  };
  await insertVocab(db, card);
  return { ok: true, card };
}

export async function editVocab(
  db: SQLiteDatabase,
  id: string,
  word: string,
  meaning: string,
  note: string | null
): Promise<AddVocabResult> {
  const error = validateCard(word, meaning, note);
  if (error) return { ok: false, error };
  const existing = await listVocab(db);
  if (isDuplicate(existing, word, id)) return { ok: false, error: 'Bu kelime zaten defterinde.' };
  await updateVocabText(db, id, {
    word: normalizeText(word),
    meaning: normalizeText(meaning),
    note: note && normalizeText(note) ? normalizeText(note) : null,
  });
  const card = await getVocab(db, id);
  if (!card) return { ok: false, error: 'Kelime bulunamadı.' };
  return { ok: true, card };
}

export const removeVocab = (db: SQLiteDatabase, id: string): Promise<void> => deleteVocab(db, id);

/** Kartı "biliyordum" / "tekrar göreceğim" ile işaretler ve bir sonraki tekrar gününü kaydeder. */
export async function answerVocab(db: SQLiteDatabase, id: string, known: boolean, now: Date): Promise<VocabCard | null> {
  const card = await getVocab(db, id);
  if (!card) return null;
  const progress = answerCard(card, known, logicalDay(now));
  await saveVocabProgress(db, id, progress);
  return { ...card, ...progress };
}

/**
 * Seans bitince süreyi dil çalışması olarak kaydeder ("Dinleme / konuşma" kalemine; ayrı bir tür olmadığı için).
 * Süre ölçülen süredir (en az 1, en çok 30 dk). Hiç kart çalışılmadıysa kayıt yapılmaz.
 */
export async function logVocabSession(
  db: SQLiteDatabase,
  answered: number,
  startMs: number,
  endMs: number,
  now: Date
): Promise<number> {
  if (answered <= 0) return 0;
  const minutes = sessionMinutes(startMs, endMs);
  await addStudy(db, 'OTHER', minutes, now);
  return minutes;
}

