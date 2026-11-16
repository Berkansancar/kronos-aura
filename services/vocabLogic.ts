/**
 * Kelime defteri: aralıklı tekrar (Leitner kutuları). Saf mantık; veritabanından bağımsız, terminalde test edilebilir.
 *
 * Kutular 0..5. Bilinen kart bir üst kutuya çıkar ve daha geç tekrar edilir; "tekrar göreceğim" denen kart iki kutu
 * geri düşer (hepsini sıfırlamaz). Hiçbir cevap yargılayıcı değildir: unutmak öğrenmenin normal parçasıdır.
 */
import type { VocabCard } from '../database/types';
import { dayKey, parseDayKey } from './activityLogic';

/** Kutuya göre bir sonraki tekrara kaç gün var (kutu 0: bir sonraki seansta yine çıkar). */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35] as const;
export const LEARNED_BOX = 5;
export const SESSION_LIMIT = 12;
export const MAX_WORD = 60;
export const MAX_MEANING = 120;
export const MAX_NOTE = 160;

export const normalizeText = (s: string): string => s.replace(/\s+/g, ' ').trim();
const key = (s: string): string => normalizeText(s).toLocaleLowerCase('tr-TR');

export function validateCard(word: string, meaning: string, note?: string | null): string | null {
  const w = normalizeText(word);
  const m = normalizeText(meaning);
  if (!w) return 'Kelime boş olamaz.';
  if (!m) return 'Anlamı boş olamaz.';
  if (w.length > MAX_WORD) return `Kelime en çok ${MAX_WORD} karakter olabilir.`;
  if (m.length > MAX_MEANING) return `Anlam en çok ${MAX_MEANING} karakter olabilir.`;
  if (note && normalizeText(note).length > MAX_NOTE) return `Not en çok ${MAX_NOTE} karakter olabilir.`;
  return null;
}

export function isDuplicate(cards: VocabCard[], word: string, exceptId?: string): boolean {
  const k = key(word);
  return cards.some((c) => c.id !== exceptId && key(c.word) === k);
}

function addDaysKey(today: string, days: number): string {
  const d = parseDayKey(today);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

export interface CardProgress {
  box: number;
  dueDay: string;
  lastDay: string;
  seen: number;
  known: number;
}

/** Bir cevaptan sonra kartın yeni durumu. */
export function answerCard(card: Pick<VocabCard, 'box' | 'seen' | 'known'>, known: boolean, today: string): CardProgress {
  const box = known ? Math.min(LEARNED_BOX, card.box + 1) : Math.max(0, card.box - 2);
  return {
    box,
    dueDay: addDaysKey(today, BOX_DAYS[box]),
    lastDay: today,
    seen: card.seen + 1,
    known: card.known + (known ? 1 : 0),
  };
}

export const isDue = (card: Pick<VocabCard, 'dueDay'>, today: string): boolean => card.dueDay <= today;
export const isLearned = (card: Pick<VocabCard, 'box'>): boolean => card.box >= LEARNED_BOX;

/** Bugün tekrar edilecek kartlar: en zayıf kutular önce, sonra en eski tekrar günü. */
export function dueCards(cards: VocabCard[], today: string, limit = SESSION_LIMIT): VocabCard[] {
  return cards
    .filter((c) => isDue(c, today))
    .sort((a, b) => a.box - b.box || a.dueDay.localeCompare(b.dueDay) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, limit));
}

export interface VocabStats {
  total: number;
  due: number;
  learned: number;
  inProgress: number;
  addedToday: number;
}

export function vocabStats(cards: VocabCard[], today: string): VocabStats {
  const learned = cards.filter(isLearned).length;
  return {
    total: cards.length,
    due: cards.filter((c) => isDue(c, today)).length,
    learned,
    inProgress: cards.length - learned,
    addedToday: cards.filter((c) => dayKey(new Date(c.createdAt)) === today).length,
  };
}

/** Kutu göstergesi: ●●●○○ (5 nokta; öğrenilen hepsi dolu). */
export function boxDots(box: number): string {
  const n = Math.max(0, Math.min(5, Math.round(box)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

// ───────────────────────── Seans ─────────────────────────

export interface SessionState {
  queue: string[];
  /** Seansta "tekrar göreceğim" denen kartlar (bir kez sona eklenir) */
  requeued: string[];
  index: number;
  knownCount: number;
  againCount: number;
}

export function startSession(cards: VocabCard[], today: string, limit = SESSION_LIMIT): SessionState {
  return { queue: dueCards(cards, today, limit).map((c) => c.id), requeued: [], index: 0, knownCount: 0, againCount: 0 };
}

export const sessionCurrent = (s: SessionState): string | null => s.queue[s.index] ?? null;
export const sessionDone = (s: SessionState): boolean => s.index >= s.queue.length;

/**
 * Cevabı işler ve sonraki karta geçer. "Tekrar göreceğim" denen kart aynı seansın sonuna bir kez daha eklenir;
 * ikinci seferde de bilinmezse tekrar eklenmez (seans sonsuza uzamasın, kart zaten yarın yine çıkar).
 */
export function sessionAnswer(s: SessionState, known: boolean): SessionState {
  const id = sessionCurrent(s);
  if (id === null) return s;
  const next: SessionState = { ...s, index: s.index + 1 };
  if (known) next.knownCount = s.knownCount + 1;
  else {
    next.againCount = s.againCount + 1;
    if (!s.requeued.includes(id)) {
      next.queue = [...s.queue, id];
      next.requeued = [...s.requeued, id];
    }
  }
  return next;
}

/** Seansta geçen süre (dk): ölçülen süre, en az 1, en çok 30. */
export function sessionMinutes(startMs: number, endMs: number): number {
  const m = Math.round((endMs - startMs) / 60_000);
  return Math.max(1, Math.min(30, m));
}
