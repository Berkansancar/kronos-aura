/**
 * Hafta planı (saf mantık, test edilebilir).
 *
 * Önümüzdeki 7 günü iş programına göre (iş günü / yarım gün / boş gün) gösterir, işleri günlere ayırır ve
 * "otomatik dağıt" önerisi üretir: odak isteyen ve uzun işler boş günlere (Pazar), kısa işler yakın günlere gider.
 * Boş zaman YAKLAŞIKTIR (uyanık 07:00–23:00, iş günlerinde yol + hazırlık 90 dk düşülür). Yargı içermez.
 */
import type { CognitiveWeight, TaskStatus } from '../database/types';
import { formatDuration } from './format';
import { hhmm } from './goalsLogic';
import { windowForDow, type WorkSchedule } from './workLogic';

export interface WeekTask {
  id: string;
  title: string;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  status: TaskStatus;
  plannedDay?: string | null;
}

export type DayKind = 'WORK' | 'HALF' | 'FREE';

export interface WeekDayPlan {
  key: string;
  dow: number;
  label: string;
  dateText: string;
  kind: DayKind;
  /** "07:40–18:00" ya da "Boş gün" */
  workText: string;
  /** Yaklaşık iş dışı boş zaman (dakika) */
  freeMinutes: number;
  tasks: { id: string; title: string; minutes: number; heavy: boolean }[];
  plannedMinutes: number;
  load: 'ROOMY' | 'FULL';
}

export const AWAKE_START_MIN = 7 * 60;
export const AWAKE_END_MIN = 23 * 60;
export const WORK_OVERHEAD_MIN = 90;
/** Bir güne, boş zamanın bu kadarı kadar iş ayrılır (gerisi dinlenmeye kalır) */
export const FILL_RATIO = 0.6;
export const HEAVY_MINUTES = 45;

const DAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const keyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isHeavy = (t: Pick<WeekTask, 'cognitiveWeight' | 'estimatedDuration'>): boolean =>
  t.cognitiveWeight === 'HIGH' || t.estimatedDuration >= HEAVY_MINUTES;

/** Kalan boş zaman bugün için: şimdiden gece 23:00'e, iş saati düşülerek. */
export function remainingFreeToday(now: Date, work: { startMin: number; endMin: number } | null): number {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const from = Math.max(nowMin, AWAKE_START_MIN);
  let free = Math.max(0, AWAKE_END_MIN - from);
  if (work) {
    const overlap = Math.max(0, Math.min(AWAKE_END_MIN, work.endMin) - Math.max(from, work.startMin));
    free -= overlap;
    // Yol + hazırlık: iş saati henüz bitmediyse ya da iş yeni bittiyse düşülür
    if (nowMin < work.endMin) free -= WORK_OVERHEAD_MIN;
  }
  return Math.max(0, free);
}

export function dayCapacity(work: { startMin: number; endMin: number } | null): number {
  const total = AWAKE_END_MIN - AWAKE_START_MIN;
  if (!work) return total;
  return Math.max(0, total - (work.endMin - work.startMin) - WORK_OVERHEAD_MIN);
}

export function buildWeekPlan(input: {
  now: Date;
  /** gün başı (04:00 kuralıyla) bugünün tarihi */
  today: Date;
  work: WorkSchedule;
  /** Bitmemiş işler (bugüne ait olanlar ve ayrılmışlar) */
  tasks: WeekTask[];
  days?: number;
}): WeekDayPlan[] {
  const n = input.days ?? 7;
  const todayKey = keyOf(input.today);
  const open = input.tasks.filter((t) => t.status !== 'COMPLETED');
  const out: WeekDayPlan[] = [];
  for (let i = 0; i < n; i += 1) {
    const date = new Date(input.today.getFullYear(), input.today.getMonth(), input.today.getDate() + i);
    const key = keyOf(date);
    const dow = date.getDay();
    const win = input.work.enabled ? windowForDow(input.work, dow) : null;
    const kind: DayKind = !input.work.enabled || !input.work.days.includes(dow) ? 'FREE' : input.work.special?.[dow] ? 'HALF' : 'WORK';
    // Bugünün listesi: günü bugün ya da daha eski/boş olanlar; sonraki günler: tam o güne ayrılanlar
    const mine = open.filter((t) => (i === 0 ? !t.plannedDay || t.plannedDay <= todayKey : t.plannedDay === key));
    const tasks = mine.map((t) => ({ id: t.id, title: t.title, minutes: t.estimatedDuration, heavy: isHeavy(t) }));
    const planned = tasks.reduce((a, t) => a + t.minutes, 0);
    const free = i === 0 ? remainingFreeToday(input.now, win) : dayCapacity(win);
    out.push({
      key,
      dow,
      label: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : DAYS_LONG[dow],
      dateText: `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`,
      kind,
      workText: win ? `${hhmm(win.startMin)}–${hhmm(win.endMin)}` : 'Boş gün',
      freeMinutes: free,
      tasks,
      plannedMinutes: planned,
      load: planned > free * FILL_RATIO ? 'FULL' : 'ROOMY',
    });
  }
  return out;
}

