/**
 * Gün sonu değerlendirmesi testi (saf mantık + gerçek SQLite + sahte yapay zekâ).
 * Çalıştırmak için:  npm run test:review
 */
import {
  createTask,
  getDayReview,
  listVisibleTasks,
  upsertDailyStat,
  upsertSleepLog,
} from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { dayKey } from '../services/activityLogic';
import {
  addIdeaAsRoutine,
  answersForDay,
  buildManualReviewPrompt,
  saveManualReview,
  gatherDayFacts,
  loadOrCreateReview,
  materializePlannedRoutines,
  planForTomorrow,
  reminderExtras,
  reviewAvailable,
  reviewDayOf,
  skipForTomorrow,
  tomorrowAnswers,
} from '../services/dayReview';
import {
  buildManualPrompt,
  buildReviewPrompt,
  buildRulesReview,
  extractJsonLenient,
  parseManualResponse,
  factChips,
  hasBannedWords,
  isQuietDay,
  parseReviewResponse,
  ruleBasedIdeas,
  type DayFacts,
} from '../services/dayReviewLogic';
import { dayBounds, planningDay } from '../services/planner';
import { acceptRoutine, addRoutineFromTemplate, markRoutineDone } from '../services/routineFlow';
import { loadRoutineBriefs } from '../services/routineBriefs';
import { planReminders } from '../services/routineRemindersLogic';
import { completeTask } from '../services/taskFlow';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m);

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  day: '2026-11-16',
  tasksDone: [],
  tasksOpen: 0,
  driftMinutes: 0,
  routinesDone: [],
  routinesSkipped: [],
  routinesOpen: [],
  energy: { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 },
  steps: null,
  stepsReliable: false,
  screenMinutes: null,
  sleepMinutes: null,
  sleepBed: null,
  sleepWake: null,
  peakStartHour: 9,
  peakEndHour: 12,
  ...over,
});

// ───────────── Gün ve saat kuralları ─────────────
console.log('Gün kuralları');
check('20:00 öncesi açılmaz', !reviewAvailable(at(19, 59)));
check('20:00 sonrası açılır', reviewAvailable(at(20, 0)) && reviewAvailable(at(23, 59)));
check('gece yarısından sonra hâlâ açık', reviewAvailable(at(2, 0)) && !reviewAvailable(at(4, 0)));
check('gece 02:00 dünün gün sonudur', dayKey(reviewDayOf(at(2, 0, 17))) === '2026-11-16');
check('akşam 21:00 aynı günün gün sonudur', dayKey(reviewDayOf(at(21, 0, 16))) === '2026-11-16');

// ───────────── Özet ve kurallar ─────────────
console.log('Özet ve kurallar');
const busy = facts({
  tasksDone: [{ title: 'Rapor', minutes: 60 }, { title: 'Mail', minutes: 15 }],
  routinesDone: ['Su iç'],
  routinesOpen: ['Yürüyüş'],
  steps: 6200,
  stepsReliable: true,
  screenMinutes: 190,
  sleepMinutes: 440,
});
const chips = factChips(busy);
check('özet satırları', chips[0] === '2 görev bitti' && chips.includes('1/2 rutin') && chips.some((c) => c.includes('adım')) && chips.some((c) => c.includes('ekran')) && chips.some((c) => c.startsWith('uyku')));
check('sessiz gün tanınır', isQuietDay(facts()) && !isQuietDay(busy));

const quiet = buildRulesReview(facts(), [], []);
check('sessiz günde yargısız mesaj', quiet.reflection.includes('sorun değil') && quiet.source === 'RULES');
const normal = buildRulesReview(busy, [], []);
check('yoğun günde sayıları söyler', normal.reflection.includes('2 görev') && normal.reflection.includes('1 rutin'));
check('yarın için tepe saati söylenir', normal.tomorrow.includes('09:00–12:00'));
check('açık rutin varsa ayar önerilir', normal.tomorrow.includes('1 rutin bugün açık'));
const tired = buildRulesReview(facts({ tasksDone: [{ title: 'x', minutes: 5 }], energy: { HIGH: 0, EXHAUSTED: 2, DISTRACTED: 0 } }), [], []);
check('yorgunluk sinyal olarak çerçevelenir', tired.reflection.includes('sinyal'));
const shortSleep = buildRulesReview(facts({ sleepMinutes: 300 }), [], []);
check('kısa uyku nazikçe belirtilir', shortSleep.reflection.includes('kısa'));
const allText = [quiet, normal, tired, shortSleep].map((p) => `${p.reflection} ${p.tomorrow} ${p.ideas.map((i) => i.why).join(' ')}`).join(' ');
check('kural metinleri yargılamaz', !hasBannedWords(allText));

