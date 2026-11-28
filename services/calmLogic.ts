/**
 * Sakin Mod (saf mantık). Farklı çalışan beyinler (DEHB, otizm, disleksi gibi) için günü küçültür ve sadeleştirir:
 * ekranda tek iş, "sadece 2 dakika" ile başlama, işi küçük adımlara bölme, gün başı enerji seçimi ve
 * yargılamayan bir ilerleme satırı. Hiçbir şey "kaçırılmış" ya da "başarısız" sayılmaz.
 * Bu bir destek aracıdır; teşhis ya da tedavi değildir.
 * Ekranı app/calm.tsx, veritabanı işlemlerini services/calm.ts yapar.
 */
import { colors } from '../constants/theme';
import type { CognitiveWeight, Task } from '../database/types';
import { parseDayKey } from './activityLogic';

// ───────────────────────── Ayar anahtarları (Setting tablosu; yedeğe girer) ─────────────────────────

export const CALM_PREFS_KEY = 'calm_prefs_v1';
/** Bugünün enerjisi: tek satır, `{ day, energy }`; başka bir günün kaydı yok sayılır. */
export const CALM_ENERGY_KEY = 'calm_energy_v1';
export const CALM_TIMER_KEY = 'calm_timer_v1';
/** Görevin adımları: `calm_steps_<görev id>` */
export const CALM_STEPS_PREFIX = 'calm_steps_';
export const CALM_STARTS_KEY = 'calm_starts_v1';

export const stepsKey = (taskId: string): string => `${CALM_STEPS_PREFIX}${taskId}`;

// ───────────────────────── Rahatlık ayarları ─────────────────────────

export type TextSize = 'NORMAL' | 'LARGE' | 'XLARGE';

export interface CalmPrefs {
  textSize: TextSize;
  /** Geniş satır aralığı (okuması kolay) */
  spacious: boolean;
  /** Titreşim ve ses yok */
  quiet: boolean;
  /** Yumuşak renkler (parlak renk ve sert karşıtlık yok) */
  calmColors: boolean;
}

export const DEFAULT_PREFS: CalmPrefs = { textSize: 'NORMAL', spacious: true, quiet: false, calmColors: true };

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LARGE', label: 'Büyük' },
  { value: 'XLARGE', label: 'Çok büyük' },
];

const TEXT_SCALE: Record<TextSize, number> = { NORMAL: 1, LARGE: 1.2, XLARGE: 1.4 };

export const isTextSize = (v: unknown): v is TextSize => v === 'NORMAL' || v === 'LARGE' || v === 'XLARGE';

/** Kayıtlı metni ayara çevirir. Bozuk ya da eksik alanlar varsayılana döner. */
export function parsePrefs(raw: string | null | undefined): CalmPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_PREFS };
    return {
      textSize: isTextSize(v.textSize) ? v.textSize : DEFAULT_PREFS.textSize,
      spacious: typeof v.spacious === 'boolean' ? v.spacious : DEFAULT_PREFS.spacious,
      quiet: typeof v.quiet === 'boolean' ? v.quiet : DEFAULT_PREFS.quiet,
      calmColors: typeof v.calmColors === 'boolean' ? v.calmColors : DEFAULT_PREFS.calmColors,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const serializePrefs = (p: CalmPrefs): string => JSON.stringify(p);

/** Yazı boyutunu seçilen ölçüye göre büyütür. */
export const scaleFont = (base: number, size: TextSize): number => Math.round(base * TEXT_SCALE[size]);

/** Satır yüksekliği: geniş aralıkta daha ferah. */
export const lineHeightFor = (fontSize: number, spacious: boolean): number => Math.round(fontSize * (spacious ? 1.55 : 1.3));

// ───────────────────────── Renkler ─────────────────────────

export interface CalmPalette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  good: string;
  warm: string;
}

/** Yumuşak palet: koyu ama siyah değil, canlı renk yok; metin ile zemin arasında yine yüksek okunurluk var. */
export const CALM_PALETTE: CalmPalette = {
  bg: '#14171C',
  surface: '#1C2027',
  surfaceAlt: '#242933',
  border: '#303642',
  text: '#E6E9EE',
  textMuted: '#A3ACBA',
  accent: '#8FB8C9',
  accentSoft: 'rgba(143,184,201,0.14)',
  good: '#8CC5A8',
  warm: '#D9B382',
};

/** Uygulamanın olağan renkleri (Sakin renkler kapalıyken). */
export const STANDARD_PALETTE: CalmPalette = {
  bg: colors.bg,
  surface: colors.surface,
  surfaceAlt: colors.surfaceAlt,
  border: colors.border,
  text: colors.text,
  textMuted: colors.textMuted,
  accent: colors.kronos,
  accentSoft: colors.kronosSoft,
  good: colors.aura,
  warm: colors.warning,
};

