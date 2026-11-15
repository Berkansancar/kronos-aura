/**
 * Kronos'un zamanlama motoru.
 *
 * Saf TypeScript: React Native, veritabanı ya da saat bağımlılığı yok (şimdiki zaman `now`
 * parametresiyle verilir). Bu yüzden tek başına test edilebilir (scripts/test-scheduler.ts).
 *
 * Fikir:
 *  1. Gün, 5 dakikalık dilimlere bölünür; her dilimin bir enerji düzeyi vardır
 *     (kronotipe göre TEPE / NORMAL / DÜŞÜK).
 *  2. Görevler bilişsel ağırlığa göre sıralanır: önce YÜKSEK, sonra ORTA, sonra DÜŞÜK.
 *  3. Her parça, boş aralıklar içinde "enerji uyumu" maliyeti en düşük yere konur:
 *       - YÜKSEK görev tepe enerjiyi ister,
 *       - DÜŞÜK görev tepe enerjiyi boşa harcamasın diye düşük enerjili saatlere kayar,
 *       - ORTA görev tepe ya da normal enerjiyle yetinir, enerji çukuruna girmekten kaçınır.
 *     Eşit maliyette erken saat kazanır (gün boşa akmasın).
 *  4. Uzun ağır işler odak seansı boyutunda parçalanır; her bloktan sonra geçiş tamponu bırakılır.
 *  5. Süre tahminleri, geçmiş TimeLog verisinden öğrenilen çarpanla düzeltilebilir.
 *  6. `reoptimize`, gün içinde bir şey aksadığında (görev uzadı, bitti, ertelendi) kalan saatleri
 *     yeniden dizer; geçmişi dondurur, çalışan görevi kilitler.
 */
import type {
  Chronotype,
  CognitiveWeight,
  DurationSample,
  PlannedSlot,
  TaskStatus,
} from '../database/types';

export type { PlannedSlot };

// ───────────────────────── Tipler ─────────────────────────

export type EnergyZone = 'PEAK' | 'NORMAL' | 'LOW';

export interface SchedulerTask {
  id: string;
  title: string;
  /** dakika */
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  status: TaskStatus;
}

export interface SchedulerUser {
  chronotype: Chronotype;
  peakStartHour: number;
  peakEndHour: number;
}

export interface ScheduledBlock extends PlannedSlot {
  zone: EnergyZone;
  /** Bloğun ortalama enerji düzeyi, 0-1 */
  avgEnergy: number;
  chunkIndex: number;
  chunkCount: number;
  /** Çalışan görevin bloğu gibi yeniden dizilirken yerinden oynatılmayanlar */
  locked: boolean;
}

export interface ScheduleOptions {
  dayStartHour?: number;
  dayEndHour?: number;
  /** Bloktan sonraki geçiş tamponu (dk) */
  buffers?: Partial<Record<CognitiveWeight, number>>;
  /** Bir odak seansının en uzun süresi (dk); fazlası parçalanır */
  maxChunkMinutes?: Partial<Record<CognitiveWeight, number>>;
  /** Aynı görevin parçaları arasındaki minimum boşluk (dk) */
  chunkGapMinutes?: number;
  /** Öğrenilmiş süre çarpanları (bkz. computeDurationFactors) */
  durationFactors?: Partial<Record<CognitiveWeight, number>>;
  /** Günlük YÜKSEK ağırlıklı iş üst sınırı (dk); aşılırsa uyarı verilir */
  highLoadCapMinutes?: number;
  /** Saat başına gecikme cezası; eşit enerji uyumunda erken saati seçtirir */
  earlinessWeight?: number;
}

export interface ScheduleInput {
  now: Date;
  /** Planlanan günü belirleyen herhangi bir an (yerel). Verilmezse `now`. */
  day?: Date;
  user: SchedulerUser;
  tasks: SchedulerTask[];
  /** Yerinden oynatılmayacak bloklar (ör. şu an çalışılan görev) */
  lockedBlocks?: ScheduledBlock[];
  options?: ScheduleOptions;
}

export interface UnscheduledTask {
  taskId: string;
  reason: 'NO_ROOM' | 'WINDOW_CLOSED';
  missingMinutes: number;
  /** Bazı parçaları yerleşti, bazıları sığmadı */
  partial: boolean;
}

