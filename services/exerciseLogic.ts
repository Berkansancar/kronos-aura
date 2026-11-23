/**
 * Egzersiz takibinin saf mantığı: durum (basamaklar ve seans geçmişi), kayıt, basamak atlama,
 * haftalık sayı ve ana ekran satırı. React Native'e bağlı değildir; terminalde test edilir.
 */
import { dayKey, parseDayKey } from './activityLogic';
import {
  ALT_REST_SECONDS,
  EXERCISES,
  EXERCISE_BY_ID,
  SESSION_MINUTES,
  WARMUP_MINUTES,
  type ExerciseVariant,
  type Level,
  type MoveId,
} from './exerciseData';

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

/** Haftalık program: hangi günler, güne başlama saati ve hatırlatma. */
export interface ExercisePlan {
  /** Egzersiz günleri; 0 = Pazar ... 6 = Cumartesi (JavaScript getDay). */
  days: number[];
  /** Güne başlama saati, gün başından dakika. Egzersiz bu saatte başlar, 30 dakika sürer. */
  startMin: number;
  /** Egzersiz günlerinde başlama saatinde bildirim gelsin mi? */
  remind: boolean;
}

export interface ExerciseState {
  levels: Record<MoveId, Level>;
  sessions: SessionRecord[];
  plan: ExercisePlan;
}

export interface LevelUp {
  move: MoveId;
  from: Level;
  to: Level;
}

export const EXERCISE_KEY = 'exercise_v1';
const MAX_SESSIONS = 60;
const MOVE_IDS: MoveId[] = EXERCISES.map((m) => m.id);

/** Güne başlama saati için seçenekler (dakika): 05:00 ile 07:00 arası. */
export const START_CHOICES: readonly number[] = [300, 330, 345, 360, 375, 390, 420];
export const DEFAULT_PLAN: ExercisePlan = { days: [1, 3, 5], startMin: 360, remind: true };
export const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
/** Gösterim sırası: Pazartesi'den başlar. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function defaultState(): ExerciseState {
  const levels = {} as Record<MoveId, Level>;
  for (const id of MOVE_IDS) levels[id] = 1;
  return { levels, sessions: [], plan: { ...DEFAULT_PLAN, days: [...DEFAULT_PLAN.days] } };
}

function parsePlan(o: unknown): ExercisePlan {
  const base: ExercisePlan = { ...DEFAULT_PLAN, days: [...DEFAULT_PLAN.days] };
  if (typeof o !== 'object' || o === null) return base;
  const p = o as { days?: unknown; startMin?: unknown; remind?: unknown };
  if (Array.isArray(p.days)) {
    const days = [...new Set(p.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length > 0) base.days = days;
  }
  if (typeof p.startMin === 'number' && Number.isFinite(p.startMin) && p.startMin >= 240 && p.startMin <= 480) base.startMin = Math.round(p.startMin);
  if (typeof p.remind === 'boolean') base.remind = p.remind;
  return base;
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
  const obj = o as { levels?: Record<string, unknown>; sessions?: unknown; plan?: unknown };
  base.plan = parsePlan(obj.plan);
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
  return JSON.stringify({ v: 1, levels: s.levels, sessions: s.sessions.slice(-MAX_SESSIONS), plan: s.plan });
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
  return { state: { levels, sessions: sessions.slice(-MAX_SESSIONS), plan: state.plan }, levelUps };
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

/** Dakikayı "06:00" biçimine çevirir (gün sonunu aşarsa 24 saate sarar). */
export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Egzersiz penceresi: "06:00–06:30". */
export function windowText(plan: ExercisePlan): string {
  return `${clock(plan.startMin)}–${clock(plan.startMin + SESSION_MINUTES)}`;
}

export const isExerciseDay = (plan: ExercisePlan, d: Date): boolean => plan.days.includes(d.getDay());

/** Egzersiz günlerini ekler ya da çıkarır; en az bir gün kalır. */
export function toggleDay(state: ExerciseState, day: number): ExerciseState {
  const has = state.plan.days.includes(day);
  if (has && state.plan.days.length === 1) return state;
  const days = (has ? state.plan.days.filter((d) => d !== day) : [...state.plan.days, day]).sort((a, b) => a - b);
  return { ...state, plan: { ...state.plan, days } };
}

export function setStart(state: ExerciseState, startMin: number): ExerciseState {
  if (!(startMin >= 240 && startMin <= 480)) return state;
  return { ...state, plan: { ...state.plan, startMin: Math.round(startMin) } };
}

export function setRemind(state: ExerciseState, remind: boolean): ExerciseState {
  return { ...state, plan: { ...state.plan, remind } };
}

/** Bugünden sonraki ilk egzersiz günü (bugün dahil değil) ve kaç gün sonra olduğu. */
export function nextExerciseDay(plan: ExercisePlan, today: Date): { offset: number; date: Date } {
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (isExerciseDay(plan, d)) return { offset: i, date: d };
  }
  return { offset: 7, date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7) };
}

export function doneToday(state: ExerciseState, today: Date): boolean {
  return daysSinceLast(state, today) === 0;
}

