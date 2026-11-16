/**
 * Oyunlaştırma (Habitica benzeri; saf mantık, test edilebilir).
 *
 * XP, seviye, altın, seri ve rozetler mevcut kayıtlardan TÜRETİLİR (ayrı bir puan tablosu yok): bir işi geri
 * alırsan puanı da kendiliğinden geri gider, eski kayıtların puanı da sayılır. Yalnızca ödül listesi ve satın
 * almalar ayarlarda tutulur. Puan kaybı / ceza yoktur: Aura yargılamaz. Seri, bir günlük boşlukla bozulmaz.
 */
import { formatDuration } from './format';

export const GAME_SETTING_KEY = 'game_v1';
export const GAME_SEEN_KEY = 'game_seen_v1';
/** Puanın hesaplandığı geçmiş (gün) */
export const GAME_DAYS = 730;

/** Bir günün oyun için gereken özeti (geçmiş ekranındaki günlerden gelir) */
export interface GameDay {
  day: string;
  tasksDone: number;
  taskMinutes: number;
  routinesDone: number;
  waterMl: number | null;
  languageMinutes?: number | null;
  /** O gün ruh hali yazıldı mı (haftalık görevler için) */
  moodLogged?: boolean;
}

export interface GameGoals {
  waterGoalMl: number | null;
  languageGoalMin: number | null;
}

export const TASK_XP = 10;
export const TASK_MINUTES_PER_XP = 5;
export const TASK_MINUTES_CAP = 480;
export const ROUTINE_XP = 5;
export const ROUTINE_XP_CAP = 50;
export const WATER_XP = 10;
export const LANG_MINUTES_PER_XP = 2;
export const LANG_MINUTES_CAP = 60;
export const LANG_GOAL_XP = 10;

export interface XpPart {
  label: string;
  xp: number;
}

export interface DayXp {
  day: string;
  xp: number;
  gold: number;
  parts: XpPart[];
}

export const goldOf = (xp: number): number => Math.floor(xp / 2);

export function dayXp(d: GameDay, goals: GameGoals): DayXp {
  const parts: XpPart[] = [];
  if (d.tasksDone > 0) {
    parts.push({
      label: `${d.tasksDone} iş`,
      xp: d.tasksDone * TASK_XP + Math.floor(Math.min(d.taskMinutes, TASK_MINUTES_CAP) / TASK_MINUTES_PER_XP),
    });
  }
  if (d.routinesDone > 0) parts.push({ label: `${d.routinesDone} rutin`, xp: Math.min(ROUTINE_XP_CAP, d.routinesDone * ROUTINE_XP) });
  if (goals.waterGoalMl !== null && d.waterMl !== null && d.waterMl >= goals.waterGoalMl) parts.push({ label: 'Su hedefi', xp: WATER_XP });
  const lang = d.languageMinutes ?? 0;
  if (lang > 0) {
    parts.push({ label: `Dil ${formatDuration(lang)}`, xp: Math.floor(Math.min(lang, LANG_MINUTES_CAP) / LANG_MINUTES_PER_XP) });
    if (goals.languageGoalMin !== null && lang >= goals.languageGoalMin) parts.push({ label: 'Dil hedefi', xp: LANG_GOAL_XP });
  }
  const xp = parts.reduce((a, p) => a + p.xp, 0);
  return { day: d.day, xp, gold: goldOf(xp), parts };
}

/** `level` seviyesinden bir sonrakine geçmek için gereken XP */
export const xpForLevel = (level: number): number => 100 + 50 * (level - 1);
export const MAX_LEVEL = 99;

export interface LevelInfo {
  level: number;
  /** Bu seviyede biriken XP */
  into: number;
  /** Sonraki seviye için gereken XP */
  needed: number;
  ratio: number;
  totalXp: number;
}

export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level += 1;
  }
  const needed = xpForLevel(level);
  return { level, into: rest, needed, ratio: Math.min(1, rest / needed), totalXp: Math.max(0, Math.floor(totalXp)) };
}

export interface Rank {
  icon: string;
  title: string;
}