console.log('Rutin fikirleri (kurallar)');
const walkIdeas = ruleBasedIdeas(facts({ steps: 1500, stepsReliable: true }), [], []);
check('az adım: yürüyüş önerilir', walkIdeas[0].templateId === 'sabah-yuruyus');
check('en fazla 3 fikir', walkIdeas.length === 3);
check('ekran çok: ekransız saat', ruleBasedIdeas(facts({ screenMinutes: 300 }), [], [])[0].templateId === 'ekransiz-saat');
check('kısa uyku: uyku hazırlığı', ruleBasedIdeas(facts({ sleepMinutes: 300 }), [], [])[0].templateId === 'uyku-hazirligi');
check('geç yatış: uyku hazırlığı', ruleBasedIdeas(facts({ sleepMinutes: 480, sleepBed: '02:10' }), [], [])[0].templateId === 'uyku-hazirligi');
check('zaten ekli şablon önerilmez', !ruleBasedIdeas(facts({ steps: 1500, stepsReliable: true }), [], ['sabah-yuruyus']).some((i) => i.templateId === 'sabah-yuruyus'));
check('aynı adlı rutin önerilmez', !ruleBasedIdeas(facts({ steps: 1500, stepsReliable: true }), ['Sabah yürüyüşü'], []).some((i) => i.templateId === 'sabah-yuruyus'));
check('önerilerin saati ve süresi geçerli', walkIdeas.every((i) => i.hour >= 6 && i.hour <= 21 && i.minutes >= 5 && i.why.length > 0));

// ───────────── Yapay zekâ istemi ve cevap doğrulama ─────────────
console.log('Yapay zekâ istemi ve cevabı');
const withPhone = facts({ tasksDone: [{ title: 'Rapor', minutes: 60 }], steps: 8000, stepsReliable: true, screenMinutes: 210, sleepMinutes: 400 });
const promptShared = buildReviewPrompt(withPhone, ['Su iç'], true);
const promptPrivate = buildReviewPrompt(withPhone, ['Su iç'], false);
check('izin varsa adım/ekran/uyku istemde', promptShared.includes('Adım: 8000') && promptShared.includes('Ekran süresi') && promptShared.includes('Dün geceki uyku'));
check('izin yoksa telefon verisi istemde yok', !promptPrivate.includes('Adım:') && !promptPrivate.includes('Ekran süresi') && !promptPrivate.includes('uyku'));
check('görev ve rutin adı her zaman istemde', promptPrivate.includes('Rapor') && promptPrivate.includes('Su iç'));
check('mevcut rutinleri tekrar önermesi yasaklanır', promptPrivate.includes('tekrar önerme'));

