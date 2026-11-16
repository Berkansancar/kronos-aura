/**
 * Rutin eylemleri. Her eylem cevabı RoutineLog'a yazar (analiz bunlardan beslenir) ve gerekirse Kronos'a
 * günü yeniden planlatır.
 *
 *  - Yapacağım      -> rutin bugünün görevi olur ve plana yerleşir
 *  - Yaptım         -> rutin bugün tamamlandı
 *  - Sonra          -> belirlenen saatte yeniden sorulur
 *  - Bugün değil    -> bugün için kapanır, yarın yeniden sorulur
 *  - Bir daha yapmam-> rutin bırakılır (geçmişi saklanır, geri alınabilir)
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addRoutineLog,
  createRoutine,
  createTask,
  deleteManualRoutineDoneLogs,
  deleteTask,
  getRoutine,
  getTask,
  listRoutineLogsSince,
  listRoutines,
  setRoutineStatus,
  setTaskStatus,
  updateRoutine,
  type NewRoutine,
} from '../database/repository';
import type { Routine, RoutineLog, Task } from '../database/types';
import { dayKey } from './activityLogic';
import { DAY_END_HOUR, replanDay } from './planner';
import { snoozeTarget, type SnoozeOption } from './routineLogic';
import { serializeDays } from './routineDaysLogic';
import { getPack, getTemplate } from './routineTemplates';

// ───────────────────────── Ekleme ve düzenleme ─────────────────────────

/** Hazır örnekten ekler. Aynı örnek zaten aktifse yenisini oluşturmaz. `at` verilirse sorulma saati o olur. */
export async function addRoutineFromTemplate(
  db: SQLiteDatabase,
  templateId: string,
  at?: { hour: number; minute: number }
): Promise<Routine> {
  const t = getTemplate(templateId);
  if (!t) throw new Error('Bu örnek rutin bulunamadı.');
  const existing = (await listRoutines(db, 'ACTIVE')).find((r) => r.templateId === templateId);
  if (existing) return existing;
  return createRoutine(db, {
    title: t.title,
    category: t.category,
    estimatedDuration: t.estimatedDuration,
    cognitiveWeight: t.cognitiveWeight,
    askHour: at?.hour ?? t.askHour,
    askMinute: at?.minute ?? t.askMinute,
    templateId: t.id,
    icon: t.icon,
    days: serializeDays(t.days ?? null),
  });
}

/** Paketteki tüm rutinleri ekler; zaten aktif olanlar atlanır. */
export async function addRoutinePack(
  db: SQLiteDatabase,
  packId: string
): Promise<{ added: number; skipped: number }> {
  const pack = getPack(packId);
  if (!pack) throw new Error('Bu paket bulunamadı.');
  const active = new Set(
    (await listRoutines(db, 'ACTIVE')).map((r) => r.templateId).filter((x): x is string => !!x)
  );
  let added = 0;
  let skipped = 0;
  for (const item of pack.items) {
    if (active.has(item.templateId)) {
      skipped += 1;
      continue;
    }
    await addRoutineFromTemplate(
      db,
      item.templateId,
      item.hour !== undefined ? { hour: item.hour, minute: item.minute ?? 0 } : undefined
    );
    active.add(item.templateId);
    added += 1;
  }
  return { added, skipped };
}

export async function addCustomRoutine(db: SQLiteDatabase, input: NewRoutine): Promise<Routine> {
  return createRoutine(db, input);
}

export async function changeRoutineTime(
  db: SQLiteDatabase,
  id: string,
  hour: number,
  minute: number
): Promise<void> {
  await updateRoutine(db, id, { askHour: hour, askMinute: minute });
}

export async function changeRoutineDuration(db: SQLiteDatabase, id: string, minutes: number): Promise<void> {
  await updateRoutine(db, id, { estimatedDuration: minutes });
}

// ───────────────────────── Yardımcılar ─────────────────────────

