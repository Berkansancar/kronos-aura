/**
 * Ücretsiz yapay zekâ istemcisi (Google Gemini ve Groq). Yalnızca `fetch` kullanır; React Native'e
 * bağımlı değildir, bu yüzden scripts/test-free.ts içinde sahte bir fetch ile test edilir.
 *
 * İki sağlayıcının da ücretsiz planı kart istemez. Sınır aşılırsa para çekilmez, servis 429 döner.
 * Model adları zamanla değişebileceği için her sağlayıcıda sırayla denenen bir liste vardır:
 * model bulunamazsa ya da sınırına takılırsa sıradaki model denenir.
 */
import { AIError } from './claudeClient';

export type FreeProvider = 'GEMINI' | 'GROQ';

export interface FreeConfig {
  provider: FreeProvider;
  apiKey: string;
}

export interface FreeProviderInfo {
  id: FreeProvider;
  label: string;
  /** Kullanıcının ücretsiz anahtarı alacağı adres. */
  keyUrl: string;
  keyHost: string;
  keyPlaceholder: string;
  /** Sırayla denenecek model adları. */
  models: string[];
  /** Ayarlarda gösterilen, gizlilikle ilgili açık not. */
  privacy: string;
}

export const FREE_PROVIDERS: Record<FreeProvider, FreeProviderInfo> = {
  GEMINI: {
    id: 'GEMINI',
    label: 'Gemini (Google)',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHost: 'aistudio.google.com',
    keyPlaceholder: 'AIza…',
    models: ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite'],
    privacy:
      'Gemini\'nin ücretsiz planında gönderilen içerik Google tarafından ürünlerini geliştirmek için kullanılabilir ve insanlar tarafından incelenebilir. Gizli kalmasını istediğin bilgiyi gönderme.',
  },
  GROQ: {
    id: 'GROQ',
    label: 'Groq (Llama)',
    keyUrl: 'https://console.groq.com/keys',
    keyHost: 'console.groq.com',
    keyPlaceholder: 'gsk_…',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    privacy:
      'Groq ücretsiz planında günlük istek sınırı vardır; sınırı aşarsan ücret çıkmaz, bir süre beklersin. Gizlilik koşulları için Groq\'un kendi sayfasına bak.',
  },
};

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface FreeCallOptions {
  provider: FreeProvider;
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Tüm denemelerin toplam süresi (ms). */
  timeoutMs?: number;
  /** Cevabın JSON olması istenir (varsayılan: evet). */
  json?: boolean;
  /** Test için: model listesini değiştirir. */
  models?: string[];
}

type Attempt = { ok: true; text: string } | { ok: false; error: AIError; status: number };

function failure(kind: AIError['kind'], message: string, status: number): Attempt {
  return { ok: false, error: new AIError(kind, message), status };
}

interface GeminiBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

interface OpenAiBody {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

function classify(status: number, message: string | undefined): Attempt | null {
  // Gemini geçersiz anahtara 400 de döndürebilir
  const keyProblem = /api key|apikey|api_key|invalid.*key|key.*invalid|permission/i.test(message ?? '');
  if (status === 401 || status === 403 || (status === 400 && keyProblem)) {
    return failure('AUTH', 'Anahtar geçersiz ya da bu işlem için yetkisiz. Anahtarı yeniden kopyalayıp dene.', status);
  }
  if (status === 429) {
    return failure('RATE_LIMIT', 'Ücretsiz kullanım sınırına takıldın. Biraz sonra tekrar dene.', status);
  }
  if (status >= 500) {
    return failure('SERVER', 'Yapay zekâ servisi şu an yanıt vermiyor. Biraz sonra tekrar dene.', status);
  }
  if (status === 404) {
    return failure('REQUEST', 'Bu model şu an kullanılamıyor.', status);
  }
  if (status < 200 || status >= 300) {
    return failure('REQUEST', message || `İstek reddedildi (kod ${status}).`, status);
  }
  return null;
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; raw: string } | AIError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, raw: await res.text() };
  } catch {
    return new AIError('NETWORK', 'İnternet bağlantısı kurulamadı ya da yanıt çok geç geldi.');
  } finally {
    clearTimeout(timer);
  }
}