export type ScheduleWarning =
  | { code: 'HIGH_LOAD'; minutes: number }
  | { code: 'WINDOW_CLOSED' };

export interface ScheduleResult {
  /** Başlangıç saatine göre sıralı */
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledTask[];
  warnings: ScheduleWarning[];
  stats: {
    windowStart: Date;
    windowEnd: Date;
    plannedMinutes: number;
    freeMinutes: number;
  };
}

export type ReplanTrigger =
  | 'MANUAL'
  | 'TASK_ADDED'
  | 'TASK_COMPLETED'
  | 'TASK_POSTPONED'
  | 'OVERRUN';

export interface ReoptimizeInput extends Omit<ScheduleInput, 'lockedBlocks'> {
  /** Önceki plan (veritabanından) */
  previousBlocks: PlannedSlot[];
  trigger: ReplanTrigger;
  /** Süresi dolmuş çalışan göreve eklenecek ek süre (dk). Varsayılan 15. */
  overrunExtraMinutes?: number;
}

export interface ScheduleChanges {
  /** Başlangıcı en az bir dilim kayan görevler */
  moved: string[];
  /** Önceden yeri olup şimdi sığmayanlar */
  dropped: string[];
  /** Önceden yeri olmayıp şimdi yerleşenler */
  added: string[];
  extendedTaskId: string | null;
  extendedByMinutes: number;
}

export interface ReoptimizeResult extends ScheduleResult {
  /** Tam gün planı: dondurulmuş geçmiş + kilitli + yeni bloklar. Doğrudan kaydedilebilir. */
  blocks: ScheduledBlock[];
  changes: ScheduleChanges;
  trigger: ReplanTrigger;
}

// ───────────────────────── Sabitler ─────────────────────────

const MIN = 60_000;
const STEP_MIN = 5;
const STEP = STEP_MIN * MIN;

const ENERGY_LEVEL: Record<EnergyZone, number> = { PEAK: 1, NORMAL: 0.6, LOW: 0.25 };

/** Kronotipe göre doğal enerji çukurları [başlangıç saati, bitiş saati) */
const LOW_WINDOWS: Record<Chronotype, ReadonlyArray<readonly [number, number]>> = {
  MORNING: [
    [14, 16],
    [21, 24],
  ],
  BALANCED: [
    [14, 16],
    [22, 24],
  ],
  NIGHT: [
    [7, 11],
    [15, 16],
  ],
};

const WEIGHT_RANK: Record<CognitiveWeight, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const DEFAULTS = {
  dayStartHour: 8,
  dayEndHour: 22,
  buffers: { HIGH: 15, MEDIUM: 10, LOW: 5 } as Record<CognitiveWeight, number>,
  maxChunkMinutes: { HIGH: 90, MEDIUM: 120, LOW: 180 } as Record<CognitiveWeight, number>,
  chunkGapMinutes: 15,
  durationFactors: { HIGH: 1, MEDIUM: 1, LOW: 1 } as Record<CognitiveWeight, number>,
  highLoadCapMinutes: 240,
  earlinessWeight: 0.02,
};

type ResolvedOptions = typeof DEFAULTS;

function resolveOptions(o: ScheduleOptions | undefined): ResolvedOptions {
  return {
    dayStartHour: o?.dayStartHour ?? DEFAULTS.dayStartHour,
    dayEndHour: o?.dayEndHour ?? DEFAULTS.dayEndHour,
    buffers: { ...DEFAULTS.buffers, ...o?.buffers },
    maxChunkMinutes: { ...DEFAULTS.maxChunkMinutes, ...o?.maxChunkMinutes },
    chunkGapMinutes: o?.chunkGapMinutes ?? DEFAULTS.chunkGapMinutes,
    durationFactors: { ...DEFAULTS.durationFactors, ...o?.durationFactors },
    highLoadCapMinutes: o?.highLoadCapMinutes ?? DEFAULTS.highLoadCapMinutes,
    earlinessWeight: o?.earlinessWeight ?? DEFAULTS.earlinessWeight,
  };
}

// ───────────────────────── Yardımcılar ─────────────────────────