async function todayLogs(db: SQLiteDatabase, routineId: string, now: Date): Promise<RoutineLog[]> {
  const day = dayKey(now);
  return (await listRoutineLogsSince(db, day)).filter((l) => l.routineId === routineId && l.day === day);
}

/** Bugün "Yapacağım" ile eklenmiş, hâlâ açık (bitmemiş) görev varsa onu döndürür. */
async function openAcceptedTask(db: SQLiteDatabase, routineId: string, now: Date): Promise<Task | null> {
  const logs = await todayLogs(db, routineId, now);
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const l = logs[i];
    if (l.outcome === 'ACCEPTED' && l.taskId) {
      const t = await getTask(db, l.taskId);
      if (t && t.status !== 'COMPLETED') return t;
    }
  }
  return null;
}

// ───────────────────────── Cevaplar ─────────────────────────

/** "Yapacağım": rutin bugünün görevi olur ve Kronos onu enerji saatlerine göre yerleştirir. */
export async function acceptRoutine(
  db: SQLiteDatabase,
  routine: Routine,
  now: Date = new Date()
): Promise<void> {
  const day = dayKey(now);

  // Gün kapanmışsa (22:00 sonrası) görev yarının planına karışmasın; yalnızca kabul kaydı tutulur.
  if (now.getHours() >= DAY_END_HOUR) {
    await addRoutineLog(db, { routineId: routine.id, day, outcome: 'ACCEPTED', loggedAt: now });
    return;
  }

  const open = await openAcceptedTask(db, routine.id, now);
  if (open) {
    await addRoutineLog(db, { routineId: routine.id, day, outcome: 'ACCEPTED', taskId: open.id, loggedAt: now });
    return;
  }

  const task = await createTask(db, {
    title: routine.title,
    estimatedDuration: routine.estimatedDuration,
    cognitiveWeight: routine.cognitiveWeight,
    routineId: routine.id,
  });
  await addRoutineLog(db, { routineId: routine.id, day, outcome: 'ACCEPTED', taskId: task.id, loggedAt: now });
  await replanDay(db, now, 'TASK_ADDED');
}

/** "Yaptım": rutin bugün tamamlandı (açık görev varsa o da kapanır). */
export async function markRoutineDone(
  db: SQLiteDatabase,
  routine: Routine,
  now: Date = new Date()
): Promise<void> {
  const open = await openAcceptedTask(db, routine.id, now);
  if (open) {
    await setTaskStatus(db, open.id, 'COMPLETED', now);
    await replanDay(db, now, 'TASK_COMPLETED');
  }
  const already = (await todayLogs(db, routine.id, now)).some((l) => l.outcome === 'DONE');
  if (!already) {
    await addRoutineLog(db, {
      routineId: routine.id,
      day: dayKey(now),
      outcome: 'DONE',
      taskId: open?.id ?? null,
      loggedAt: now,
    });
  }
}

/** Rutinden doğan görev normal akışla (Başla/Bitir) tamamlanınca rutini de "yapıldı" yazar. */
export async function recordRoutineDoneFromTask(
  db: SQLiteDatabase,
  task: Task,
  now: Date = new Date()
): Promise<void> {
  if (!task.routineId) return;
  const routine = await getRoutine(db, task.routineId);
  if (!routine) return;
  const already = (await todayLogs(db, routine.id, now)).some((l) => l.outcome === 'DONE');
  if (already) return;
  await addRoutineLog(db, {
    routineId: routine.id,
    day: dayKey(now),
    outcome: 'DONE',
    taskId: task.id,
    loggedAt: now,
  });
}

/**
 * "Sonra": seçilen saatte yeniden sorulur. "Yarın" seçilirse rutin bugün için kapanır.
 * Yeniden soru zamanını (bildirim için) döndürür; yarın ise null.
 */
