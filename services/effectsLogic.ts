/**
 * "Etki" ekranının saf mantığı: seri hesabı, aşama durumu, tekrar ve kalori toplamı, ekran satırları.
 * React Native ve veritabanına bağlı değildir; terminalde test edilir (npm run test:effects).
 * İçerik (kas listeleri, aşama metinleri, kaynaklar) services/effectsData.ts içindedir.
 */
import { parseDayKey } from './activityLogic';
import { variantFor, type ExerciseState } from './exerciseLogic';
import {
  PROFILES,
  PROFILE_BY_ID,
  STAGES,
  type EffectId,
  type EffectProfile,
  type StageId,
} from './effectsData';
import type { MoveId } from './exerciseData';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** İki gün anahtarı arasındaki gün farkı (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((parseDayKey(b).getTime() - parseDayKey(a).getTime()) / 86_400_000);
}

export interface Streak {
  /** Seri sürüyor mu (son aktif günden bu yana izin verilen aralığı aşmadın mı) */
  alive: boolean;
  start: string | null;
  last: string | null;
  /** Serideki aktif gün sayısı (seans ya da gün) */
  activeDays: number;
  /** Serinin ilk gününden son aktif güne kadar geçen gün sayısı (ilk gün dahil) */
  spanDays: number;
  /** Aşamaları açan gün sayısı: seri sürmüyorsa 0 */
  progressDays: number;
  /** Geçmişteki en uzun serinin gün sayısı */
  bestSpan: number;
  doneToday: boolean;
  /** Son aktif günün bugünden kaç gün önce olduğu; hiç yoksa null */
  sinceLast: number | null;
}

/**
 * Gün anahtarlarından seri çıkarır. İki aktif gün arasındaki fark `maxGap` günü aşmazsa seri sürer
 * (her gün yapılan işlerde 1; Pzt-Çar-Cum egzersizinde Cuma'dan Pazartesi'ye 3 gün). Geleceğe ait ve bozuk anahtarlar sayılmaz.
 * `restCounts` doğruysa (güç antrenmanı) dinlenme günleri de aşamayı ilerletir; yoksa yalnızca son aktif güne kadar sayılır.
 */
export function computeStreak(days: Iterable<string>, today: string, maxGap: number, restCounts: boolean): Streak {
  const keys = [...new Set(days)].filter((k) => DAY_RE.test(k) && k <= today).sort();
  if (keys.length === 0) {
    return { alive: false, start: null, last: null, activeDays: 0, spanDays: 0, progressDays: 0, bestSpan: 0, doneToday: false, sinceLast: null };
  }
  const chains: { start: string; last: string; active: number }[] = [];
  for (const k of keys) {
    const c = chains[chains.length - 1];
    if (c && dayDiff(c.last, k) <= maxGap) {
      c.last = k;
      c.active += 1;
    } else {
      chains.push({ start: k, last: k, active: 1 });
    }
  }
  const cur = chains[chains.length - 1];
  const sinceLast = dayDiff(cur.last, today);
  const alive = sinceLast <= maxGap;
  const spanDays = dayDiff(cur.start, cur.last) + 1;
  const bestSpan = chains.reduce((m, c) => Math.max(m, dayDiff(c.start, c.last) + 1), 0);
  const progressDays = alive ? (restCounts ? dayDiff(cur.start, today) + 1 : spanDays) : 0;
  return {
    alive,
    start: cur.start,
    last: cur.last,
    activeDays: cur.active,
    spanDays,
    progressDays,
    bestSpan,
    doneToday: cur.last === today,
    sinceLast,
  };
}

export type StageState = 'reached' | 'current' | 'later';

export interface StageRow {
  id: StageId;
  label: string;
  afterDays: number;
  text: string;
  state: StageState;
  /** Aşamaya kalan gün (ulaşıldıysa 0) */
  daysLeft: number;
}

/** Her aşamanın durumu: ulaşılanların en sonuncusu "şu an", sonrakiler "ileride". */
export function stageRows(profile: EffectProfile, progressDays: number): StageRow[] {
  let currentIdx = -1;
  STAGES.forEach((s, i) => {
    if (progressDays >= s.afterDays) currentIdx = i;
  });
  return STAGES.map((s, i) => ({
    id: s.id,
    label: s.label,
    afterDays: s.afterDays,
    text: profile.stages[s.id],
    state: i < currentIdx ? 'reached' : i === currentIdx ? 'current' : 'later',
    daysLeft: Math.max(0, s.afterDays - progressDays),
  }));
}

/** Kilo geçersizse ya da yoksa 70 kg kabul edilir. */
export function safeWeight(kg: number | null | undefined): number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= 35 && kg <= 250 ? kg : 70;
}

export function formatKcal(k: number): string {
  if (!Number.isFinite(k) || k <= 0) return '0 kcal';
  if (k < 1) return '1 kcal\'den az';
  return `${Math.round(k)} kcal`;
}

export interface MoveItemFacts {
  name: string;
  sets: number[];
  /** Kaydedildiği gibi toplam (tekrar ya da saniye); bacakta her bacak için */
  units: number;
  kcal: number;
}

export interface MoveFacts {
  days: string[];
  sessions: number;
  units: number;
  kcal: number;
  today: MoveItemFacts | null;
}