const good = {
  reflection: 'Bugün güzel bir ritim yakaladın. Akşam sakince kapanabilirsin.',
  tomorrow: 'Yarın ağır işi 09:00-12:00 arasına koy.',
  ideas: [
    { title: 'Akşam esneme', category: 'SAGLIK', minutes: 10, hour: 21, minute: 0, why: 'Gün sonunda vücudu gevşetir.' },
    { title: 'Su iç', category: 'SAGLIK', minutes: 5, hour: 9, minute: 0, why: 'Zaten var.' },
    { title: 'Şükür notu', category: 'ZIHIN', minutes: 5, hour: 22, minute: 70, why: 'Gün sonu kapanışı.' },
    { title: 'X', category: 'ZIHIN', minutes: 5, hour: 9, minute: 0, why: 'Çok kısa ad.' },
    { title: 'Akşam esneme', category: 'SAGLIK', minutes: 10, hour: 21, minute: 0, why: 'Tekrar.' },
    { title: 'Haftalık plan', category: 'YOK', minutes: 400, hour: 3, minute: 0, why: 'Geçersiz kategori ve süre.' },
    'bozuk',
  ],
};
const parsed = parseReviewResponse(good, ['Su iç'])!;
check('geçerli cevap kabul edilir', parsed.source === 'AI' && parsed.reflection.includes('ritim'));
check('mevcut rutin ve tekrarlar atılır, en fazla 3', parsed.ideas.length === 3 && parsed.ideas.map((i) => i.title).join() === 'Akşam esneme,Şükür notu,Haftalık plan', parsed.ideas.map((i) => i.title).join());
check('saat ve dakika sınırlanır', parsed.ideas[1].hour === 21 && parsed.ideas[1].minute === 59);
check('geçersiz kategori DUZEN olur, süre sınırlanır', parsed.ideas[2].category === 'DUZEN' && parsed.ideas[2].minutes === 60 && parsed.ideas[2].hour === 6);
check('yorum eksikse null', parseReviewResponse({ ...good, reflection: '' }, []) === null && parseReviewResponse({ tomorrow: 'x' }, []) === null && parseReviewResponse(null, []) === null);
check('yargılayıcı yorum atılır', parseReviewResponse({ ...good, reflection: 'Bugün boşa geçti.' }, []) === null && parseReviewResponse({ ...good, tomorrow: 'Tembel olma.' }, []) === null);
const dirtyIdea = parseReviewResponse({ ...good, ideas: [{ title: 'Disiplinsiz olma', category: 'ODAK', minutes: 10, hour: 9, minute: 0, why: 'x' }] }, [])!;
check('yargılayıcı fikir atılır', dirtyIdea.ideas.length === 0);
check('fikir listesi yoksa yine geçerli', parseReviewResponse({ reflection: 'a', tomorrow: 'b' }, [])?.ideas.length === 0);

// ───────────── Elle (ücretsiz sohbet uygulaması) ─────────────
console.log('Elle yol: komut ve cevap okuma');
const manualPrompt = buildManualPrompt(withPhone, ['Su iç']);
check('komut kişilik ve yasak sözcükleri içerir', manualPrompt.includes('AURA') && manualPrompt.includes('KRONOS') && manualPrompt.includes('tembel'));
check('komuta günün verileri girer', manualPrompt.includes('Rapor') && manualPrompt.includes('Adım: 8000') && manualPrompt.includes('uyku'));
check('mevcut rutinler tekrar önerilmez denir', manualPrompt.includes('Su iç') && manualPrompt.includes('tekrar önerme'));
check('cevap kod bloğunda istenir', manualPrompt.includes('```json'));

