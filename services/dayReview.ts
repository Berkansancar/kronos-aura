/**
 * Gün sonu değerlendirmesi (veritabanı + yapay zekâ koordinasyonu). Akış:
 *  1. Gün verileri toplanır (görevler, rutinler, adım/ekran, uyku).
 *  2. Yapay zekâ anahtarı varsa Aura yorumlar, Kronos yarını planlar, yeni rutin fikirleri çıkar;
 *     yoksa ya da hata olursa aynı yapı kural tabanlı üretilir.
 *  3. Kullanıcı her rutin için "yarın yapacağım / yarın değil" der; "yapacağım" dedikleri yarın sabah plana girer.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addRoutineLog,
  getDailyStat,
  getDayReview,
  getOrCreateUser,
  isHardDay,
  getTask,
  listRecentLogs,
  listRoutineLogsSince,
  listRoutines,
  listSleepLogs,
  listVisibleTasks,
  upsertDayReview,
} from '../database/repository';
import type { DayReview, DayReviewPayload, Routine, RoutineIdea, TaskStatus } from '../database/types';
import { dayKey } from './activityLogic';
import {
  buildManualPrompt,
  buildRulesReview,
  parseManualResponse,
  type DayFacts,
} from './dayReviewLogic';
import { FREE_PROVIDERS, type FreeConfig } from './ai/freeClient';
import { generateAiReview, generateFreeReview } from './ai/reviewAI';
import type { AiConfig } from './ai/settings';
import { loadDayNutrition, type NutritionOptions } from './nutrition';
import { DAY_END_HOUR } from './planner';
import { acceptRoutine, addCustomRoutine, addRoutineFromTemplate } from './routineFlow';
import { routineDayState } from './routineLogic';
import { formatClockIso } from './sleepLogic';

/** Gece yarısından sonra (04:00'e kadar) hâlâ "dünün" gün sonudur. */
export function reviewDayOf(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < 4) d.setDate(d.getDate() - 1);
  return d;
}

/** Değerlendirme 20:00'den sonra ve gece 04:00'e kadar açılabilir. */
export function reviewAvailable(now: Date): boolean {
  return now.getHours() >= 20 || now.getHours() < 4;
}

function nextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

// ───────────────────────── Gerçekleri topla ─────────────────────────

