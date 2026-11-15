/**
 * Yapay zekâ katmanı testi (gerçek API'ye gitmez, sahte bir fetch kullanır).
 * Çalıştırmak için:  npm run test:ai
 */
import type { Task, TimeLog, UserProfile } from '../database/types';
import {
  AIError,
  ANTHROPIC_URL,
  callClaude,
  extractJsonObject,
} from '../services/ai/claudeClient';
import { describeSituation, enhanceCoachMessage, trimHistory } from '../services/ai/coachAI';
import { PERSONAS } from '../services/ai/personas';
import {
  getAuraDriftReply,
  getAuraMessage,
  getKronosMessage,
  type CoachContext,
} from '../services/coachEngine';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

type Reply = { status: number; body: string } | Error;
let lastRequest: { url: string; init: { headers: Record<string, string>; body: string } } | null = null;

function mockFetch(reply: Reply): void {
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    init: { headers: Record<string, string>; body: string }
  ) => {
    lastRequest = { url, init };
    if (reply instanceof Error) throw reply;
    return { status: reply.status, text: async () => reply.body };
  };
}

const okBody = (text: string) => JSON.stringify({ content: [{ type: 'text', text }] });
const cfg = { apiKey: 'sk-test', model: 'claude-haiku-5-5' };

async function expectError(kind: string, reply: Reply, label: string): Promise<void> {
  mockFetch(reply);
  try {
    await callClaude({ ...cfg, system: 's', messages: [{ role: 'user', content: 'x' }] });
    throw new Error(`BAŞARISIZ: ${label} hata vermedi`);
  } catch (e) {
    check(label, e instanceof AIError && e.kind === kind, `beklenen=${kind} gelen=${String(e)}`);
  }
}

const user: UserProfile = { id: 'u', chronotype: 'BALANCED', peakStartHour: 10, peakEndHour: 14 };
const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m);
const task = (id: string, title: string, status: Task['status'], w: Task['cognitiveWeight'] = 'HIGH'): Task => ({
  id,
  title,
  estimatedDuration: 90,
  cognitiveWeight: w,
  status,
  createdAt: '2026-11-16T05:00:00Z',
  startedAt: null,
});