const ceilToStep = (ms: number) => Math.ceil(ms / STEP) * STEP;
const floorToStep = (ms: number) => Math.floor(ms / STEP) * STEP;

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

interface Interval {
  start: number;
  end: number;
}

/** Boş aralıklar listesinden [busyStart, busyEnd) kısmını çıkarır. */
function carve(free: Interval[], busyStart: number, busyEnd: number): Interval[] {
  const out: Interval[] = [];
  for (const iv of free) {
    if (busyEnd <= iv.start || busyStart >= iv.end) {
      out.push(iv);
      continue;
    }
    if (busyStart > iv.start) out.push({ start: iv.start, end: busyStart });
    if (busyEnd < iv.end) out.push({ start: busyEnd, end: iv.end });
  }
  return out;
}

// ───────────────────────── Enerji modeli ─────────────────────────

export function energyZoneAt(user: SchedulerUser, at: Date): EnergyZone {
  const h = at.getHours() + at.getMinutes() / 60;
  if (h >= user.peakStartHour && h < user.peakEndHour) return 'PEAK';
  for (const [from, to] of LOW_WINDOWS[user.chronotype]) {
    if (h >= from && h < to) return 'LOW';
  }
  return 'NORMAL';
}

function blockStats(
  user: SchedulerUser,
  startMs: number,
  endMs: number
): { zone: EnergyZone; avgEnergy: number } {
  const counts: Record<EnergyZone, number> = { PEAK: 0, NORMAL: 0, LOW: 0 };
  let sum = 0;
  let n = 0;
  for (let t = startMs; t < endMs; t += STEP) {
    const z = energyZoneAt(user, new Date(t));
    counts[z] += 1;
    sum += ENERGY_LEVEL[z];
    n += 1;
  }
  let zone: EnergyZone = 'NORMAL';
  let best = -1;
  for (const z of ['PEAK', 'NORMAL', 'LOW'] as const) {
    if (counts[z] > best) {
      best = counts[z];
      zone = z;
    }
  }
  return { zone, avgEnergy: n > 0 ? sum / n : ENERGY_LEVEL.NORMAL };
}

/** Küçük = iyi. Görevin ağırlığı ile bloğun ortalama enerjisi ne kadar uyumlu? */
function fitCost(weight: CognitiveWeight, avgEnergy: number): number {
  switch (weight) {
    case 'HIGH':
      return (1 - avgEnergy) * 3;
    case 'MEDIUM':
      // Normal ve tepe enerji eşit iyi; sadece çukura girmesin. (Ağır işler zaten önce yerleşti,
      // artan tepe saatlerini orta işlere vermek zararsız.)
      return Math.max(0, ENERGY_LEVEL.NORMAL - avgEnergy) * 3;
    case 'LOW':
      return avgEnergy;
  }
}

function decorate(
  user: SchedulerUser,
  taskId: string,
  startMs: number,
  endMs: number,
  bufferTime: number,
  locked: boolean,
  chunkIndex = 0,
  chunkCount = 1
): ScheduledBlock {
  const { zone, avgEnergy } = blockStats(user, startMs, endMs);
  return {
    taskId,
    startTime: new Date(startMs),
    endTime: new Date(endMs),
    bufferTime,
    zone,
    avgEnergy,
    chunkIndex,
    chunkCount,
    locked,
  };
}

// ───────────────────────── Süre hesapları ─────────────────────────

/** Öğrenilmiş çarpanla düzeltilmiş, 5 dakikaya yukarı yuvarlanmış süre. */
export function effectiveMinutes(
  task: Pick<SchedulerTask, 'estimatedDuration' | 'cognitiveWeight'>,
  factors?: Partial<Record<CognitiveWeight, number>>
): number {
  const f = factors?.[task.cognitiveWeight] ?? 1;
  const raw = Math.max(STEP_MIN, task.estimatedDuration * f);
  return Math.ceil(raw / STEP_MIN) * STEP_MIN;
}

