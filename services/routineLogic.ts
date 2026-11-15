/**
 * Rutinlerin saf mantığı (veritabanından ve React Native'den bağımsız, terminalde test edilebilir):
 * bugünkü durum, erteleme saatleri, geçmiş analizi ve öneriler.
 *
 * Aura'nın ilkesi burada da geçerli: ertelemek ya da bırakmak bir kusur değildir, veridir.
 */
import type {
  Routine,
  RoutineBrief,
  RoutineDayState,
  RoutineLog,
  RoutineStats,
  RoutineSuggestion,
  TaskStatus,
} from '../database/types';
import { dayKey } from './activityLogic';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatAskTime(r: Pick<Routine, 'askHour' | 'askMinute'>): string {
  return `${pad(r.askHour)}:${pad(r.askMinute)}`;
}

function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Rutinin sorulma saati bugün geldi mi? */
export function isAskTimeReached(r: Pick<Routine, 'askHour' | 'askMinute'>, now: Date): boolean {
  return minuteOfDay(now) >= r.askHour * 60 + r.askMinute;
}

// ───────────────────────── Bugünkü durum ─────────────────────────

/**
 * Bir rutinin bugünkü durumu. `todayLogs` bugünün kayıtları, eskiden yeniye sıralı olmalıdır.
 * `taskStatusOf`: "Yapacağım" ile eklenen görevin şu anki durumu (görev silindiyse null).
 */
export function routineDayState(
  routine: Routine,
  todayLogs: RoutineLog[],
  taskStatusOf: (taskId: string) => TaskStatus | null,
  now: Date
): { state: RoutineDayState; snoozeUntil: string | null } {
  const waitingOrDue = (): { state: RoutineDayState; snoozeUntil: string | null } => ({
    state: isAskTimeReached(routine, now) ? 'DUE' : 'WAITING',
    snoozeUntil: null,
  });

  if (todayLogs.some((l) => l.outcome === 'DONE')) return { state: 'DONE', snoozeUntil: null };
  const last = todayLogs[todayLogs.length - 1];
  if (!last) return waitingOrDue();

  switch (last.outcome) {
    case 'SKIPPED':
    case 'RETIRED':
      return { state: 'SKIPPED', snoozeUntil: null };
    case 'SNOOZED': {
      const until = last.snoozeUntil ? new Date(last.snoozeUntil) : null;
      if (until && now.getTime() < until.getTime()) {
        return { state: 'SNOOZED', snoozeUntil: last.snoozeUntil };
      }
      return { state: 'DUE', snoozeUntil: null };
    }
    case 'ACCEPTED': {
      // Görevsiz kabul (gün sonu): kullanıcı "Yaptım" diyene kadar kabul edilmiş sayılır.
      if (!last.taskId) return { state: 'ACCEPTED', snoozeUntil: null };
      const status = taskStatusOf(last.taskId);
      if (status === 'COMPLETED') return { state: 'DONE', snoozeUntil: null };
      if (status === 'POSTPONED') return { state: 'SKIPPED', snoozeUntil: null };
      if (status === null) return waitingOrDue(); // görev silindi: rutin yeniden sorulabilir
      return { state: 'ACCEPTED', snoozeUntil: null };
    }
    default:
      return waitingOrDue();
  }
}

// ───────────────────────── "Sonra" seçenekleri ─────────────────────────

export type SnoozeOption = 'MIN30' | 'HOUR1' | 'EVENING' | 'TOMORROW';

export const SNOOZE_LABEL: Record<SnoozeOption, string> = {
  MIN30: '30 dakika sonra',
  HOUR1: '1 saat sonra',
  EVENING: 'Akşam',
  TOMORROW: 'Yarın',
};

/** O an seçilebilecek erteleme seçenekleri ("Akşam" yalnızca saat uygunsa). */
export function availableSnoozeOptions(now: Date): SnoozeOption[] {
  const list: SnoozeOption[] = ['MIN30', 'HOUR1'];
  if (snoozeTarget('EVENING', now)) list.push('EVENING');
  list.push('TOMORROW');
  return list;
}

/**
 * Yeniden sorulacak an. `TOMORROW` için null döner (rutin bugün için kapanır, yarın yeniden sorulur).
 * "Akşam" 19:30'dur; saat 19:00'u geçtiyse seçenek sunulmaz (null).
 */
export function snoozeTarget(option: SnoozeOption, now: Date): Date | null {
  switch (option) {
    case 'MIN30':
      return new Date(now.getTime() + 30 * 60_000);
    case 'HOUR1':
      return new Date(now.getTime() + 60 * 60_000);
    case 'EVENING': {
      const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30);
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0);
      return now.getTime() < cutoff.getTime() ? evening : null;
    }
    case 'TOMORROW':
      return null;
  }
}

// ───────────────────────── Analiz ─────────────────────────

/**
 * Son `windowDays` günün istatistiği. `logs` bu rutinin kayıtlarıdır (en az 60 gün geriye, eskiden yeniye).
 * Gün, cevap verildiyse "kapanmış" sayılır: bugün yalnızca yapıldıysa ya da atlandıysa kapanır.
 */
