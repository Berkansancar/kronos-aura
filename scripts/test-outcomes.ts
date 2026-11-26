/**
 * Yaptım / Yapmadım / Yapamadım, iş saatleri, gün akışı, sigara sayacı ve gün sonu zaman analizi testi.
 * Çalıştırmak için:  npm run test:outcomes
 */
import {
  addDayEvent,
  addTaskOutcome,
  createTask,
  getTask,
  listDayEvents,
  listRecentLogs,
  listTaskOutcomes,
  upsertDailyStat,
} from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { dayKey } from '../services/activityLogic';
import { addSmoke, getSmokeLimit, loadDayFlow, removeEvent, setSmokeLimit, stampEvent } from '../services/dayFlow';
import { FLOW_KINDS, buildFlow, flowChips, nextKind, typicalWakeMinute } from '../services/dayFlowLogic';
import { gatherDayFacts, loadOrCreateReview } from '../services/dayReview';
import {
  buildRulesReview,
  buildReviewPrompt,
  hasBannedWords,
  parseReviewResponse,
  withTimeUse,
  type DayFacts,
} from '../services/dayReviewLogic';
import { loadGoalState } from '../services/goals';
import { EMPTY_GOALS } from '../services/goalsLogic';
import { planningDay, replanDay } from '../services/planner';
import { DEFAULT_WAKE_NUDGE_MINUTE, WAKE_NUDGE_DELAY, planReminders } from '../services/routineRemindersLogic';
import { buildSchedule, type SchedulerTask } from '../services/scheduler';
import { analyzeSmoking, smokePromptLine } from '../services/smokeLogic';
import { addDoneTask, carryOverMissed, completeTask, markTaskMissed, toggleWorkOk } from '../services/taskFlow';
import { REASON_CHOICES, auraOutcomeReply, latestOutcomes, summarizeOutcomes } from '../services/taskOutcomeLogic';
import { SCREEN_MIN_FOR_ALTERNATIVES, analyzeTimeUse, screenAlternatives, screenBudget, timeUsePromptLines } from '../services/timeUseLogic';
import { DEFAULT_WORK, isWorkTime, parseWork, serializeWork, workSummary, workWindowFor } from '../services/workLogic';
import { getWork, saveWork } from '../services/workSettings';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// 16 Kasım 2026 Pazartesi
const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const user = { chronotype: 'BALANCED' as const, peakStartHour: 10, peakEndHour: 14 };
const st = (id: string, mins: number, workOk = false): SchedulerTask => ({
  id,
  title: id,
  estimatedDuration: mins,
  cognitiveWeight: 'LOW',
  status: 'PENDING',
  workOk,
});

// ───────────── İş saatleri (mantık) ─────────────
console.log('İş saatleri');
const w0 = parseWork(null);
check('varsayılan: kapalı, 09:00–18:00, Pzt–Cum', !w0.enabled && w0.startMin === 540 && w0.endMin === 1080 && w0.days.join() === '1,2,3,4,5');
const w1 = { ...DEFAULT_WORK, enabled: true };
check('gidiş-dönüş', JSON.stringify(parseWork(serializeWork(w1))) === JSON.stringify(w1));
check('bozuk kayıt kapalı sayılır', !parseWork('{bozuk').enabled);
check('çok kısa iş günü en az 4 saate tamamlanır', (() => { const p = parseWork(JSON.stringify({ enabled: true, startMin: 600, endMin: 700, days: [1] })); return p.endMin - p.startMin >= 240; })());
check('boş gün listesi varsayılana döner', parseWork(JSON.stringify({ enabled: true, days: [] })).days.length === 5);
check('iş günü penceresi: Pazartesi var, Cumartesi yok, kapalıyken yok', workWindowFor(at(10), w1)?.startMin === 540 && workWindowFor(at(10, 0, 21), w1) === null && workWindowFor(at(10), w0) === null);
check('isWorkTime', isWorkTime(at(12), w1) && !isWorkTime(at(19), w1) && !isWorkTime(at(12, 0, 21), w1));
check('özet metni', workSummary(w1) === '09:00–18:00 · Pzt–Cum');