/** Süreyi eşit odak seanslarına böler: 150 dk, tavan 90 -> [75, 75]. */
export function splitIntoChunks(total: number, maxChunk: number): number[] {
  const n = Math.max(1, Math.ceil(total / maxChunk));
  const base = Math.ceil(total / n / STEP_MIN) * STEP_MIN;
  const chunks: number[] = [];
  let remaining = total;
  for (let i = 0; i < n && remaining > 0; i++) {
    const c = Math.min(base, remaining);
    chunks.push(c);
    remaining -= c;
  }
  return chunks;
}

/**
 * TimeLog geçmişinden "tahminim gerçeğe göre ne kadar sapıyor?" çarpanı.
 * Her ağırlık için en az `minSamples` gözlem yoksa 1 (düzeltme yok) döner.
 * Ortanca kullanılır, tek bir uç değer planı bozmasın; çarpan 0.7-2.0 arasına sıkıştırılır.
 */
export function computeDurationFactors(
  samples: DurationSample[],
  minSamples = 3
): Record<CognitiveWeight, number> {
  const out: Record<CognitiveWeight, number> = { HIGH: 1, MEDIUM: 1, LOW: 1 };
  for (const w of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    const ratios = samples
      .filter((s) => s.cognitiveWeight === w && s.estimatedDuration > 0 && s.actualDuration > 0)
      .map((s) => s.actualDuration / s.estimatedDuration)
      .sort((a, b) => a - b);
    if (ratios.length < minSamples) continue;
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
    out[w] = Math.min(2, Math.max(0.7, Math.round(median * 100) / 100));
  }
  return out;
}

// ───────────────────────── Ana zamanlayıcı ─────────────────────────

interface Unit {
  task: SchedulerTask;
  minutes: number;
  chunkIndex: number;
  chunkCount: number;
  buffer: number;
  totalMinutes: number;
  order: number;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const o = resolveOptions(input.options);
  const { user } = input;
  const day = input.day ?? input.now;

  const windowStart = ceilToStep(
    Math.max(input.now.getTime(), atHour(day, o.dayStartHour).getTime())
  );
  const windowEnd = atHour(day, o.dayEndHour).getTime();

  const warnings: ScheduleWarning[] = [];
  const unscheduled: UnscheduledTask[] = [];

  let free: Interval[] = windowEnd > windowStart ? [{ start: windowStart, end: windowEnd }] : [];
  const locked = input.lockedBlocks ?? [];
  for (const b of locked) {
    free = carve(free, b.startTime.getTime(), b.endTime.getTime() + b.bufferTime * MIN);
  }

  const lockedIds = new Set(locked.map((b) => b.taskId));
  const toPlace = input.tasks.filter(
    (t) => (t.status === 'PENDING' || t.status === 'IN_PROGRESS') && !lockedIds.has(t.id)
  );

  // Gün kapanmışsa hiçbir şey yerleştirilemez.
  if (windowEnd <= windowStart) {
    warnings.push({ code: 'WINDOW_CLOSED' });
    for (const t of toPlace) {
      unscheduled.push({
        taskId: t.id,
        reason: 'WINDOW_CLOSED',
        missingMinutes: effectiveMinutes(t, o.durationFactors),
        partial: false,
      });
    }
    return {
      blocks: [...locked].sort(byStart),
      unscheduled,
      warnings,
      stats: {
        windowStart: new Date(windowStart),
        windowEnd: new Date(windowEnd),
        plannedMinutes: 0,
        freeMinutes: 0,
      },
    };
  }

  // Görevleri odak seanslarına böl.
  const units: Unit[] = [];
  toPlace.forEach((task, order) => {
    const total = effectiveMinutes(task, o.durationFactors);
    const chunks = splitIntoChunks(total, o.maxChunkMinutes[task.cognitiveWeight]);
    chunks.forEach((minutes, i) =>
      units.push({
        task,
        minutes,
        chunkIndex: i,
        chunkCount: chunks.length,
        buffer: o.buffers[task.cognitiveWeight],
        totalMinutes: total,
        order,
      })
    );
  });

  // Önce ağır işler, içlerinde uzun olan önce ("büyük taşlar önce").
  units.sort(
    (a, b) =>
      WEIGHT_RANK[a.task.cognitiveWeight] - WEIGHT_RANK[b.task.cognitiveWeight] ||
      b.totalMinutes - a.totalMinutes ||
      a.order - b.order ||
      a.chunkIndex - b.chunkIndex
  );