export interface Assignment {
  taskId: string;
  /** Yapılacağı gün anahtarı; bugünse (todayKey) görev yerinde kalır */
  day: string;
  reason: string;
}

/**
 * Bugünün listesindeki hareket ettirilebilir işleri (bekleyen/ertelenen) haftaya dağıtır.
 * Odak isteyen ya da uzun işler boş güne (sonra yarım güne), kısa işler en yakın uygun güne gider. Her güne boş
 * zamanın %60'ı kadar iş ayrılır. Sığmayan iş yerinde (bugün) kalır. Başlanmış işe dokunulmaz.
 */
export function autoDistribute(plan: WeekDayPlan[], tasks: WeekTask[]): Assignment[] {
  if (plan.length === 0) return [];
  const todayKey = plan[0].key;
  const movable = tasks.filter((t) => (t.status === 'PENDING' || t.status === 'POSTPONED') && (!t.plannedDay || t.plannedDay <= todayKey));
  const fixed = tasks.filter((t) => !movable.includes(t) && t.status !== 'COMPLETED' && (!t.plannedDay || t.plannedDay <= todayKey));
  // Başlangıç doluluğu: bugünde kalan sabit işler + ileri günlere önceden ayrılmış işler
  const used = new Map<string, number>(plan.map((d) => [d.key, d.key === todayKey ? fixed.reduce((a, t) => a + t.estimatedDuration, 0) : d.tasks.reduce((a, t) => a + t.minutes, 0)]));
  const cap = (d: WeekDayPlan) => d.freeMinutes * FILL_RATIO;
  const rank = (d: WeekDayPlan, heavy: boolean): number => {
    const idx = plan.indexOf(d);
    if (!heavy) return idx; // kısa işler en yakın gün
    const kindScore = d.kind === 'FREE' ? 0 : d.kind === 'HALF' ? 1 : 2;
    return kindScore * 100 + idx; // odak isteyen işler önce boş gün, sonra yarım gün
  };
  const ordered = [...movable].sort((a, b) => Number(isHeavy(b)) - Number(isHeavy(a)) || b.estimatedDuration - a.estimatedDuration || a.title.localeCompare(b.title, 'tr'));
  const out: Assignment[] = [];
  for (const t of ordered) {
    const heavy = isHeavy(t);
    const candidates = [...plan].sort((a, b) => rank(a, heavy) - rank(b, heavy));
    const target = candidates.find((d) => (used.get(d.key) ?? 0) + t.estimatedDuration <= cap(d));
    if (!target) {
      out.push({ taskId: t.id, day: todayKey, reason: 'Sığmadı, yerinde kaldı' });
      used.set(todayKey, (used.get(todayKey) ?? 0) + t.estimatedDuration);
      continue;
    }
    used.set(target.key, (used.get(target.key) ?? 0) + t.estimatedDuration);
    out.push({
      taskId: t.id,
      day: target.key,
      reason: heavy ? (target.kind === 'FREE' ? 'Odak isteyen iş boş güne' : target.kind === 'HALF' ? 'Odak isteyen iş yarım güne' : 'Odak isteyen iş') : 'Kısa iş',
    });
  }
  return out;
}

/** "Dağıtım: 2 iş Pazar, 1 iş Salı…" gibi kısa özet (bugünde kalanlar yazılmaz). */
export function assignmentSummary(plan: WeekDayPlan[], assignments: Assignment[]): string {
  const todayKey = plan[0]?.key;
  const moved = assignments.filter((a) => a.day !== todayKey);
  if (moved.length === 0) return 'Taşınacak iş yok; hepsi bugüne sığıyor.';
  const parts = plan
    .filter((d) => d.key !== todayKey)
    .map((d) => ({ d, n: moved.filter((a) => a.day === d.key).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} iş ${x.d.label}`);
  const stay = assignments.length - moved.length;
  return `${moved.length} iş taşınır: ${parts.join(', ')}.${stay > 0 ? ` ${stay} iş bugünde kalır.` : ''}`;
}

/** Bir günün kısa özet satırı: "07:40–18:00 · ≈ 4 sa boş · 2 iş (1 sa)". */
export function dayLine(d: WeekDayPlan): string {
  const parts = [d.workText, `≈ ${formatDuration(d.freeMinutes)} boş`];
  if (d.tasks.length > 0) parts.push(`${d.tasks.length} iş (${formatDuration(d.plannedMinutes)})`);
  return parts.join(' · ');
}

/** Bir güne taşıma seçenekleri: bugünden sonraki 6 gün. */
export function moveTargets(plan: WeekDayPlan[]): { key: string; label: string }[] {
  return plan.slice(1).map((d) => ({ key: d.key, label: d.label === 'Yarın' ? 'Yarın' : d.label.slice(0, 3) }));
}

/** Yeni/düzenlenen görev için "Ne zaman?" seçenekleri: bugün (null), yarın ve sonraki 5 gün. */
export function whenChoices(today: Date): { key: string | null; label: string }[] {
  const out: { key: string | null; label: string }[] = [{ key: null, label: 'Bugün' }];
  for (let i = 1; i <= 6; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    out.push({ key: keyOf(d), label: i === 1 ? 'Yarın' : DAYS_LONG[d.getDay()].slice(0, 3) });
  }
  return out;
}
