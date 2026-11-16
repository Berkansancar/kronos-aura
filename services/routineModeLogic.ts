/**
 * Rutin modu: bugünün rutinlerini tek ekranda, sırayla ve adım adım yürütme. Saf mantık; veritabanından bağımsız.
 *
 * Adım: "Yaptım" (tamamlandı), "Atla" (bugünlük geç, yarın yine sorulur), "Sonra" (bu turun sonuna al).
 * Hiçbir seçenek yargılayıcı değil: atlanan rutin kayıp değil, yalnızca bugün için kapanır.
 */
import type { RoutineBrief, RoutineCategory } from '../database/types';
import { routineColor, routineIcon } from './routineLook';

export type RunSegment = 'ALL' | 'MORNING' | 'EVENING';

export const SEGMENT_LABEL: Record<RunSegment, string> = {
  ALL: 'Bugünkü hepsi',
  MORNING: 'Sabah',
  EVENING: 'Akşam',
};

export const MORNING_END_HOUR = 12;
export const EVENING_START_HOUR = 17;

export interface RunStep {
  routineId: string;
  title: string;
  icon: string;
  color: string;
  category: RoutineCategory;
  minutes: number;
  askMinuteOfDay: number;
}

/** Çalıştırılabilir (henüz yapılmamış, atlanmamış, bugün planlı) rutin mi? */
const runnable = (b: RoutineBrief): boolean => b.state !== 'DONE' && b.state !== 'SKIPPED' && b.state !== 'OFF';

function inSegment(b: RoutineBrief, seg: RunSegment): boolean {
  if (seg === 'ALL') return true;
  if (seg === 'MORNING') return b.routine.askHour < MORNING_END_HOUR;
  return b.routine.askHour >= EVENING_START_HOUR;
}

export function buildRun(briefs: RoutineBrief[], segment: RunSegment): RunStep[] {
  return briefs
    .filter((b) => runnable(b) && inSegment(b, segment))
    .map<RunStep>((b) => ({
      routineId: b.routine.id,
      title: b.routine.title,
      icon: routineIcon(b.routine),
      color: routineColor(b.routine),
      category: b.routine.category,
      minutes: Math.max(1, b.routine.estimatedDuration),
      askMinuteOfDay: b.routine.askHour * 60 + b.routine.askMinute,
    }))
    .sort((a, b) => a.askMinuteOfDay - b.askMinuteOfDay || a.title.localeCompare(b.title, 'tr'));
}

/** Seçilebilir bölümler ve her birinde kaç adım var (adımı olmayan bölüm listelenmez; "hepsi" tek bölümse gizlenir). */
export function availableSegments(briefs: RoutineBrief[]): { segment: RunSegment; count: number; minutes: number }[] {
  const out: { segment: RunSegment; count: number; minutes: number }[] = [];
  for (const segment of ['MORNING', 'EVENING', 'ALL'] as RunSegment[]) {
    const steps = buildRun(briefs, segment);
    if (steps.length === 0) continue;
    out.push({ segment, count: steps.length, minutes: steps.reduce((a, s) => a + s.minutes, 0) });
  }
  // "Hepsi", başka bir bölümle aynı adımları içeriyorsa tekrar göstermeye gerek yok
  const all = out.find((o) => o.segment === 'ALL');
  if (all && out.some((o) => o.segment !== 'ALL' && o.count === all.count)) {
    return out.filter((o) => o.segment !== 'ALL');
  }
  return out;
}

/** Günün saatine göre önerilen bölüm: sabah → Sabah, akşam → Akşam; yoksa Hepsi. */
export function defaultSegment(briefs: RoutineBrief[], now: Date): RunSegment {
  const avail = availableSegments(briefs).map((a) => a.segment);
  const h = now.getHours();
  if (h < MORNING_END_HOUR && avail.includes('MORNING')) return 'MORNING';
  if (h >= EVENING_START_HOUR && avail.includes('EVENING')) return 'EVENING';
  if (avail.includes('ALL')) return 'ALL';
  return avail[0] ?? 'ALL';
}

// ───────────────────────── Akış ─────────────────────────