export async function gatherDayFacts(
  db: SQLiteDatabase,
  now: Date,
  nutritionOpts?: NutritionOptions
): Promise<DayFacts> {
  const day = reviewDayOf(now);
  const key = dayKey(day);
  const start = day.toISOString();
  const end = nextDay(day).toISOString();
  const user = await getOrCreateUser(db);

  // Görevler ve zaman kayıtları
  const logs = (await listRecentLogs(db, 80)).filter((l) => l.loggedAt >= start && l.loggedAt < end);
  const tasksDone: DayFacts['tasksDone'] = [];
  let driftMinutes = 0;
  const energy = { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 };
  for (const l of logs) {
    if (l.taskId) {
      const t = await getTask(db, l.taskId);
      tasksDone.push({ title: t?.title ?? 'Görev', minutes: l.actualDuration });
      energy[l.energyStateAtCompletion] += 1;
    } else {
      driftMinutes += l.actualDuration;
    }
  }
  const tasksOpen = (await listVisibleTasks(db, start)).filter(
    (t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
  ).length;

  // Rutinler: günün son durumu
  const routines = await listRoutines(db, 'ACTIVE');
  const dayLogs = (await listRoutineLogsSince(db, key)).filter((l) => l.day === key);
  const taskStatus = new Map<string, TaskStatus>();
  for (const l of dayLogs) {
    if (l.taskId && !taskStatus.has(l.taskId)) {
      const t = await getTask(db, l.taskId);
      if (t) taskStatus.set(l.taskId, t.status);
    }
  }
  const routinesDone: string[] = [];
  const routinesSkipped: string[] = [];
  const routinesOpen: string[] = [];
  for (const r of routines) {
    const own = dayLogs.filter((l) => l.routineId === r.id);
    // Gün bittiği için saat koşulu önemsiz: akşamın sonunda durumu sorarız
    const { state } = routineDayState(r, own, (id) => taskStatus.get(id) ?? null, endOfDay(day));
    if (state === 'DONE') routinesDone.push(r.title);
    else if (state === 'SKIPPED') routinesSkipped.push(r.title);
    else routinesOpen.push(r.title);
  }

  // Telefon verisi
  const stat = await getDailyStat(db, key);
  const sleep = (await listSleepLogs(db, 3)).find((s) => s.day === key) ?? null;

  return {
    day: key,
    tasksDone,
    tasksOpen,
    driftMinutes,
    routinesDone,
    routinesSkipped,
    routinesOpen,
    energy,
    steps: stat ? stat.steps : null,
    stepsReliable: stat ? stat.steps > 0 : false,
    screenMinutes: stat ? stat.screenMinutes : null,
    sleepMinutes: sleep ? sleep.durationMinutes : null,
    sleepBed: sleep ? formatClockIso(sleep.bedtime) : null,
    sleepWake: sleep ? formatClockIso(sleep.wakeTime) : null,
    peakStartHour: user.peakStartHour,
    peakEndHour: user.peakEndHour,
    nutrition: nutritionOpts ? await loadDayNutrition(db, now, nutritionOpts, key).catch(() => null) : null,
  };
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
}

// ───────────────────────── Değerlendirmeyi üret ─────────────────────────

export interface ReviewResult {
  facts: DayFacts;
  review: DayReview;
  /** Yapay zekâ denendi ama başarısız olduysa kısa açıklama */
  aiError: string | null;
}

/** Bugünkü kayıt varsa onu verir; `force` ise yeniden üretir. */
export async function loadOrCreateReview(
  db: SQLiteDatabase,
  now: Date,
  opts: {
    cfg: AiConfig | null;
    free?: FreeConfig | null;
    shareActivity: boolean;
    force?: boolean;
    nutritionOpts?: NutritionOptions;
  }
): Promise<ReviewResult> {
  const facts = await gatherDayFacts(db, now, opts.nutritionOpts);
  if (!opts.force) {
    const stored = await getDayReview(db, facts.day);
    if (stored) return { facts, review: stored, aiError: null };
  }

  const active = await listRoutines(db, 'ACTIVE');
  const retired = await listRoutines(db, 'RETIRED');
  // Bırakılan rutinler tekrar önerilmesin
  const existingTitles = [...active, ...retired].map((r) => r.title);
  const activeTemplateIds = active.map((r) => r.templateId).filter((x): x is string => !!x);

  let payload = buildRulesReview(facts, existingTitles, activeTemplateIds);
  // Sıra: ücretsiz anahtar (kullanıcı özellikle bunun için eklediyse) -> Claude anahtarı -> hazır kurallar.
  const errors: string[] = [];
  let generated: DayReviewPayload | null = null;
  if (opts.free) {
    try {
      generated = await generateFreeReview(facts, existingTitles, opts.shareActivity, opts.free);
    } catch (e) {
      const label = FREE_PROVIDERS[opts.free.provider].label;
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!generated && opts.cfg) {
    try {
      generated = await generateAiReview(facts, existingTitles, opts.shareActivity, opts.cfg);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (generated) payload = generated;
  const aiError: string | null = generated || errors.length === 0 ? null : errors.join(' · ');

  await upsertDayReview(db, facts.day, payload, now);
  return { facts, review: { day: facts.day, payload, createdAt: now.toISOString() }, aiError };
}

// ───────────────────────── Elle (ücretsiz sohbet uygulaması) ─────────────────────────

async function allRoutineTitles(db: SQLiteDatabase): Promise<string[]> {
  const active = await listRoutines(db, 'ACTIVE');
  const retired = await listRoutines(db, 'RETIRED');
  return [...active, ...retired].map((r) => r.title);
}

/** Kopyalanıp ücretsiz sohbet uygulamasına yapıştırılacak günün özeti ve komut. */
export async function buildManualReviewPrompt(
  db: SQLiteDatabase,
  now: Date,
  nutritionOpts?: NutritionOptions
): Promise<string> {
  const facts = await gatherDayFacts(db, now, nutritionOpts);
  return buildManualPrompt(facts, await allRoutineTitles(db));
}

/**
 * Sohbet uygulamasından yapıştırılan cevabı okur ve günün değerlendirmesi olarak kaydeder.
 * Cevap okunamazsa fırlatır ve mevcut değerlendirmeye dokunmaz.
 */
export async function saveManualReview(
  db: SQLiteDatabase,
  now: Date,
  pastedText: string
): Promise<DayReview> {
  const facts = await gatherDayFacts(db, now);
  const parsed = parseManualResponse(pastedText, await allRoutineTitles(db));
  if (!parsed.ok) throw new Error(parsed.message);
  await upsertDayReview(db, facts.day, parsed.payload, now);
  return { day: facts.day, payload: parsed.payload, createdAt: now.toISOString() };
}

// ───────────────────────── Yarın cevapları ─────────────────────────

export type TomorrowAnswer = 'ACCEPTED' | 'SKIPPED';

/** `day` günü için verilmiş son cevaplar (rutin id -> cevap). */
export async function answersForDay(db: SQLiteDatabase, day: Date): Promise<Map<string, TomorrowAnswer>> {
  const key = dayKey(day);
  const logs = (await listRoutineLogsSince(db, key)).filter((l) => l.day === key);
  const out = new Map<string, TomorrowAnswer>();
  for (const l of logs) {
    if (l.outcome === 'ACCEPTED') out.set(l.routineId, 'ACCEPTED');
    else if (l.outcome === 'SKIPPED') out.set(l.routineId, 'SKIPPED');
    else if (l.outcome === 'DONE' || l.outcome === 'SNOOZED') out.delete(l.routineId);
  }
  return out;
}

/** Değerlendirilen günün ertesi için cevaplar. */
export async function tomorrowAnswers(db: SQLiteDatabase, now: Date): Promise<Map<string, TomorrowAnswer>> {
  return answersForDay(db, nextDay(reviewDayOf(now)));
}

async function logForTomorrow(
  db: SQLiteDatabase,
  routine: Routine,
  now: Date,
  outcome: 'ACCEPTED' | 'SKIPPED'
): Promise<void> {
  await addRoutineLog(db, {
    routineId: routine.id,
    day: dayKey(nextDay(reviewDayOf(now))),
    outcome,
    loggedAt: now,
  });
}

/** "Yarın yapacağım": yarın sabah plana yerleştirilir (görev o zaman oluşur). */
export function planForTomorrow(db: SQLiteDatabase, routine: Routine, now: Date): Promise<void> {
  return logForTomorrow(db, routine, now, 'ACCEPTED');
}

/** "Yarın değil": yarın bu rutin sorulmaz. */
export function skipForTomorrow(db: SQLiteDatabase, routine: Routine, now: Date): Promise<void> {
  return logForTomorrow(db, routine, now, 'SKIPPED');
}

/**
 * Dün akşam "yarın yapacağım" denen rutinleri bugünün planına yerleştirir.
 * Sabah (05:00) ile gün sonu (22:00) arasında, uygulama her yüklendiğinde güvenle çağrılabilir.
 */
export async function materializePlannedRoutines(db: SQLiteDatabase, now: Date): Promise<number> {
  if (now.getHours() < 5 || now.getHours() >= DAY_END_HOUR) return 0;
  const key = dayKey(now);
  const todays = (await listRoutineLogsSince(db, key)).filter((l) => l.day === key);
  if (todays.length === 0) return 0;

  let created = 0;
  for (const r of await listRoutines(db, 'ACTIVE')) {
    const own = todays.filter((l) => l.routineId === r.id);
    const last = own[own.length - 1];
    if (!last || last.outcome !== 'ACCEPTED' || last.taskId) continue;
    await acceptRoutine(db, r, now);
    created += 1;
  }
  return created;
}

// ───────────────────────── Fikri rutine çevir ─────────────────────────

/** Önerilen fikri rutin olarak ekler. Aynı ad zaten aktifse mevcut rutini döndürür. */
export async function addIdeaAsRoutine(db: SQLiteDatabase, idea: RoutineIdea): Promise<Routine> {
  const active = await listRoutines(db, 'ACTIVE');
  const same = active.find((r) => r.title.trim().toLocaleLowerCase('tr-TR') === idea.title.trim().toLocaleLowerCase('tr-TR'));
  if (same) return same;
  if (idea.templateId) return addRoutineFromTemplate(db, idea.templateId);
  return addCustomRoutine(db, {
    title: idea.title,
    category: idea.category,
    estimatedDuration: idea.minutes,
    cognitiveWeight: 'LOW',
    askHour: idea.hour,
    askMinute: idea.minute,
  });
}

// ───────────────────────── Bildirim seçenekleri ─────────────────────────

/** Hatırlatma planı için: bugün değerlendirme yapıldı mı, yarın için hangi rutinler cevaplandı. */
export async function reminderExtras(
  db: SQLiteDatabase,
  now: Date
): Promise<{ reviewDone: boolean; answeredTomorrow: Set<string>; hardDayToday: boolean }> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const reviewDone = (await getDayReview(db, dayKey(today))) !== null;
  const answers = await answersForDay(db, nextDay(today));
  return {
    reviewDone,
    answeredTomorrow: new Set(answers.keys()),
    hardDayToday: await isHardDay(db, dayKey(today)),
  };
}