export const paletteFor = (prefs: CalmPrefs): CalmPalette => (prefs.calmColors ? CALM_PALETTE : STANDARD_PALETTE);

// ───────────────────────── Gün enerjisi ─────────────────────────

export type DayEnergy = 'LOW' | 'MID' | 'HIGH';

export interface EnergyOption {
  value: DayEnergy;
  label: string;
  hint: string;
  /** Bu enerjide "sığan" en uzun iş (dakika) */
  maxMinutes: number;
}

export const ENERGY_OPTIONS: EnergyOption[] = [
  { value: 'LOW', label: 'Düşük', hint: 'Küçük ve hafif işler yeter', maxMinutes: 20 },
  { value: 'MID', label: 'Orta', hint: 'Orta büyüklükte işler olur', maxMinutes: 45 },
  { value: 'HIGH', label: 'Yüksek', hint: 'Derin odak isteyen iş de olur', maxMinutes: 120 },
];

export const isDayEnergy = (v: unknown): v is DayEnergy => v === 'LOW' || v === 'MID' || v === 'HIGH';

/** Enerji seçilmemişse orta varsayılır. */
export const maxMinutesFor = (energy: DayEnergy | null): number =>
  ENERGY_OPTIONS.find((o) => o.value === (energy ?? 'MID'))?.maxMinutes ?? 45;

export const serializeDayEnergy = (day: string, energy: DayEnergy): string => JSON.stringify({ day, energy });

/** Yalnızca bugüne ait kayıt geçerlidir; dünün seçimi bugünü bağlamaz. */
export function parseDayEnergy(raw: string | null | undefined, today: string): DayEnergy | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { day?: unknown; energy?: unknown } | null;
    if (!v || v.day !== today || !isDayEnergy(v.energy)) return null;
    return v.energy;
  } catch {
    return null;
  }
}

// ───────────────────────── Tek görev seçimi ─────────────────────────

/** 30 dakika ve üstü işler enerji ne olursa olsun bölünmeye önerilir. */
export const SPLIT_HINT_MINUTES = 30;

export const isOpenTask = (t: Task): boolean => t.status === 'PENDING' || t.status === 'IN_PROGRESS';

/** Düşük enerjide hafif iş önce; yüksek enerjide derin odak işi önce; ortada orta iş önce. */
function weightOrder(w: CognitiveWeight, energy: DayEnergy): number {
  const order: Record<DayEnergy, Record<CognitiveWeight, number>> = {
    LOW: { LOW: 0, MEDIUM: 1, HIGH: 2 },
    MID: { MEDIUM: 0, LOW: 1, HIGH: 2 },
    HIGH: { HIGH: 0, MEDIUM: 1, LOW: 2 },
  };
  return order[energy][w];
}

/**
 * Bugünün açık işlerini "şimdi yapılacak" sırasına dizer: başlamış iş her zaman en üstte; sonra enerjiye sığanlar;
 * sonra enerjiye uygun yük; en sonda kısa olan (yüksek enerjide eski olan) iş.
 */
