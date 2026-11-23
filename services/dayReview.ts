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
  getMoodLog,
  getOrCreateUser,
  isHardDay,
  getTask,
  listDayEvents,
  listRecentLogs,
  listRoutineLogsSince,
  listRoutines,
  listSleepLogs,
  listTaskOutcomes,
  listVisibleTasks,
  upsertDayReview,
} from '../database/repository';
import type { DayReview, DayReviewPayload, Routine, RoutineIdea, TaskStatus } from '../database/types';
import { dayKey } from './activityLogic';
import { moodInfo } from './moodLogic';
import { buildFlow } from './dayFlowLogic';
import { getSmokeLimit } from './dayFlow';
import {
  buildManualPrompt,
  buildRulesReview,
  parseManualResponse,
  withTimeUse,
  type DayFacts,
} from './dayReviewLogic';
import { FREE_PROVIDERS, type FreeConfig } from './ai/freeClient';
import { generateAiReview, generateFreeReview } from './ai/reviewAI';
import type { AiConfig } from './ai/settings';
import { loadDayNutrition, type NutritionOptions } from './nutrition';
import { nutritionDay } from './nutritionLogic';
import { analyzeSmoking } from './smokeLogic';
import { latestOutcomes } from './taskOutcomeLogic';
import { loadExercise } from './exercise';
import { exerciseDayFacts } from './exerciseLogic';
import { languageForDay } from './language';
import { analyzeTimeUse, type OpenTaskInfo } from './timeUseLogic';
import { getWork } from './workSettings';
import { workWindowFor } from './workLogic';
import { listSmokeLogs } from '../database/repository';
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
  const doneAt: { at: number; minutes: number }[] = [];
  let driftMinutes = 0;
  const energy = { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 };
  for (const l of logs) {
    if (l.taskId) {
      const t = await getTask(db, l.taskId);
      tasksDone.push({ title: t?.title ?? 'Görev', minutes: l.actualDuration });
      doneAt.push({ at: new Date(l.loggedAt).getTime(), minutes: l.actualDuration });
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
    if (state === 'OFF') continue; // o gün planlı değildi
    if (state === 'DONE') routinesDone.push(r.title);
    else if (state === 'SKIPPED') routinesSkipped.push(r.title);
    else routinesOpen.push(r.title);
  }

  // Telefon verisi
  const stat = await getDailyStat(db, key);
  const sleep = (await listSleepLogs(db, 3)).find((s) => s.day === key) ?? null;

  // Görev sonuçları (Yaptım / Yapmadım / Yapamadım) ve açık işler
  const outcomesRaw = latestOutcomes(await listTaskOutcomes(db, key));
  const missed = new Map(outcomesRaw.filter((o) => o.outcome !== 'DONE' && o.taskId).map((o) => [o.taskId as string, o]));
  const visible = await listVisibleTasks(db, start);
  const openTasks: OpenTaskInfo[] = visible
    .filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS' || (t.status === 'POSTPONED' && missed.has(t.id)))
    .map((t) => {
      const m = missed.get(t.id);
      return {
        title: t.title,
        minutes: t.estimatedDuration,
        workOk: t.workOk === true,
        missed: m ? (m.outcome as 'COULD_NOT' | 'NOT_DONE') : null,
        reason: m ? m.reason : null,
      };
    });

  // Gün akışı damgaları, iş saatleri ve zaman dökümü
  const flow = buildFlow(await listDayEvents(db, key), now);
  const minOf = (d: Date) => Math.round((d.getTime() - day.getTime()) / 60_000);
  const endMin = Math.min(1680, Math.max(0, minOf(now)));
  let wakeMin: number | null = null;
  let wakeSource: 'STAMP' | 'SLEEP' | null = null;
  if (flow.wakeAt) {
    wakeMin = minOf(flow.wakeAt);
    wakeSource = 'STAMP';
  } else if (sleep) {
    const [h, m] = formatClockIso(sleep.wakeTime).split(':').map(Number);
    wakeMin = h * 60 + m;
    wakeSource = 'SLEEP';
  }
  let work: DayFacts['workWindow'] = null;
  if (flow.shopInAt) {
    work = { startMin: minOf(flow.shopInAt), endMin: flow.shopOutAt ? minOf(flow.shopOutAt) : endMin, source: 'STAMP' };
  } else {
    const win = workWindowFor(day, await getWork(db));
    if (win) work = { ...win, source: 'SETTING' };
  }
  const dayStartMs = day.getTime();
  const doneInWork = work
    ? doneAt
        .filter((d) => d.at >= dayStartMs + work.startMin * 60_000 && d.at < dayStartMs + work.endMin * 60_000)
        .reduce((sum, d) => sum + d.minutes, 0)
    : 0;
  // Dil öğrenme: ekrandaki uygulama süresi ekrandan düşülür, ekran dışı elle girilen "kayıt dışı"dan düşülür
  const lang = await languageForDay(db, key).catch(() => null);
  const timeUse = analyzeTimeUse({
    wakeMin,
    wakeSource,
    endMin,
    work,
    commuteMinutes: (flow.commuteToMinutes ?? 0) + (flow.commuteBackMinutes ?? 0),
    prepMinutes: flow.prepMinutes ?? 0,
    doneMinutes: doneAt.reduce((sum, d) => sum + d.minutes, 0),
    doneInWorkMinutes: doneInWork,
    driftMinutes,
    screenMinutes: stat ? stat.screenMinutes : null,
    languageScreenMinutes: lang ? lang.summary.screenMinutes : 0,
    languageOffScreenMinutes: lang ? lang.summary.offScreenMinutes : 0,
  });
  const smoke = analyzeSmoking(
    (await listSmokeLogs(db, key)).map((l) => new Date(l.at)),
    now,
    await getSmokeLimit(db),
    key === nutritionDay(now)
  );

  const moodLog = await getMoodLog(db, key).catch(() => null);
  // Sabah egzersizi: program ve o günkü seans (hata verirse değerlendirme egzersizsiz devam eder)
  const exercise = await loadExercise(db)
    .then((s) => exerciseDayFacts(s, day))
    .catch(() => null);

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
    outcomes: outcomesRaw.map((o) => ({ title: o.title, outcome: o.outcome, reason: o.reason, workOk: o.workOk })),
    openTasks,
    workWindow: work,
    timeUse,
    smoke,
    mood: moodLog ? { value: moodLog.mood, label: moodInfo(moodLog.mood).label } : null,
    exercise,
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

  const rules = buildRulesReview(facts, existingTitles, activeTemplateIds);
  let payload = rules;
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
  if (generated) payload = withTimeUse(generated, rules, facts);
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
  const titles = await allRoutineTitles(db);
  const parsed = parseManualResponse(pastedText, titles);
  if (!parsed.ok) throw new Error(parsed.message);
  const payload = withTimeUse(parsed.payload, buildRulesReview(facts, titles, []), facts);
  await upsertDayReview(db, facts.day, payload, now);
  return { day: facts.day, payload, createdAt: now.toISOString() };
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