export interface RunState {
  queue: RunStep[];
  index: number;
  done: string[];
  skipped: string[];
  /** "Sonra" denip turun sonuna alınanlar (her rutin bir kez ertelenebilir) */
  deferred: string[];
  /** İkinci "Sonra"da açık bırakılanlar */
  left: string[];
}

export function startRun(steps: RunStep[]): RunState {
  return { queue: steps, index: 0, done: [], skipped: [], deferred: [], left: [] };
}

export const runCurrent = (s: RunState): RunStep | null => s.queue[s.index] ?? null;
export const runFinished = (s: RunState): boolean => s.index >= s.queue.length;

export type RunAnswer = 'DONE' | 'SKIP' | 'LATER';

/**
 * Cevabı işler. "Sonra": adım bir kez sona eklenir; ikinci kez "Sonra" denirse açık bırakılır (tur sonsuza uzamaz,
 * rutin bugün yine Rutinlerim'den yapılabilir).
 */
export function runAnswer(s: RunState, answer: RunAnswer): RunState {
  const cur = runCurrent(s);
  if (!cur) return s;
  const next: RunState = { ...s, index: s.index + 1 };
  if (answer === 'DONE') next.done = [...s.done, cur.routineId];
  else if (answer === 'SKIP') next.skipped = [...s.skipped, cur.routineId];
  else if (!s.deferred.includes(cur.routineId)) {
    next.queue = [...s.queue, cur];
    next.deferred = [...s.deferred, cur.routineId];
  } else {
    next.left = [...s.left, cur.routineId];
  }
  return next;
}

export function runProgress(s: RunState): { position: number; total: number; ratio: number } {
  const total = s.queue.length;
  const position = Math.min(s.index + 1, total);
  return { position, total, ratio: total === 0 ? 0 : Math.min(1, s.index / total) };
}

/** Kalan adımların toplam tahmini süresi (dk), geçerli adım dahil. */
export function remainingMinutes(s: RunState): number {
  return s.queue.slice(s.index).reduce((a, st) => a + st.minutes, 0);
}

export function runSummary(s: RunState): string {
  const d = s.done.length;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} rutini tamamladın`);
  if (s.skipped.length > 0) parts.push(`${s.skipped.length} rutini bugünlük geçtin`);
  if (s.left.length > 0) parts.push(`${s.left.length} rutin açık kaldı`);
  if (parts.length === 0) return 'Bu turda hiçbir rutine dokunmadın, sorun değil.';
  const base = parts.join(', ') + '.';
  if (d === 0) return `${base} Geçmek de bir karar; yarın yeniden sorulur.`;
  return `${base} Küçük adımlar birikiyor.`;
}

// ───────────────────────── Sayaç ─────────────────────────

export interface TimerState {
  running: boolean;
  /** Çalışmaya başladığı an (ms); durduysa null */
  startedAt: number | null;
  /** Önceki çalışmalardan biriken süre (ms) */
  accumulated: number;
}

export const newTimer = (): TimerState => ({ running: false, startedAt: null, accumulated: 0 });

export function timerToggle(t: TimerState, nowMs: number): TimerState {
  if (t.running && t.startedAt !== null) {
    return { running: false, startedAt: null, accumulated: t.accumulated + Math.max(0, nowMs - t.startedAt) };
  }
  return { running: true, startedAt: nowMs, accumulated: t.accumulated };
}

export function timerElapsedMs(t: TimerState, nowMs: number): number {
  return t.accumulated + (t.running && t.startedAt !== null ? Math.max(0, nowMs - t.startedAt) : 0);
}

/** Kalan saniye (hedef süreye göre). Süre dolduysa negatif: fazladan geçen süre. */
export function timerRemainingSec(t: TimerState, nowMs: number, targetMinutes: number): number {
  return Math.round(targetMinutes * 60 - timerElapsedMs(t, nowMs) / 1000);
}

/** "04:07" ya da süre aşıldıysa "+01:30". */
export function formatTimer(remainingSec: number): string {
  const over = remainingSec < 0;
  const abs = Math.abs(remainingSec);
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  const body = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return over ? `+${body}` : body;
}