// ───────────── Planlayıcı: iş saatinde yapılabilir / yapılamaz ─────────────
console.log('Planlayıcı ve iş saatleri');
const win = { startMin: 540, endMin: 1080 };
const overlaps = (b: { startTime: Date; endTime: Date }) => {
  const s = b.startTime.getHours() * 60 + b.startTime.getMinutes();
  const e = b.endTime.getHours() * 60 + b.endTime.getMinutes();
  return s < win.endMin && e > win.startMin;
};
const plain = buildSchedule({ now: at(7, 0), user, tasks: [st('a', 30), st('b', 45), st('c', 60)], options: { workWindow: win } });
check('işaretsiz işler iş saatine konmaz', plain.blocks.length > 0 && plain.blocks.every((b) => !overlaps(b)));
const free = buildSchedule({ now: at(9, 0), user, tasks: [st('a', 30, true), st('b', 45, true)], options: { workWindow: win } });
check('iş vaktinde yapılabilir işler iş saatine konabilir', free.blocks.length === 2 && free.blocks.some(overlaps));
const tight = buildSchedule({ now: at(9, 0), user, tasks: [st('x', 90)], options: { dayStartHour: 9, dayEndHour: 18, workWindow: win } });
check('yer yalnızca iş saatindeyse sebep WORK_HOURS', tight.blocks.length === 0 && tight.unscheduled[0]?.reason === 'WORK_HOURS', JSON.stringify(tight.unscheduled));
const tightOk = buildSchedule({ now: at(9, 0), user, tasks: [st('x', 90, true)], options: { dayStartHour: 9, dayEndHour: 18, workWindow: win } });
check('aynı iş iş vaktinde yapılabilirse yerleşir', tightOk.blocks.length >= 1 && tightOk.unscheduled.length === 0);
const none = buildSchedule({ now: at(9, 0), user, tasks: [st('x', 90)], options: { dayStartHour: 9, dayEndHour: 18, workWindow: null } });
check('iş saati yoksa kısıt yok', none.blocks.length >= 1);

// ───────────── Gün sonu: zaman dökümü ve ekran alternatifleri (mantık) ─────────────
console.log('Zaman dökümü');
const tu = analyzeTimeUse({
  wakeMin: 7 * 60,
  wakeSource: 'STAMP',
  endMin: 23 * 60,
  work: { startMin: 540, endMin: 1080, source: 'STAMP' },
  commuteMinutes: 75,
  prepMinutes: 60,
  doneMinutes: 90,
  doneInWorkMinutes: 30,
  driftMinutes: 20,
  screenMinutes: 200,
});
check('uyanık 16 sa, iş 9 sa, iş dışı uyanık 4 sa 45 dk', tu.awakeMinutes === 960 && tu.workMinutes === 540 && tu.freeMinutes === 285, JSON.stringify(tu));
check('iş dışında biten 60 dk, kayıt dışı kalan 225 dk', tu.doneOutsideWorkMinutes === 60 && tu.unaccountedMinutes === 225);
check('metin yargısız: "kayıt dışı", "veri", yasaklı sözcük yok', /kayıt dışı/.test(tu.text) && /veri/.test(tu.text) && !hasBannedWords(tu.text) && !/boşa/i.test(tu.text), tu.text);
check('ekran süresi anılır', /Ekran süren 3 sa 20 dk/.test(tu.text) && tu.chips.some((c) => c.startsWith('Ekran')));
const tuNoWake = analyzeTimeUse({ wakeMin: null, wakeSource: null, endMin: 1380, work: null, commuteMinutes: 0, prepMinutes: 0, doneMinutes: 45, doneInWorkMinutes: 0, driftMinutes: 0, screenMinutes: null });
check('uyanış bilinmiyorsa tahmin yürütmez, Gün akışı önerir', tuNoWake.freeMinutes === null && tuNoWake.unaccountedMinutes === null && /Uyandım/.test(tuNoWake.text));
check('istemde yalnızca ölçülenler; ekran izne bağlı', timeUsePromptLines(tu, true).join('\n').includes('Ekran süresi') && !timeUsePromptLines(tu, false).join('\n').includes('Ekran süresi'));

