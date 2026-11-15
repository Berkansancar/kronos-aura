/**
 * İki koçun "beyni".
 *
 * Şu an kural tabanlıdır (çevrimdışı çalışır, anında yanıt verir, bedava). Arayüz yalnızca
 * `CoachMessage` biçimini bilir; ileride aynı `CoachContext`'i bir yapay zekâ modeline
 * göndererek aynı biçimde cevap almak, arayüze dokunmadan mümkündür.
 *
 *  - Kronos: net, stratejik, çözüm odaklı. Zamanı ve görev akışını yönetir.
 *  - Aura:   empatik, sakin. Suçluluğu söndürür; "boşa geçen" zamanı yargılamadan veriye çevirir.
 *            Aura'nın dilinde "boşa", "kaybettin", "tembellik" gibi yargılayıcı sözler yoktur.
 */
import type { CoachId, EnergyState, Task, TimeLog, UserProfile } from '../database/types';
import { formatClock, formatDuration } from './format';
import { energyZoneAt, type EnergyZone } from './scheduler';

export type { CoachId };
export type CoachTone = 'STRATEGIC' | 'CALM' | 'ALERT';
export type CoachActionId = 'PLAN_DAY' | 'REPLAN' | 'POSTPONE_OVERFLOW' | 'LOG_DRIFT';

export interface CoachAction {
  id: CoachActionId;
  label: string;
  /** LOG_DRIFT için: kaç dakika akıp gitti */
  minutes?: number;
}

export interface CoachMessage {
  coach: CoachId;
  tone: CoachTone;
  headline: string;
  body: string;
  /** Eylemlerin üstünde küçük açıklama satırı */
  hint?: string;
  actions: CoachAction[];
  /** Metni kural motoru mu yazdı, yapay zekâ mı? (Varsayılan: kural motoru) */
  source?: 'RULES' | 'AI';
}

export interface BlockView {
  taskId: string;
  startTime: Date;
  endTime: Date;
}

export interface CoachContext {
  now: Date;
  user: UserProfile;
  tasks: Task[];
  /** Planlanan günün blokları */
  blocks: BlockView[];
  recentLogs: TimeLog[];
  dayEndHour: number;
}

const ZONE_LABEL: Record<EnergyZone, string> = {
  PEAK: 'tepe enerji',
  NORMAL: 'orta enerji',
  LOW: 'düşük enerji',
};

const MIN = 60_000;

// ───────────────────────── Ortak yardımcılar ─────────────────────────

function blocksOf(ctx: CoachContext, taskId: string): BlockView[] {
  return ctx.blocks.filter((b) => b.taskId === taskId);
}

/** Çalışan görev, planlanan son bloğunu aşmışsa onu döndürür. */
function findOverrun(ctx: CoachContext): { task: Task; plannedEnd: Date } | null {
  for (const task of ctx.tasks) {
    if (task.status !== 'IN_PROGRESS') continue;
    const own = blocksOf(ctx, task.id);
    if (own.length === 0) continue;
    const lastEnd = own.reduce((max, b) => (b.endTime > max ? b.endTime : max), own[0].endTime);
    if (ctx.now > lastEnd) return { task, plannedEnd: lastEnd };
  }
  return null;
}

/** Planda yeri olmayan bekleyen görevler (sığmadı ya da henüz planlanmadı). */
function unplannedTasks(ctx: CoachContext): Task[] {
  const planned = new Set(ctx.blocks.map((b) => b.taskId));
  return ctx.tasks.filter((t) => t.status === 'PENDING' && !planned.has(t.id));
}

