/**
 * Haftalık iş programı testi (gün bazlı saatler, Cumartesi yarım gün, Pazar boş, planlayıcı, hatırlatma, boş gün planı).
 * Çalıştırmak için:  npm run test:work
 */
import { createTask } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { hasBannedWords } from '../services/dayReviewLogic';
import { freeDayPlan, type FreeDayTask } from '../services/freeDayLogic';
import { replanDay } from '../services/planner';
import { planReminders } from '../services/routineRemindersLogic';
import {
  DEFAULT_WORK,
  PERSONAL_WORK,
  adjustWork,
  isFreeDay,
  isWorkTime,
  parseWork,
  serializeWork,
  setSpecial,
  weeklyWorkMinutes,
  windowForDow,
  workEndsByDay,
  workSummary,
  workWeekLines,
  workWindowFor,
} from '../services/workLogic';
import { ensureWorkSeed, getWork, saveWork } from '../services/workSettings';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// 16 Kasım 2026 Pazartesi, 21 Cumartesi, 22 Pazar
const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const mins = (iso: string) => {
  const x = new Date(iso);
  return x.getHours() * 60 + x.getMinutes();
};

async function main(): Promise<void> {
  console.log('Program');
  const p = PERSONAL_WORK;
  check('hafta içi 07:40–18:00', JSON.stringify(workWindowFor(at(10), p)) === JSON.stringify({ startMin: 460, endMin: 1080 }));
  check('Cumartesi 08:30–13:30', JSON.stringify(workWindowFor(at(10, 0, 21), p)) === JSON.stringify({ startMin: 510, endMin: 810 }));
  check('Pazar iş yok', workWindowFor(at(10, 0, 22), p) === null && windowForDow(p, 0) === null);
  check('boş gün: yalnızca Pazar; Cumartesi boş gün değil', isFreeDay(at(10, 0, 22), p) && !isFreeDay(at(10, 0, 21), p) && !isFreeDay(at(10), p));
  check('iş saatleri kapalıysa boş gün kavramı yok', !isFreeDay(at(10, 0, 22), { ...p, enabled: false }) && workWindowFor(at(10), { ...p, enabled: false }) === null);
  check('isWorkTime: Pzt 07:30 değil, 07:40 evet; Cmt 12:00 evet, 14:00 hayır; Paz hayır', !isWorkTime(at(7, 30), p) && isWorkTime(at(7, 40), p) && isWorkTime(at(12, 0, 21), p) && !isWorkTime(at(14, 0, 21), p) && !isWorkTime(at(12, 0, 22), p));
  check('özet metni', workSummary(p) === '07:40–18:00 · Pzt–Cum · Cmt 08:30–13:30 · Boş: Paz', workSummary(p));
  check('eski biçim özeti değişmedi', workSummary({ ...DEFAULT_WORK, enabled: true }) === '09:00–18:00 · Pzt–Cum');
  check('bitişler gün gün', JSON.stringify(workEndsByDay(p)) === JSON.stringify({ 1: 1080, 2: 1080, 3: 1080, 4: 1080, 5: 1080, 6: 810 }));
  check('haftalık toplam: 5 × 10 sa 20 dk + 5 sa = 56 sa 40 dk', weeklyWorkMinutes(p) === 5 * 620 + 300, String(weeklyWorkMinutes(p)));
  const lines = workWeekLines(p);
  check('gün gün satırlar', lines[0].text === '07:40–18:00 · 10 sa 20 dk' && lines[5].text === '08:30–13:30 · 5 sa' && lines[6].text === 'Boş gün' && lines[6].free && !lines[5].free, JSON.stringify(lines));

  console.log('Kayıt biçimi');
  check('gidiş-dönüş (özel saatlerle)', JSON.stringify(parseWork(serializeWork(p))) === JSON.stringify(p));
  check('özel saat yoksa alan eklenmez (eski kayıtlarla aynı)', !('special' in parseWork(serializeWork({ ...DEFAULT_WORK, enabled: true }))) && !('special' in parseWork('{"enabled":true,"special":{}}')));
  check('eski kayıt (özel alanı yok) aynen okunur', JSON.stringify(parseWork('{"enabled":true,"startMin":540,"endMin":1080,"days":[1,2,3,4,5]}')) === JSON.stringify({ enabled: true, startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5] }));
  const bad = parseWork(JSON.stringify({ enabled: true, startMin: 460, endMin: 1080, days: [1, 6], special: { 6: { startMin: 700, endMin: 760 }, 9: { startMin: 500, endMin: 800 }, 2: 'x', 3: { startMin: 'a' } } }));
  check('geçersiz özel saatler atılır (çok kısa, gün 9, bozuk)', bad.special === undefined, JSON.stringify(bad.special));
  check('özel saati olmayan gün ortak saati kullanır', windowForDow({ ...p, days: [1, 2, 3, 4, 5, 6], special: undefined }, 6)?.startMin === 460);
  check('özel saati olan gün listeden çıkarılırsa boş sayılır', workWindowFor(at(10, 0, 21), { ...p, days: [1, 2, 3, 4, 5] }) === null);

  console.log('Saat ayarı');
  let w = adjustWork(p, 'COMMON', 'start', -10);
  check('ortak başlangıç 10 dk erken', w.startMin === 450 && w.special?.[6]?.startMin === 510);
  w = adjustWork(p, 6, 'start', 30);
  check('Cumartesi başlangıcı 30 dk geç; ortak saat değişmez', w.special?.[6]?.startMin === 540 && w.startMin === 460);
  w = adjustWork(p, 6, 'end', -30);
  check('Cumartesi bitişi 30 dk erken', w.special?.[6]?.endMin === 780);
  let tiny = p;
  for (let i = 0; i < 30; i += 1) tiny = adjustWork(tiny, 6, 'end', -30);
  check('Cumartesi en az 2 saat kalır', (tiny.special?.[6]?.endMin ?? 0) - (tiny.special?.[6]?.startMin ?? 0) >= 120, JSON.stringify(tiny.special));
  let early = p;
  for (let i = 0; i < 40; i += 1) early = adjustWork(early, 'COMMON', 'start', -30);
  check('ortak başlangıç 05:00\'ten erken olmaz', early.startMin === 300);
  let late = p;
  for (let i = 0; i < 40; i += 1) late = adjustWork(late, 'COMMON', 'start', 30);
  check('ortak iş günü en az 4 saat kalır', late.endMin - late.startMin >= 240, `${late.startMin}-${late.endMin}`);
  check('özel saati olmayan güne doğrudan dokunulmaz', adjustWork(p, 2, 'start', 30) === p);
  const sp = setSpecial({ ...p, special: undefined }, 5, true);
  check('"farklı saat" verilince ortak saatin kopyası olur; kapatılınca silinir', sp.special?.[5]?.startMin === 460 && setSpecial(sp, 5, false).special === undefined);

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('ilk açılışta program bir kez yazılır', (await ensureWorkSeed(db)) === true && JSON.stringify(await getWork(db)) === JSON.stringify(p));
  await saveWork(db, { days: [1, 2, 3, 4, 5] });
  check('ikinci açılışta üzerine yazılmaz', (await ensureWorkSeed(db)) === false && (await getWork(db)).days.length === 5);
  await saveWork(db, { days: [1, 2, 3, 4, 5, 6], special: {} });
  check('özel saatler temizlenebilir', (await getWork(db)).special === undefined);
  await saveWork(db, { special: p.special });
  check('özel saat kaydı kalıcıdır', (await getWork(db)).special?.[6]?.endMin === 810);

  console.log('Planlayıcı');
  const t = await createTask(db, { title: 'Mail yaz', estimatedDuration: 45, cognitiveWeight: 'LOW' });
  const blocksAt = async (now: Date) => {
    await replanDay(db, now, 'MANUAL');
    return db.getAllAsync<{ startTime: string; endTime: string }>('SELECT startTime, endTime FROM TimeBlock WHERE taskId = ?', [t.id]);
  };
  const clashes = (rows: { startTime: string; endTime: string }[], from: number, to: number) => rows.some((r) => mins(r.startTime) < to && mins(r.endTime) > from && new Date(r.endTime).getDate() === new Date(r.startTime).getDate());
  const mon = await blocksAt(at(6, 0));
  check('hafta içi: iş vaktinde (07:40–18:00) yerleşmez', mon.length > 0 && !clashes(mon, 460, 1080), JSON.stringify(mon));
  const sat = await blocksAt(at(6, 0, 21));
  check('Cumartesi: yalnızca 08:30–13:30 dışına yerleşir (öğleden sonra serbest)', sat.length > 0 && !clashes(sat, 510, 810), JSON.stringify(sat));
  const sun = await blocksAt(at(6, 0, 22));
  check('Pazar: iş saati yok, iş hafta içinden (18:00) daha erken yerleşir', sun.length > 0 && Math.min(...sun.map((r) => mins(r.startTime))) < Math.min(...mon.map((r) => mins(r.startTime))), JSON.stringify({ sun, mon }));

  console.log('Hatırlatma');
  const goals = { waterGoalReached: false, bedtime: null, work: { endMin: 1080, days: [1, 2, 3, 4, 5, 6], ends: { 6: 810 } } };
  const rem = planReminders([], at(6, 0, 20), 4, 80, { goals });
  const find = (d: number) => rem.find((r) => r.id.includes(`mark-2026-11-${d}`));
  check('Cuma: iş bitince 18:15', !!find(20) && find(20)!.at.getHours() * 60 + find(20)!.at.getMinutes() === 1095);
  check('Cumartesi: iş bitince 13:45', !!find(21) && find(21)!.at.getHours() * 60 + find(21)!.at.getMinutes() === 825);
  check('Pazar: işaretleme hatırlatması yok', !find(22));
  const old = planReminders([], at(6, 0, 20), 4, 80, { goals: { waterGoalReached: false, bedtime: null, work: { endMin: 1080, days: [1, 2, 3, 4, 5] } } });
  check('eski biçim (bitişler yok) aynı çalışır', old.some((r) => r.id.includes('mark-2026-11-20')) && !old.some((r) => r.id.includes('mark-2026-11-21')));

  console.log('Boş gün planı');
  const tasks: FreeDayTask[] = [
    { id: 'a', title: 'Rapor yaz', estimatedDuration: 90, cognitiveWeight: 'HIGH', status: 'PENDING' },
    { id: 'b', title: 'Mail', estimatedDuration: 15, cognitiveWeight: 'LOW', status: 'PENDING' },
    { id: 'c', title: 'Fatura', estimatedDuration: 20, cognitiveWeight: 'LOW', status: 'POSTPONED' },
    { id: 'd', title: 'Dolap düzeni', estimatedDuration: 60, cognitiveWeight: 'MEDIUM', status: 'PENDING' },
    { id: 'e', title: 'Bitmiş iş', estimatedDuration: 30, cognitiveWeight: 'HIGH', status: 'COMPLETED' },
    { id: 'f', title: 'Çok uzun', estimatedDuration: 240, cognitiveWeight: 'HIGH', status: 'PENDING' },
  ];
  const fp = freeDayPlan(tasks);
  check('tamamlananlar önerilmez; odak isteyen uzun iş önde, bütçeye sığmayanlar atlanır', fp.items.map((i) => i.id).join() === 'f,d', JSON.stringify(fp.items));
  const pp = freeDayPlan([tasks[1], tasks[2]]);
  check('ertelenmiş iş önce gelir ve "Ertelenmişti" der', pp.items[0].id === 'c' && pp.items[0].why === 'Ertelenmişti' && pp.items[1].why === 'Kısa iş', JSON.stringify(pp.items));
  check('bütçeyi (5 sa) aşmaz; ilk iş büyükse yine alınır', fp.totalMinutes <= 300 && fp.items.length >= 1, String(fp.totalMinutes));
  check('en çok 5 iş', freeDayPlan(Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, title: `İş ${i}`, estimatedDuration: 10, cognitiveWeight: 'LOW' as const, status: 'PENDING' as const }))).items.length === 5);
  const empty = freeDayPlan([]);
  check('iş yoksa sakin bir cümle', empty.items.length === 0 && /Dinlenebilir/.test(empty.headline));
  check('başlıkta süre ve yargı yok', /yaklaşık/.test(fp.headline) && !hasBannedWords(fp.headline) && fp.items.every((i) => !hasBannedWords(i.why)));
  check('açık iş sayısı', fp.openCount === 5);
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