  const findBestSlot = (u: Unit, minStart: number): { start: number } | null => {
    const durMs = u.minutes * MIN;
    const bufMs = u.buffer * MIN;
    let best: { start: number; cost: number } | null = null;

    for (const iv of free) {
      for (let s = ceilToStep(Math.max(iv.start, minStart)); ; s += STEP) {
        const e = s + durMs;
        // Son tampon, günün sonundan taşabilir; ama diğer bloklara taşamaz.
        const fits = e <= iv.end && (e + bufMs <= iv.end || iv.end >= windowEnd);
        if (!fits) break;
        const { avgEnergy } = blockStats(user, s, e);
        const hoursIn = (s - windowStart) / (60 * MIN);
        const cost = fitCost(u.task.cognitiveWeight, avgEnergy) + o.earlinessWeight * hoursIn;
        if (!best || cost < best.cost - 1e-9) best = { start: s, cost };
      }
    }
    return best ? { start: best.start } : null;
  };

  const placed: ScheduledBlock[] = [];
  const nextChunkEarliest = new Map<string, number>();
  const failed = new Set<string>();
  const placedMinutes = new Map<string, number>();
  const missingMinutes = new Map<string, number>();

  for (const u of units) {
    const id = u.task.id;
    if (failed.has(id)) {
      missingMinutes.set(id, (missingMinutes.get(id) ?? 0) + u.minutes);
      continue;
    }
    const slot = findBestSlot(u, nextChunkEarliest.get(id) ?? 0);
    if (!slot) {
      failed.add(id);
      missingMinutes.set(id, (missingMinutes.get(id) ?? 0) + u.minutes);
      continue;
    }
    const end = slot.start + u.minutes * MIN;
    free = carve(free, slot.start, end + u.buffer * MIN);
    nextChunkEarliest.set(id, end + (u.buffer + o.chunkGapMinutes) * MIN);
    placedMinutes.set(id, (placedMinutes.get(id) ?? 0) + u.minutes);
    placed.push(
      decorate(user, id, slot.start, end, u.buffer, false, u.chunkIndex, u.chunkCount)
    );
  }

  for (const [taskId, missing] of missingMinutes) {
    unscheduled.push({
      taskId,
      reason: 'NO_ROOM',
      missingMinutes: missing,
      partial: (placedMinutes.get(taskId) ?? 0) > 0,
    });
  }

  const blocks = [...locked, ...placed].sort(byStart);

  // Günlük ağır iş yükü uyarısı
  const weightById = new Map(input.tasks.map((t) => [t.id, t.cognitiveWeight]));
  const highMinutes = blocks
    .filter((b) => weightById.get(b.taskId) === 'HIGH')
    .reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()) / MIN, 0);
  if (highMinutes > o.highLoadCapMinutes) {
    warnings.push({ code: 'HIGH_LOAD', minutes: Math.round(highMinutes) });
  }

  const freeMinutes = free.reduce((sum, iv) => sum + (iv.end - iv.start) / MIN, 0);
  const plannedMinutes = placed.reduce(
    (sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()) / MIN,
    0
  );

  return {
    blocks,
    unscheduled,
    warnings,
    stats: {
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
      plannedMinutes: Math.round(plannedMinutes),
      freeMinutes: Math.round(freeMinutes),
    },
  };
}

function byStart(a: PlannedSlot, b: PlannedSlot): number {
  return a.startTime.getTime() - b.startTime.getTime();
}

// ───────────────────────── Yeniden optimizasyon ─────────────────────────

/**
 * Gün içinde bir şey değiştiğinde kalan günü yeniden dizer.
 *
 *  - Biten görevlerin bugüne kadarki blokları "geçmiş" olarak dondurulur
 *    (erken bittiyse blok `now`a kısaltılır, boşalan zaman yeniden kullanılır).
 *  - Çalışan görev (IN_PROGRESS) kilitlenir. Planlanan bitişi geçildiyse blok uzatılır.
 *  - Bekleyen görevler `now`dan itibaren baştan yerleştirilir.
 *  - Ertelenen görevler plandan çıkar.
 *
 * Döndürülen `blocks` tam gün planıdır; olduğu gibi kaydedilebilir.
 */
