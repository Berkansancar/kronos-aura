/**
 * Gün rehberi (saf mantık, test edilebilir).
 *
 * İş programından (iş günü / Cumartesi yarım gün / Pazar boş), tipik uyanış ve yol süresinden ve planlayıcının
 * yerleştirdiği işlerden gün boyu bir saat çizelgesi çıkarır; boş aralıklara hafif öneriler (dil çalışması, kısa
 * yürüyüş, serbest zaman) koyar. Her şey bir ÖNERİdir; yargı içermez, yok sayılabilir.
 */
import { hhmm } from './goalsLogic';
import { windowForDow, type WorkSchedule } from './workLogic';

export type GuideKind = 'PREP' | 'COMMUTE' | 'WORK' | 'TASK' | 'MEAL' | 'LANGUAGE' | 'MOVE' | 'FREE' | 'REVIEW' | 'WINDDOWN';

export interface GuideSegment {
  id: string;
  kind: GuideKind;
  title: string;
  /** Gün başından dakika */
  from: number;
  to: number;
  note?: string;
  taskId?: string;
  /** true: sabit (hazırlık, yol, iş, yemek, gün sonu); false: planlayıcının işi ya da öneri */
  fixed: boolean;
}

export interface GuideBlock {
  taskId: string;
  title: string;
  from: number;
  to: number;
}

export interface GuideLanguage {
  goalMin: number | null;
  doneMin: number;
  appName: string;
}

export interface GuideInput {
  /** Planlama gününün tarihi (yalnızca haftanın günü için) */
  day: Date;
  work: WorkSchedule;
  /** Tipik uyanış (son "Uyandım" damgalarının ortancası) */
  wakeMin: number | null;
  /** Tipik tek yön yol süresi */
  commuteMin: number | null;
  /** Yatış saati (gün başından dakika; gece yarısını geçebilir); yoksa 23:00 */
  bedtimeMin: number | null;
  blocks: GuideBlock[];
  language: GuideLanguage | null;
}

export type GuideDayKind = 'WORK' | 'HALF' | 'FREE';

export interface GuideResult {
  kind: GuideDayKind;
  headline: string;
  segments: GuideSegment[];
  /** Sığmayan planlı işlerin adları */
  overflow: string[];
}

export const DEFAULT_COMMUTE_MIN = 25;
export const PREP_MIN = 60;
export const FREE_DAY_WAKE_MIN = 8 * 60;
export const MEAL_MIN = 45;
export const DEFAULT_BEDTIME_MIN = 23 * 60;
export const REVIEW_MIN = 20;
export const WINDDOWN_MIN = 30;
export const MIN_FILL_MIN = 25;
const LUNCH_FREE_MIN = 13 * 60;
const DINNER_LATE_MIN = 19 * 60 + 30;

interface Span {
  from: number;
  to: number;
}

const len = (s: Span) => s.to - s.from;

function resolveFixed(list: GuideSegment[], limit: number): GuideSegment[] {
  const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: GuideSegment[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    const from = Math.max(s.from, prev ? prev.to : s.from);
    const to = Math.min(s.to, limit);
    if (to - from < 10) continue;
    out.push({ ...s, from, to });
  }
  return out;
}

/** Sabit parçalar arasındaki (ve ilk/son sabit parçalar içindeki) boş aralıklar */
function gapsOf(fixed: GuideSegment[], start: number, end: number): Span[] {
  const gaps: Span[] = [];
  let cursor = start;
  for (const s of fixed) {
    if (s.from > cursor) gaps.push({ from: cursor, to: s.from });
    cursor = Math.max(cursor, s.to);
  }
  if (end > cursor) gaps.push({ from: cursor, to: end });
  return gaps;
}

/** `span` içinden `minutes` kadarını ayırır; bulunamazsa null. */
function take(gaps: Span[], minutes: number, opts: { notBefore?: number; notAfter?: number } = {}): Span | null {
  for (let i = 0; i < gaps.length; i += 1) {
    const g = gaps[i];
    const from = Math.max(g.from, opts.notBefore ?? 0);
    const to = Math.min(g.to, opts.notAfter ?? Number.POSITIVE_INFINITY);
    if (to - from < minutes) continue;
    const used = { from, to: from + minutes };
    const rest: Span[] = [];
    if (from - g.from > 0) rest.push({ from: g.from, to: from });
    if (g.to - used.to > 0) rest.push({ from: used.to, to: g.to });
    gaps.splice(i, 1, ...rest);
    return used;
  }
  return null;
}

