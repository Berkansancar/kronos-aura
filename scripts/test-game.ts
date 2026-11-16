/**
 * Oyunlaştırma testi (XP, seviye, altın, seri, rozetler, ödüller, veritabanından türetme).
 * Çalıştırmak için:  npm run test:game
 */
import { addTaskOutcome, createTask, upsertDailyStat } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { backupRestoreSmoke } from './gameBackupHelper';
import { completeTask } from '../services/taskFlow';
import { hasBannedWords } from '../services/dayReviewLogic';
import { addGameReward, buyGameReward, deleteGameReward, getGameState, loadGame, refundGamePurchase, takeLevelUp } from '../services/game';
import {
  EMPTY_GAME_STATE,
  GameError,
  MAX_PURCHASES,
  MAX_REWARDS,
  addReward,
  buildBadges,
  buildGame,
  buyReward,
  computeStreak,
  dayXp,
  goldOf,
  levelFromXp,
  levelUpMessage,
  parseGameState,
  rankOf,
  refundPurchase,
  removeReward,
  serializeGameState,
  spentTotal,
  xpForLevel,
  type GameDay,
} from '../services/gameLogic';
import { addStudy } from '../services/language';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const key = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const goals = { waterGoalMl: 2000, languageGoalMin: 20 };
const day = (over: Partial<GameDay> = {}): GameDay => ({ day: key(16), tasksDone: 0, taskMinutes: 0, routinesDone: 0, waterMl: null, languageMinutes: null, ...over });
const throws = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (e) {
    return e instanceof GameError ? e.message : `BAŞKA HATA: ${String(e)}`;
  }
};