console.log('Ekran yerine');
check('bütçe: 200 dk → 50, 60 → 30 (alt sınır), 900 → 120 (üst sınır)', screenBudget(200) === 50 && screenBudget(60) === 30 && screenBudget(900) === 120);
check('ekran az ya da bilinmiyorsa öneri yok', screenAlternatives(null, []).items.length === 0 && screenAlternatives(SCREEN_MIN_FOR_ALTERNATIVES - 1, []).items.length === 0);
const open = [
  { title: 'Mail', minutes: 20, workOk: false, missed: 'NOT_DONE' as const, reason: null },
  { title: 'Rapor', minutes: 30, workOk: false, missed: 'COULD_NOT' as const, reason: 'WORK' as const },
  { title: 'Uzun iş', minutes: 120, workOk: false, missed: null, reason: null },
];
const alt = screenAlternatives(200, open);
check('önce yapamadığın işler, bütçeye sığanlar', alt.items[0].title === 'Rapor' && alt.items[0].kind === 'TASK' && alt.items[1].title === 'Mail' && !alt.items.some((i) => i.title === 'Uzun iş'));
check('toplam süre bütçeyi aşmaz', alt.items.reduce((a, i) => a + i.minutes, 0) <= screenBudget(200));
const ideas = screenAlternatives(400, []);
check('açık iş yoksa kısa fikirler (en çok 4, bütçeye sığar)', ideas.items.length >= 2 && ideas.items.length <= 4 && ideas.items.every((i) => i.kind === 'IDEA') && ideas.items.reduce((a, i) => a + i.minutes, 0) <= screenBudget(400));
check('fikirler günden güne döner', screenAlternatives(400, [], 1).items[0].title !== screenAlternatives(400, [], 2).items[0].title);
check('öneri metinlerinde yargı yok', [...alt.items, ...ideas.items].every((i) => !hasBannedWords(i.title) && !hasBannedWords(i.why)) && !hasBannedWords(alt.note ?? ''));

// ───────────── Gün akışı ve sigara (mantık) ─────────────
console.log('Gün akışı ve sigara');
const ev = (kind: string, h: number, m = 0) => ({ id: `${kind}${h}${m}`, day: '2026-11-16', kind: kind as never, at: at(h, m).toISOString() });
check('sıra: boşken Uyandım', nextKind([]) === 'WAKE');
const chain = [ev('WAKE', 7), ev('SHOWER', 7, 20), ev('BUS', 8), ev('SHOP_IN', 8, 40), ev('SHOP_OUT', 18, 10), ev('BUS', 18, 20), ev('HOME', 18, 55)];
check('her adımdan sonra doğru sıradaki', [1, 2, 3, 4, 5, 6, 7].map((n) => nextKind(chain.slice(0, n))).join() === 'SHOWER,BUS,SHOP_IN,SHOP_OUT,BUS,HOME,');
const fl = buildFlow(chain, at(19));
check('süreler: hazırlık 60, yol 40, dükkan 570, dönüş yolu 35', fl.prepMinutes === 60 && fl.commuteToMinutes === 40 && fl.shopMinutes === 570 && fl.commuteBackMinutes === 35 && !fl.shopOpen, JSON.stringify(fl));
check('özet satırları', flowChips(fl).join('|') === 'Hazırlık 1 sa|Yol (işe) 40 dk|Dükkanda 9 sa 30 dk|Yol (eve) 35 dk', flowChips(fl).join('|'));
const open2 = buildFlow(chain.slice(0, 4), at(12));
check('dükkandayken süre şimdiye kadar sayılır (süren)', open2.shopOpen && open2.shopMinutes === 200, JSON.stringify(open2));
check('tipik uyanış: 3 kayıttan az yetmez, ortanca alınır', typicalWakeMinute([at(7), at(7, 30)]) === null && typicalWakeMinute([at(7), at(7, 30, 15), at(8, 0, 14)]) === 450);
check('altı adım ve etiketler', FLOW_KINDS.length === 6 && FLOW_KINDS.every((k) => k.label.length > 0));

const times = [at(8), at(10), at(12), at(15)];
const sm = analyzeSmoking(times, at(16), 5, true);
check('sigara: sayı, ortalama aralık, sınıra kalan', sm.count === 4 && sm.avgGapMinutes === 140 && sm.leftToLimit === 1 && sm.overLimit === 0 && sm.sinceLastMinutes === 60, JSON.stringify(sm));
check('sınır aşılırsa yargısız söylenir', (() => { const o = analyzeSmoking([...times, at(16), at(17)], at(18), 5, true); return o.overLimit === 1 && /sadece veri/.test(o.line) && !hasBannedWords(o.line); })());
check('sınır yoksa sınır cümlesi yok; dünün sayacında "sonuncudan beri" yok', !/Sınır/.test(analyzeSmoking(times, at(16), null, true).line) && analyzeSmoking(times, at(16), null, false).sinceLastMinutes === null);
check('bölümlere ayrılır (sabah/öğleden sonra/akşam)', sm.byPart.morning === 2 && sm.byPart.afternoon === 2 && sm.byPart.evening === 0);
check('boş gün: kayıt yok, istem satırı yok', analyzeSmoking([], at(10), null).line === 'Henüz kayıt yok.' && smokePromptLine(analyzeSmoking([], at(10), null)) === null);
check('istem satırı yalnızca sayı ve aralık', (() => { const l = smokePromptLine(sm) ?? ''; return /4 adet/.test(l) && /ortalama aralık/.test(l) && !/08:00/.test(l); })());