const jsonText = JSON.stringify(good);
check('düz JSON okunur', extractJsonLenient(jsonText) !== null);
check('kod bloğu ve açıklama içinden okunur', extractJsonLenient('İşte cevabın:\n```json\n' + jsonText + '\n```\nUmarım yardımcı olur.') !== null);
const curly = jsonText.replace(/"/g, '\u201C').replace(/\u201C(reflection|tomorrow|ideas|title|category|minutes|hour|minute|why)\u201C/g, '"$1"');
check('eğri tırnaklar düzeltilir', extractJsonLenient(`{\u201Creflection\u201D: \u201CSakin bir gün.\u201D, \u201Ctomorrow\u201D: \u201CYarın tepe saatini kullan.\u201D}`)?.reflection === 'Sakin bir gün.');
check('sondaki fazladan virgül düzeltilir', extractJsonLenient('{"reflection":"a","tomorrow":"b",}')?.tomorrow === 'b');
check('JSON olmayan metin null', extractJsonLenient('Merhaba, bugün güzel bir gündü.') === null);
void curly;

const okManual = parseManualResponse('```json\n' + jsonText + '\n```', ['Su iç']);
check('geçerli cevap kabul edilir, kaynak MANUAL', okManual.ok && okManual.payload.source === 'MANUAL' && okManual.payload.ideas.length === 3);
const empty = parseManualResponse('   ', []);
check('boş yapıştırma açıklayıcı mesaj verir', !empty.ok && empty.message.includes('yapıştır'));
const garbage = parseManualResponse('Bu bir cevap değil', []);
check('okunamayan cevap açıklayıcı mesaj verir', !garbage.ok && garbage.message.includes('kod bloğu'));
const missing = parseManualResponse('{"reflection":"x"}', []);
check('eksik alan açıklayıcı mesaj verir', !missing.ok && missing.message.includes('tomorrow'));
const judgy = parseManualResponse('{"reflection":"Tembel bir gündü","tomorrow":"b"}', []);
check('yargılayıcı cevap reddedilir', !judgy.ok);

// ───────────── Veritabanı ─────────────
async function dbTests(): Promise<void> {
  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const ver = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  check('temiz kurulum son sürüm', ver === DATABASE_VERSION && DATABASE_VERSION === 11);

  // v4 -> v5 yükseltme
  raw.exec('DROP TABLE DayReview');
  raw.exec('PRAGMA user_version = 4');
  await migrateDbIfNeeded(db);
  check('v4 veritabanı v5\'e yükselir', (raw.prepare("SELECT name FROM sqlite_master WHERE name='DayReview'").get() as unknown) !== undefined);
  await migrateDbIfNeeded(db);
  check('yeniden çalıştırmak zararsız', true);

  // Gün verisi tohumla: 16 Kasım
  const routineA = await addRoutineFromTemplate(db, 'su-ic');
  const routineB = await addRoutineFromTemplate(db, 'sabah-yuruyus');
  const routineC = await addRoutineFromTemplate(db, 'nefes-meditasyon');
  await markRoutineDone(db, routineA, at(10, 0));
  await acceptRoutine(db, routineB, at(9, 0)); // yapacağım dedi, yapmadı
  const task = await createTask(db, { title: 'Rapor yaz', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  await completeTask(db, task, 'EXHAUSTED', at(15, 0));
  await createTask(db, { title: 'Açık iş', estimatedDuration: 30, cognitiveWeight: 'LOW' });
  await upsertDailyStat(db, { day: '2026-11-16', steps: 3200, screenMinutes: 250, topApps: [] });
  await upsertSleepLog(db, { day: '2026-11-16', bedtime: at(0, 30).toISOString(), wakeTime: at(6, 0).toISOString(), durationMinutes: 330 });

  const f = await gatherDayFacts(db, at(21, 30));
  check('biten görev ve süre', f.tasksDone.length === 1 && f.tasksDone[0].title === 'Rapor yaz');
  check('açık görev sayısı', f.tasksOpen >= 1);
  check('hisler sayılır', f.energy.EXHAUSTED === 1);
  check('yapılan rutin', f.routinesDone.join() === 'Bir bardak su iç');
  check('söz verip yapılmayan rutin açık sayılır', f.routinesOpen.includes('Sabah yürüyüşü') && f.routinesOpen.includes('Nefes ve meditasyon'), f.routinesOpen.join());
  check('adım, ekran ve uyku gelir', f.steps === 3200 && f.screenMinutes === 250 && f.sleepMinutes === 330 && f.sleepBed === '00:30' && f.sleepWake === '06:00');
  check('tepe saatleri profilden', f.peakStartHour > 0 && f.peakEndHour > f.peakStartHour);

  // Yapay zekâ olmadan (kurallar)
  const rules = await loadOrCreateReview(db, at(21, 30), { cfg: null, shareActivity: false });
  check('anahtarsız: kural tabanlı', rules.review.payload.source === 'RULES' && rules.aiError === null);
  check('değerlendirme saklanır', (await getDayReview(db, '2026-11-16'))?.payload.reflection === rules.review.payload.reflection);
  check('mevcut rutinler fikirlerde tekrarlanmaz', !rules.review.payload.ideas.some((i) => ['su-ic', 'sabah-yuruyus', 'nefes-meditasyon'].includes(i.templateId ?? '')));

  // Sahte yapay zekâ
  let calls = 0;
  let lastBody = '';
  const aiText = JSON.stringify(good);
  (globalThis as { fetch: unknown }).fetch = async (_u: string, init: { body: string }) => {
    calls += 1;
    lastBody = init.body;
    return { status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: `Tamam:\n${aiText}` }] }) };
  };
  const cfg = { apiKey: 'sk-test', model: 'claude-haiku-5-5' };
  const stored = await loadOrCreateReview(db, at(21, 40), { cfg, shareActivity: true });
  check('kayıtlı değerlendirme varken API çağrılmaz', calls === 0 && stored.review.payload.source === 'RULES');
  const forced = await loadOrCreateReview(db, at(21, 45), { cfg, shareActivity: true, force: true });
  check('yeniden yazdırınca yapay zekâ kullanılır', calls === 1 && forced.review.payload.source === 'AI' && forced.aiError === null);
  check('mevcut rutin adları isteme girer', lastBody.includes('Bir bardak su iç') && lastBody.includes('Sabah yürüyüşü'));
  check('paylaşım açıkken adım isteme girer', lastBody.includes('3200'));
  check('yeni değerlendirme saklanır', (await getDayReview(db, '2026-11-16'))?.payload.source === 'AI');
  await loadOrCreateReview(db, at(21, 50), { cfg, shareActivity: false, force: true });
  check('paylaşım kapalıyken adım isteme girmez', !lastBody.includes('3200') && !lastBody.includes('Ekran süresi'));

  (globalThis as { fetch: unknown }).fetch = async () => ({ status: 500, text: async () => 'hata' });
  const failed = await loadOrCreateReview(db, at(21, 55), { cfg, shareActivity: false, force: true });
  check('yapay zekâ hata verirse kurallara düşer', failed.review.payload.source === 'RULES' && failed.aiError !== null);

  // Ücretsiz sağlayıcı (Gemini / Groq): sıra ücretsiz -> Claude -> kurallar
  const free = { provider: 'GEMINI' as const, apiKey: 'AIza-test' };
  const urls: string[] = [];
  let freeStatus = 200;
  let claudeStatus = 200;
  (globalThis as { fetch: unknown }).fetch = async (u: string, init: { body: string }) => {
    urls.push(u);
    lastBody = init.body;
    if (u.includes('generativelanguage')) {
      return freeStatus === 200
        ? { status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: aiText }] } }] }) }
        : { status: freeStatus, text: async () => 'hata' };
    }
    return claudeStatus === 200
      ? { status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: aiText }] }) }
      : { status: claudeStatus, text: async () => 'hata' };
  };
  const viaFree = await loadOrCreateReview(db, at(22, 0), { cfg: null, free, shareActivity: false, force: true });
  check('ücretsiz anahtarla değerlendirme gelir', viaFree.review.payload.source === 'FREE' && viaFree.aiError === null && urls.length === 1);
  check('ücretsiz kaynak saklanır', (await getDayReview(db, '2026-11-16'))?.payload.source === 'FREE');
  check('ücretsiz yolda adım gönderilmez (paylaşım kapalı)', !lastBody.includes('3200'));
  urls.length = 0;
  const both = await loadOrCreateReview(db, at(22, 1), { cfg, free, shareActivity: false, force: true });
  check('ikisi de varsa önce ücretsiz denenir, Claude\'a gidilmez', both.review.payload.source === 'FREE' && urls.every((u) => u.includes('generativelanguage')));
  freeStatus = 500;
  urls.length = 0;
  const fallbackClaude = await loadOrCreateReview(db, at(22, 2), { cfg, free, shareActivity: false, force: true });
  check('ücretsiz hata verirse Claude denenir', fallbackClaude.review.payload.source === 'AI' && fallbackClaude.aiError === null && urls.some((u) => u.includes('anthropic')));
  const freeOnlyFail = await loadOrCreateReview(db, at(22, 3), { cfg: null, free, shareActivity: false, force: true });
  check('yalnız ücretsiz var ve hata verirse kurallara düşer, sağlayıcı adı hatada görünür',
    freeOnlyFail.review.payload.source === 'RULES' && !!freeOnlyFail.aiError && freeOnlyFail.aiError.includes('Gemini'), String(freeOnlyFail.aiError));
  claudeStatus = 500;
  const bothFail = await loadOrCreateReview(db, at(22, 4), { cfg, free, shareActivity: false, force: true });
  check('ikisi de hata verirse kurallara düşer ve iki hata da söylenir',
    bothFail.review.payload.source === 'RULES' && !!bothFail.aiError && bothFail.aiError.includes('Gemini') && bothFail.aiError.includes('·'), String(bothFail.aiError));
  freeStatus = 200;
  claudeStatus = 200;
  urls.length = 0;
  const storedFree = await loadOrCreateReview(db, at(22, 5), { cfg, free, shareActivity: false });
  check('kayıtlı değerlendirme varken ücretsiz servis de çağrılmaz', urls.length === 0 && storedFree.review.payload.source === 'RULES');

  // Fikri rutine çevir
  const idea = parsed.ideas[0];
  const added = await addIdeaAsRoutine(db, idea);
  check('yapay zekâ fikri rutin olur', added.title === 'Akşam esneme' && added.askHour === 21 && added.estimatedDuration === 10 && added.templateId === null);
  check('aynı fikir iki kez eklenmez', (await addIdeaAsRoutine(db, idea)).id === added.id);
  const tmpl = await addIdeaAsRoutine(db, ruleBasedIdeas(facts({ screenMinutes: 300 }), [], [])[0]);
  check('şablon fikri şablona bağlanır', tmpl.templateId === 'ekransiz-saat');

  // Yarın cevapları
  console.log('Yarın planı');
  check('başlangıçta cevap yok', (await tomorrowAnswers(db, at(21, 30))).size === 0);
  await planForTomorrow(db, routineB, at(21, 35));
  await skipForTomorrow(db, routineC, at(21, 36));
  let ans = await tomorrowAnswers(db, at(21, 40));
  check('"yarın yapacağım" ve "yarın değil" kaydedilir', ans.get(routineB.id) === 'ACCEPTED' && ans.get(routineC.id) === 'SKIPPED');
  await skipForTomorrow(db, routineB, at(21, 41));
  await planForTomorrow(db, routineB, at(21, 42));
  ans = await tomorrowAnswers(db, at(21, 43));
  check('fikir değişirse son cevap geçerli', ans.get(routineB.id) === 'ACCEPTED');
  check('bugünün durumu etkilenmez', (await answersForDay(db, at(12, 0))).get(routineC.id) !== 'SKIPPED');

  // Ertesi sabah
  const tomorrowStart = dayBounds(at(8, 0, 17)).start.toISOString();
  check('gece 03:00\'te yerleştirme yapılmaz', (await materializePlannedRoutines(db, at(3, 0, 17))) === 0);
  check('gün sonunda yerleştirme yapılmaz', (await materializePlannedRoutines(db, at(22, 30, 17))) === 0);
  const before = (await listVisibleTasks(db, tomorrowStart)).filter((t) => t.routineId === routineB.id).length;
  const made = await materializePlannedRoutines(db, at(7, 30, 17));
  check('sabah "yapacağım" denen rutin plana girer', made === 1, String(made));
  const tasks = (await listVisibleTasks(db, tomorrowStart)).filter((t) => t.routineId === routineB.id);
  check('yalnızca bir görev oluşur', tasks.length === before + 1 && tasks.length >= 1);
  check('ikinci kez çağırmak çoğaltmaz', (await materializePlannedRoutines(db, at(7, 45, 17))) === 0);
  const brief = (await loadRoutineBriefs(db, at(8, 0, 17))).find((b) => b.routine.id === routineB.id);
  check('rutin kartı çıkmaz, durum kabul edildi', brief?.state === 'ACCEPTED');
  const skippedBrief = (await loadRoutineBriefs(db, at(8, 0, 17))).find((b) => b.routine.id === routineC.id);
  check('"yarın değil" denen rutin sorulmaz', skippedBrief?.state === 'SKIPPED');
  const planned = (await import('../database/repository')).listDayBlocks;
  const { start, end } = dayBounds(planningDay(at(8, 0, 17)));
  check('yerleşen görev planda blok alır', (await planned(db, start, end)).some((b) => b.taskId === tasks[0].id));

  // Elle yol: veritabanı
  console.log('Elle yol: kaydetme');
  const manualPromptDb = await buildManualReviewPrompt(db, at(21, 30));
  check('komuta rutin adları ve günün verisi girer', manualPromptDb.includes('Bir bardak su iç') && manualPromptDb.includes('Rapor yaz') && manualPromptDb.includes('3200'));
  const storedBefore = await getDayReview(db, "2026-11-16");
  let rejected = '';
  try {
    await saveManualReview(db, at(22, 0), 'anlamsız metin');
  } catch (e) {
    rejected = e instanceof Error ? e.message : String(e);
  }
  check('okunamayan cevap hata verir', rejected.includes('okunamadı'));
  check('hata mevcut değerlendirmeye dokunmaz', (await getDayReview(db, '2026-11-16'))?.createdAt === storedBefore?.createdAt);
  const saved = await saveManualReview(db, at(22, 5), '```json\n' + JSON.stringify({ ...good, ideas: [{ title: 'Akşam yürüyüşü', category: 'SAGLIK', minutes: 20, hour: 18, minute: 30, why: 'Gün sonu hareketi.' }, { title: 'Bir bardak su iç', category: 'SAGLIK', minutes: 5, hour: 9, minute: 0, why: 'Zaten var.' }] }) + '\n```');
  check('yapıştırılan cevap kaydedilir', saved.payload.source === 'MANUAL' && (await getDayReview(db, '2026-11-16'))?.payload.source === 'MANUAL');
  check('mevcut rutin fikirden atılır', saved.payload.ideas.length === 1 && saved.payload.ideas[0].title === 'Akşam yürüyüşü');
  const manualRoutine = await addIdeaAsRoutine(db, saved.payload.ideas[0]);
  check('elle gelen fikir rutin olur', manualRoutine.title === 'Akşam yürüyüşü' && manualRoutine.askHour === 18 && manualRoutine.askMinute === 30);
  const reuse = await loadOrCreateReview(db, at(22, 10), { cfg: null, shareActivity: false });
  check('kaydedilen elle değerlendirme yeniden açılınca korunur', reuse.review.payload.source === 'MANUAL');

  // Bildirim ayarları
  console.log('Bildirim bilgisi');
  const extras = await reminderExtras(db, at(21, 30));
  check('bugünün değerlendirmesi yapıldı', extras.reviewDone === true);
  check('yarın cevaplananlar bildirimden çıkar', extras.answeredTomorrow.has(routineB.id) && extras.answeredTomorrow.has(routineC.id));
  const briefs = await loadRoutineBriefs(db, at(21, 30));
  const plan = planReminders(briefs, at(21, 30), 3, 60, extras);
  check('cevaplanan rutin için yarının bildirimi yok', !plan.some((p) => p.routineId === routineB.id && p.at.getDate() === 17));
  check('cevaplanmayan rutin için yarının bildirimi var', plan.some((p) => p.routineId === routineA.id && p.at.getDate() === 17));
  check('bugünün değerlendirme bildirimi gönderilmez', !plan.some((p) => p.id.startsWith('rtn-review') && p.at.getDate() === 16));
  check('yarının değerlendirme bildirimi 21:30', plan.some((p) => p.id.startsWith('rtn-review') && p.at.getDate() === 17 && p.at.getHours() === 21 && p.at.getMinutes() === 30));
  const planNoReview = planReminders(briefs, at(18, 0), 2, 60, { reviewDone: false, answeredTomorrow: new Set() });
  check('değerlendirme yapılmadıysa bugün 21:30 bildirimi var', planNoReview.some((p) => p.id.startsWith('rtn-review') && p.at.getDate() === 16));
  check('kapalıysa değerlendirme bildirimi yok', !planReminders(briefs, at(18, 0), 2, 60, { reviewDone: false, answeredTomorrow: new Set(), review: false }).some((p) => p.id.startsWith('rtn-review')));
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