export function rankFocusTasks(tasks: Task[], energy: DayEnergy | null): Task[] {
  const e: DayEnergy = energy ?? 'MID';
  const limit = maxMinutesFor(e);
  return tasks
    .filter(isOpenTask)
    .slice()
    .sort((a, b) => {
      const running = (a.status === 'IN_PROGRESS' ? 0 : 1) - (b.status === 'IN_PROGRESS' ? 0 : 1);
      if (running !== 0) return running;
      const fits = (a.estimatedDuration <= limit ? 0 : 1) - (b.estimatedDuration <= limit ? 0 : 1);
      if (fits !== 0) return fits;
      const weight = weightOrder(a.cognitiveWeight, e) - weightOrder(b.cognitiveWeight, e);
      if (weight !== 0) return weight;
      if (e === 'HIGH') return a.createdAt.localeCompare(b.createdAt);
      return a.estimatedDuration - b.estimatedDuration || a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * Ekranda gösterilecek tek iş. `skip`: "başka iş göster" ile geçilenler; hepsi geçildiyse başa döner.
 * Açık iş yoksa null.
 */
export function pickFocusTask(tasks: Task[], energy: DayEnergy | null, skip: string[] = []): Task | null {
  const ranked = rankFocusTasks(tasks, energy);
  if (ranked.length === 0) return null;
  return ranked.find((t) => !skip.includes(t.id)) ?? ranked[0];
}

/** İş büyükse (enerjiye sığmıyor ya da uzun) adımlara bölmek önerilir. */
export function needsSplit(task: Task, energy: DayEnergy | null): boolean {
  return task.estimatedDuration > maxMinutesFor(energy) || task.estimatedDuration >= SPLIT_HINT_MINUTES;
}

/** Düşük enerjili günde ve zor gün modu kapalıysa, zor gün modu yumuşakça hatırlatılır. */
export const shouldOfferHardDay = (energy: DayEnergy | null, hardDay: boolean): boolean => energy === 'LOW' && !hardDay;

// ───────────────────────── Adımlar ─────────────────────────

export interface CalmStep {
  text: string;
  done: boolean;
}

export const MAX_STEPS = 12;
export const STEP_MAX_LENGTH = 80;

export const cleanStepText = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, STEP_MAX_LENGTH).trim();

/** Başlıktan kısa bir ad çıkarır (adım satırına sığsın). */
function shortName(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length === 0) return 'İş';
  return t.length > 40 ? `${t.slice(0, 39).trim()}…` : t;
}

/**
 * Kural tabanlı adım önerisi (yapay zekâ ya da internet gerekmez): hazırlık, süreye göre eşit parçalar, toparlama.
 * Çok kısa işlerde (5 dk ve altı) yalnızca iki adım verilir. Öneriler kullanıcı tarafından değiştirilebilir.
 */
export function suggestSteps(title: string, minutes: number): CalmStep[] {
  const name = shortName(title);
  const total = Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : 10;
  if (total <= 5) {
    return [`İlk hareketi yap: ${name}`, 'Bitir ve işaretle'].map((text) => ({ text: cleanStepText(text), done: false }));
  }
  const prep = 2;
  const wrap = 2;
  const parts = Math.max(1, Math.min(6, Math.round(total / 10)));
  const work = Math.max(parts, total - prep - wrap);
  const each = Math.max(1, Math.round(work / parts));
  const lines = [`Hazırlan: gerekenleri yanına al (${prep} dk)`];
  if (parts === 1) lines.push(`Yap: ${name} (~${each} dk)`);
  else for (let i = 1; i <= parts; i++) lines.push(`${i}. parça: ${name} (~${each} dk)`);
  lines.push(`Toparla: nerede kaldığını not et (${wrap} dk)`);
  return lines.map((text) => ({ text: cleanStepText(text), done: false }));
}

export function parseSteps(raw: string | null | undefined): CalmStep[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: CalmStep[] = [];
    for (const item of v) {
      if (!item || typeof item !== 'object') continue;
      const s = item as { text?: unknown; done?: unknown };
      if (typeof s.text !== 'string') continue;
      const text = cleanStepText(s.text);
      if (text.length === 0) continue;
      out.push({ text, done: s.done === true });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export const serializeSteps = (steps: CalmStep[]): string => JSON.stringify(steps);

export const toggleStep = (steps: CalmStep[], index: number): CalmStep[] =>
  steps.map((s, i) => (i === index ? { ...s, done: !s.done } : s));

/** Boş ya da sınırı aşan adım eklenmez. */
export function addStep(steps: CalmStep[], text: string): CalmStep[] {
  const clean = cleanStepText(text);
  if (clean.length === 0 || steps.length >= MAX_STEPS) return steps;
  return [...steps, { text: clean, done: false }];
}

export const removeStep = (steps: CalmStep[], index: number): CalmStep[] => steps.filter((_, i) => i !== index);

export function stepsProgress(steps: CalmStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** Sıradaki yapılmamış adımın sırası; hepsi bittiyse ya da adım yoksa -1. */
export const currentStepIndex = (steps: CalmStep[]): number => steps.findIndex((s) => !s.done);

// ───────────────────────── Geri sayım ─────────────────────────

export const MICRO_MINUTES = 2;
export const FOCUS_MINUTES = 10;

export type TimerKind = 'MICRO' | 'FOCUS';

export interface CalmTimer {
  taskId: string;
  kind: TimerKind;
  minutes: number;
  /** ms (epoch) */
  startedAt: number;
  endsAt: number;
}

/** Bitişinden bu kadar süre geçmiş bir sayaç eskimiş sayılır ve silinir. */
export const STALE_TIMER_MS = 6 * 60 * 60 * 1000;

export function newTimer(taskId: string, kind: TimerKind, nowMs: number): CalmTimer {
  const minutes = kind === 'MICRO' ? MICRO_MINUTES : FOCUS_MINUTES;
  return { taskId, kind, minutes, startedAt: nowMs, endsAt: nowMs + minutes * 60_000 };
}

/** Kalan süre saat sayılarak değil bitiş anından hesaplanır; uygulama arka plana gitse de doğru kalır. */
export const remainingMs = (t: CalmTimer, nowMs: number): number => Math.max(0, t.endsAt - nowMs);

export const isTimerOver = (t: CalmTimer, nowMs: number): boolean => nowMs >= t.endsAt;

/** 1 = süre yeni başladı, 0 = bitti. */
export function timerFraction(t: CalmTimer, nowMs: number): number {
  const total = t.endsAt - t.startedAt;
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, remainingMs(t, nowMs) / total));
}

/** Kalan süreyi "m:ss" yazar; saniye yukarı yuvarlanır (0:00 yalnızca bittiğinde görünür). */
export function formatClock(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Küçülen daire: alan kalan süreyle orantılı olsun diye çap karekökle küçülür. */
export function discSize(fraction: number, maxPx: number, minPx: number = 10): number {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (f <= 0) return minPx;
  return Math.round(minPx + (maxPx - minPx) * Math.sqrt(f));
}

export function parseTimer(raw: string | null | undefined, nowMs: number): CalmTimer | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return null;
    const { taskId, kind, minutes, startedAt, endsAt } = v;
    if (typeof taskId !== 'string' || taskId.length === 0) return null;
    if (kind !== 'MICRO' && kind !== 'FOCUS') return null;
    if (typeof minutes !== 'number' || !(minutes > 0)) return null;
    if (typeof startedAt !== 'number' || typeof endsAt !== 'number') return null;
    if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || !(endsAt > startedAt)) return null;
    if (nowMs - endsAt > STALE_TIMER_MS) return null;
    return { taskId, kind, minutes, startedAt, endsAt };
  } catch {
    return null;
  }
}

