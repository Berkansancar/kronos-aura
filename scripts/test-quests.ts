/**
 * Haftalık görevler testi (seçim, ilerleme, bonus XP, geçmişe bonus verilmemesi, Kahraman entegrasyonu).
 * Çalıştırmak için:  npm run test:quests
 */
import { createRoutine, setMoodLog } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { getGameState, loadGame } from '../services/game';
import {
  EMPTY_GAME_STATE,
  buildGame,
  dayXp,
  parseGameState,
  serializeGameState,
  type GameDay,
} from '../services/gameLogic';
import {
  QUESTS_PER_WEEK,
  buildQuests,
  evaluateWeek,
  questLine,
  questsForWeek,
  shiftWeek,
  weekEndOf,
  weekIndex,
  weekStartOf,
} from '../services/questsLogic';
import { markRoutineDoneOnDay } from '../services/routineFlow';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const goals = { waterGoalMl: 2000, languageGoalMin: 20 };
const noWater = { waterGoalMl: null, languageGoalMin: 20 };
const day = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function gd(d: string, over: Partial<GameDay> = {}): GameDay {
  return { day: d, tasksDone: 0, taskMinutes: 0, routinesDone: 0, waterMl: null, languageMinutes: null, moodLogged: false, ...over };
}

async function main(): Promise<void> {
  console.log('Hafta sınırları');
  check('Pazar önceki haftaya ait', weekStartOf('2026-11-15') === '2026-11-09');
  check('Pazartesi kendi haftasının başı', weekStartOf('2026-11-16') === '2026-11-16');
  check('Pazar haftanın sonu', weekEndOf('2026-11-16') === '2026-11-22' && weekStartOf('2026-11-22') === '2026-11-16');
  check('ay/yıl geçişi', weekStartOf('2027-01-01') === '2026-12-28' && weekEndOf('2026-12-28') === '2027-01-03');
  check('haftayı kaydırma', shiftWeek('2026-11-16', -1) === '2026-11-09' && shiftWeek('2026-11-16', 3) === '2026-12-07');
  check('hafta numarası ardışık', weekIndex('2026-11-16') === weekIndex('2026-11-09') + 1);

  console.log('Görev seçimi');
  const a = questsForWeek('2026-11-16', goals).map((q) => q.id).join();
  check('aynı hafta hep aynı görevler', a === questsForWeek('2026-11-16', goals).map((q) => q.id).join());
  check('her hafta 3 görev, her biri farklı aileden', questsForWeek('2026-11-16', goals).length === QUESTS_PER_WEEK && new Set(questsForWeek('2026-11-16', goals).map((q) => q.family)).size === 3);
  let waterSeen = false;
  let waterWhenOff = false;
  const combos = new Set<string>();
  const families = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    const w = shiftWeek('2026-01-05', i);
    const on = questsForWeek(w, goals);
    combos.add(on.map((q) => q.id).join());
    on.forEach((q) => families.add(q.family));
    if (on.some((q) => q.family === 'water')) waterSeen = true;
    const off = questsForWeek(w, noWater);
    if (off.some((q) => q.family === 'water')) waterWhenOff = true;
    if (off.length !== QUESTS_PER_WEEK) throw new Error('su hedefi yokken de 3 görev olmalı');
  }
  check('40 haftada çeşitli kombinasyonlar', combos.size >= 10, `combos=${combos.size}`);
  check('tüm aileler zamanla görünür', families.size === 6);
  check('su görevi hedef varken çıkar, yokken hiç çıkmaz', waterSeen && !waterWhenOff);

  console.log('İlerleme');
  const wk = '2026-11-16';
  // Sabit, bilinen bir görev seti için ilerlemeyi doğrudan hesaplamak üzere tüm havuz görevlerini sınıyoruz
  const days = [
    gd(day(11, 16), { tasksDone: 3, routinesDone: 2, waterMl: 2200, languageMinutes: 30, moodLogged: true }),
    gd(day(11, 17), { tasksDone: 2, routinesDone: 3, waterMl: 1000, languageMinutes: 0, moodLogged: true }),
    gd(day(11, 18), { routinesDone: 1, waterMl: 2000 }),
    gd(day(11, 19), { tasksDone: 5, languageMinutes: 70 }),
    gd(day(11, 21), { tasksDone: 9, routinesDone: 9, moodLogged: true }), // bugünden sonrası (bugün 19)
    gd(day(11, 15), { tasksDone: 50, routinesDone: 50 }), // önceki hafta
  ];
  const { QUEST_POOL } = await import('../services/questsLogic');
  const week = days.filter((d) => d.day >= wk && d.day <= '2026-11-19');
  const prog = (id: string) => QUEST_POOL.find((q) => q.id === id)!.progress(week, goals);
  check('rutin günü sayısı', prog('routine-days') === 3);
  check('rutin toplamı', prog('routine-count') === 6);
  check('dil günü', prog('lang-days') === 2);
  check('dil dakikası', prog('lang-minutes') === 100);
  check('biten iş', prog('tasks') === 10);
  check('su hedefi günleri (2000 ve üstü)', prog('water-days') === 2);
  check('ruh hali günleri', prog('mood-days') === 2);
  check('etkin günler', prog('active-days') === 4);
  const ev = evaluateWeek(wk, days, goals, '2026-11-19', true);
  const lines = ev.quests.map((q) => `${q.id}:${q.progress}/${q.target}`);
  check('değerlendirme bugünden sonrasını ve önceki haftayı saymaz', ev.quests.every((q) => q.progress < 150 && (q.id !== 'tasks' || q.progress === 10) && (q.id !== 'routine-count' || q.progress === 6) && (q.id !== 'lang-minutes' || q.progress === 100) && (q.id !== 'water-days' || q.progress === 2)) && lines.length === 3, lines.join());
  check('XP yalnızca tamamlananlardan', ev.xp === ev.quests.filter((q) => q.done).reduce((s, q) => s + q.xp, 0));
  const none = evaluateWeek(wk, days, goals, '2026-11-19', false);
  check('sayılmayan haftada XP 0', none.xp === 0 && none.counts === false);

  console.log('Geçmişe bonus yok');
  const richPast = [] as GameDay[];
  for (let i = 0; i < 28; i += 1) richPast.push(gd(shiftDay('2026-10-19', i), { tasksDone: 4, routinesDone: 4, languageMinutes: 40, waterMl: 2500, moodLogged: true }));
  const fresh = buildQuests(richPast, goals, undefined, '2026-11-15');
  check('başlangıç kaydı yoksa yalnızca süren hafta', fresh.startWeek === '2026-11-09' && fresh.recent.length === 1);
  const withStart = buildQuests(richPast, goals, '2026-10-19', '2026-11-15');
  check('başlangıç haftasından itibaren haftalar sayılır (4 hafta)', withStart.recent.length === 4 && withStart.totalXp > fresh.totalXp);
  check('hepsi tamamsa bonus = tüm görev XP\'leri', withStart.totalCompleted === 12 && withStart.totalXp === withStart.recent.reduce((s, w) => s + w.xp, 0));
  check('altın = XP / 2', withStart.totalGold === Math.floor(withStart.totalXp / 2));
  check('gelecekte bir başlangıç süren haftaya çekilir', buildQuests(richPast, goals, '2027-03-01', '2026-11-15').startWeek === '2026-11-09');
  check('bozuk başlangıç yok sayılır', buildQuests(richPast, goals, 'bozuk', '2026-11-15').recent.length === 1);

  console.log('Kahraman ile birleşme');
  const base = buildGame(richPast, goals, EMPTY_GAME_STATE);
  const bonus = buildGame(richPast, goals, EMPTY_GAME_STATE, { xp: withStart.totalXp, completed: withStart.totalCompleted });
  check('bonus XP toplam XP\'ye eklenir', bonus.totalXp === base.totalXp + withStart.totalXp && bonus.questXp === withStart.totalXp);
  check('altın bonusla artar', bonus.earnedGold === base.earnedGold + Math.floor(withStart.totalXp / 2));
  check('görev rozeti', bonus.badges.find((b) => b.id === 'quest-1')!.earned && !base.badges.find((b) => b.id === 'quest-1')!.earned);
  check('bonus yokken eski davranış', base.questXp === 0);
  const st = parseGameState(serializeGameState({ ...EMPTY_GAME_STATE, questsStart: '2026-11-09' }));
  check('questsStart kaydedilip okunur', st.questsStart === '2026-11-09');
  check('bozuk questsStart atılır', parseGameState('{"questsStart":"yarın"}').questsStart === undefined);
  check('eski kayıtlar (questsStart yok) sorunsuz', parseGameState('{"rewards":[],"purchases":[],"spentTrimmed":0}').questsStart === undefined);
  check('cümleler yargısız', !/kötü|başarısız|boşa|yetersiz/i.test([questLine(none), questLine({ ...none, completed: 0 }, true), questLine({ ...ev, completed: 3, quests: ev.quests })].join(' ')));

  console.log('Veritabanından');
  // Rutin görevi içeren bir hafta bul
  let monday = '2026-01-05';
  while (!questsForWeek(monday, goals).some((q) => q.id === 'routine-days')) monday = shiftWeek(monday, 1);
  const sat = new Date(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)) - 1, Number(monday.slice(8, 10)) + 5, 12, 0, 0);
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const walk = await createRoutine(db, { title: 'Yürüyüş', category: 'SAGLIK', estimatedDuration: 20, cognitiveWeight: 'LOW', askHour: 18, askMinute: 0 });
  // Önceki haftada bolca rutin: görevler henüz başlamadığı için bonus vermemeli
  for (let i = 1; i <= 7; i += 1) await markRoutineDoneOnDay(db, walk, shiftDay(monday, -i), sat);
  const first = await loadGame(db, sat, goals);
  check('ilk yüklemede başlangıç haftası kaydedilir', (await getGameState(db)).questsStart === monday && first.quests.startWeek === monday);
  check('önceki haftalardan bonus yok, seviye sıçramaz', first.quests.totalXp === 0 && first.summary.questXp === 0);
  const xpBefore = first.summary.totalXp;
  for (let i = 0; i < 5; i += 1) await markRoutineDoneOnDay(db, walk, shiftDay(monday, i), sat);
  await setMoodLog(db, shiftDay(monday, 1), 4, sat);
  const after = await loadGame(db, sat, goals);
  const routineQuest = after.quests.current.quests.find((q) => q.id === 'routine-days')!;
  check('5 gün rutin: görev tamamlandı', routineQuest.progress === 5 && routineQuest.done);
  const dayPart = after.summary.totalXp - after.quests.totalXp;
  check('toplam XP = günlük XP + görev bonusu', after.quests.totalXp >= 40 && dayPart === xpBefore + 5 * 5, `${dayPart} vs ${xpBefore}`);
  check('ikinci yüklemede başlangıç değişmez', (await getGameState(db)).questsStart === monday);
  const moodQ = after.quests.current.quests.find((q) => q.id === 'mood-days');
  check('ruh hali görevi varsa ilerleme 1', !moodQ || moodQ.progress === 1);
  check('görev sayısı bonusu özetlenir', after.summary.badges.some((b) => b.id === 'quest-1' && b.earned));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

function shiftDay(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(y, m - 1, dd + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

void dayXp;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
