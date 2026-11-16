/**
 * Yolculuk (saf mantık, test edilebilir): yoldayken önerilecek işler ve tipik yol süresi.
 * Yolda olmak, gün akışında "Minibüse bindim" damgasının son damga olmasıdır; plana etkisi yoktur,
 * yalnızca ana ekranda küçük bir kart çıkar. Öneriler yargı taşımaz.
 */
import type { DayEvent, Task } from '../database/types';
import { formatDuration } from './format';

/** "Minibüse bindim" damgası bundan eskiyse hâlâ yolda sayılmaz (damga atmayı unutmuş olabilir) */
export const COMMUTE_MAX_MINUTES = 120;
/** Tipik yol süresi bilinmiyorsa kullanılan varsayılan */
export const DEFAULT_COMMUTE_MINUTES = 25;
/** Tipik süre için gereken en az örnek sayısı */
export const MIN_COMMUTE_SAMPLES = 3;

export type CommuteDirection = 'TO_WORK' | 'HOME';

export interface CommuteState {
  onBus: boolean;
  direction: CommuteDirection | null;
  startedAt: Date | null;
  /** Binişten bu yana geçen dakika */
  elapsedMinutes: number;
}

const ms = (iso: string) => new Date(iso).getTime();

export function commuteState(events: DayEvent[], now: Date): CommuteState {
  const none: CommuteState = { onBus: false, direction: null, startedAt: null, elapsedMinutes: 0 };
  const list = [...events].sort((a, b) => ms(a.at) - ms(b.at));
  const last = list[list.length - 1];
  if (!last || last.kind !== 'BUS') return none;
  const elapsed = Math.round((now.getTime() - ms(last.at)) / 60_000);
  if (elapsed < 0 || elapsed > COMMUTE_MAX_MINUTES) return none;
  // Dükkandan çıktıktan sonra binilen minibüs eve gider
  const before = list[list.length - 2];
  return {
    onBus: true,
    direction: before?.kind === 'SHOP_OUT' ? 'HOME' : 'TO_WORK',
    startedAt: new Date(last.at),
    elapsedMinutes: elapsed,
  };
}

/** Tek yön yol sürelerinden (dk) tipik süre: ortanca, 5 dakikaya yuvarlanır. Yeterli örnek yoksa null. */
export function typicalCommuteMinutes(samples: number[]): number | null {
  const valid = samples.filter((m) => Number.isFinite(m) && m >= 3 && m <= COMMUTE_MAX_MINUTES).sort((a, b) => a - b);
  if (valid.length < MIN_COMMUTE_SAMPLES) return null;
  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return Math.max(5, Math.round(median / 5) * 5);
}

/** Yolda kalan tahmini süre; en az 10 dakika gösterilir (biraz uzarsa öneriler hemen kaybolmasın). */
export function remainingMinutes(state: CommuteState, typical: number | null): number {
  const total = typical ?? DEFAULT_COMMUTE_MINUTES;
  return Math.max(10, total - state.elapsedMinutes);
}

export interface CommuteSuggestion {
  kind: 'TASK' | 'IDEA' | 'LANGUAGE';
  taskId: string | null;
  title: string;
  minutes: number;
}

const IDEAS_TO_WORK = [
  'Bugünün en önemli işini aklından planla',
  'Bugün için 3 küçük hedef düşün',
  'Kısa bir şey dinle ya da oku',
  'Derin nefes: 2 dakika, yavaşça',
];
const IDEAS_HOME = [
  'Bugün iyi giden bir şeyi hatırla',
  'Akşam için küçük bir plan yap: yemek, su, dinlenme',
  'Yarın için 3 madde not al',
  'Kısa bir şey dinle, günü bırak',
];
const IDEA_MINUTES = 5;

/**
 * Yola sığan işleri seçer: önce "yolda yapılabilir" işaretliler, sonra yola sığan hafif işler.
 * Süreler toplamı yolu aşmaz. Hiç iş yoksa iki kısa fikir önerilir (`seed` ile döner).
 */
export interface CommuteLanguage {
  /** Günlük hedef (dk); null = hedef yok */
  goalMin: number | null;
  /** Bugün şimdiye kadar yapılan (dk) */
  doneMin: number;
  /** Sayılan uygulamanın adı (ör. "Duolingo") */
  appName: string;
}

export function commuteSuggestions(
  tasks: Task[],
  available: number,
  direction: CommuteDirection,
  seed: number,
  max = 3,
  language?: CommuteLanguage
): CommuteSuggestion[] {
  // Yolda yapabildiğin şey çoğunlukla dil öğrenmekse ilk satır odur; süre otomatik sayılır, düğme gerekmez
  const lang: CommuteSuggestion[] = [];
  if (language) {
    const left = language.goalMin === null ? 10 : Math.max(0, language.goalMin - language.doneMin);
    const progress =
      language.goalMin === null ? `bugün ${language.doneMin} dk` : `bugün ${language.doneMin} / ${language.goalMin} dk`;
    lang.push({
      kind: 'LANGUAGE',
      taskId: null,
      title: `Dil öğrenme (${language.appName}) · ${progress}`,
      minutes: left > 0 ? Math.min(Math.max(5, left), available) : 0,
    });
  }
  const rest = commuteBaseSuggestions(tasks, available, direction, seed, Math.max(0, max - lang.length));
  return [...lang, ...rest];
}

function commuteBaseSuggestions(
  tasks: Task[],
  available: number,
  direction: CommuteDirection,
  seed: number,
  max: number
): CommuteSuggestion[] {
  if (max <= 0) return [];
  const open = tasks.filter((t) => t.status === 'PENDING' && t.estimatedDuration <= available);
  const flagged = open.filter((t) => t.commuteOk === true).sort((a, b) => b.estimatedDuration - a.estimatedDuration);
  const light = open
    .filter((t) => t.commuteOk !== true && t.cognitiveWeight === 'LOW')
    .sort((a, b) => b.estimatedDuration - a.estimatedDuration);

  const picked: CommuteSuggestion[] = [];
  let used = 0;
  for (const t of [...flagged, ...light]) {
    if (picked.length >= max) break;
    if (used + t.estimatedDuration > available) continue;
    picked.push({ kind: 'TASK', taskId: t.id, title: t.title, minutes: t.estimatedDuration });
    used += t.estimatedDuration;
  }
  if (picked.length > 0) return picked;

  const ideas = direction === 'HOME' ? IDEAS_HOME : IDEAS_TO_WORK;
  const first = Math.abs(Math.floor(seed)) % ideas.length;
  return [first, (first + 1) % ideas.length]
    .slice(0, Math.min(2, max))
    .map((i) => ({ kind: 'IDEA' as const, taskId: null, title: ideas[i], minutes: IDEA_MINUTES }));
}

/** Kartın alt başlığı: "Yolculuğun ≈ 30 dk · 12 dk geçti". */
export function commuteLine(state: CommuteState, typical: number | null): string {
  const parts: string[] = [];
  if (typical !== null) parts.push(`Yolun ≈ ${formatDuration(typical)}`);
  parts.push(`${formatDuration(Math.max(1, state.elapsedMinutes))} oldu`);
  return parts.join(' · ');
}