// ───────────── Aura'nın cevapları ─────────────
console.log('Aura cevapları');
const replies = [
  auraOutcomeReply('DONE', 'Rapor'),
  auraOutcomeReply('NOT_DONE', 'Rapor'),
  auraOutcomeReply('COULD_NOT', 'Rapor', null),
  ...REASON_CHOICES.map((r) => auraOutcomeReply('COULD_NOT', 'Rapor', r.id)),
];
check('hepsi Aura, sakin; yargı ve baskı yok', replies.every((r) => r.coach === 'AURA' && r.tone === 'CALM' && !hasBannedWords(r.headline + r.body) && !/boşa/i.test(r.body)));
check('"iş vaktindeydi" cevabı çözümü söyler', /iş vaktinde yapılabilir/.test(auraOutcomeReply('COULD_NOT', 'Rapor', 'WORK').body));

// ───────────── Gün sonu metinleri ─────────────
console.log('Gün sonu metinleri');
const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  day: '2026-11-16',
  tasksDone: [{ title: 'Rapor', minutes: 60 }],
  tasksOpen: 2,
  driftMinutes: 0,
  routinesDone: [],
  routinesSkipped: [],
  routinesOpen: [],
  energy: { HIGH: 1, EXHAUSTED: 0, DISTRACTED: 0 },
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
const full = facts({
  screenMinutes: 200,
  outcomes: [
    { title: 'Rapor', outcome: 'COULD_NOT', reason: 'WORK', workOk: false },
    { title: 'Mail', outcome: 'NOT_DONE', reason: null, workOk: false },
    { title: 'Not', outcome: 'DONE', reason: null, workOk: false },
  ],
  openTasks: open,
  workWindow: { startMin: 540, endMin: 1080, source: 'SETTING' },
  timeUse: tu,
  smoke: sm,
});
const rr = buildRulesReview(full, [], []);
check('kurallar: yapılamayan işler yarına döner, borç değil', /2 iş bugün olmadı/.test(rr.reflection) && /borç oluşmadı/.test(rr.reflection));
check('kurallar: iş vaktinden olmayan iş için "iş vaktinde yapılabilecek" ipucu', /iş vaktinde yapılabilecek/.test(rr.tomorrow));
check('kurallar: zaman nereye gitti ve ekran yerine dolar', !!rr.timeUse && rr.timeUse === tu.text && (rr.screenAlternatives?.length ?? 0) >= 2 && !!rr.screenNote);
check('ekran yoksa alternatif yok', buildRulesReview(facts({ timeUse: tu, openTasks: open }), [], []).screenAlternatives === undefined);
check('tüm kural metinlerinde yasaklı sözcük yok', ![rr.reflection, rr.tomorrow, rr.timeUse ?? '', rr.screenNote ?? '', ...(rr.screenAlternatives ?? []).flatMap((a) => [a.title, a.why])].some(hasBannedWords));

const pShared = buildReviewPrompt(full, [], true);
const pPrivate = buildReviewPrompt(full, [], false);
check('paylaşımla: görev sonuçları, iş saatleri, zaman dökümü, ekran, sigara, alternatif talimatı', ['Yapamadım: Rapor (sebep: İş vaktindeydi)', 'İş saatleri: 09:00–18:00', 'Zaman dökümü', 'Ekran süresi', 'Sigara sayacı', 'screenAlternatives'].every((x) => pShared.includes(x)), pShared);
check('paylaşım kapalı: görev sonucu ve iş saati var; ekran, sigara, alternatif talimatı yok', pPrivate.includes('Görev sonuçları') && pPrivate.includes('İş saatleri') && !pPrivate.includes('Ekran süresi') && !pPrivate.includes('Sigara') && !pPrivate.includes('screenAlternatives'));
check('talimat "boşa" yerine "kayıt dışı kalan zaman" der', /kayıt dışı kalan zaman/.test(pShared) && !/boşa geçen/i.test(pShared.replace(/"boşa" gibi/, '')));