export function computeRoutineStats(
  routine: Routine,
  logs: RoutineLog[],
  now: Date,
  windowDays = 14
): RoutineStats {
  const today = dayKey(now);
  const since = dayKey(addDays(now, -(windowDays - 1)));

  const byDay = new Map<string, RoutineLog[]>();
  for (const l of logs) {
    if (l.routineId !== routine.id) continue;
    const list = byDay.get(l.day) ?? [];
    list.push(l);
    byDay.set(l.day, list);
  }

  let closedDays = 0;
  let doneDays = 0;
  let skippedDays = 0;
  let snoozeCount = 0;
  let acceptedNotDone = 0;
  const doneHours = new Map<number, number>();

  for (const [day, dayLogs] of byDay) {
    if (day < since || day > today) continue;
    snoozeCount += dayLogs.filter((l) => l.outcome === 'SNOOZED').length;

    const done = dayLogs.filter((l) => l.outcome === 'DONE');
    const last = dayLogs[dayLogs.length - 1];
    const isToday = day === today;

    if (done.length > 0) {
      closedDays += 1;
      doneDays += 1;
      const h = new Date(done[0].loggedAt).getHours();
      doneHours.set(h, (doneHours.get(h) ?? 0) + 1);
      continue;
    }
    const wasAccepted = dayLogs.some((l) => l.outcome === 'ACCEPTED');
    if (isToday) {
      // Bugün henüz bitmediyse (sorulmuş, ertelenmiş ya da kabul edilmiş) sayıma katılmaz.
      if (last.outcome === 'SKIPPED' || last.outcome === 'RETIRED') {
        closedDays += 1;
        skippedDays += 1;
      }
      continue;
    }
    closedDays += 1;
    skippedDays += 1;
    if (wasAccepted) acceptedNotDone += 1;
  }

  // Seri: bugünden (yapıldıysa) ya da dünden başlayarak üst üste yapılan günler.
  const doneSet = new Set<string>();
  for (const l of logs) if (l.routineId === routine.id && l.outcome === 'DONE') doneSet.add(l.day);
  let streak = 0;
  let cursor = doneSet.has(today) ? 0 : 1;
  while (cursor < 365 && doneSet.has(dayKey(addDays(now, -cursor)))) {
    streak += 1;
    cursor += 1;
  }

  let bestHour: number | null = null;
  const totalDone = [...doneHours.values()].reduce((a, b) => a + b, 0);
  if (totalDone >= 3) {
    let max = 0;
    for (const [h, c] of doneHours) {
      if (c > max || (c === max && bestHour !== null && h < bestHour)) {
        max = c;
        bestHour = h;
      }
    }
  }

  return {
    closedDays,
    doneDays,
    skippedDays,
    snoozeCount,
    acceptedNotDone,
    rate: closedDays > 0 ? doneDays / closedDays : 0,
    streak,
    bestHour,
  };
}

// ───────────────────────── Öneriler ─────────────────────────

/** Son 7 günün istatistiğine göre en fazla bir öneri. Dil yargısızdır. */
export function suggestForRoutine(routine: Routine, s7: RoutineStats): RoutineSuggestion | null {
  if (s7.closedDays >= 5 && s7.doneDays <= 1 && s7.skippedDays + s7.snoozeCount >= 5) {
    return {
      kind: 'RETIRE',
      text: 'Bu rutin son günlerde pek oturmadı. Süresini küçültebilir, saatini değiştirebilir ya da bırakabilirsin; hepsi geçerli bir karar.',
    };
  }

  if (s7.snoozeCount >= 3) {
    let hour: number;
    let minute = 0;
    if (s7.bestHour !== null && s7.bestHour !== routine.askHour) {
      hour = s7.bestHour;
    } else if (routine.askHour < 14) {
      hour = 18;
      minute = 30;
    } else {
      hour = 9;
    }
    return {
      kind: 'MOVE_TIME',
      hour,
      minute,
      text: `Bu rutini son günlerde ${s7.snoozeCount} kez erteledin. Saati ${pad(hour)}:${pad(minute)} yapmayı deneyelim mi?`,
    };
  }

  if (s7.acceptedNotDone >= 2 && routine.estimatedDuration >= 15) {
    const minutes = Math.max(5, Math.round(routine.estimatedDuration / 2 / 5) * 5);
    return {
      kind: 'SHRINK',
      minutes,
      text: `"Yapacağım" deyip tamamlanamayan günler oldu. Süreyi ${minutes} dk'ya indirip küçük başlayalım mı?`,
    };
  }

  if (s7.streak >= 3) {
    return {
      kind: 'KEEP_GOING',
      text: `${s7.streak} gündür aralıksız yapıyorsun. Bu ritim kıymetli.`,
    };
  }
  return null;
}

// ───────────────────────── Özet ─────────────────────────

export function buildRoutineBrief(
  routine: Routine,
  logs: RoutineLog[],
  taskStatusOf: (taskId: string) => TaskStatus | null,
  now: Date
): RoutineBrief {
  const own = logs.filter((l) => l.routineId === routine.id);
  const today = dayKey(now);
  const { state, snoozeUntil } = routineDayState(
    routine,
    own.filter((l) => l.day === today),
    taskStatusOf,
    now
  );
  return {
    routine,
    state,
    snoozeUntil,
    stats: computeRoutineStats(routine, own, now, 14),
    suggestion: suggestForRoutine(routine, computeRoutineStats(routine, own, now, 7)),
  };
}

export function todayProgress(briefs: RoutineBrief[]): { done: number; open: number; skipped: number } {
  let done = 0;
  let open = 0;
  let skipped = 0;
  for (const b of briefs) {
    if (b.state === 'DONE') done += 1;
    else if (b.state === 'SKIPPED') skipped += 1;
    else open += 1;
  }
  return { done, open, skipped };
}

/** Cevap bekleyen (şimdi sorulması gereken) rutinler, sorulma saatine göre. */
export function dueBriefs(briefs: RoutineBrief[]): RoutineBrief[] {
  return briefs
    .filter((b) => b.state === 'DUE')
    .sort(
      (a, b) =>
        a.routine.askHour * 60 + a.routine.askMinute - (b.routine.askHour * 60 + b.routine.askMinute)
    );
}
