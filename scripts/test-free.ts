/**
 * Ücretsiz yapay zekâ istemcisi testi (gerçek servise gitmez, sahte bir fetch kullanır).
 * Çalıştırmak için:  npm run test:free
 */
import { AIError } from '../services/ai/claudeClient';
import { callFreeAI, FREE_PROVIDERS, GEMINI_BASE, GROQ_URL } from '../services/ai/freeClient';
import { generateFreeReview } from '../services/ai/reviewAI';
import type { DayFacts } from '../services/dayReviewLogic';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

type Reply = { status: number; body: string } | Error;
interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
let sent: Sent[] = [];

/** Sırayla verilen cevapları döndürür; liste biterse sonuncuyu tekrarlar. */
function mockFetch(replies: Reply[]): void {
  sent = [];
  let i = 0;
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    init: { headers: Record<string, string>; body: string }
  ) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return { status: r.status, text: async () => r.body };
  };
}

const gemini = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const groq = (text: string) => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] });
const errBody = (message: string) => JSON.stringify({ error: { message } });

async function expectError(kind: string, replies: Reply[], provider: 'GEMINI' | 'GROQ', label: string): Promise<void> {
  mockFetch(replies);
  try {
    await callFreeAI({ provider, apiKey: 'k', system: 's', prompt: 'p' });
    throw new Error(`BAŞARISIZ: ${label} hata vermedi`);
  } catch (e) {
    check(label, e instanceof AIError && e.kind === kind, `beklenen=${kind} gelen=${String(e)}`);
  }
}

const facts: DayFacts = {
  day: '2026-11-16',
  tasksDone: [{ title: 'Rapor yaz', minutes: 60 }],
  tasksOpen: 1,
  driftMinutes: 0,
  routinesDone: ['Bir bardak su iç'],
  routinesSkipped: [],
  routinesOpen: ['Sabah yürüyüşü'],
  energy: { HIGH: 1, EXHAUSTED: 0, DISTRACTED: 0 },
  steps: 3200,
  stepsReliable: true,
  screenMinutes: 250,
  sleepMinutes: 330,
  sleepBed: '00:30',
  sleepWake: '06:00',
  peakStartHour: 9,
  peakEndHour: 12,
};

const goodReview = {
  reflection: 'Bugün bir görevi bitirdin ve suyunu içtin. Yorgun bir gün için bu yeterince güzel.',
  tomorrow: 'Yarın 09:00–12:00 aralığında en zor işi yap, sonra yürüyüşe çık.',
  ideas: [
    { title: 'Akşam esneme', category: 'SAGLIK', minutes: 10, hour: 21, minute: 0, why: 'Gün sonunda gevşemene yardım eder.' },
  ],
};