function upcomingBlocks(ctx: CoachContext): BlockView[] {
  return ctx.blocks
    .filter((b) => b.startTime >= ctx.now && ctx.tasks.find((t) => t.id === b.taskId)?.status === 'PENDING')
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

function titleOf(ctx: CoachContext, taskId: string): string {
  return ctx.tasks.find((t) => t.id === taskId)?.title ?? 'Görev';
}

// ───────────────────────── Kronos ─────────────────────────

export function getKronosMessage(ctx: CoachContext): CoachMessage {
  const active = ctx.tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const done = ctx.tasks.filter((t) => t.status === 'COMPLETED');
  const postponed = ctx.tasks.filter((t) => t.status === 'POSTPONED');

  if (active.length === 0 && done.length === 0 && postponed.length === 0) {
    return {
      coach: 'KRONOS',
      tone: 'STRATEGIC',
      headline: 'Güne hazırım',
      body: 'Birkaç görev ekle. Süre ve zihinsel yükünü söyle; enerji saatlerine göre zaman bloklarına ben yerleştireyim.',
      actions: [],
    };
  }

  if (active.length === 0) {
    return {
      coach: 'KRONOS',
      tone: 'STRATEGIC',
      headline: 'Plan tamam',
      body:
        done.length > 0
          ? `${done.length} görev bitti. Kalan zaman tamamen senin.`
          : 'Plandaki her şey ertelendi. Hazır olduğunda geri alabilirsin.',
      actions: [],
    };
  }

  const overrun = findOverrun(ctx);
  if (overrun) {
    return {
      coach: 'KRONOS',
      tone: 'ALERT',
      headline: 'Süre aşıldı',
      body: `"${overrun.task.title}" planlanan ${formatClock(overrun.plannedEnd)} bitişini geçti. Kalan saatleri yeniden dizeyim; bu bir hata değil, sadece güncel rota.`,
      actions: [{ id: 'REPLAN', label: 'Yeniden optimize et' }],
    };
  }

  const unplanned = unplannedTasks(ctx);
  if (unplanned.length > 0 && ctx.blocks.length === 0) {
    return {
      coach: 'KRONOS',
      tone: 'STRATEGIC',
      headline: 'Plan hazır değil',
      body: `${unplanned.length} görev bekliyor. Enerji saatlerine göre yerleştireyim mi?`,
      actions: [{ id: 'PLAN_DAY', label: 'Günü planla' }],
    };
  }
  if (unplanned.length > 0) {
    return {
      coach: 'KRONOS',
      tone: 'ALERT',
      headline: 'Bugüne sığmayanlar var',
      body: `${unplanned.length} görev bugün yerleşemedi. Bunları ertelemeyi öneriyorum; sonra hiçbir şey kaybolmaz, tekrar plana alabilirsin.`,
      actions: [
        { id: 'POSTPONE_OVERFLOW', label: 'Ertele' },
        { id: 'REPLAN', label: 'Yeniden dene' },
      ],
    };
  }

  const running = active.find((t) => t.status === 'IN_PROGRESS');
  const next = upcomingBlocks(ctx).find((b) => !running || b.taskId !== running.id);

  if (running) {
    const own = blocksOf(ctx, running.id);
    const end = own.length ? own[own.length - 1].endTime : null;
    const nextText = next
      ? `Sonra: ${titleOf(ctx, next.taskId)} · ${formatClock(next.startTime)}.`
      : 'Sonrasında planlı iş yok.';
    return {
      coach: 'KRONOS',
      tone: 'STRATEGIC',
      headline: `Şimdi: ${running.title}`,
      body: `${end ? `Bitiş ${formatClock(end)}. ` : ''}${nextText}`,
      actions: [],
    };
  }

  if (next) {
    const minutesLeft = Math.max(0, Math.round((next.startTime.getTime() - ctx.now.getTime()) / MIN));
    const title = titleOf(ctx, next.taskId);
    if (minutesLeft <= 15) {
      return {
        coach: 'KRONOS',
        tone: 'STRATEGIC',
        headline: `${title} · ${minutesLeft} dk sonra`,
        body: `${formatClock(next.startTime)}'da başlıyor. Geçiş tamponunu kullan, masayı hazırla.`,
        actions: [],
      };
    }
    const zone = energyZoneAt(ctx.user, next.startTime);
    return {
      coach: 'KRONOS',
      tone: 'STRATEGIC',
      headline: `Sıradaki: ${title}`,
      body: `${formatClock(next.startTime)}–${formatClock(next.endTime)} arası, ${ZONE_LABEL[zone]} penceresinde. Aradaki süre serbest.`,
      actions: [],
    };
  }

  return {
    coach: 'KRONOS',
    tone: 'STRATEGIC',
    headline: 'Plan akıyor',
    body: 'Bugünün blokları tamam. Yeni bir görev eklersen kalan saatleri yeniden dizerim.',
    actions: [],
  };
}

// ───────────────────────── Aura ─────────────────────────

const DRIFT_ACTIONS: CoachAction[] = [
  { id: 'LOG_DRIFT', label: '15 dk', minutes: 15 },
  { id: 'LOG_DRIFT', label: '30 dk', minutes: 30 },
  { id: 'LOG_DRIFT', label: '1 saat', minutes: 60 },
];
const DRIFT_HINT = 'Zaman akıp gittiyse, ne kadar olduğunu not düş. Yargısız, sadece veri.';

function recentLog(ctx: CoachContext, hours: number): TimeLog | undefined {
  const since = ctx.now.getTime() - hours * 60 * MIN;
  return ctx.recentLogs.find(
    (l) => l.taskId !== null && new Date(l.loggedAt).getTime() >= since
  );
}

export function getAuraMessage(ctx: CoachContext): CoachMessage {
  const base = { coach: 'AURA' as const, hint: DRIFT_HINT, actions: DRIFT_ACTIONS };

  // Gün bitti
  if (ctx.now.getHours() >= ctx.dayEndHour) {
    return {
      ...base,
      tone: 'CALM',
      headline: 'Gün kapanıyor',
      body: 'Yaptıkların yeterli. Kalanlar yarın sessizce devam eder; bugünden borç taşımıyorsun.',
    };
  }

  // Son görevin bıraktığı enerji durumu
  const last = recentLog(ctx, 3);
  if (last?.energyStateAtCompletion === 'EXHAUSTED') {
    return {
      ...base,
      tone: 'CALM',
      headline: 'Yorgunluk de bir veri',
      body: 'Son işi yorgun bitirdin. 10 dakika ekrandan uzaklaş, su iç. Bir sonraki ağır işe enerjin toparlanınca geçeriz.',
    };
  }
  if (last?.energyStateAtCompletion === 'DISTRACTED') {
    return {
      ...base,
      tone: 'CALM',
      headline: 'Dağılmak olağan',
      body: 'Zihin dolaştı; bu bir hata değil, bir sinyal. İki dakika derin nefes, sonra yalnızca tek bir küçük adım yeterli.',
    };
  }

  // Süre aşımı: suçluluğu baştan söndür
  if (findOverrun(ctx)) {
    return {
      ...base,
      tone: 'CALM',
      headline: 'Süre uzadı, sorun yok',
      body: 'Tahminler zamanla öğrenilir. Bu iş bittiğinde süresini veri olarak kaydedeceğim; kendine yüklenme.',
    };
  }

  // Enerji çukurunda ağır işe yaklaşılıyor
  const zone = energyZoneAt(ctx.user, ctx.now);
  const next = upcomingBlocks(ctx)[0];
  const nextTask = next ? ctx.tasks.find((t) => t.id === next.taskId) : undefined;
  if (
    zone === 'LOW' &&
    nextTask?.cognitiveWeight === 'HIGH' &&
    next.startTime.getTime() - ctx.now.getTime() <= 30 * MIN
  ) {
    return {
      ...base,
      tone: 'CALM',
      headline: 'Enerji çukurundasın',
      body: 'Şu an doğal düşüş saatin. Ağır işe girmeden önce 10 dakikalık bir mola iyi gelir.',
    };
  }

  const byZone: Record<EnergyZone, { headline: string; body: string }> = {
    PEAK: {
      headline: 'Tepe saatlerindesin',
      body: 'Zihnin en berrak penceresi. Derin işi buraya yaslayalım; arada kısa nefes almayı unutma.',
    },
    NORMAL: {
      headline: 'Dengeli akış',
      body: 'Sakin bir tempoda ilerlemek tamamen yeterli. Hız değil, süreklilik.',
    },
    LOW: {
      headline: 'Yavaşlamak serbest',
      body: 'Düşük enerji penceresindesin. Hafif işler ya da kısa bir mola şu an en akıllı seçim.',
    },
  };
  return { ...base, tone: 'CALM', ...byZone[zone] };
}

/** Aura'nın "zaman akıp gitti" notuna verdiği yanıt (arayüzde kısa süre gösterilir). */
export function getAuraDriftReply(minutes: number): CoachMessage {
  return {
    coach: 'AURA',
    tone: 'CALM',
    headline: 'Not aldım',
    body: `${formatDuration(minutes)} kayda geçti. Hiçbir şey kaybolmadı; bu artık planını iyileştiren bir veri. Hazır olduğunda tek bir küçük adımla devam edebiliriz.`,
    actions: [],
  };
}

// ───────────────────────── TimeLog notları ─────────────────────────

const ENERGY_NOTE: Record<EnergyState, string> = {
  HIGH: 'Güçlü bitirdin; bu ritim kayda alındı.',
  EXHAUSTED: 'Yorgun bitirdin; kısa bir mola hak edildi.',
  DISTRACTED: 'Dağınık bir seans oldu; yargı yok, sadece veri.',
};

/** Bir görev bittiğinde TimeLog.coachNotes alanına yazılacak ortak değerlendirme. */
export function buildCompletionNotes(p: {
  estimated: number;
  actual: number;
  energy: EnergyState;
}): string {
  const ratio = p.estimated > 0 ? p.actual / p.estimated : 1;
  let kronos: string;
  if (ratio > 1.2) {
    kronos = `${p.estimated} dk tahmin, ${p.actual} dk gerçekleşti. Benzer işlere daha geniş süre ayıracağım.`;
  } else if (ratio < 0.8) {
    kronos = `${p.estimated} dk tahmin, ${p.actual} dk gerçekleşti. Kazanılan zamanı sıradaki bloklara aktardım.`;
  } else {
    kronos = `${p.estimated} dk tahmin, ${p.actual} dk gerçekleşti. Tahmin isabetli.`;
  }
  return `Kronos: ${kronos} | Aura: ${ENERGY_NOTE[p.energy]}`;
}

export function buildDriftNote(minutes: number): string {
  return `Aura: ${formatDuration(minutes)} akıp gitti; yargısız veri olarak kaydedildi.`;
}