async function attemptGemini(
  model: string,
  o: FreeCallOptions,
  timeoutMs: number
): Promise<Attempt> {
  const sent = await post(
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': o.apiKey },
    {
      systemInstruction: { parts: [{ text: o.system }] },
      contents: [{ role: 'user', parts: [{ text: o.prompt }] }],
      generationConfig: {
        // Düşünen modeller düşünme jetonlarını da bu sınırdan harcar; payı geniş tutuyoruz.
        maxOutputTokens: o.maxTokens ?? 2048,
        temperature: 0.7,
        ...(o.json === false ? {} : { responseMimeType: 'application/json' }),
      },
    },
    timeoutMs
  );
  if (sent instanceof AIError) return { ok: false, error: sent, status: 0 };

  let body: GeminiBody = {};
  try {
    body = JSON.parse(sent.raw) as GeminiBody;
  } catch {
    if (sent.status >= 200 && sent.status < 300) {
      return failure('BAD_RESPONSE', 'Yapay zekâdan okunamayan bir yanıt geldi.', sent.status);
    }
  }
  const bad = classify(sent.status, body.error?.message);
  if (bad) return bad;

  if (body.promptFeedback?.blockReason) {
    return failure('BAD_RESPONSE', 'Gemini bu isteği güvenlik filtresi nedeniyle yanıtlamadı.', sent.status);
  }
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text as string)
    .join('')
    .trim();
  if (!text) return failure('BAD_RESPONSE', 'Yapay zekâ boş yanıt döndürdü.', sent.status);
  return { ok: true, text };
}

async function attemptGroq(model: string, o: FreeCallOptions, timeoutMs: number): Promise<Attempt> {
  const sent = await post(
    GROQ_URL,
    { authorization: `Bearer ${o.apiKey}` },
    {
      model,
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: o.prompt },
      ],
      max_tokens: o.maxTokens ?? 2048,
      temperature: 0.7,
      // json_object kipi, komutta "JSON" sözcüğü geçmesini ister; gün sonu komutunda geçiyor.
      ...(o.json === false ? {} : { response_format: { type: 'json_object' } }),
    },
    timeoutMs
  );
  if (sent instanceof AIError) return { ok: false, error: sent, status: 0 };

  let body: OpenAiBody = {};
  try {
    body = JSON.parse(sent.raw) as OpenAiBody;
  } catch {
    if (sent.status >= 200 && sent.status < 300) {
      return failure('BAD_RESPONSE', 'Yapay zekâdan okunamayan bir yanıt geldi.', sent.status);
    }
  }
  const bad = classify(sent.status, body.error?.message);
  if (bad) return bad;

  const text = (body.choices?.[0]?.message?.content ?? '').trim();
  if (!text) return failure('BAD_RESPONSE', 'Yapay zekâ boş yanıt döndürdü.', sent.status);
  return { ok: true, text };
}

/** Bu hatalarda sıradaki modeli denemek mantıklıdır; anahtar ya da ağ sorununda değil. */
function tryNextModel(a: Extract<Attempt, { ok: false }>): boolean {
  return (
    a.error.kind === 'RATE_LIMIT' ||
    a.error.kind === 'SERVER' ||
    a.error.kind === 'BAD_RESPONSE' ||
    a.status === 404
  );
}

export async function callFreeAI(opts: FreeCallOptions): Promise<string> {
  if (!opts.apiKey.trim()) {
    throw new AIError('NO_KEY', 'Önce Ayarlar bölümünden ücretsiz anahtarı gir.');
  }
  const models = opts.models ?? FREE_PROVIDERS[opts.provider].models;
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);

  let last: AIError | null = null;
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) break;
    const a =
      opts.provider === 'GEMINI'
        ? await attemptGemini(model, opts, remaining)
        : await attemptGroq(model, opts, remaining);
    if (a.ok) return a.text;
    last = a.error;
    if (!tryNextModel(a)) throw a.error;
  }
  throw last ?? new AIError('NETWORK', 'İnternet bağlantısı kurulamadı ya da yanıt çok geç geldi.');
}