async function main(): Promise<void> {
  console.log('\n1) API isteği doğru kuruluyor');
  mockFetch({ status: 200, body: okBody('  Merhaba!  ') });
  const text = await callClaude({
    ...cfg,
    system: 'sistem',
    messages: [{ role: 'user', content: 'selam' }],
    maxTokens: 50,
  });
  check('yanıt metni kırpılarak dönüyor', text === 'Merhaba!');
  check('adres doğru', lastRequest?.url === ANTHROPIC_URL);
  const sent = JSON.parse(lastRequest!.init.body);
  check('model, sistem metni, mesajlar ve token sınırı gidiyor',
    sent.model === cfg.model && sent.system === 'sistem' && sent.max_tokens === 50 && sent.messages[0].content === 'selam');
  check('anahtar ve sürüm başlıkları var',
    lastRequest!.init.headers['x-api-key'] === 'sk-test' && !!lastRequest!.init.headers['anthropic-version']);

  console.log('\n2) Hatalar anlaşılır Türkçe mesaja çevriliyor');
  await expectError('AUTH', { status: 401, body: '{}' }, '401 -> AUTH');
  await expectError('RATE_LIMIT', { status: 429, body: '{}' }, '429 -> RATE_LIMIT');
  await expectError('SERVER', { status: 529, body: '{}' }, '529 -> SERVER');
  await expectError('NETWORK', new Error('Network request failed'), 'ağ kopması -> NETWORK');
  await expectError('BAD_RESPONSE', { status: 200, body: 'json değil' }, 'bozuk gövde -> BAD_RESPONSE');
  await expectError('BAD_RESPONSE', { status: 200, body: JSON.stringify({ content: [] }) }, 'boş içerik -> BAD_RESPONSE');
  mockFetch({ status: 400, body: JSON.stringify({ error: { message: 'model bulunamadı' } }) });
  try {
    await callClaude({ ...cfg, system: 's', messages: [{ role: 'user', content: 'x' }] });
  } catch (e) {
    check('400 -> API mesajı kullanıcıya iletiliyor', e instanceof AIError && e.kind === 'REQUEST' && e.message === 'model bulunamadı');
  }
  try {
    await callClaude({ ...cfg, apiKey: '', system: 's', messages: [] });
  } catch (e) {
    check('anahtar yoksa istek atılmıyor', e instanceof AIError && e.kind === 'NO_KEY');
  }

  console.log('\n3) JSON ayıklama ve sohbet geçmişi');
  check('açıklamalı metinden JSON çıkıyor', extractJsonObject('İşte: {"a":"b"} bitti')?.a === 'b');
  check('JSON yoksa null', extractJsonObject('düz metin') === null);
  check('bozuk JSON null', extractJsonObject('{bozuk') === null);
  const long = Array.from({ length: 30 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: String(i),
  }));
  const trimmed = trimHistory(long);
  check('geçmiş en fazla 20 mesaj', trimmed.length <= 20);
  check('geçmiş kullanıcı mesajıyla başlıyor', trimmed[0].role === 'user');

  console.log('\n4) Durum özeti koça doğru bilgiyi veriyor');
  const ctx: CoachContext = {
    now: at(9, 50),
    user,
    tasks: [task('a', 'Rapor yaz', 'PENDING'), task('b', 'Fatura gir', 'POSTPONED', 'LOW')],
    blocks: [{ taskId: 'a', startTime: at(10), endTime: at(11, 30) }],
    recentLogs: [
      { id: 'l', taskId: null, actualDuration: 30, energyStateAtCompletion: 'DISTRACTED', coachNotes: null, loggedAt: at(9, 0).toISOString() } as TimeLog,
    ],
    dayEndHour: 22,
  };
  const desc = describeSituation(ctx);
  check('görev adı ve plan saati var', desc.includes('Rapor yaz') && desc.includes('10:00–11:30'));
  check('ertelenen görev işaretli', desc.includes('Fatura gir') && desc.includes('ertelendi'));
  check('zaman akıp gitti kaydı yargısız anlatılıyor', desc.includes('30 dk zaman akıp gitti'));
  check('kronotip ve enerji penceresi var', desc.includes('dengeli') && desc.includes('tepe enerji'));

  console.log('\n5) Kural mesajı yapay zekâyla zenginleşiyor, eylemler korunuyor');
  const base = getKronosMessage({ ...ctx, tasks: [task('a', 'Rapor yaz', 'PENDING')], blocks: [] });
  check('taslakta "Günü planla" eylemi var', base.actions.some((a) => a.id === 'PLAN_DAY'));
  mockFetch({ status: 200, body: okBody('Tamam: {"headline":"Planı kuralım","body":"Bir görev bekliyor. Yerleştirelim mi?"}') });
  const ai = await enhanceCoachMessage('KRONOS', base, ctx, cfg);
  check('başlık ve metin yapay zekâdan', ai.headline === 'Planı kuralım' && ai.body.startsWith('Bir görev'));
  check('kaynak AI olarak işaretlendi', ai.source === 'AI');
  check('eylem düğmeleri kural motorundan korundu', ai.actions.length === base.actions.length && ai.actions[0].id === 'PLAN_DAY');
  const sentPrompt = JSON.parse(lastRequest!.init.body);
  check('istekte koçun kişiliği (sistem metni) var', sentPrompt.system === PERSONAS.KRONOS.system);
  check('istekte taslak ve durum var', sentPrompt.messages[0].content.includes('Başlık:') && sentPrompt.messages[0].content.includes('Rapor yaz'));
  mockFetch({ status: 200, body: okBody('JSON yerine düz cevap') });
  try {
    await enhanceCoachMessage('AURA', getAuraMessage(ctx), ctx, cfg);
    throw new Error('BAŞARISIZ: bozuk yanıt kabul edildi');
  } catch (e) {
    check('beklenmeyen biçim reddediliyor (arayüz kurala döner)', e instanceof AIError && e.kind === 'BAD_RESPONSE');
  }

  console.log('\n6) Aura suçlayıcı dil kullanmıyor (kural tabanlı mesajlar + sistem metni)');
  const banned = /(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i;
  const scenarios: CoachContext[] = [
    ctx,
    { ...ctx, now: at(14, 40), blocks: [{ taskId: 'a', startTime: at(15), endTime: at(16) }] },
    { ...ctx, now: at(12), tasks: [task('a', 'Rapor yaz', 'IN_PROGRESS')], blocks: [{ taskId: 'a', startTime: at(10), endTime: at(11) }] },
    { ...ctx, now: at(12), recentLogs: [{ id: 'x', taskId: 'a', actualDuration: 90, energyStateAtCompletion: 'EXHAUSTED', coachNotes: null, loggedAt: at(11, 30).toISOString() }] },
    { ...ctx, now: at(12), recentLogs: [{ id: 'y', taskId: 'a', actualDuration: 90, energyStateAtCompletion: 'DISTRACTED', coachNotes: null, loggedAt: at(11, 30).toISOString() }] },
    { ...ctx, now: at(22, 30) },
  ];
  for (const [i, s] of scenarios.entries()) {
    const m = getAuraMessage(s);
    check(`Aura senaryo ${i + 1} temiz`, !banned.test(`${m.headline} ${m.body} ${m.hint ?? ''}`));
  }
  const reply = getAuraDriftReply(30);
  check('"not aldım" yanıtı temiz', !banned.test(`${reply.headline} ${reply.body}`));
  check('Aura sistem metni yasak sözcükleri koça açıkça yasaklıyor', PERSONAS.AURA.system.includes('ASLA kullanma'));
  check('iki koçun sistem metninde kriz yönlendirmesi (112) var',
    PERSONAS.AURA.system.includes('112') && PERSONAS.KRONOS.system.includes('112'));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(String(e));
  throw e;
});