export function buildGuide(input: GuideInput): GuideResult {
  const dow = input.day.getDay();
  const win = input.work.enabled ? windowForDow(input.work, dow) : null;
  const kind: GuideDayKind = !win ? 'FREE' : input.work.special?.[dow] ? 'HALF' : 'WORK';
  const commute = input.commuteMin ?? DEFAULT_COMMUTE_MIN;
  const bed = Math.min(input.bedtimeMin ?? DEFAULT_BEDTIME_MIN, 24 * 60);
  const lang = input.language;
  const langLeft = lang ? Math.max(0, (lang.goalMin ?? 15) - lang.doneMin) : 0;
  const langNote = lang ? `Dil öğrenme (${lang.appName}) ya da yolda yapılabilir işler için uygun` : 'Yolda yapılabilir işler için uygun';

  const fixed: GuideSegment[] = [];
  const add = (s: Omit<GuideSegment, 'fixed'>) => fixed.push({ ...s, fixed: true });
  let dayStart: number;
  let arrive: number | null = null;

  if (win) {
    const leave = win.startMin - commute;
    const wake = input.wakeMin !== null && input.wakeMin >= 4 * 60 && input.wakeMin <= leave - 20 ? input.wakeMin : leave - PREP_MIN;
    dayStart = wake;
    arrive = win.endMin + commute;
    add({ id: 'prep', kind: 'PREP', title: 'Hazırlık ve kahvaltı', from: wake, to: leave, note: 'Bir bardak su, kahvaltı, çıkmadan önce son bakış' });
    add({ id: 'to-work', kind: 'COMMUTE', title: 'Yolda · işe', from: leave, to: win.startMin, note: langNote });
    add({ id: 'work', kind: 'WORK', title: 'İş', from: win.startMin, to: win.endMin, note: 'Telefon yok; gün sonunda topluca işaretlersin' });
    add({ id: 'to-home', kind: 'COMMUTE', title: 'Yolda · eve', from: win.endMin, to: arrive, note: langNote });
    if (kind === 'WORK') {
      add({ id: 'dinner', kind: 'MEAL', title: 'Akşam yemeği ve dinlenme', from: arrive, to: arrive + MEAL_MIN });
    } else {
      add({ id: 'lunch', kind: 'MEAL', title: 'Öğle yemeği', from: arrive, to: arrive + MEAL_MIN });
      add({ id: 'dinner', kind: 'MEAL', title: 'Akşam yemeği', from: Math.max(DINNER_LATE_MIN, arrive + MEAL_MIN + 60), to: Math.max(DINNER_LATE_MIN, arrive + MEAL_MIN + 60) + MEAL_MIN });
    }
  } else {
    const wake = FREE_DAY_WAKE_MIN;
    dayStart = wake;
    add({ id: 'prep', kind: 'PREP', title: 'Güne yavaş başla', from: wake, to: wake + PREP_MIN, note: 'Su, kahvaltı; acele yok' });
    add({ id: 'lunch', kind: 'MEAL', title: 'Öğle yemeği', from: LUNCH_FREE_MIN, to: LUNCH_FREE_MIN + MEAL_MIN });
    add({ id: 'dinner', kind: 'MEAL', title: 'Akşam yemeği', from: DINNER_LATE_MIN, to: DINNER_LATE_MIN + MEAL_MIN });
  }

  const reviewFrom = Math.min(21 * 60 + 30, bed - WINDDOWN_MIN - REVIEW_MIN);
  add({ id: 'review', kind: 'REVIEW', title: 'Gün sonu değerlendirmesi', from: reviewFrom, to: reviewFrom + REVIEW_MIN, note: 'Bugünü birlikte değerlendirip yarını planlarız' });
  add({ id: 'winddown', kind: 'WINDDOWN', title: 'Günü yavaşça kapat', from: bed - WINDDOWN_MIN, to: bed, note: 'Ekranı kıs, yarına hazırlan' });

  const segments = resolveFixed(fixed, bed);
  const gaps = gapsOf(segments, dayStart, bed);

  // Planlayıcının işleri: iş saatine denk gelenler İş parçasının notuna yazılır, diğerleri boş aralıklara oturur
  const overflow: string[] = [];
  const workSeg = segments.find((s) => s.kind === 'WORK');
  const duringWork: string[] = [];
  const blocks = [...input.blocks].sort((a, b) => a.from - b.from);
  for (const b of blocks) {
    if (workSeg && b.from < workSeg.to && b.to > workSeg.from) {
      duringWork.push(b.title);
      continue;
    }
    const minutes = Math.max(5, b.to - b.from);
    const placed = take(gaps, minutes, { notBefore: Math.max(b.from, dayStart) });
    // Planlanan saatte yer yoksa o günün başka bir aralığına bakılır
    const spot = placed ?? take(gaps, minutes);
    if (!spot) {
      overflow.push(b.title);
      continue;
    }
    segments.push({ id: `task-${b.taskId}`, kind: 'TASK', title: b.title, from: spot.from, to: spot.to, taskId: b.taskId, fixed: false });
  }
  if (workSeg && duringWork.length > 0) {
    workSeg.note = `Telefon yok · iş vaktinde yapılabilenler: ${duringWork.slice(0, 3).join(', ')}${duringWork.length > 3 ? '…' : ''}`;
  }

  // Öneriler: dil çalışması, kısa yürüyüş, (Pazar) haftaya bakış
  const evening = kind === 'FREE' ? 0 : (arrive ?? 0) + MEAL_MIN;
  if (lang && langLeft > 0) {
    const need = Math.min(Math.max(langLeft, 10), kind === 'FREE' ? 45 : 30);
    const spot = take(gaps, need, { notBefore: 8 * 60 });
    if (spot) {
      segments.push({
        id: 'language',
        kind: 'LANGUAGE',
        title: `Dil öğrenme (${lang.appName}) · ${need} dk`,
        from: spot.from,
        to: spot.to,
        note: lang.goalMin !== null ? `Bugün ${lang.doneMin} / ${lang.goalMin} dk` : `Bugün ${lang.doneMin} dk`,
        fixed: false,
      });
    }
  }
  const walk = take(gaps, kind === 'FREE' ? 45 : 25, { notBefore: Math.max(evening, 15 * 60) });
  if (walk) segments.push({ id: 'move', kind: 'MOVE', title: kind === 'FREE' ? 'Yürüyüş ya da dışarı çıkma' : 'Kısa yürüyüş', from: walk.from, to: walk.to, note: 'Hareket, günün yorgunluğunu alır', fixed: false });
  if (dow === 0) {
    const prep = take(gaps, 20, { notBefore: 16 * 60, notAfter: DINNER_LATE_MIN });
    if (prep) {
      segments.push({ id: 'week', kind: 'FREE', title: 'Haftaya bakış (Hafta planı)', from: prep.from, to: prep.to, note: 'Önümüzdeki günlerin işlerini günlere ayır', fixed: false });
    }
  }
  for (const g of gaps) {
    if (len(g) >= MIN_FILL_MIN) {
      segments.push({ id: `free-${g.from}`, kind: 'FREE', title: 'Serbest zaman', from: g.from, to: g.to, note: 'Dinlen ya da sevdiğin bir şey yap', fixed: false });
    }
  }

  segments.sort((a, b) => a.from - b.from || a.to - b.to);
  const headline =
    kind === 'WORK'
      ? `İş günü · ${hhmm(win!.startMin)}–${hhmm(win!.endMin)} · eve ≈ ${hhmm(arrive!)}`
      : kind === 'HALF'
        ? `Yarım gün · ${hhmm(win!.startMin)}–${hhmm(win!.endMin)} · öğleden sonra senin`
        : 'Boş gün · iş yok, acele yok';
  return { kind, headline, segments, overflow };
}

export interface GuideNow {
  current: GuideSegment | null;
  next: GuideSegment | null;
  /** Şimdiki parçanın bitmesine kalan dakika */
  leftMin: number | null;
}

/** `nowMin`: planlama gününün gece yarısından beri dakika. */
export function guideNow(segments: GuideSegment[], nowMin: number): GuideNow {
  const current = segments.find((s) => s.from <= nowMin && nowMin < s.to) ?? null;
  const next = segments.find((s) => s.from > nowMin) ?? null;
  return { current, next, leftMin: current ? current.to - nowMin : null };
}

/** "Şimdi: İş · 18:00'e kadar" ve "Sıradaki: 18:00 Yolda · eve" gibi kısa satırlar. */
export function guideLines(g: GuideNow): { now: string; next: string | null } {
  const nowText = g.current ? `${g.current.title} · ${hhmm(g.current.to)}'e kadar` : 'Şu an plan dışı, serbestsin';
  return { now: nowText, next: g.next ? `${hhmm(g.next.from)} ${g.next.title}` : null };
}
