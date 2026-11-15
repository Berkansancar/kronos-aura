/**
 * Kural motoru "ne oluyor?" sorusunu cevaplar, yapay zekâ "nasıl söylenmeli?" sorusunu.
 * Eylem düğmeleri (Günü planla, Ertele...) her zaman kural motorundan gelir; yapay zekâ yalnızca
 * mesajın metnini zenginleştirir ve sohbette konuşur. Böylece model hata yapsa bile plan bozulmaz.
 */
import type { CoachId } from '../../database/types';
import type { CoachContext, CoachMessage } from '../coachEngine';
import { formatClock } from '../format';
import { energyZoneAt } from '../scheduler';
import { AIError, callClaude, extractJsonObject, type ChatTurn } from './claudeClient';
import { PERSONAS } from './personas';
import type { AiConfig } from './settings';

const CHRONO_TR = { MORNING: 'sabahçı', BALANCED: 'dengeli', NIGHT: 'gececi' } as const;
const ZONE_TR = { PEAK: 'tepe enerji', NORMAL: 'orta enerji', LOW: 'düşük enerji' } as const;
const WEIGHT_TR = { HIGH: 'derin odak', MEDIUM: 'orta yük', LOW: 'hafif' } as const;
const STATUS_TR = {
  PENDING: 'bekliyor',
  IN_PROGRESS: 'şu an üzerinde çalışılıyor',
  COMPLETED: 'bitti',
  POSTPONED: 'ertelendi',
} as const;
const ENERGY_TR = { HIGH: 'enerjik', EXHAUSTED: 'yorgun', DISTRACTED: 'dağınık' } as const;

const pad = (h: number) => String(h).padStart(2, '0');

/** Koçlara verilen, kullanıcının o anki durumunun düz Türkçe özeti. */
export function describeSituation(ctx: CoachContext): string {
  const zone = energyZoneAt(ctx.user, ctx.now);
  const lines: string[] = [
    `Şu an saat ${formatClock(ctx.now)}.`,
    `Kronotip: ${CHRONO_TR[ctx.user.chronotype]}; tepe enerji penceresi ${pad(ctx.user.peakStartHour)}:00–${pad(ctx.user.peakEndHour)}:00. Şu anki enerji penceresi: ${ZONE_TR[zone]}.`,
  ];

  if (ctx.tasks.length === 0) {
    lines.push('Görev listesi boş.');
  } else {
    lines.push('Görevler:');
    for (const t of ctx.tasks.slice(0, 15)) {
      const times = ctx.blocks
        .filter((b) => b.taskId === t.id)
        .map((b) => `${formatClock(b.startTime)}–${formatClock(b.endTime)}`)
        .join(', ');
      lines.push(
        `- ${t.title} (${WEIGHT_TR[t.cognitiveWeight]}, ${t.estimatedDuration} dk, ${STATUS_TR[t.status]}${times ? `, plan: ${times}` : ', planda yeri yok'})`
      );
    }
  }

  const logs = ctx.recentLogs.slice(0, 5);
  if (logs.length > 0) {
    lines.push('Son kayıtlar:');
    for (const l of logs) {
      const title = l.taskId ? (ctx.tasks.find((t) => t.id === l.taskId)?.title ?? 'görev') : null;
      lines.push(
        `- ${formatClock(new Date(l.loggedAt))}: ${title ? `"${title}" bitti, ${l.actualDuration} dk` : `${l.actualDuration} dk zaman akıp gitti (görevden bağımsız not)`}; hissi: ${ENERGY_TR[l.energyStateAtCompletion]}`
      );
    }
  }
  return lines.join('\n');
}

/** Kural motorunun taslak mesajını, koçun kendi tonuyla yeniden yazdırır. Hata durumunda fırlatır. */
export async function enhanceCoachMessage(
  coach: CoachId,
  base: CoachMessage,
  ctx: CoachContext,
  cfg: AiConfig
): Promise<CoachMessage> {
  const persona = PERSONAS[coach];
  const prompt = [
    describeSituation(ctx),
    '',
    'Kural motorunun taslak mesajı:',
    `Başlık: ${base.headline}`,
    `Metin: ${base.body}`,
    '',
    persona.consoleInstruction,
  ].join('\n');

  const text = await callClaude({
    apiKey: cfg.apiKey,
    model: cfg.model,
    system: persona.system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 220,
  });

  const obj = extractJsonObject(text);
  const headline = typeof obj?.headline === 'string' ? obj.headline.trim() : '';
  const body = typeof obj?.body === 'string' ? obj.body.trim() : '';
  if (!headline || !body) {
    throw new AIError('BAD_RESPONSE', 'Yapay zekâ beklenen biçimde yanıt vermedi.');
  }
  return { ...base, headline: headline.slice(0, 60), body: body.slice(0, 300), source: 'AI' };
}

/** Sohbet geçmişi: en fazla son 20 mesaj, ilk mesaj kullanıcıdan olmalı. */
export function trimHistory(history: ChatTurn[], max = 20): ChatTurn[] {
  const recent = history.slice(-max);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  return recent;
}

export async function chatReply(
  coach: CoachId,
  ctx: CoachContext,
  history: ChatTurn[],
  cfg: AiConfig
): Promise<string> {
  const system = `${PERSONAS[coach].system}\n\nKULLANICININ ŞU ANKİ DURUMU (uygulamadan)\n${describeSituation(ctx)}`;
  const messages = trimHistory(history);
  if (messages.length === 0) throw new AIError('REQUEST', 'Gönderilecek mesaj yok.');
  return callClaude({
    apiKey: cfg.apiKey,
    model: cfg.model,
    system,
    messages,
    maxTokens: 500,
  });
}