async function main(): Promise<void> {
  console.log('Gemini isteği');
  mockFetch([{ status: 200, body: gemini('{"a":1}') }]);
  const t1 = await callFreeAI({ provider: 'GEMINI', apiKey: 'AIza-test', system: 'sistem', prompt: 'komut' });
  check('metin döner', t1 === '{"a":1}');
  check('adres ilk modelle kurulur', sent[0].url === `${GEMINI_BASE}/${FREE_PROVIDERS.GEMINI.models[0]}:generateContent`, sent[0].url);
  check('anahtar başlıkta gider, adreste değil', sent[0].headers['x-goog-api-key'] === 'AIza-test' && !sent[0].url.includes('AIza-test'));
  const gb = sent[0].body as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType?: string; maxOutputTokens: number };
  };
  check('sistem metni ve komut ayrı gider', gb.systemInstruction.parts[0].text === 'sistem' && gb.contents[0].parts[0].text === 'komut' && gb.contents[0].role === 'user');
  check('JSON cevabı istenir ve jeton payı geniştir', gb.generationConfig.responseMimeType === 'application/json' && gb.generationConfig.maxOutputTokens >= 1024);
  mockFetch([{ status: 200, body: gemini('Merhaba') }]);
  await callFreeAI({ provider: 'GEMINI', apiKey: 'k', system: 's', prompt: 'p', json: false });
  check('json:false ise JSON kipi istenmez', (sent[0].body as { generationConfig: Record<string, unknown> }).generationConfig.responseMimeType === undefined);

  mockFetch([{ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'düşünce', thought: true }, { text: 'cevap' }] } }] }) }]);
  check('düşünme parçaları atılır', (await callFreeAI({ provider: 'GEMINI', apiKey: 'k', system: 's', prompt: 'p' })) === 'cevap');

  console.log('Groq isteği');
  mockFetch([{ status: 200, body: groq('{"b":2}') }]);
  const t2 = await callFreeAI({ provider: 'GROQ', apiKey: 'gsk_test', system: 'sistem', prompt: 'komut' });
  check('metin döner', t2 === '{"b":2}');
  check('adres ve yetki başlığı', sent[0].url === GROQ_URL && sent[0].headers.authorization === 'Bearer gsk_test');
  const qb = sent[0].body as { model: string; messages: Array<{ role: string; content: string }>; response_format?: { type: string } };
  check('ilk model ve mesajlar', qb.model === FREE_PROVIDERS.GROQ.models[0] && qb.messages[0].role === 'system' && qb.messages[1].content === 'komut');
  check('JSON kipi açık', qb.response_format?.type === 'json_object');
  mockFetch([{ status: 200, body: groq('Merhaba') }]);
  await callFreeAI({ provider: 'GROQ', apiKey: 'k', system: 's', prompt: 'p', json: false });
  check('json:false ise Groq JSON kipi istenmez', (sent[0].body as { response_format?: unknown }).response_format === undefined);

  console.log('Model yedeği');
  mockFetch([{ status: 404, body: errBody('model not found') }, { status: 200, body: gemini('yedek') }]);
  const fb = await callFreeAI({ provider: 'GEMINI', apiKey: 'k', system: 's', prompt: 'p' });
  check('model yoksa sıradaki denenir', fb === 'yedek' && sent.length === 2 && sent[1].url.includes(FREE_PROVIDERS.GEMINI.models[1]));
  mockFetch([{ status: 429, body: errBody('quota') }, { status: 200, body: groq('yedek') }]);
  const fb2 = await callFreeAI({ provider: 'GROQ', apiKey: 'k', system: 's', prompt: 'p' });
  check('sınıra takılınca sıradaki model denenir', fb2 === 'yedek' && (sent[1].body as { model: string }).model === FREE_PROVIDERS.GROQ.models[1]);
  mockFetch([{ status: 401, body: errBody('bad') }, { status: 200, body: groq('x') }]);
  try {
    await callFreeAI({ provider: 'GROQ', apiKey: 'k', system: 's', prompt: 'p' });
  } catch {
    // beklenen
  }
  check('anahtar hatasında diğer modeller denenmez', sent.length === 1);

  console.log('Hata eşleme');
  await expectError('AUTH', [{ status: 401, body: errBody('x') }], 'GROQ', 'Groq 401 -> AUTH');
  await expectError('AUTH', [{ status: 403, body: errBody('x') }], 'GEMINI', 'Gemini 403 -> AUTH');
  await expectError('AUTH', [{ status: 400, body: errBody('API key not valid. Please pass a valid API key.') }], 'GEMINI', 'Gemini geçersiz anahtar (400) -> AUTH');
  await expectError('RATE_LIMIT', [{ status: 429, body: errBody('quota') }], 'GEMINI', 'tüm modeller 429 -> RATE_LIMIT');
  await expectError('SERVER', [{ status: 503, body: 'down' }], 'GROQ', 'tüm modeller 5xx -> SERVER');
  await expectError('NETWORK', [new Error('ağ yok')], 'GEMINI', 'ağ hatası -> NETWORK');
  await expectError('BAD_RESPONSE', [{ status: 200, body: 'json değil' }], 'GROQ', 'bozuk yanıt -> BAD_RESPONSE');
  await expectError('BAD_RESPONSE', [{ status: 200, body: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }) }], 'GEMINI', 'güvenlik filtresi -> BAD_RESPONSE');
  await expectError('BAD_RESPONSE', [{ status: 200, body: groq('   ') }], 'GROQ', 'boş yanıt -> BAD_RESPONSE');
  await expectError('REQUEST', [{ status: 400, body: errBody('geçersiz istek') }], 'GROQ', 'diğer 4xx -> REQUEST');
  try {
    await callFreeAI({ provider: 'GEMINI', apiKey: '  ', system: 's', prompt: 'p' });
    throw new Error('BAŞARISIZ: anahtarsız çağrı hata vermedi');
  } catch (e) {
    check('anahtarsız çağrı NO_KEY', e instanceof AIError && e.kind === 'NO_KEY');
  }

  console.log('Gün sonu değerlendirmesi');
  mockFetch([{ status: 200, body: gemini('```json\n' + JSON.stringify(goodReview) + '\n```') }]);
  const review = await generateFreeReview(facts, ['Bir bardak su iç'], true, { provider: 'GEMINI', apiKey: 'k' });
  check('değerlendirme okunur ve FREE olarak etiketlenir', review.source === 'FREE' && review.ideas.length === 1 && review.ideas[0].title === 'Akşam esneme');
  const gp = JSON.stringify(sent[0].body);
  check('kişilik kuralları sistem metnine girer', gp.includes('AURA') && gp.includes('KRONOS'));
  check('paylaşım açıkken adım komuta girer', gp.includes('3200'));
  mockFetch([{ status: 200, body: groq(JSON.stringify(goodReview)) }]);
  await generateFreeReview(facts, [], false, { provider: 'GROQ', apiKey: 'k' });
  const gq = JSON.stringify(sent[0].body);
  check('paylaşım kapalıyken adım ve uyku komuta girmez', !gq.includes('3200') && !gq.includes('Ekran süresi') && !gq.includes('00:30'));
  check('komutta JSON sözcüğü geçer (Groq JSON kipi için gerekli)', /json/i.test(gq));
  mockFetch([{ status: 200, body: groq('Bugün güzeldi.') }]);
  try {
    await generateFreeReview(facts, [], false, { provider: 'GROQ', apiKey: 'k' });
    throw new Error('BAŞARISIZ: JSON olmayan cevap kabul edildi');
  } catch (e) {
    check('JSON olmayan cevap BAD_RESPONSE olur', e instanceof AIError && e.kind === 'BAD_RESPONSE');
  }
  mockFetch([{ status: 200, body: groq(JSON.stringify({ ...goodReview, reflection: 'Bugün tembel bir gündü.' })) }]);
  try {
    await generateFreeReview(facts, [], false, { provider: 'GROQ', apiKey: 'k' });
    throw new Error('BAŞARISIZ: yasaklı sözcük kabul edildi');
  } catch (e) {
    check('yargılayıcı sözcük içeren cevap reddedilir', e instanceof AIError && e.kind === 'BAD_RESPONSE');
  }
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
