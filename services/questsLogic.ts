/**
 * Haftalık görevler (Kahraman): her hafta (Pazartesi–Pazar) 3 küçük, gerçekçi hedef. Saf mantık.
 *
 * Her şey geçmişten türetilir: görev seçimi haftaya göre sabittir (aynı hafta hep aynı 3 görev), ilerleme o haftanın
 * günlerinden hesaplanır, tamamlanan görevin XP'si toplam XP'ye eklenir. Kayıtlı tek şey, görevlerin hangi haftadan
 * başladığıdır (`questsStart`): böylece güncelleme sonrası eski haftalar için birden bonus yağmaz, seviye atlamaz.
 *
 * Görev bir ceza değildir: tamamlanmayan görev puan düşürmez, yalnızca yeni hafta yeni görevlerle başlar.
 */
import type { GameDay, GameGoals } from './gameLogic';
import { goldOf } from './gameLogic';

const DAY_MS = 86_400_000;

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Günün ait olduğu haftanın Pazartesi'si (yyyy-mm-dd). */
export function weekStartOf(day: string): string {
  const d = parse(day);
  const back = (d.getDay() + 6) % 7; // Pazartesi=0 … Pazar=6
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

export const weekEndOf = (weekStart: string): string => {
  const d = parse(weekStart);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6));
};

export const shiftWeek = (weekStart: string, delta: number): string => {
  const d = parse(weekStart);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * delta));
};

/** Hafta numarası (Pazartesi'ler arası sıra); tohum için. */
export function weekIndex(weekStart: string): number {
  const d = parse(weekStart);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS / 7);
}

// ───────────────────────── Görev havuzu ─────────────────────────

export type QuestFamily = 'routine' | 'lang' | 'tasks' | 'water' | 'mood' | 'active';

export interface QuestDef {
  id: string;
  family: QuestFamily;
  icon: string;
  title: string;
  target: number;
  /** İlerleme birimi ("gün", "dk", ...) */
  unit: string;
  xp: number;
  eligible: (goals: GameGoals) => boolean;
  progress: (week: GameDay[], goals: GameGoals) => number;
}

const countDays = (week: GameDay[], f: (d: GameDay) => boolean): number => week.filter(f).length;
const sum = (week: GameDay[], f: (d: GameDay) => number): number => week.reduce((a, d) => a + f(d), 0);

export const QUEST_POOL: QuestDef[] = [
  { id: 'routine-days', family: 'routine', icon: '🔁', title: 'Bu hafta 5 gün en az bir rutin yap', target: 5, unit: 'gün', xp: 40, eligible: () => true, progress: (w) => countDays(w, (d) => d.routinesDone > 0) },
  { id: 'routine-count', family: 'routine', icon: '✅', title: 'Bu hafta 12 rutin tamamla', target: 12, unit: 'rutin', xp: 40, eligible: () => true, progress: (w) => sum(w, (d) => d.routinesDone) },
  { id: 'lang-days', family: 'lang', icon: '🗣️', title: 'Bu hafta 3 gün dil çalış', target: 3, unit: 'gün', xp: 30, eligible: () => true, progress: (w) => countDays(w, (d) => (d.languageMinutes ?? 0) > 0) },
  { id: 'lang-minutes', family: 'lang', icon: '📚', title: 'Bu hafta toplam 90 dk dil çalış', target: 90, unit: 'dk', xp: 40, eligible: () => true, progress: (w) => sum(w, (d) => d.languageMinutes ?? 0) },
  { id: 'tasks', family: 'tasks', icon: '💪', title: 'Bu hafta 8 iş bitir', target: 8, unit: 'iş', xp: 40, eligible: () => true, progress: (w) => sum(w, (d) => d.tasksDone) },
  { id: 'water-days', family: 'water', icon: '💧', title: 'Su hedefini bu hafta 4 gün tamamla', target: 4, unit: 'gün', xp: 30, eligible: (g) => g.waterGoalMl !== null, progress: (w, g) => (g.waterGoalMl === null ? 0 : countDays(w, (d) => d.waterMl !== null && d.waterMl >= (g.waterGoalMl as number))) },
  { id: 'mood-days', family: 'mood', icon: '🙂', title: 'Bu hafta 4 gün ruh halini yaz', target: 4, unit: 'gün', xp: 20, eligible: () => true, progress: (w) => countDays(w, (d) => d.moodLogged === true) },
  { id: 'active-days', family: 'active', icon: '🌿', title: 'Bu hafta 5 gün bir şey yap (iş, rutin ya da dil)', target: 5, unit: 'gün', xp: 30, eligible: () => true, progress: (w) => countDays(w, (d) => d.tasksDone > 0 || d.routinesDone > 0 || (d.languageMinutes ?? 0) > 0) },
];

