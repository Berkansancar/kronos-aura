/**
 * Egzersiz takibinin saf mantığı: durum (basamaklar ve seans geçmişi), kayıt, basamak atlama,
 * haftalık sayı ve ana ekran satırı. React Native'e bağlı değildir; terminalde test edilir.
 */
import { dayKey, parseDayKey } from './activityLogic';
import { EXERCISES, EXERCISE_BY_ID, SESSIONS_PER_WEEK, type ExerciseVariant, type Level, type MoveId } from './exerciseData';

export interface SessionItem {
  move: MoveId;
  level: Level;
  /** Yapılan her setin tekrar sayısı (tutuş hareketlerinde saniye). Bacak hareketlerinde her bacak için. */
  sets: number[];
}

export interface SessionRecord {
  day: string;
  items: SessionItem[];
}

export interface ExerciseState {
  levels: Record<MoveId, Level>;
  sessions: SessionRecord[];
}

export interface LevelUp {
  move: MoveId;
  from: Level;
  to: Level;
}

export const EXERCISE_KEY = 'exercise_v1';
const MAX_SESSIONS = 60;
const MOVE_IDS: MoveId[] = EXERCISES.map((m) => m.id);

export function defaultState(): ExerciseState {
  const levels = {} as Record<MoveId, Level>;
  for (const id of MOVE_IDS) levels[id] = 1;
  return { levels, sessions: [] };
}

const isLevel = (n: unknown): n is Level => n === 1 || n === 2 || n === 3;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Kayıtlı metni okur; bozuk ya da eski veri varsa güvenle varsayılana düşer. */
export function parseState(raw: string | null): ExerciseState {
  const base = defaultState();
  if (!raw) return base;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof o !== 'object' || o === null) return base;
  const obj = o as { levels?: Record<string, unknown>; sessions?: unknown };
  if (obj.levels && typeof obj.levels === 'object') {
    for (const id of MOVE_IDS) {
      const v = obj.levels[id];
      if (isLevel(v)) base.levels[id] = v;
    }
  }
  if (Array.isArray(obj.sessions)) {
    for (const s of obj.sessions) {
      if (typeof s !== 'object' || s === null) continue;
      const rec = s as { day?: unknown; items?: unknown };
      if (!isDay(rec.day) || !Array.isArray(rec.items)) continue;
      const items: SessionItem[] = [];
      for (const it of rec.items) {
        if (typeof it !== 'object' || it === null) continue;
        const x = it as { move?: unknown; level?: unknown; sets?: unknown };
        if (typeof x.move !== 'string' || !MOVE_IDS.includes(x.move as MoveId) || !isLevel(x.level) || !Array.isArray(x.sets)) continue;
        const sets = x.sets.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 999).map((n) => Math.round(n));
        items.push({ move: x.move as MoveId, level: x.level, sets });
      }
      base.sessions.push({ day: rec.day, items });
    }
    base.sessions = base.sessions.slice(-MAX_SESSIONS);
  }
  return base;
}

export function serializeState(s: ExerciseState): string {
  return JSON.stringify({ v: 1, levels: s.levels, sessions: s.sessions.slice(-MAX_SESSIONS) });
}

export function variantFor(move: MoveId, level: Level): ExerciseVariant {
  return EXERCISE_BY_ID[move].variants[level - 1];
}

/** Tüm setler tamamlandı ve hepsi üst sınıra ulaştı mı? Öyleyse bir üst basamağa geçilir. */
export function qualifiesForLevelUp(v: ExerciseVariant, sets: number[]): boolean {
  return sets.length >= v.sets && sets.every((n) => n >= v.max);
}

export function setLevel(state: ExerciseState, move: MoveId, level: Level): ExerciseState {
  return { ...state, levels: { ...state.levels, [move]: level } };
}

/**
 * Seansı kaydeder ve üst basamağa hak kazanan hareketleri bir üst basamağa taşır.
 * Aynı gün ikinci kayıt varsa aynı günün kaydına eklenir (hareket başına son sonuç geçerli olur).
 */