async function main(): Promise<void> {
  console.log('Günlük XP');
  check('boş gün 0 XP', dayXp(day(), goals).xp === 0);
  check('iş: iş başına 10 + her 5 dk için 1', dayXp(day({ tasksDone: 3, taskMinutes: 90 }), goals).xp === 30 + 18);
  check('iş süresi günde 8 saatle sınırlı', dayXp(day({ tasksDone: 1, taskMinutes: 2000 }), goals).xp === 10 + 96);
  check('rutin 5 XP, günde en çok 50', dayXp(day({ routinesDone: 4 }), goals).xp === 20 && dayXp(day({ routinesDone: 30 }), goals).xp === 50);
  check('su hedefi 10 XP; hedefin altı ya da ölçülmeyen sayılmaz', dayXp(day({ waterMl: 2000 }), goals).xp === 10 && dayXp(day({ waterMl: 1999 }), goals).xp === 0 && dayXp(day({ waterMl: null }), goals).xp === 0 && dayXp(day({ waterMl: 5000 }), { ...goals, waterGoalMl: null }).xp === 0);
  check('dil: 2 dk = 1 XP (en çok 60 dk), hedef tamamlanırsa +10', dayXp(day({ languageMinutes: 10 }), goals).xp === 5 && dayXp(day({ languageMinutes: 25 }), goals).xp === 12 + 10 && dayXp(day({ languageMinutes: 300 }), goals).xp === 30 + 10 && dayXp(day({ languageMinutes: 25 }), { ...goals, languageGoalMin: null }).xp === 12);
  const full = dayXp(day({ tasksDone: 2, taskMinutes: 60, routinesDone: 2, waterMl: 2200, languageMinutes: 20 }), goals);
  check('toplam ve parçalar', full.xp === 32 + 10 + 10 + 10 + 10 && full.parts.length === 5 && full.parts.reduce((a, p) => a + p.xp, 0) === full.xp, JSON.stringify(full));
  check('altın XP\'nin yarısı (aşağı yuvarlanır)', goldOf(51) === 25 && goldOf(0) === 0 && full.gold === goldOf(full.xp));
  check('etiketlerde yargı yok', full.parts.every((p) => !hasBannedWords(p.label)));

  console.log('Seviye');
  check('1. seviye için 100 XP, her seviye 50 fazla', xpForLevel(1) === 100 && xpForLevel(2) === 150 && xpForLevel(3) === 200);
  let li = levelFromXp(0);
  check('0 XP: seviye 1, oran 0', li.level === 1 && li.into === 0 && li.needed === 100 && li.ratio === 0);
  li = levelFromXp(99);
  check('99 XP: hâlâ seviye 1', li.level === 1 && li.into === 99);
  li = levelFromXp(100);
  check('100 XP: seviye 2', li.level === 2 && li.into === 0 && li.needed === 150);
  li = levelFromXp(100 + 150 + 75);
  check('325 XP: seviye 3, 75/200', li.level === 3 && li.into === 75 && li.needed === 200 && li.ratio === 0.375);
  check('negatif / küsuratlı XP güvenli', levelFromXp(-5).level === 1 && levelFromXp(100.9).level === 2);
  check('üst sınır 99', levelFromXp(10_000_000).level === 99);
  check('ünvanlar', rankOf(1).title === 'Çaylak' && rankOf(2).title === 'Çaylak' && rankOf(3).title === 'Yolcu' && rankOf(6).title === 'Kâşif' && rankOf(10).title === 'Usta' && rankOf(15).title === 'Üstat' && rankOf(20).title === 'Efsane' && rankOf(99).title === 'Efsane');

  console.log('Seri');
  check('hiç aktif gün yok: 0', computeStreak([false, false, false]).current === 0 && computeStreak([]).current === 0);
  check('art arda 3 gün', computeStreak([false, true, true, true]).current === 3);
  check('bugün boşsa seri bozulmaz (gün bitmedi)', computeStreak([true, true, false]).current === 2);
  check('bir günlük boşluk (dinlenme günü) seriyi bozmaz', computeStreak([true, true, false, true, true]).current === 4);
  check('dün boş, bugün henüz boş: seri sürer (bir günlük dinlenme); üç gün boşsa biter', computeStreak([true, true, false, false]).current === 2 && computeStreak([true, true, false, false, false]).current === 0);
  check('iki günlük boşluk seriyi böler', computeStreak([true, true, false, false, true]).current === 1 && computeStreak([true, true, false, false, true]).best === 2);
  check('en uzun seri geçmişten gelir', computeStreak([true, true, true, true, false, false, true, false, false]).best === 4);
  check('bugün boş, dün aktif, ondan önce boş: seri 1', computeStreak([false, false, true, false]).current === 1);

  console.log('Ödüller');
  let s = addReward(EMPTY_GAME_STATE, '  30 dk dizi ', 30, 'r1');
  check('ödül eklenir, ad kırpılır', s.rewards.length === 1 && s.rewards[0].title === '30 dk dizi' && s.rewards[0].price === 30);
  check('boş ad reddedilir', /adını yaz/.test(throws(() => addReward(s, '   ', 10, 'r2'))));
  check('fiyat 1–1000 arası olmalı', /1 ile 1000/.test(throws(() => addReward(s, 'X', 0, 'r2'))) && /1 ile 1000/.test(throws(() => addReward(s, 'X', 1001, 'r2'))) && /1 ile 1000/.test(throws(() => addReward(s, 'X', Number.NaN, 'r2'))));
  check('aynı ad (büyük/küçük harf farkı olsa da) reddedilir', /zaten/.test(throws(() => addReward(s, '30 DK DİZİ', 5, 'r2'))));
  let many = EMPTY_GAME_STATE;
  for (let i = 0; i < MAX_REWARDS; i += 1) many = addReward(many, `Ödül ${i}`, 5, `r${i}`);
  check('en çok 20 ödül', /En çok 20/.test(throws(() => addReward(many, 'Fazla', 5, 'rx'))));
  check('altın yetmezse satın alma reddedilir', /Yetmiyor: 30 altın gerekiyor, 10 altının var/.test(throws(() => buyReward(s, 'r1', 10, 'p1', at(10)))));
  check('olmayan ödül', /bulunamadı/.test(throws(() => buyReward(s, 'yok', 100, 'p1', at(10)))));
  const b1 = buyReward(s, 'r1', 100, 'p1', at(10));
  check('satın alma kaydedilir, harcama toplanır', b1.purchases.length === 1 && b1.purchases[0].price === 30 && spentTotal(b1) === 30);
  check('geri alınca altın geri döner', spentTotal(refundPurchase(b1, 'p1')) === 0);
  check('ödül silinince geçmiş satın almalar durur', removeReward(b1, 'r1').rewards.length === 0 && spentTotal(removeReward(b1, 'r1')) === 30);
  let heavy = addReward(EMPTY_GAME_STATE, 'Kahve', 10, 'k');
  for (let i = 0; i < MAX_PURCHASES + 5; i += 1) heavy = buyReward(heavy, 'k', 1000, `p${i}`, at(10));
  check('satın alma listesi 100 ile sınırlı, harcanan toplam korunur', heavy.purchases.length === MAX_PURCHASES && spentTotal(heavy) === (MAX_PURCHASES + 5) * 10, `${heavy.purchases.length} ${spentTotal(heavy)}`);
  check('kayıt gidiş-dönüş', JSON.stringify(parseGameState(serializeGameState(heavy))) === JSON.stringify(heavy));
  check('bozuk kayıt boş duruma döner', JSON.stringify(parseGameState('{bozuk')) === JSON.stringify(EMPTY_GAME_STATE) && parseGameState(null).rewards.length === 0);
  check('geçersiz öğeler atılır', parseGameState(JSON.stringify({ rewards: [{ id: 'a', title: '', price: 5 }, { id: 'b', title: 'İyi', price: 0 }, { id: 'c', title: 'Tamam', price: 7 }], purchases: [{ id: 'x' }] })).rewards.map((r) => r.id).join() === 'c');

  console.log('Özet');
  const days: GameDay[] = [
    day({ day: key(10), tasksDone: 2, taskMinutes: 60 }),
    day({ day: key(11) }),
    day({ day: key(12), tasksDone: 1, taskMinutes: 30, waterMl: 2100 }),
    day({ day: key(13), routinesDone: 3, languageMinutes: 30 }),
    day({ day: key(14), tasksDone: 4, taskMinutes: 120, waterMl: 2500, languageMinutes: 20 }),
    day({ day: key(15) }),
    day({ day: key(16), tasksDone: 1, taskMinutes: 20 }),
  ];
  const sum = buildGame(days, goals, b1);
  const perDay = days.map((d) => dayXp(d, goals).xp);
  const total = perDay.reduce((a, b) => a + b, 0);
  check('toplam XP günlerin toplamı', sum.totalXp === total, `${sum.totalXp} ${total}`);
  check('altın = kazanılan − harcanan (en az 0)', sum.earnedGold === days.reduce((a, d) => a + dayXp(d, goals).gold, 0) && sum.gold === Math.max(0, sum.earnedGold - 30));
  check('bugün ve hafta', sum.today.xp === perDay[6] && sum.weekXp === total && sum.today.day === key(16));
  check('seri: tek günlük boşluklar (11 ve 15) zinciri bozmaz → 5 aktif gün', sum.streak.current === 5 && sum.streak.best === 5, JSON.stringify(sum.streak));
  check('seviye ve ünvan toplam XP\'ten', sum.level === levelFromXp(total).level && sum.rank.title === rankOf(sum.level).title);
  check('rozetler: ilk adım kazanıldı, 100 iş kazanılmadı', sum.badges.find((b) => b.id === 'task-1')!.earned && !sum.badges.find((b) => b.id === 'task-100')!.earned && sum.earnedBadges >= 1);
  check('boş geçmişte çökmez', buildGame([], goals, EMPTY_GAME_STATE).gold === 0 && buildGame([], goals, EMPTY_GAME_STATE).level === 1);
  const bd = buildBadges({ tasks: 250, routines: 20, waterDays: 30, languageMinutes: 3000, bestStreak: 30, level: 10, quests: 10 });
  check('tüm rozetler kazanılabilir', bd.every((b) => b.earned) && bd.length === 19);
  check('görev rozetleri: görev sayısı verilmezse kazanılmaz', !buildBadges({ tasks: 0, routines: 0, waterDays: 0, languageMinutes: 0, bestStreak: 0, level: 1 }).some((b) => b.id.startsWith('quest') && b.earned));
  check('rozet adları/ipuçlarında yargı yok', bd.every((b) => !hasBannedWords(b.title) && !hasBannedWords(b.hint)));
  check('seviye atlama mesajları', levelUpMessage(null, 1) === null && /başlıyorsun/.test(levelUpMessage(null, 4) ?? '') && /Seviye 5!/.test(levelUpMessage(4, 5) ?? '') && levelUpMessage(5, 5) === null && levelUpMessage(6, 5) === null);

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const t1 = await createTask(db, { title: 'Rapor', estimatedDuration: 30, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Mail', estimatedDuration: 20, cognitiveWeight: 'LOW' });
  await completeTask(db, t1, 'HIGH', at(10, 0), { loggedAt: at(10, 0), minutes: 30 });
  await completeTask(db, t2, 'HIGH', at(11, 0), { loggedAt: at(11, 0), minutes: 20 });
  await addStudy(db, 'PAPER', 20, at(20, 0));
  let g = await loadGame(db, at(22, 0), goals);
  const expected = dayXp(day({ tasksDone: 2, taskMinutes: 50, languageMinutes: 20 }), goals).xp;
  check('veritabanından türetilir: 2 iş (50 dk) + dil 20 dk', g.summary.totalXp === expected && g.summary.today.xp === expected, `${g.summary.totalXp} beklenen ${expected}`);
  check('tek aktif gün: seri 1', g.summary.streak.current === 1);
  const before = g.summary.totalXp;
  await upsertDailyStat(db, { day: key(16), steps: 100, screenMinutes: 60, topApps: [{ label: 'Duolingo', minutes: 40 }] });
  g = await loadGame(db, at(22, 0), goals);
  check('Duolingo ekran süresi de dil çalışmasına sayılır', g.summary.totalXp > before, `${g.summary.totalXp} > ${before}`);
  await addGameReward(db, 'Çay molası', 5);
  await addGameReward(db, 'Dizi', 9999).catch(() => undefined);
  const st = await getGameState(db);
  check('ödül kalıcı; geçersiz fiyat eklenmez', st.rewards.length === 1 && st.rewards[0].title === 'Çay molası');
  const bought = await buyGameReward(db, st.rewards[0].id, at(22, 5), goals);
  check('satın alma altını düşürür', bought.summary.gold === g.summary.gold - 5 && bought.state.purchases.length === 1);
  let tooMuch = '';
  await addGameReward(db, 'Büyük ödül', 1000);
  await buyGameReward(db, (await getGameState(db)).rewards[1].id, at(22, 6), goals).catch((e) => (tooMuch = e instanceof GameError ? e.message : String(e)));
  check('altın yetmeyince satın alma olmaz', /Yetmiyor/.test(tooMuch) && (await getGameState(db)).purchases.length === 1, tooMuch);
  await refundGamePurchase(db, bought.state.purchases[0].id);
  check('geri alınca altın döner', (await loadGame(db, at(22, 10), goals)).summary.gold === g.summary.gold);
  await deleteGameReward(db, st.rewards[0].id);
  check('ödül silinir', (await getGameState(db)).rewards.length === 1);

  // İşi geri almak puanı da geri alır
  const doneBefore = (await loadGame(db, at(22, 0), goals)).summary.totalXp;
  await db.runAsync('DELETE FROM TimeLog WHERE taskId = ?', [t2.id]);
  check('kayıt silinince (geri alma) XP düşer', (await loadGame(db, at(22, 0), goals)).summary.totalXp < doneBefore);
  void addTaskOutcome;

  console.log('Seviye bildirimi');
  const first = await takeLevelUp(db, 3);
  check('ilk açılışta geçmişten başlangıç mesajı, bir kez', /başlıyorsun/.test(first ?? '') && (await takeLevelUp(db, 3)) === null);
  check('seviye atlayınca mesaj, sonra susar', /Seviye 4!/.test((await takeLevelUp(db, 4)) ?? '') && (await takeLevelUp(db, 4)) === null);
  check('seviye 1 ve ilk açılış: mesaj yok', (await takeLevelUp(makeTestDb().db, 1)) === null);

  console.log('Yedek');
  await backupRestoreSmoke(db, check);
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