const RANKS: { min: number; rank: Rank }[] = [
  { min: 20, rank: { icon: '🐉', title: 'Efsane' } },
  { min: 15, rank: { icon: '👑', title: 'Üstat' } },
  { min: 10, rank: { icon: '🛡️', title: 'Usta' } },
  { min: 6, rank: { icon: '🗺️', title: 'Kâşif' } },
  { min: 3, rank: { icon: '🧭', title: 'Yolcu' } },
  { min: 1, rank: { icon: '🌱', title: 'Çaylak' } },
];

export function rankOf(level: number): Rank {
  return (RANKS.find((r) => level >= r.min) ?? RANKS[RANKS.length - 1]).rank;
}

export interface Streak {
  current: number;
  best: number;
}

/**
 * Seri: puan kazanılan günlerin zinciri. İki aktif gün arasında EN FAZLA BİR boş gün olabilir (dinlenme günü),
 * zincir bozulmaz. Bugün henüz bitmediği için bugün boşsa seriyi bozmaz. `active` eskiden yeniye, sonuncusu bugün.
 */
export function computeStreak(active: boolean[]): Streak {
  const n = active.length;
  let current = 0;
  let i = n - 1;
  if (i >= 0 && !active[i]) i -= 1;
  let gap = 0;
  for (; i >= 0; i -= 1) {
    if (active[i]) {
      current += 1;
      gap = 0;
    } else {
      gap += 1;
      if (gap >= 2) break;
    }
  }
  let best = 0;
  let run = 0;
  gap = 0;
  for (let k = 0; k < n; k += 1) {
    if (active[k]) {
      run += 1;
      gap = 0;
      best = Math.max(best, run);
    } else {
      gap += 1;
      if (gap >= 2) run = 0;
    }
  }
  return { current, best: Math.max(best, current) };
}

// ---- Ödüller ----

export interface Reward {
  id: string;
  title: string;
  price: number;
}

export interface Purchase {
  id: string;
  rewardId: string;
  title: string;
  price: number;
  at: string;
}

export interface GameState {
  rewards: Reward[];
  purchases: Purchase[];
  /** Listeden eskiyen satın almaların toplam altını (bakiye doğru kalsın) */
  spentTrimmed: number;
  /** Haftalık görevlerin başladığı haftanın Pazartesi'si (yyyy-mm-dd); geçmişe bonus verilmesin diye saklanır */
  questsStart?: string;
}

export const EMPTY_GAME_STATE: GameState = { rewards: [], purchases: [], spentTrimmed: 0 };
export const MAX_REWARDS = 20;
export const MAX_PURCHASES = 100;
export const MAX_REWARD_PRICE = 1000;
export const REWARD_TITLE_MAX = 40;

export const REWARD_SUGGESTIONS: { title: string; price: number }[] = [
  { title: 'Kahve / çay molası', price: 10 },
  { title: 'Bir tatlı', price: 25 },
  { title: '30 dk dizi', price: 30 },
  { title: '1 saat oyun', price: 50 },
];

export function parseGameState(raw: string | null): GameState {
  if (!raw) return { rewards: [], purchases: [], spentTrimmed: 0 };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const num = (v: unknown, lo: number, hi: number): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, REWARD_TITLE_MAX) : null);
    const rewards: Reward[] = [];
    for (const r of Array.isArray(o.rewards) ? o.rewards : []) {
      const x = r as Record<string, unknown>;
      const price = num(x.price, 1, MAX_REWARD_PRICE);
      const title = str(x.title);
      if (typeof x.id === 'string' && title && price !== null && rewards.length < MAX_REWARDS) rewards.push({ id: x.id, title, price });
    }
    const purchases: Purchase[] = [];
    for (const p of Array.isArray(o.purchases) ? o.purchases : []) {
      const x = p as Record<string, unknown>;
      const price = num(x.price, 0, MAX_REWARD_PRICE);
      const title = str(x.title);
      if (typeof x.id === 'string' && typeof x.rewardId === 'string' && typeof x.at === 'string' && title && price !== null) {
        purchases.push({ id: x.id, rewardId: x.rewardId, title, price, at: x.at });
      }
    }
    const questsStart = typeof o.questsStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.questsStart) ? o.questsStart : undefined;
    return {
      rewards,
      purchases: purchases.slice(-MAX_PURCHASES),
      spentTrimmed: num(o.spentTrimmed, 0, 10_000_000) ?? 0,
      ...(questsStart ? { questsStart } : {}),
    };
  } catch {
    return { rewards: [], purchases: [], spentTrimmed: 0 };
  }
}