const good = { reflection: 'Bugün dolu geçti; olmayan işler yarına kalıyor.', tomorrow: 'Yarın ağır işi sabaha koy.', ideas: [] };
const pr = parseReviewResponse({ ...good, timeUse: 'İş dışında kalan zamanın büyük kısmı kayıt dışı kaldı; bu sadece veri.', screenAlternatives: [{ title: 'Kısa yürüyüş', minutes: 15, why: 'Hareket iyi gelir.' }, { title: 'Tembel olma', minutes: 10, why: 'x' }, { title: 'Kitap oku', minutes: 400, why: 'Odak.' }] }, [])!;
check('yapay zekâ cevabı: zaman metni ve alternatifler okunur; yasaklı olan atılır, süre sınırlanır', pr.timeUse?.includes('kayıt dışı') === true && pr.screenAlternatives?.length === 2 && pr.screenAlternatives[1].minutes === 120);
const bad = parseReviewResponse({ ...good, timeUse: 'Zamanını boşa harcadın, yetersizsin.' }, [])!;
check('zaman metni yargılıyorsa yalnızca o alan atılır, değerlendirme geçerli kalır', bad.reflection === good.reflection && bad.timeUse === undefined);
check('eski biçim (alanlar yok) hâlâ geçerli', parseReviewResponse(good, [])?.timeUse === undefined);
const merged = withTimeUse(parseReviewResponse(good, [])!, rr, full);
check('eksik alanlar kurallardan tamamlanır; açık işle eşleşen alternatif TASK olur', merged.timeUse === rr.timeUse && (merged.screenAlternatives?.length ?? 0) >= 2);
const mergedAi = withTimeUse({ ...pr }, rr, { ...full, openTasks: [{ title: 'Kısa yürüyüş', minutes: 15, workOk: false, missed: null, reason: null }] });
check('yapay zekânın alternatifi korunur, eşleşen TASK sayılır', mergedAi.screenAlternatives?.[0].kind === 'TASK');
const noScreen = withTimeUse(pr, buildRulesReview(facts({ timeUse: tu }), [], []), facts({ timeUse: tu }));
check('ekran verisi yoksa alternatif listesi gösterilmez', noScreen.screenAlternatives === undefined && noScreen.screenNote === undefined);

// ───────────── Hatırlatmalar ─────────────
console.log('Hatırlatmalar');
const rem = (g: object) => planReminders([], at(6, 0), 7, 60, { goals: { waterGoalReached: false, bedtime: null, ...g } });
const r1 = rem({ wakeMinute: 7 * 60, work: { endMin: 1080, days: [1, 2, 3, 4, 5] } });
const wake1 = r1.find((r) => r.id.endsWith('-wake'));
check('sabah suyu: tipik uyanıştan 10 dk sonra, /day', !!wake1 && wake1.at.getHours() * 60 + wake1.at.getMinutes() === 7 * 60 + WAKE_NUDGE_DELAY && wake1.route === '/day');
const mark1 = r1.filter((r) => r.route === '/mark');
check('iş sonrası: hafta içi 18:15, /mark; hafta sonu yok', mark1.length >= 4 && mark1.every((r) => r.at.getHours() === 18 && r.at.getMinutes() === 15 && r.at.getDay() >= 1 && r.at.getDay() <= 5));
check('uyanış bilinmiyorsa 07:45; makul değilse de', (() => { const t = (g: object) => { const w = rem(g).find((r) => r.id.endsWith('-wake'))!; return w.at.getHours() * 60 + w.at.getMinutes(); }; return t({ wakeMinute: null }) === DEFAULT_WAKE_NUDGE_MINUTE && t({ wakeMinute: 120 }) === DEFAULT_WAKE_NUDGE_MINUTE; })());
check('alan hiç verilmezse sabah suyu ve işaretleme kurulmaz (eski davranış)', rem({}).every((r) => !r.id.endsWith('-wake') && r.route !== '/mark'));
check('bugünkü su hedefi tamamsa sabah suyu da susar', planReminders([], at(6, 0), 1, 60, { goals: { waterGoalReached: true, bedtime: null, wakeMinute: 420 } }).every((r) => !r.id.endsWith('-wake')));
check('bildirim metinlerinde yargı yok', r1.every((r) => !hasBannedWords(r.title + r.body)));