/** Bugün için kısa öneri. Program günlerine ve yapılıp yapılmadığına bakar. */
export function todayAdvice(state: ExerciseState, today: Date): string {
  const plan = state.plan;
  if (doneToday(state, today)) return 'Bugünkü seans tamam. Dinlen, kaslar bugün toparlanır.';
  if (isExerciseDay(plan, today)) return `Bugün egzersiz günü: ${windowText(plan)}. Hazır olunca seansı başlat.`;
  const next = nextExerciseDay(plan, today);
  const when = next.offset === 1 ? 'yarın' : DAY_NAMES[next.date.getDay()];
  return `Bugün dinlenme günü. Sonraki egzersiz: ${when} ${clock(plan.startMin)}.`;
}

/** Ayarlar ve program ekranı için tek satır. */
export function tileLine(state: ExerciseState, today: Date): string {
  const target = state.plan.days.length;
  const n = Math.min(sessionsThisWeek(state, today), 99);
  const days = WEEK_ORDER.filter((d) => state.plan.days.includes(d)).map((d) => DAY_SHORT[d]).join(' ');
  return `${days} · ${windowText(state.plan)} · bu hafta ${n}/${target}${doneToday(state, today) ? ' · bugün yapıldı' : ''}`;
}

export type MorningCard =
  | { kind: 'TODO'; title: string; sub: string }
  | { kind: 'DONE'; title: string; sub: string };

/**
 * Ana ekrandaki sabah egzersizi kartı. Yalnızca egzersiz gününde ve 05:00-12:00 arasında görünür;
 * yapıldıysa "tamam" kartına döner. Diğer zamanlarda null (menüde yer almaz).
 */
export function morningCard(state: ExerciseState, now: Date, hardDay = false): MorningCard | null {
  if (now.getHours() < 5 || now.getHours() >= 12) return null;
  if (!isExerciseDay(state.plan, now)) return null;
  if (doneToday(state, now)) return { kind: 'DONE', title: 'Sabah egzersizi tamam', sub: 'Bugün dinlen; sıradaki seans programda.' };
  if (hardDay) return null;
  const mins = estimateMinutes(state.levels);
  return {
    kind: 'TODO',
    title: `Sabah egzersizi · ${windowText(state.plan)}`,
    sub: `Bacak, itme, çekme, arka zincir, karın · yaklaşık ${mins} dk`,
  };
}

/** Bir seti yapmak için tahmini süre (saniye): tekrar başına ~5 sn ya da tutuş süresi, artı hazırlık; her taraf ayrı yapılan harekette iki kat. */
function setSeconds(v: ExerciseVariant): number {
  const work = v.unit === 'sec' ? v.max : v.max * 5;
  return (work + 10) * (v.perSide ? 2 : 1);
}

/**
 * Seansın tahmini süresi (dakika): ısınma + tüm setler + setler arası dinlenme. Blok mantığıyla dönüşümlü
 * çalışılırken dinlenme her sette tek kez sayılır.
 */
export function estimateMinutes(levels: Record<MoveId, Level>, restSec: number = ALT_REST_SECONDS): number {
  let sec = WARMUP_MINUTES * 60;
  for (const m of EXERCISES) {
    const v = variantFor(m.id, levels[m.id]);
    sec += v.sets * (setSeconds(v) + restSec);
  }
  return Math.ceil(sec / 60);
}

/** Saat uygulamasına alarm kurmak için Android amacı (intent) ek bilgileri. */
export function alarmExtras(startMin: number, message = 'Sabah egzersizi'): { key: string; value: string | number }[] {
  const m = ((Math.round(startMin) % 1440) + 1440) % 1440;
  return [
    { key: 'android.intent.extra.alarm.HOUR', value: Math.floor(m / 60) },
    { key: 'android.intent.extra.alarm.MINUTES', value: m % 60 },
    { key: 'android.intent.extra.alarm.MESSAGE', value: message },
  ];
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

/** Günü değerlendirme için egzersiz özeti. */
export interface ExerciseDayFacts {
  /** O gün egzersiz günüydü (program gereği). */
  planned: boolean;
  /** O gün seans kaydedildi. */
  done: boolean;
  /** Güne başlama saati (gün başından dakika); önerilen saatlerin bu pencereye denk gelmemesi için. */
  startMin: number;
  /** "06:00–06:30" */
  window: string;
  /** Yapılan hareketler: başlık, hareket adı, set başına tekrar/saniye. */
  items: { title: string; name: string; sets: number[] }[];
}

export function exerciseDayFacts(state: ExerciseState, day: Date): ExerciseDayFacts {
  const session = state.sessions.find((r) => r.day === dayKey(day));
  return {
    planned: isExerciseDay(state.plan, day),
    done: session !== undefined && session.items.length > 0,
    startMin: state.plan.startMin,
    window: windowText(state.plan),
    items: (session?.items ?? []).map((it) => ({
      title: EXERCISE_BY_ID[it.move].title,
      name: variantFor(it.move, it.level).name,
      sets: it.sets,
    })),
  };
}