export async function snoozeRoutine(
  db: SQLiteDatabase,
  routine: Routine,
  option: SnoozeOption,
  now: Date = new Date()
): Promise<Date | null> {
  const day = dayKey(now);
  const until = snoozeTarget(option, now);
  if (!until) {
    await addRoutineLog(db, { routineId: routine.id, day, outcome: 'SKIPPED', loggedAt: now });
    return null;
  }
  await addRoutineLog(db, { routineId: routine.id, day, outcome: 'SNOOZED', snoozeUntil: until, loggedAt: now });
  return until;
}

/** Bugünlük vazgeç: açık görev varsa plandan çıkar, yarın yeniden sorulur. */
export async function skipRoutineToday(
  db: SQLiteDatabase,
  routine: Routine,
  now: Date = new Date()
): Promise<void> {
  const open = await openAcceptedTask(db, routine.id, now);
  if (open) {
    await deleteTask(db, open.id);
    await replanDay(db, now, 'MANUAL');
  }
  await addRoutineLog(db, { routineId: routine.id, day: dayKey(now), outcome: 'SKIPPED', loggedAt: now });
}

/** "Bir daha yapmam": rutin bırakılır; geçmişi saklanır, Rutinler ekranından geri alınabilir. */
export async function retireRoutine(
  db: SQLiteDatabase,
  routine: Routine,
  now: Date = new Date()
): Promise<void> {
  const open = await openAcceptedTask(db, routine.id, now);
  if (open) {
    await deleteTask(db, open.id);
    await replanDay(db, now, 'MANUAL');
  }
  await addRoutineLog(db, { routineId: routine.id, day: dayKey(now), outcome: 'RETIRED', loggedAt: now });
  await setRoutineStatus(db, routine.id, 'RETIRED', now);
}

export async function restoreRoutine(db: SQLiteDatabase, routineId: string): Promise<void> {
  await setRoutineStatus(db, routineId, 'ACTIVE');
}

// ───────────────────────── Sonradan işaretleme ─────────────────────────

/**
 * Takvimden bir gün için rutini "yapıldı" işaretler. Gelecek gün işaretlenemez. Bugün için normal akış çalışır
 * (açık görev varsa kapanır). Geçmiş günde kayıt, rutinin sorulma saatine yazılır; böylece "en iyi saat" gibi
 * istatistikler bozulmaz. Daha önce yapıldıysa hiçbir şey yapmaz ve false döner.
 */
export async function markRoutineDoneOnDay(
  db: SQLiteDatabase,
  routine: Routine,
  day: string,
  now: Date = new Date()
): Promise<boolean> {
  const today = dayKey(now);
  if (day > today) throw new Error('Gelecek bir gün işaretlenemez.');
  if (day === today) {
    const before = (await todayLogs(db, routine.id, now)).some((l) => l.outcome === 'DONE');
    if (before) return false;
    await markRoutineDone(db, routine, now);
    return true;
  }
  const exists = (await listRoutineLogsSince(db, day)).some(
    (l) => l.routineId === routine.id && l.day === day && l.outcome === 'DONE'
  );
  if (exists) return false;
  const [y, m, d] = day.split('-').map(Number);
  await addRoutineLog(db, {
    routineId: routine.id,
    day,
    outcome: 'DONE',
    loggedAt: new Date(y, m - 1, d, routine.askHour, routine.askMinute),
  });
  return true;
}

/**
 * Takvimden eklenmiş (göreve bağlı olmayan) "yapıldı" işaretini geri alır.
 * REMOVED: silindi · LOCKED: kayıt bir görevden geldiği için geri alınamaz · NONE: zaten işaretli değildi.
 */
export async function unmarkRoutineDay(
  db: SQLiteDatabase,
  routineId: string,
  day: string
): Promise<'REMOVED' | 'LOCKED' | 'NONE'> {
  const removed = await deleteManualRoutineDoneLogs(db, routineId, day);
  if (removed > 0) return 'REMOVED';
  const locked = (await listRoutineLogsSince(db, day)).some(
    (l) => l.routineId === routineId && l.day === day && l.outcome === 'DONE' && l.taskId
  );
  return locked ? 'LOCKED' : 'NONE';
}
