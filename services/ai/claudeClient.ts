/**
 * Claude API istemcisi (Messages API). Yalnızca `fetch` kullanır; React Native'e bağımlı değildir,
 * bu yüzden scripts/test-ai.ts içinde sahte bir fetch ile test edilebilir.
 */

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/** İstek sürüm başlığı. API sürümleri geriye dönük uyumlu tutulur; gerekirse buradan güncellenir. */
export const ANTHROPIC_VERSION = '2023-06-01';

export type AIErrorKind =
  | 'NO_KEY'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'SERVER'
  | 'REQUEST'
  | 'BAD_RESPONSE';

/** Mesajı doğrudan kullanıcıya gösterilebilecek, Türkçe hata. */
export class AIError extends Error {
  kind: AIErrorKind;
  constructor(kind: AIErrorKind, message: string) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
  timeoutMs?: number;
}

interface ApiBody {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

export async function callClaude(opts: CallOptions): Promise<string> {
  if (!opts.apiKey) throw new AIError('NO_KEY', 'Önce Ayarlar bölümünden API anahtarını gir.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

  let status = 0;
  let raw = '';
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 400,
        system: opts.system,
        messages: opts.messages,
      }),
      signal: controller.signal,
    });
    status = res.status;
    raw = await res.text();
  } catch {
    throw new AIError('NETWORK', 'İnternet bağlantısı kurulamadı ya da yanıt çok geç geldi.');
  } finally {
    clearTimeout(timer);
  }

  if (status === 401 || status === 403) {
    throw new AIError('AUTH', 'API anahtarı geçersiz ya da bu işlem için yetkisiz.');
  }
  if (status === 429) {
    throw new AIError('RATE_LIMIT', 'Kullanım sınırına takıldın. Biraz sonra tekrar dene.');
  }
  if (status >= 500) {
    throw new AIError('SERVER', 'Yapay zekâ servisi şu an yanıt vermiyor. Biraz sonra tekrar dene.');
  }

  let body: ApiBody;
  try {
    body = JSON.parse(raw) as ApiBody;
  } catch {
    throw new AIError('BAD_RESPONSE', 'Yapay zekâdan okunamayan bir yanıt geldi.');
  }

  if (status < 200 || status >= 300) {
    throw new AIError('REQUEST', body.error?.message ?? `İstek reddedildi (kod ${status}).`);
  }

  const text = (body.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
  if (!text) throw new AIError('BAD_RESPONSE', 'Yapay zekâ boş yanıt döndürdü.');
  return text;
}

/** Modelin metni içinden ilk JSON nesnesini çıkarır (önünde/arkasında açıklama olsa bile). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