export const serializeTimer = (t: CalmTimer): string => JSON.stringify(t);

/** Süre bitince gösterilen yumuşak mesaj: bırakmak da bir seçenektir, başlamak zaten sayılır. */
export function timerOverText(kind: TimerKind): string {
  return kind === 'MICRO'
    ? `${MICRO_MINUTES} dakika doldu. İstersen ${FOCUS_MINUTES} dakika daha devam edelim; bırakmak da olur, başlamıştın bile.`
    : `${FOCUS_MINUTES} dakika doldu. Devam edebilir ya da mola verebilirsin.`;
}

// ───────────────────────── Yumuşak ilerleme ─────────────────────────

/** Başladığın günler hatırlanır; kaç tane olduğu sayılır, ara verilen gün hiçbir şeyi sıfırlamaz. */
export const STARTS_KEEP = 60;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function parseStartDays(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const days = v.filter((d): d is string => typeof d === 'string' && DAY_KEY.test(d));
    return [...new Set(days)].sort().slice(-STARTS_KEEP);
  } catch {
    return [];
  }
}

export function addStartDay(days: string[], day: string): string[] {
  if (!DAY_KEY.test(day)) return days;
  return [...new Set([...days, day])].sort().slice(-STARTS_KEEP);
}

/** İki gün anahtarı arasındaki takvim günü farkı (saat dilimi ve yaz saati etkilemez). */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseDayKey(fromKey);
  const b = parseDayKey(toKey);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

/** Bugün dahil son `windowDays` günde kaç gün başlanmış. Gelecekteki günler sayılmaz. */
export function startsInWindow(days: string[], today: string, windowDays: number = 7): number {
  return days.filter((d) => {
    const diff = daysBetween(d, today);
    return diff >= 0 && diff < windowDays;
  }).length;
}

export function weekLine(count: number): string {
  if (count <= 0) return 'Bu hafta henüz başlamadın. Bugün sadece 2 dakika yeter.';
  if (count === 1) return 'Son 7 günde 1 gün başladın. Her başlangıç sayılır.';
  if (count >= 7) return 'Son 7 günde her gün başladın.';
  return `Son 7 günde ${count} gün başladın. Ara verdiğin günler hiçbir şeyi bozmaz.`;
}

/** Odak kartının altındaki kısa yönlendirme. */
export function focusHint(task: Task, energy: DayEnergy | null): string {
  if (task.status === 'IN_PROGRESS') return 'Başlamıştın. Devam etmek için süreyi aç ya da bitirdiysen işaretle.';
  return needsSplit(task, energy)
    ? 'Bu iş büyük görünüyor. Küçük adımlara bölmek başlamayı kolaylaştırır.'
    : 'Tek bir iş: gerisini şimdilik düşünme.';
}