export const serializeGameState = (s: GameState): string => JSON.stringify(s);

export const spentTotal = (s: GameState): number => s.spentTrimmed + s.purchases.reduce((a, p) => a + p.price, 0);

export class GameError extends Error {}

export function addReward(s: GameState, title: string, price: number, id: string): GameState {
  const t = title.trim().slice(0, REWARD_TITLE_MAX);
  if (t.length === 0) throw new GameError('Ödülün adını yaz.');
  if (!Number.isFinite(price) || price < 1 || price > MAX_REWARD_PRICE) throw new GameError(`Fiyat 1 ile ${MAX_REWARD_PRICE} altın arasında olmalı.`);
  if (s.rewards.length >= MAX_REWARDS) throw new GameError(`En çok ${MAX_REWARDS} ödül olabilir.`);
  if (s.rewards.some((r) => r.title.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr'))) throw new GameError('Bu ödül zaten listede.');
  return { ...s, rewards: [...s.rewards, { id, title: t, price: Math.round(price) }] };
}

export function removeReward(s: GameState, id: string): GameState {
  return { ...s, rewards: s.rewards.filter((r) => r.id !== id) };
}

export function buyReward(s: GameState, rewardId: string, balance: number, purchaseId: string, now: Date): GameState {
  const r = s.rewards.find((x) => x.id === rewardId);
  if (!r) throw new GameError('Ödül bulunamadı.');
  if (balance < r.price) throw new GameError(`Yetmiyor: ${r.price} altın gerekiyor, ${balance} altının var.`);
  let purchases = [...s.purchases, { id: purchaseId, rewardId: r.id, title: r.title, price: r.price, at: now.toISOString() }];
  let trimmed = s.spentTrimmed;
  while (purchases.length > MAX_PURCHASES) {
    trimmed += purchases[0].price;
    purchases = purchases.slice(1);
  }
  return { ...s, purchases, spentTrimmed: trimmed };
}

/** Satın almayı geri alır; altın geri döner. */
export function refundPurchase(s: GameState, purchaseId: string): GameState {
  return { ...s, purchases: s.purchases.filter((p) => p.id !== purchaseId) };
}

// ---- Rozetler ----

export interface Badge {
  id: string;
  icon: string;
  title: string;
  hint: string;
  earned: boolean;
}

export interface BadgeStats {
  tasks: number;
  routines: number;
  waterDays: number;
  languageMinutes: number;
  bestStreak: number;
  level: number;
  /** Tamamlanan haftalık görev sayısı */
  quests?: number;
}

export function buildBadges(st: BadgeStats): Badge[] {
  const out: Badge[] = [];
  const add = (id: string, icon: string, title: string, hint: string, earned: boolean) => out.push({ id, icon, title, hint, earned });
  add('task-1', '🌟', 'İlk adım', 'İlk işini bitir', st.tasks >= 1);
  add('task-10', '✅', '10 iş', '10 iş bitir', st.tasks >= 10);
  add('task-50', '💪', '50 iş', '50 iş bitir', st.tasks >= 50);
  add('task-100', '🏅', '100 iş', '100 iş bitir', st.tasks >= 100);
  add('task-250', '🏆', '250 iş', '250 iş bitir', st.tasks >= 250);
  add('streak-3', '🔥', '3 günlük seri', 'Art arda 3 gün puan kazan', st.bestStreak >= 3);
  add('streak-7', '🔥', '7 günlük seri', 'Art arda 7 gün puan kazan', st.bestStreak >= 7);
  add('streak-14', '🔥', '14 günlük seri', 'Art arda 14 gün puan kazan', st.bestStreak >= 14);
  add('streak-30', '🌋', '30 günlük seri', 'Art arda 30 gün puan kazan', st.bestStreak >= 30);
  add('water-7', '💧', 'Su: 7 gün', 'Su hedefini 7 gün tamamla', st.waterDays >= 7);
  add('water-30', '🌊', 'Su: 30 gün', 'Su hedefini 30 gün tamamla', st.waterDays >= 30);
  add('lang-60', '🗣️', 'Dil: 1 saat', 'Toplam 1 saat dil çalış', st.languageMinutes >= 60);
  add('lang-600', '📚', 'Dil: 10 saat', 'Toplam 10 saat dil çalış', st.languageMinutes >= 600);
  add('lang-3000', '🎓', 'Dil: 50 saat', 'Toplam 50 saat dil çalış', st.languageMinutes >= 3000);
  add('routine-20', '🔁', 'Rutin: 20', '20 rutin tamamla', st.routines >= 20);
  add('quest-1', '🎯', 'İlk görev', 'Bir haftalık görevi tamamla', (st.quests ?? 0) >= 1);
  add('quest-10', '🎖️', '10 görev', '10 haftalık görev tamamla', (st.quests ?? 0) >= 10);
  add('level-5', '⭐', 'Seviye 5', 'Seviye 5\'e ulaş', st.level >= 5);
  add('level-10', '🌠', 'Seviye 10', 'Seviye 10\'a ulaş', st.level >= 10);
  return out;
}

// ---- Özet ----

export interface GameSummary {
  totalXp: number;
  earnedGold: number;
  spentGold: number;
  gold: number;
  levelInfo: LevelInfo;
  level: number;
  rank: Rank;
  streak: Streak;
  today: DayXp;
  /** Son 7 günde kazanılan XP */
  weekXp: number;
  badges: Badge[];
  earnedBadges: number;
  tasksTotal: number;
  /** Haftalık görevlerden gelen toplam XP */
  questXp: number;
}

/** `days` eskiden yeniye; sonuncusu bugün. */
export function buildGame(
  days: GameDay[],
  goals: GameGoals,
  state: GameState,
  quests: { xp: number; completed: number } = { xp: 0, completed: 0 }
): GameSummary {
  const perDay = days.map((d) => dayXp(d, goals));
  const totalXp = perDay.reduce((a, d) => a + d.xp, 0) + quests.xp;
  const earnedGold = perDay.reduce((a, d) => a + d.gold, 0) + goldOf(quests.xp);
  const spentGold = spentTotal(state);
  const levelInfo = levelFromXp(totalXp);
  const streak = computeStreak(perDay.map((d) => d.xp > 0));
  const tasksTotal = days.reduce((a, d) => a + d.tasksDone, 0);
  const badges = buildBadges({
    tasks: tasksTotal,
    routines: days.reduce((a, d) => a + d.routinesDone, 0),
    waterDays: goals.waterGoalMl === null ? 0 : days.filter((d) => d.waterMl !== null && d.waterMl >= (goals.waterGoalMl as number)).length,
    languageMinutes: days.reduce((a, d) => a + (d.languageMinutes ?? 0), 0),
    bestStreak: streak.best,
    level: levelInfo.level,
    quests: quests.completed,
  });
  const today = perDay[perDay.length - 1] ?? { day: '', xp: 0, gold: 0, parts: [] };
  return {
    totalXp,
    earnedGold,
    spentGold,
    gold: Math.max(0, earnedGold - spentGold),
    levelInfo,
    level: levelInfo.level,
    rank: rankOf(levelInfo.level),
    streak,
    today,
    weekXp: perDay.slice(-7).reduce((a, d) => a + d.xp, 0),
    badges,
    earnedBadges: badges.filter((b) => b.earned).length,
    tasksTotal,
    questXp: quests.xp,
  };
}

/** Seviye atlama mesajı; atlama yoksa null. `seen`: en son gösterilen seviye (null: hiç gösterilmedi). */
export function levelUpMessage(seen: number | null, level: number): string | null {
  if (level <= 1 && seen === null) return null;
  if (seen === null) return `Geçmiş kayıtlarınla Seviye ${level} (${rankOf(level).title}) olarak başlıyorsun! ${rankOf(level).icon}`;
  if (level > seen) return `Seviye ${level}! ${rankOf(level).icon} Artık ${rankOf(level).title} unvanındasın.`;
  return null;
}
