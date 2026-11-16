/**
 * Sabah brifingi (saf mantık, test edilebilir). Günün planını, en önemli işi, rutinleri ve uykuyu tek bir
 * kısa özet hâline getirir. Yapay zekâ gerekmez; her şey telefondaki verilerden ve kurallardan gelir.
 * Dil: yargılamayan, kısa, emojisiz.
 */
import type { CognitiveWeight, RoutineDayState, TaskStatus } from '../database/types';
import { formatDuration } from './format';

export interface MorningTask {
  id: string;
  title: string;
  minutes: number;
  weight: CognitiveWeight;
  status: TaskStatus;
  /** Planda bu görev için ilk blok varsa başlangıç saati "SS:DD" */
  start: string | null;
}

export interface MorningRoutine {
  title: string;
  /** Sorulma saati "SS:DD" */
  time: string;
  state: RoutineDayState;
}

export interface MorningFacts {
  /** Plan gününün anahtarı (yyyy-mm-dd) */
  day: string;
  /** Şu anki saat (selamlama için) */
  hour: number;
  /** Bugün için açık görevler (bitmemiş, ertelenmemiş) */
  tasks: MorningTask[];
  doneTaskCount: number;
  peakStartHour: number;
  peakEndHour: number;
  routines: MorningRoutine[];
  /** Dünkü gün sonu değerlendirmesindeki Kronos'un yarın notu */
  note: string | null;
  sleepMinutes: number | null;
  /** Zor gün modu açık mı? */
  hardDay: boolean;
}

export interface MorningBrief {
  greeting: string;
  /** Aura: enerjiye ve uykuya göre sıcak, kısa bir cümle */
  aura: string;
  /** Kronos: planın net özeti (birkaç kısa satır) */
  kronos: string[];
  /** Dünkü Kronos notu (varsa) */
  note: string | null;
  top: MorningTask | null;
  /** Planı yapılmış (saatli) görevler, saate göre */
  planned: MorningTask[];
  /** Saati olmayan, plana sığmamış görevler */
  unplanned: MorningTask[];
  openMinutes: number;
  routinesOpen: MorningRoutine[];
  routinesDone: number;
  /** Uyku kısa ya da zor gün: zor gün modu önerilsin mi? */
  suggestHardDay: boolean;
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Günaydın';
  if (hour >= 12 && hour < 18) return 'İyi günler';
  if (hour >= 18 && hour < 22) return 'İyi akşamlar';
  return 'Merhaba';
}

const WEIGHT_RANK: Record<CognitiveWeight, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const pad = (n: number) => String(n).padStart(2, '0');

/** Kısa uyku sınırı: bunun altında zor gün modu önerilir. */
export const SHORT_SLEEP_MINUTES = 330;

/**
 * En önemli iş: başlamış olan; yoksa en ağır olan; eşitse planda en erken olan.
 * Zor günde tersine, en hafif ve kısa olan seçilir (yük azaltılır).
 */
export function pickTopTask(tasks: MorningTask[], hardDay: boolean): MorningTask | null {
  const open = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  if (open.length === 0) return null;
  const started = open.find((t) => t.status === 'IN_PROGRESS');
  if (started) return started;
  const startKey = (t: MorningTask) => (t.start ? t.start : '99:99');
  return [...open].sort((a, b) => {
    if (hardDay) {
      const byWeight = WEIGHT_RANK[b.weight] - WEIGHT_RANK[a.weight];
      if (byWeight !== 0) return byWeight;
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    } else {
      const byWeight = WEIGHT_RANK[a.weight] - WEIGHT_RANK[b.weight];
      if (byWeight !== 0) return byWeight;
    }
    return startKey(a).localeCompare(startKey(b));
  })[0];
}

function auraLine(f: MorningFacts): string {
  const s = f.sleepMinutes;
  if (f.hardDay) {
    return 'Bugün zor gün modundayız. Yalnızca en önemli işi yapmak yeterli, gerisi beklesin. Kendine nazik ol.';
  }
  if (s !== null && s < 300) {
    return `Dün gece epey kısa uyumuşsun (${formatDuration(s)}). Bugün kendine nazik ol: yalnızca en önemli işi yapmak da güzel bir gün sayılır.`;
  }
  if (s !== null && s < SHORT_SLEEP_MINUTES + 60) {
    return `Uykun biraz kısa kalmış (${formatDuration(s)}). Enerjini koru, aralara küçük molalar koy.`;
  }
  if (s !== null && s >= 450) {
    return `İyi dinlenmişsin (${formatDuration(s)}). Enerjin yerindeyse tepe saatini değerlendir.`;
  }
  return 'Yeni bir gün. Küçük adımlar da sayılır; ben buradayım.';
}

function kronosLines(f: MorningFacts, b: Pick<MorningBrief, 'top' | 'openMinutes' | 'unplanned'>): string[] {
  const lines: string[] = [];
  const open = f.tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  if (open.length === 0) {
    lines.push(
      f.doneTaskCount > 0
        ? `Bugünün görevleri bitmiş (${f.doneTaskCount}). İstersen yeni bir görev ekle.`
        : 'Bugün için açık görev yok. Bir görev ekleyip günü planlayabilirsin.'
    );
    return lines;
  }
  const noun = open.length === 1 ? '1 görev' : `${open.length} görev`;
  lines.push(`Bugün ${noun} açık, toplam ${formatDuration(b.openMinutes)}.`);
  if (b.top) {
    const when = b.top.start ? `, planda ${b.top.start}` : '';
    lines.push(
      f.hardDay
        ? `Bugünün tek hedefi: "${b.top.title}" (${formatDuration(b.top.minutes)}${when}).`
        : `En önemli işin: "${b.top.title}" (${formatDuration(b.top.minutes)}${when}).`
    );
  }
  if (!f.hardDay) {
    lines.push(
      `Tepe saatin ${pad(f.peakStartHour)}:00–${pad(f.peakEndHour % 24)}:00; en zor işi o aralığa koy.`
    );
  }
  if (b.unplanned.length > 0) {
    lines.push(
      `${b.unplanned.length} görev bugüne sığmadı. Günü planlayabilir ya da yarına bırakabilirsin.`
    );
  }
  return lines;
}

export function buildMorningBrief(f: MorningFacts): MorningBrief {
  const open = f.tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const planned = open
    .filter((t) => t.start !== null)
    .sort((a, b) => (a.start as string).localeCompare(b.start as string));
  const unplanned = open.filter((t) => t.start === null);
  const openMinutes = open.reduce((a, t) => a + t.minutes, 0);
  const top = pickTopTask(f.tasks, f.hardDay);

  const routinesOpen = f.routines
    .filter((r) => r.state !== 'DONE' && r.state !== 'SKIPPED' && r.state !== 'OFF')
    .sort((a, b) => a.time.localeCompare(b.time));
  const routinesDone = f.routines.filter((r) => r.state === 'DONE').length;

  const base = { top, openMinutes, unplanned };
  return {
    greeting: greetingFor(f.hour),
    aura: auraLine(f),
    kronos: kronosLines(f, base),
    note: f.note && f.note.trim() ? f.note.trim() : null,
    top,
    planned,
    unplanned,
    openMinutes,
    routinesOpen,
    routinesDone,
    suggestHardDay: !f.hardDay && f.sleepMinutes !== null && f.sleepMinutes < SHORT_SLEEP_MINUTES,
  };
}