export function recordSession(state: ExerciseState, day: string, items: SessionItem[]): { state: ExerciseState; levelUps: LevelUp[] } {
  const clean = items.filter((it) => it.sets.length > 0);
  if (clean.length === 0) return { state, levelUps: [] };
  const levels = { ...state.levels };
  const levelUps: LevelUp[] = [];
  for (const it of clean) {
    const v = variantFor(it.move, it.level);
    // Yalnızca şu anki basamakta yapılan çalışma basamak atlatır
    if (levels[it.move] === it.level && it.level < 3 && qualifiesForLevelUp(v, it.sets)) {
      levels[it.move] = (it.level + 1) as Level;
      levelUps.push({ move: it.move, from: it.level, to: levels[it.move] });
    }
  }
  const sessions = state.sessions.slice();
  const idx = sessions.findIndex((s) => s.day === day);
  if (idx >= 0) {
    const merged = sessions[idx].items.filter((old) => !clean.some((n) => n.move === old.move)).concat(clean);
    sessions[idx] = { day, items: merged };
  } else {
    sessions.push({ day, items: clean });
    sessions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
  return { state: { levels, sessions: sessions.slice(-MAX_SESSIONS) }, levelUps };
}

/** Haftanın Pazartesi günü (yerel). */
export function weekStartKey(d: Date): string {
  const wd = (d.getDay() + 6) % 7; // Pzt=0 ... Paz=6
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
  return dayKey(start);
}

/** Bu haftaki (Pzt-Paz) seans günü sayısı. */
export function sessionsThisWeek(state: ExerciseState, today: Date): number {
  const start = weekStartKey(today);
  const end = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6 - ((today.getDay() + 6) % 7)));
  return new Set(state.sessions.filter((s) => s.day >= start && s.day <= end).map((s) => s.day)).size;
}

export function lastSessionDay(state: ExerciseState): string | null {
  return state.sessions.length ? state.sessions[state.sessions.length - 1].day : null;
}

/** Son seansın bugünden kaç gün önce olduğu (bugün = 0). Hiç seans yoksa null. */
export function daysSinceLast(state: ExerciseState, today: Date): number | null {
  const last = lastSessionDay(state);
  if (!last) return null;
  const a = parseDayKey(dayKey(today)).getTime();
  const b = parseDayKey(last).getTime();
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** Bir hareketin en son kaydı (geçen sefer kaç yaptığını göstermek için). */
export function lastResult(state: ExerciseState, move: MoveId): { day: string; item: SessionItem } | null {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const item = state.sessions[i].items.find((it) => it.move === move);
    if (item) return { day: state.sessions[i].day, item };
  }
  return null;
}

/** Bugün için kısa öneri. Araya dinlenme günü koymayı hatırlatır. */
export function todayAdvice(state: ExerciseState, today: Date): string {
  const since = daysSinceLast(state, today);
  if (since === null) return 'İlk seansını yapmaya hazırsın. Hafif başla, her sette 1-3 tekrar kalmış olsun.';
  if (since === 0) return 'Bugünkü seans tamam. Dinlen, yarın dinlenme günü olsun.';
  if (since === 1) return 'Dün çalıştın. Bugün dinlenmen iyi olur; kaslar ve sinirler toparlansın.';
  return 'Dinlendin, bugün seans yapabilirsin.';
}

/** Ana ekran kutusu için tek satır. */
export function tileLine(state: ExerciseState, today: Date): string {
  const n = sessionsThisWeek(state, today);
  if (state.sessions.length === 0) return 'Ekipmansız güç programı: çizimli hareketler ve seans takibi';
  const done = daysSinceLast(state, today) === 0;
  return `Bu hafta ${Math.min(n, 99)}/${SESSIONS_PER_WEEK} seans${done ? ' · bugün yapıldı' : ''}`;
}

/** "5-5-4-4" ya da "20-18-15 sn" gibi set özeti. */
export function setsLine(v: ExerciseVariant, sets: number[]): string {
  if (sets.length === 0) return '-';
  return sets.join('-') + (v.unit === 'sec' ? ' sn' : '');
}

/** Hedef satırı: "4 set x 3-5 tekrar (her bacak)". */
export function targetLine(v: ExerciseVariant): string {
  const unit = v.unit === 'sec' ? 'sn' : 'tekrar';
  const side = v.perSide ? ' (her taraf)' : '';
  return `${v.sets} set x ${v.min}-${v.max} ${unit}${side}`;
}

/** Seans özeti: "3 hareket, 12 set". */
export function sessionSummary(rec: SessionRecord): string {
  const sets = rec.items.reduce((n, it) => n + it.sets.length, 0);
  return `${rec.items.length} hareket, ${sets} set`;
}