// ───────────── Veritabanı ─────────────
async function dbTests(): Promise<void> {
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('şema sürümü 14', DATABASE_VERSION === 14);
  const tables = (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map((t) => t.name);
  check('yeni tablolar var', ['TaskOutcome', 'Setting', 'DayEvent', 'SmokeLog'].every((t) => tables.includes(t)));
  await migrateDbIfNeeded(db);
  check('ikinci geçiş zararsız', (await db.getAllAsync<{ name: string }>('PRAGMA table_info(Task)')).some((c) => c.name === 'workOk'));

  // İş saatleri ayarı
  check('ayar yokken kapalı', (await getWork(db)).enabled === false);
  await saveWork(db, { enabled: true });
  await saveWork(db, { startMin: 8 * 60 });
  const saved = await getWork(db);
  check('ayar kalıcı ve kısmi güncellenir', saved.enabled && saved.startMin === 480 && saved.endMin === 1080);
  check('planlayıcı ayarı okur: iş vaktinde yapılmaz işler iş saatine konmaz', await (async () => {
    const t = await createTask(db, { title: 'Mail yaz', estimatedDuration: 45, cognitiveWeight: 'LOW' });
    await replanDay(db, at(7, 0), 'MANUAL');
    const rows = await db.getAllAsync<{ startTime: string; endTime: string }>('SELECT startTime, endTime FROM TimeBlock WHERE taskId = ?', [t.id]);
    return rows.length > 0 && rows.every((r) => { const s = new Date(r.startTime); const e = new Date(r.endTime); return !(s.getHours() * 60 + s.getMinutes() < 1080 && e.getHours() * 60 + e.getMinutes() > 480 && e.getDate() === s.getDate()); });
  })());
  await toggleWorkOk(db, (await getTask(db, (await db.getFirstAsync<{ id: string }>('SELECT id FROM Task LIMIT 1'))!.id))!, at(7, 0));
  check('"iş vaktinde yapılabilir" işareti değişir', (await db.getFirstAsync<{ workOk: number }>('SELECT workOk FROM Task LIMIT 1'))!.workOk === 1);
  await db.execAsync('DELETE FROM TimeBlock; DELETE FROM Task;');

  // Sonuçlar
  const t1 = await createTask(db, { title: 'Rapor', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Mail', estimatedDuration: 20, cognitiveWeight: 'LOW', workOk: true });
  const t3 = await createTask(db, { title: 'Arama', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  check('workOk kaydedilir ve boolean okunur', (await getTask(db, t2.id))!.workOk === true && (await getTask(db, t1.id))!.workOk === false);
  await replanDay(db, at(7, 0), 'MANUAL');

  await markTaskMissed(db, t1, 'COULD_NOT', 'WORK', at(14, 0));
  const missed = await getTask(db, t1.id);
  const outs = await listTaskOutcomes(db, '2026-11-16');
  check('yapamadım: sonuç yazılır, görev bugünden çıkar (ertelendi)', missed!.status === 'POSTPONED' && outs.length === 1 && outs[0].outcome === 'COULD_NOT' && outs[0].reason === 'WORK');
  await markTaskMissed(db, t1, 'NOT_DONE', null, at(15, 0));
  const outs2 = latestOutcomes(await listTaskOutcomes(db, '2026-11-16'));
  check('aynı iş aynı gün tekrar işaretlenirse son cevap tutulur (tek kayıt)', outs2.length === 1 && outs2[0].outcome === 'NOT_DONE' && outs2[0].reason === null);

  check('aynı gün öğlen: görev geri dönmez', (await carryOverMissed(db, at(16, 0))).length === 0 && (await getTask(db, t1.id))!.status === 'POSTPONED');
  const carried = await carryOverMissed(db, at(22, 30));
  check('22:00 sonrası yarının planına geri döner', carried.join() === 'Rapor' && (await getTask(db, t1.id))!.status === 'PENDING');
  check('bir kez taşınır', (await carryOverMissed(db, at(23, 0))).length === 0);
  await markTaskMissed(db, t3, 'COULD_NOT', 'ENERGY', at(20, 0));
  check('sabah (ertesi gün) taşınır', (await carryOverMissed(db, at(8, 0, 17))).join() === 'Arama' && (await getTask(db, t3.id))!.status === 'PENDING');
  await markTaskMissed(db, t3, 'NOT_DONE', null, at(20, 0));
  await db.runAsync("UPDATE Task SET status = 'PENDING' WHERE id = ?", [t3.id]);
  check('kullanıcı kendisi plana aldıysa dokunulmaz', (await carryOverMissed(db, at(8, 0, 18))).length === 0);

  // Yaptım
  await completeTask(db, t2, 'HIGH', at(12, 0), { loggedAt: at(11, 0), minutes: 25 });
  const logs = await listRecentLogs(db, 10);
  const done = await listTaskOutcomes(db, '2026-11-16');
  check('yaptım: süre ve an elle verilebilir, sonuç DONE yazılır', logs[0].actualDuration === 25 && new Date(logs[0].loggedAt).getHours() === 11 && done.some((o) => o.taskId === t2.id && o.outcome === 'DONE'));
  await addDoneTask(db, { title: 'Müşteri aradı', minutes: 40, energy: 'EXHAUSTED', workOk: true }, at(21, 0), at(13, 0));
  const extra = (await listRecentLogs(db, 10)).find((l) => l.actualDuration === 40);
  check('planda olmayan ama yapılan iş: tamamlanmış görev + kayıt', !!extra && new Date(extra.loggedAt).getHours() === 13 && (await db.getFirstAsync<{ status: string }>("SELECT status FROM Task WHERE title = 'Müşteri aradı'"))!.status === 'COMPLETED');
  const sum = summarizeOutcomes(latestOutcomes(await listTaskOutcomes(db, '2026-11-16')));
  check('özet sayıları', sum.done.length === 2 && sum.total === sum.done.length + sum.notDone.length + sum.couldNot.length);

  // Gün akışı
  const wakeDay = '2026-11-17';
  void wakeDay;
  await stampEvent(db, 'WAKE', at(7, 5, 19), 5);
  await stampEvent(db, 'SHOWER', at(7, 30, 19), 10);
  await stampEvent(db, 'BUS', at(8, 0, 19), 0);
  await stampEvent(db, 'SHOP_IN', at(8, 40, 19), 0);
  const fs = await loadDayFlow(db, at(12, 0, 19));
  check('damga: "N dk önce" geriye yazar; sıradaki dükkandan çıkış', fs.events.map((e) => new Date(e.at).getHours() * 60 + new Date(e.at).getMinutes()).join() === '420,440,480,520' && fs.next === 'SHOP_OUT', fs.events.map((e) => e.at).join());
  check('süreler hesaplanır', fs.flow.prepMinutes === 60 && fs.flow.commuteToMinutes === 40 && fs.flow.shopOpen);
  await removeEvent(db, fs.events[1].id);
  check('damga silinir', (await listDayEvents(db, fs.day)).length === 3);
  const lateNight = await stampEvent(db, 'HOME', at(2, 0, 20), 0);
  check('gece 02:00 damgası önceki günün sayılır (04:00 sınırı)', lateNight.day === '2026-11-19');

  // Sigara
  for (const [h, m] of [[9, 0], [11, 30], [14, 0]] as const) await addSmoke(db, at(h, m, 19), 0);
  check('sınır ayarı yokken null; ayarlayınca kalıcı; kapatınca null', (await getSmokeLimit(db)) === null && (await (async () => { await setSmokeLimit(db, 10); return (await getSmokeLimit(db)) === 10; })()) && (await (async () => { await setSmokeLimit(db, null); return (await getSmokeLimit(db)) === null; })()));
  await setSmokeLimit(db, 5);
  const fs2 = await loadDayFlow(db, at(15, 0, 19));
  check('günün sigara özeti', fs2.smoke.count === 3 && fs2.smoke.avgGapMinutes === 150 && fs2.smoke.leftToLimit === 2 && fs2.smoke.sinceLastMinutes === 60);
  check('dünün kaydı bugüne karışmaz', (await loadDayFlow(db, at(15, 0, 20))).smoke.count === 0);

  // Gün sonu: gerçekleri topla
  await db.execAsync('DELETE FROM TimeBlock; DELETE FROM TaskOutcome; DELETE FROM DayEvent; DELETE FROM SmokeLog; DELETE FROM TimeLog; DELETE FROM Task;');
  const a = await createTask(db, { title: 'Rapor yaz', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const b = await createTask(db, { title: 'Mail', estimatedDuration: 20, cognitiveWeight: 'LOW', workOk: true });
  const c = await createTask(db, { title: 'Kitap', estimatedDuration: 30, cognitiveWeight: 'LOW' });
  const d = await createTask(db, { title: 'Sonradan', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  void d;
  await upsertDailyStat(db, { day: '2026-11-16', steps: 4000, screenMinutes: 220, topApps: [] });
  await markTaskMissed(db, a, 'COULD_NOT', 'WORK', at(21, 0));
  await markTaskMissed(db, c, 'NOT_DONE', null, at(21, 0));
  await completeTask(db, b, 'HIGH', at(21, 0), { loggedAt: at(13, 0), minutes: 20 });
  for (const [k, h, m] of [['WAKE', 7, 0], ['SHOWER', 7, 20], ['BUS', 8, 0], ['SHOP_IN', 8, 40], ['SHOP_OUT', 18, 0], ['BUS', 18, 10], ['HOME', 18, 45]] as const) {
    await addDayEvent(db, '2026-11-16', k, at(h, m));
  }
  await addSmoke(db, at(10, 0), 0);
  await addSmoke(db, at(12, 0), 0);
  await saveWork(db, { enabled: true, startMin: 540, endMin: 1080 });
  const f = await gatherDayFacts(db, at(21, 30));
  check('gerçekler: sonuçlar', f.outcomes?.length === 3 && f.outcomes.some((o) => o.title === 'Rapor yaz' && o.outcome === 'COULD_NOT' && o.reason === 'WORK') && f.outcomes.some((o) => o.title === 'Mail' && o.outcome === 'DONE'));
  check('gerçekler: açık işler, yapılamayanlar işaretli', (f.openTasks ?? []).some((t) => t.title === 'Rapor yaz' && t.missed === 'COULD_NOT') && (f.openTasks ?? []).some((t) => t.title === 'Sonradan' && t.missed === null) && !(f.openTasks ?? []).some((t) => t.title === 'Mail'));
  check('gerçekler: iş penceresi dükkan damgalarından', f.workWindow?.source === 'STAMP' && f.workWindow.startMin === 8 * 60 + 40 && f.workWindow.endMin === 18 * 60);
  const tuDb = f.timeUse!;
  check('zaman dökümü: uyanık 07:00–21:30, iş 9 sa 20 dk, yol 40+35, hazırlık 60', tuDb.awakeMinutes === 870 && tuDb.workMinutes === 560 && tuDb.commuteMinutes === 75 && tuDb.prepMinutes === 60, JSON.stringify(tuDb));
  check('iş vaktinde biten iş (13:00) iş dışına sayılmaz', tuDb.doneOutsideWorkMinutes === 0 && tuDb.freeMinutes === 870 - 560 - 75 - 60 && tuDb.unaccountedMinutes === tuDb.freeMinutes);
  check('sigara özeti gerçeklere girer', f.smoke?.count === 2);

  const rv = await loadOrCreateReview(db, at(21, 30), { cfg: null, shareActivity: false });
  check('değerlendirme (kurallar): zaman metni ve ekran yerine önerileri var (bütçeye sığmayan 60 dakikalık iş önerilmez, 30 dakikalık yapılmayan iş öne gelir)', !!rv.review.payload.timeUse && (rv.review.payload.screenAlternatives?.length ?? 0) >= 2 && rv.review.payload.screenAlternatives![0].title === 'Kitap' && !rv.review.payload.screenAlternatives!.some((a) => a.title === 'Rapor yaz'), JSON.stringify(rv.review.payload.screenAlternatives));
  check('kaydedilen değerlendirme eski biçimle uyumlu (JSON geri okunur)', JSON.stringify((await loadOrCreateReview(db, at(21, 40), { cfg: null, shareActivity: false })).review.payload) === JSON.stringify(rv.review.payload));

  // Zaman dengesi: iş saatleri boş pencere sayılmaz
  const cfg = { settings: { ...EMPTY_GOALS, bedtime: 1410 }, waterGoalMl: 2000, kcalTarget: null };
  const gs = await loadGoalState(db, at(10, 0), cfg);
  check('iş saatleri boş pencere değildir', gs.balance.freeWindows.every((w) => w.to <= 540 || w.from >= 1080), JSON.stringify(gs.balance.freeWindows));
  check('iş saati kayıt dışı kalan zamandan düşülür: 07:00–10:00 arası 180 dk − biten 20 dk − işte geçen 60 dk', gs.balance.unrecordedMinutes === 100, String(gs.balance.unrecordedMinutes));
  await saveWork(db, { enabled: false });
  const gs2 = await loadGoalState(db, at(10, 0), cfg);
  check('iş saatleri kapalıyken eskisi gibi (180 − 20)', gs2.balance.unrecordedMinutes === 160, String(gs2.balance.unrecordedMinutes));

  // Yarın planı
  const tm = planningDay(at(22, 30));
  check('22:30 planlanan gün yarın', dayKey(tm) === '2026-11-17');
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
