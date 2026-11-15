/**
 * Gün sonu değerlendirmesini yapay zekâya yazdırır. Hata durumunda fırlatır; çağıran kural tabanlı
 * değerlendirmeye döner. Yeni rutin fikirleri de burada üretilir ve doğrulanır.
 */
import type { DayReviewPayload } from '../../database/types';
import {
  buildReviewPrompt,
  extractJsonLenient,
  MANUAL_PREAMBLE,
  parseReviewResponse,
  type DayFacts,
} from '../dayReviewLogic';
import { AIError, callClaude, extractJsonObject } from './claudeClient';
import { callFreeAI, type FreeConfig } from './freeClient';
import { PERSONAS } from './personas';
import type { AiConfig } from './settings';

const SYSTEM = `${PERSONAS.AURA.system}

BU GÖREVDE ÖZEL
- Gün sonu değerlendirmesi yazıyorsun. "reflection" alanını Aura olarak, "tomorrow" alanını Kronos'un net ve stratejik sesiyle yaz.
- Yeni rutin fikirleri küçük, uygulanabilir ve kullanıcının günündeki verilere uygun olsun; tıbbi tavsiye verme.
- "timeUse" ve "screenAlternatives" alanlarında zamanı yargılama; yalnızca verilen sayıları kullan.`;

export async function generateAiReview(
  facts: DayFacts,
  existingTitles: string[],
  shareActivity: boolean,
  cfg: AiConfig
): Promise<DayReviewPayload> {
  const text = await callClaude({
    apiKey: cfg.apiKey,
    model: cfg.model,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildReviewPrompt(facts, existingTitles, shareActivity) }],
    maxTokens: 1200,
    timeoutMs: 40_000,
  });
  const parsed = parseReviewResponse(extractJsonObject(text), existingTitles);
  if (!parsed) {
    throw new AIError('BAD_RESPONSE', 'Yapay zekâ beklenen biçimde yanıt vermedi.');
  }
  return parsed;
}

/**
 * Ücretsiz sağlayıcıyla (Gemini ya da Groq) değerlendirme yazdırır. Kişilik ve kurallar sistem metni olarak
 * gider. Telefondaki paylaşım ayarı burada da geçerlidir: kapalıysa adım, ekran ve uyku bilgisi gönderilmez.
 */
export async function generateFreeReview(
  facts: DayFacts,
  existingTitles: string[],
  shareActivity: boolean,
  free: FreeConfig
): Promise<DayReviewPayload> {
  const text = await callFreeAI({
    provider: free.provider,
    apiKey: free.apiKey,
    system: MANUAL_PREAMBLE,
    prompt: `${buildReviewPrompt(facts, existingTitles, shareActivity)}\n\nSadece tek bir JSON nesnesi döndür.`,
    maxTokens: 2048,
    timeoutMs: 45_000,
  });
  const obj = extractJsonLenient(text);
  const parsed = obj ? parseReviewResponse(obj, existingTitles) : null;
  if (!parsed) {
    throw new AIError('BAD_RESPONSE', 'Yapay zekâ beklenen biçimde yanıt vermedi.');
  }
  return { ...parsed, source: 'FREE' };
}