export function reoptimize(input: ReoptimizeInput): ReoptimizeResult {
  const o = resolveOptions(input.options);
  const { now, user, tasks, previousBlocks, trigger } = input;
  const day = input.day ?? now;
  const nowMs = now.getTime();
  const windowEnd = atHour(day, o.dayEndHour).getTime();

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const prev = previousBlocks.filter((b) => taskById.has(b.taskId)).sort(byStart);

  const frozen: ScheduledBlock[] = [];
  const locked: ScheduledBlock[] = [];
  const prevStart = new Map<string, number>();
  let extendedTaskId: string | null = null;
  let extendedBy = 0;

  // 1) Önceki plandan geçmişi dondur, bekleyen görevlerin eski başlangıçlarını not et.
  for (const b of prev) {
    const t = taskById.get(b.taskId);
    if (!t) continue;
    if (t.status === 'COMPLETED') {
      const start = b.startTime.getTime();
      if (start < nowMs) {
        const end = Math.min(b.endTime.getTime(), nowMs);
        if (end > start) frozen.push(decorate(user, t.id, start, end, 0, true));
      }
    } else if (t.status === 'PENDING' && !prevStart.has(t.id)) {
      prevStart.set(t.id, b.startTime.getTime());
    }
  }

  // 2) Çalışan görevleri kilitle (gerekirse uzat).
  for (const t of tasks.filter((x) => x.status === 'IN_PROGRESS')) {
    const own = prev.filter((b) => b.taskId === t.id);
    const started = own.filter((b) => b.startTime.getTime() <= nowMs);
    const cur = started[started.length - 1];
    const buffer = o.buffers[t.cognitiveWeight];

    let start: number;
    let end: number;
    if (cur) {
      start = cur.startTime.getTime();
      end = cur.endTime.getTime();
      if (nowMs > end) {
        const newEnd = ceilToStep(nowMs + (input.overrunExtraMinutes ?? 15) * MIN);
        extendedTaskId = t.id;
        extendedBy = Math.round((newEnd - end) / MIN);
        end = newEnd;
      }
    } else {
      // Plana göre başlamamış ama kullanıcı başlatmış: şimdiden başlat, tüm süreyi tek blok say.
      start = floorToStep(nowMs);
      end = start + effectiveMinutes(t, o.durationFactors) * MIN;
    }
    locked.push(decorate(user, t.id, start, end, buffer, true));

    // Aynı görevin sonraki odak seansları varsa, kilitli bloğun arkasına kaydırarak koru.
    if (cur) {
      let cursor = end + (buffer + o.chunkGapMinutes) * MIN;
      for (const b of own.filter((x) => x.startTime.getTime() > nowMs)) {
        const len = b.endTime.getTime() - b.startTime.getTime();
        const s = Math.max(ceilToStep(b.startTime.getTime()), cursor);
        if (s + len > windowEnd) continue;
        locked.push(decorate(user, t.id, s, s + len, b.bufferTime, true));
        cursor = s + len + (buffer + o.chunkGapMinutes) * MIN;
      }
    }
  }

  // 3) Kalan her şeyi şimdiden itibaren yerleştir.
  const result = buildSchedule({
    now,
    day,
    user,
    tasks,
    lockedBlocks: locked,
    options: input.options,
  });

  const blocks = [...frozen, ...result.blocks].sort(byStart);

  // 4) Ne değişti? (Kronos'un açıklaması için)
  const newStart = new Map<string, number>();
  for (const b of result.blocks) {
    if (b.locked) continue;
    const s = b.startTime.getTime();
    const cur = newStart.get(b.taskId);
    if (cur === undefined || s < cur) newStart.set(b.taskId, s);
  }
  const moved: string[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  for (const [id, s] of newStart) {
    const p = prevStart.get(id);
    if (p === undefined) added.push(id);
    else if (Math.abs(p - s) >= STEP) moved.push(id);
  }
  for (const id of prevStart.keys()) {
    if (!newStart.has(id)) dropped.push(id);
  }

  return {
    ...result,
    blocks,
    trigger,
    changes: {
      moved,
      dropped,
      added,
      extendedTaskId,
      extendedByMinutes: extendedBy,
    },
  };
}