/** Bir güç hareketinin seans geçmişinden gün listesi, toplam tekrar ve yaklaşık kalori. */
export function moveFacts(state: ExerciseState, move: MoveId, today: string, weightKg: number | null | undefined): MoveFacts {
  const profile = PROFILE_BY_ID[move];
  const perUnit = (profile.kcalPer70 ?? 0) * (safeWeight(weightKg) / 70);
  const days: string[] = [];
  let units = 0;
  let kcal = 0;
  let todayFacts: MoveItemFacts | null = null;
  for (const s of state.sessions) {
    const it = s.items.find((x) => x.move === move);
    if (!it || it.sets.length === 0) continue;
    const v = variantFor(move, it.level);
    const sum = it.sets.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
    const k = sum * (v.perSide ? 2 : 1) * perUnit;
    days.push(s.day);
    units += sum;
    kcal += k;
    if (s.day === today) todayFacts = { name: v.name, sets: it.sets.slice(), units: sum, kcal: k };
  }
  return { days, sessions: new Set(days).size, units, kcal, today: todayFacts };
}

/** Günlük su toplamı hedefe ulaşan günler. */
export function waterGoalDays(logs: { day: string; ml: number }[], goalMl: number): string[] {
  const sum = new Map<string, number>();
  for (const l of logs) sum.set(l.day, (sum.get(l.day) ?? 0) + (Number.isFinite(l.ml) ? l.ml : 0));
  const goal = Math.max(500, goalMl);
  return [...sum.entries()].filter(([, ml]) => ml >= goal).map(([d]) => d);
}

export interface EffectInput {
  exercise: ExerciseState;
  /** Her su kaydı: gün ve ml */
  water: { day: string; ml: number }[];
  waterGoalMl: number;
  /** Dil çalışılan günler ve dakikaları (dakika 0 olan günler sayılmaz) */
  study: { day: string; minutes: number }[];
  /** Mantıksal bugün (gün anahtarı) */
  today: string;
  weightKg?: number | null;
}

export interface EffectView {
  id: EffectId;
  profile: EffectProfile;
  streak: Streak;
  stages: StageRow[];
  /** Şu anki aşama; seri yoksa null */
  current: StageRow | null;
  /** Sıradaki aşama (varsa) */
  next: StageRow | null;
  headline: string;
  todayText: string;
  todayDone: boolean;
  /** Toplam satırı (tekrar, seans, kalori) ya da null */
  totalText: string | null;
}

const unitWord = (p: EffectProfile): string => (p.unit === 'sec' ? 'sn' : 'tekrar');

function headlineFor(profile: EffectProfile, st: Streak): string {
  if (st.activeDays === 0) return 'Henüz başlamadın';
  if (!st.alive) return `Seri bitti (en uzunu ${st.bestSpan} gün). Bugün yeniden başlamak için uygun`;
  const parts = [`Seri ${st.spanDays} gün`];
  if (profile.strength) parts.push(`${st.activeDays} seans`);
  return parts.join(' · ');
}

export function buildEffects(input: EffectInput): EffectView[] {
  const waterByDay = new Map<string, number>();
  for (const w of input.water) waterByDay.set(w.day, (waterByDay.get(w.day) ?? 0) + (Number.isFinite(w.ml) ? w.ml : 0));
  const studyByDay = new Map<string, number>();
  for (const s of input.study) if (s.minutes > 0) studyByDay.set(s.day, (studyByDay.get(s.day) ?? 0) + s.minutes);

  return PROFILES.map((profile): EffectView => {
    let days: string[] = [];
    let todayText = 'Bugün yapılmadı';
    let totalText: string | null = null;

    if (profile.strength) {
      const f = moveFacts(input.exercise, profile.id as MoveId, input.today, input.weightKg);
      days = f.days;
      if (f.today) {
        const t = f.today;
        todayText = `${t.name}: ${t.sets.join(' + ')} (${t.units} ${unitWord(profile)}), yaklaşık ${formatKcal(t.kcal)}`;
      }
      if (f.sessions > 0) totalText = `Toplam ${f.sessions} seans, ${f.units} ${unitWord(profile)}, yaklaşık ${formatKcal(f.kcal)}`;
    } else if (profile.id === 'water') {
      days = waterGoalDays(input.water, input.waterGoalMl);
      const ml = waterByDay.get(input.today) ?? 0;
      todayText = ml > 0 ? `Bugün ${ml} ml / ${Math.max(500, input.waterGoalMl)} ml` : 'Bugün su kaydı yok';
      if (days.length > 0) totalText = `Hedefe ulaştığın ${days.length} gün`;
    } else {
      days = [...studyByDay.keys()];
      const min = studyByDay.get(input.today) ?? 0;
      todayText = min > 0 ? `Bugün ${min} dk çalıştın` : 'Bugün çalışma kaydı yok';
      if (days.length > 0) totalText = `${days.length} gün çalıştın, toplam ${[...studyByDay.values()].reduce((a, b) => a + b, 0)} dk`;
    }

    const streak = computeStreak(days, input.today, profile.maxGap, profile.restCounts);
    const stages = stageRows(profile, streak.progressDays);
    const current = stages.find((s) => s.state === 'current') ?? null;
    const next = stages.find((s) => s.state === 'later') ?? null;
    const todayDone = profile.id === 'water' ? waterGoalDays(input.water, input.waterGoalMl).includes(input.today) : streak.doneToday;
    return {
      id: profile.id,
      profile,
      streak,
      stages,
      current,
      next,
      headline: headlineFor(profile, streak),
      todayText,
      todayDone,
      totalText,
    };
  });
}

/** Aşama adının "-e" hali: "4. hafta" -> "4. haftaya", "2. gün" -> "2. güne". */
export function toStage(label: string): string {
  return label.endsWith('hafta') ? `${label}ya` : `${label}e`;
}

/** Sıradaki aşamaya kalan süreyi kısa cümleyle söyler; seri yoksa null. */
export function nextHint(view: EffectView): string | null {
  if (!view.streak.alive || !view.next) return null;
  const n = view.next.daysLeft;
  return `${toStage(view.next.label)} ${n === 1 ? '1 gün' : `${n} gün`} kaldı`;
}