export const QUESTS_PER_WEEK = 3;
const FAMILIES: QuestFamily[] = ['routine', 'lang', 'tasks', 'water', 'mood', 'active'];

/** Küçük, deterministik rastgele sayı üreteci (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Haftanın 3 görevi: aynı hafta ve aynı hedefler için hep aynı; her biri farklı bir aileden. */
export function questsForWeek(weekStart: string, goals: GameGoals): QuestDef[] {
  const rand = rng(weekIndex(weekStart) * 2654435761);
  const order = [...FAMILIES];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: QuestDef[] = [];
  for (const family of order) {
    const variants = QUEST_POOL.filter((q) => q.family === family && q.eligible(goals));
    if (variants.length === 0) continue;
    out.push(variants[Math.floor(rand() * variants.length)]);
    if (out.length === QUESTS_PER_WEEK) break;
  }
  return out;
}

// ───────────────────────── İlerleme ve ödül ─────────────────────────

export interface QuestProgress {
  id: string;
  icon: string;
  title: string;
  unit: string;
  target: number;
  progress: number;
  ratio: number;
  done: boolean;
  xp: number;
}

export interface QuestWeek {
  weekStart: string;
  weekEnd: string;
  quests: QuestProgress[];
  completed: number;
  /** Bu haftanın tamamlanan görevlerinden gelen XP */
  xp: number;
  /** Bu hafta ödüle sayılıyor mu (görevlerin başladığı haftadan itibaren) */
  counts: boolean;
}

export function evaluateWeek(weekStart: string, days: GameDay[], goals: GameGoals, today: string, counts: boolean): QuestWeek {
  const end = weekEndOf(weekStart);
  const week = days.filter((d) => d.day >= weekStart && d.day <= end && d.day <= today);
  const quests = questsForWeek(weekStart, goals).map<QuestProgress>((q) => {
    const progress = Math.max(0, q.progress(week, goals));
    return {
      id: q.id,
      icon: q.icon,
      title: q.title,
      unit: q.unit,
      target: q.target,
      progress,
      ratio: Math.min(1, progress / q.target),
      done: progress >= q.target,
      xp: q.xp,
    };
  });
  const done = quests.filter((q) => q.done);
  return { weekStart, weekEnd: end, quests, completed: done.length, xp: counts ? done.reduce((a, q) => a + q.xp, 0) : 0, counts };
}

export interface QuestsSummary {
  current: QuestWeek;
  /** Görevlerin başladığı hafta (Pazartesi) */
  startWeek: string;
  /** Başlangıçtan bu yana tüm haftalardan gelen bonus XP / altın / tamamlanan görev */
  totalXp: number;
  totalGold: number;
  totalCompleted: number;
  /** Son 4 haftanın özeti (eskiden yeniye; süren hafta dahil) */
  recent: QuestWeek[];
}

/**
 * `questsStart`: görevlerin başladığı haftanın Pazartesi'si. Yoksa süren haftadan başlar (geçmişe bonus verilmez).
 * `today`: bugünün gün anahtarı (mantıksal gün).
 */
export function buildQuests(days: GameDay[], goals: GameGoals, questsStart: string | undefined, today: string): QuestsSummary {
  const curStart = weekStartOf(today);
  const start = questsStart && /^\d{4}-\d{2}-\d{2}$/.test(questsStart) ? weekStartOf(questsStart) : curStart;
  const first = start > curStart ? curStart : start;
  let totalXp = 0;
  let totalCompleted = 0;
  const weeks: QuestWeek[] = [];
  for (let w = first; w <= curStart; w = shiftWeek(w, 1)) {
    const ev = evaluateWeek(w, days, goals, today, true);
    totalXp += ev.xp;
    totalCompleted += ev.completed;
    weeks.push(ev);
  }
  const current = weeks[weeks.length - 1];
  return { current, startWeek: first, totalXp, totalGold: goldOf(totalXp), totalCompleted, recent: weeks.slice(-4) };
}

/** Haftalık özet cümlesi: yargısız, teşvik edici. */
export function questLine(w: QuestWeek, todayIsLastDay = false): string {
  if (w.completed === w.quests.length && w.quests.length > 0) return 'Bu haftanın tüm görevleri tamam. Harikasın!';
  if (w.completed > 0) return `${w.completed} görev tamam, ${w.quests.length - w.completed} görev kaldı.`;
  return todayIsLastDay
    ? 'Hafta bitiyor; tamamlanmayan görev kaybolmaz, yeni hafta yeni görevler getirir.'
    : 'Küçük adımlarla ilerle; hafta boyunca vaktin var.';
}
