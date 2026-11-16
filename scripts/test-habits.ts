/**
 * Şablon paketleri, simge/renk, alışkanlık takvimi, ruh hali, rutin tarzı testi ve ipuçları testi.
 * Çalıştırmak için:  npm run test:habits
 */
import { listRoutines, listMoodLogsSince, setMoodLog, getMoodLog, createRoutine, updateRoutine, listRoutineLogsSince, addRoutineLog } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import type { MoodLog, Routine, RoutineLog } from '../database/types';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { buildRulesReview, factChips, type DayFacts } from '../services/dayReviewLogic';
import { buildManualReviewPrompt } from '../services/dayReview';
import { hasBannedWords } from '../services/dayReviewLogic';
import {
  bestStreak,
  buildMonth,
  currentStreak,
  dayDetail,
  doneByDay,
  intensity,
  monthGrid,
  monthKeyOf,
  monthTitle,
  shiftMonth,
  summarize,
} from '../services/habitCalendarLogic';
import { loadHabitScreen, logMood, saveMoodNote, setMoodForDay, todayMood } from '../services/habits';
import {
  MOODS,
  lowRun,
  moodAverage,
  moodCounts,
  moodInsight,
  moodReply,
  moodSeries,
  moodVsRoutines,
} from '../services/moodLogic';
import { addRoutineFromTemplate, addRoutinePack } from '../services/routineFlow';
import { CATEGORY_COLOR, CATEGORY_ICON, ROUTINE_COLORS, ROUTINE_ICONS, isHexColor, routineColor, routineIcon, withAlpha } from '../services/routineLook';
import { ROUTINE_PACKS, ROUTINE_TEMPLATES, getPack, getTemplate } from '../services/routineTemplates';
import { SELF_CARE_TIPS, tipOfDay } from '../services/selfCareTips';
import { STYLE_QUIZ, STYLE_RESULT, scoreQuiz } from '../services/styleQuizLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  title: 'Yürüyüş',
  category: 'SAGLIK',
  estimatedDuration: 20,
  cognitiveWeight: 'LOW',
  askHour: 18,
  askMinute: 30,
  status: 'ACTIVE',
  createdAt: new Date(2026, 9, 1).toISOString(),
  retiredAt: null,
  templateId: null,
  icon: null,
  color: null,
  ...over,
});
let seq = 0;
const done = (routineId: string, d: number): RoutineLog => ({
  id: `l${(seq += 1)}`,
  routineId,
  day: day(d),
  outcome: 'DONE',
  taskId: null,
  snoozeUntil: null,
  loggedAt: new Date(2026, 10, d, 19).toISOString(),
});
const mood = (d: number, m: 1 | 2 | 3 | 4 | 5, note: string | null = null): MoodLog => ({
  day: day(d),
  mood: m,
  note,
  updatedAt: new Date(2026, 10, d, 21).toISOString(),
});

async function main(): Promise<void> {
  console.log('Şablonlar ve paketler');
  const ids = ROUTINE_TEMPLATES.map((t) => t.id);
  check('şablon id\'leri benzersiz', new Set(ids).size === ids.length);
  check('her şablonun simgesi, saati ve nedeni var', ROUTINE_TEMPLATES.every((t) => t.icon.length > 0 && t.askHour >= 0 && t.askHour <= 23 && t.askMinute >= 0 && t.askMinute <= 59 && t.why.length > 5));
  check('şablonlar en az 24', ROUTINE_TEMPLATES.length >= 24);
  check('beş paket, benzersiz id', ROUTINE_PACKS.length === 5 && new Set(ROUTINE_PACKS.map((p) => p.id)).size === 5);
  check('paketlerdeki her şablon var', ROUTINE_PACKS.every((p) => p.items.every((i) => getTemplate(i.templateId))));
  check('paket içinde aynı şablon iki kez yok', ROUTINE_PACKS.every((p) => new Set(p.items.map((i) => i.templateId)).size === p.items.length));
  check('paket saatleri geçerli', ROUTINE_PACKS.every((p) => p.items.every((i) => (i.hour ?? 0) >= 0 && (i.hour ?? 0) <= 23 && (i.minute ?? 0) >= 0 && (i.minute ?? 0) < 60)));
  check('şablon ve paket metinlerinde yasak sözcük yok', ROUTINE_TEMPLATES.every((t) => !hasBannedWords(t.title) && !hasBannedWords(t.why)) && ROUTINE_PACKS.every((p) => !hasBannedWords(p.about)));
  check('getPack bilinmeyen id için undefined', getPack('yok') === undefined && getPack('sabah')?.title === 'Güne güzel başla');

  console.log('Simge ve renk');
  check('8 renk geçerli hex, 24 simge benzersiz', ROUTINE_COLORS.length === 8 && ROUTINE_COLORS.every((c) => isHexColor(c.value)) && new Set(ROUTINE_ICONS).size === ROUTINE_ICONS.length && ROUTINE_ICONS.length === 24);
  check('seçim yoksa kategori varsayılanı', routineIcon(routine()) === CATEGORY_ICON.SAGLIK && routineColor(routine()) === CATEGORY_COLOR.SAGLIK);
  check('seçim varsa o gösterilir', routineIcon(routine({ icon: '🎨' })) === '🎨' && routineColor(routine({ color: '#F472B6' })) === '#F472B6');
  check('bozuk renk/boş simge varsayılana döner', routineColor(routine({ color: 'kırmızı' })) === CATEGORY_COLOR.SAGLIK && routineIcon(routine({ icon: '  ' })) === CATEGORY_ICON.SAGLIK);
  check('withAlpha', withAlpha('#FF0000', 0.5) === 'rgba(255,0,0,0.5)' && withAlpha('bozuk', 2).startsWith('rgba(95,214,180,1'));

  console.log('Veritabanı v12');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('son sürüm 12', (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === DATABASE_VERSION && DATABASE_VERSION === 12);
  const cols = (raw.prepare('PRAGMA table_info(Routine)').all() as { name: string }[]).map((c) => c.name);
  check('Routine tablosunda icon ve color var', cols.includes('icon') && cols.includes('color'));
  check('MoodLog tablosu var', (raw.prepare("SELECT name FROM sqlite_master WHERE name='MoodLog'").all() as unknown[]).length === 1);

  // v11'den yükseltme: eski rutin korunur, simge/renk boş
  const old = makeTestDb();
  await migrateDbIfNeeded(old.db);
  old.raw.exec('ALTER TABLE Routine DROP COLUMN icon; ALTER TABLE Routine DROP COLUMN color; DROP TABLE MoodLog; PRAGMA user_version = 11;');
  old.raw
    .prepare("INSERT INTO Routine (id,title,category,estimatedDuration,cognitiveWeight,askHour,askMinute,status,createdAt) VALUES ('e1','Eski','ZIHIN',10,'LOW',9,0,'ACTIVE','2026-10-01T10:00:00.000Z')")
    .run();
  await migrateDbIfNeeded(old.db);
  const upgraded = await listRoutines(old.db, 'ACTIVE');
  check('v11 → v12: rutin korunur, simge ve renk boş', upgraded.length === 1 && upgraded[0].title === 'Eski' && upgraded[0].icon === null && upgraded[0].color === null);
  await migrateDbIfNeeded(old.db);
  check('yükseltme tekrar çalışırsa hata vermez', (old.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 12);

  console.log('Paket ekleme');
  const first = await addRoutinePack(db, 'sabah');
  const listed = await listRoutines(db, 'ACTIVE');
  check('sabah paketi 5 rutin ekler', first.added === 5 && first.skipped === 0 && listed.length === 5);
  check('paket saatleri uygulanır (06:35 yatak)', listed.some((r) => r.templateId === 'yatagi-topla' && r.askHour === 6 && r.askMinute === 35));
  check('şablonun simgesi kaydedilir', listed.find((r) => r.templateId === 'su-ic')?.icon === '💧');
  const again = await addRoutinePack(db, 'sabah');
  check('aynı paket ikinci kez eklenmez', again.added === 0 && again.skipped === 5 && (await listRoutines(db, 'ACTIVE')).length === 5);
  const evening = await addRoutinePack(db, 'aksam');
  check('akşam paketi ortak olmayanları ekler', evening.added === 6 && (await listRoutines(db, 'ACTIVE')).length === 11);
  const care = await addRoutinePack(db, 'kendine-bakim');
  check('ortak rutin (şükran) atlanır', care.skipped === 1 && care.added === 3);
  let threw = false;
  try {
    await addRoutinePack(db, 'yok');
  } catch {
    threw = true;
  }
  check('bilinmeyen paket hata verir', threw);
  const single = await addRoutineFromTemplate(db, 'derin-calisma', { hour: 22, minute: 5 });
  check('tek şablon için saat verilebilir', single.askHour === 22 && single.askMinute === 5);

  console.log('Simge ve renk kaydı');
  const custom = await createRoutine(db, { title: 'Resim çiz', category: 'ZIHIN', estimatedDuration: 30, cognitiveWeight: 'LOW', askHour: 20, icon: '🎨', color: '#F472B6' });
  check('özel rutin simge ve rengiyle kaydedilir', custom.icon === '🎨' && custom.color === '#F472B6');
  await updateRoutine(db, custom.id, { icon: '🎧', color: '#7C9CFF' });
  const reread = (await listRoutines(db, 'ACTIVE')).find((r) => r.id === custom.id);
  check('düzenleme simge ve rengi günceller', reread?.icon === '🎧' && reread?.color === '#7C9CFF');
  await updateRoutine(db, custom.id, { title: 'Resim çiz!' });
  const keep = (await listRoutines(db, 'ACTIVE')).find((r) => r.id === custom.id);
  check('başka alan düzenlenirse simge ve renk korunur', keep?.icon === '🎧' && keep?.color === '#7C9CFF' && keep.title === 'Resim çiz!');

  console.log('Takvim ızgarası');
  check('ay anahtarı ve başlık', monthKeyOf(at(10)) === '2026-11' && monthTitle('2026-11') === 'Kasım 2026' && monthTitle('2027-01') === 'Ocak 2027');
  check('ay kaydırma yıl sınırını aşar', shiftMonth('2026-12', 1) === '2027-01' && shiftMonth('2026-01', -1) === '2025-12' && shiftMonth('2026-11', 0) === '2026-11');
  const grid = monthGrid('2026-11');
  const cells = grid.flat();
  check('Kasım 2026: Pazar günü başlar, 6 boşluk sonra 1 Kasım', grid[0].slice(0, 6).every((c) => c === null) && grid[0][6] === day(1));
  check('30 gün, haftalar 7\'lik, 6 hafta', cells.filter(Boolean).length === 30 && grid.every((w) => w.length === 7) && grid.length === 6);
  check('Şubat 2028 (artık yıl) 29 gün', monthGrid('2028-02').flat().filter(Boolean).length === 29);
  check('Şubat 2026: 28 gün, Pazar başlar', monthGrid('2026-02').flat().filter(Boolean).length === 28 && monthGrid('2026-02')[0][6] === '2026-02-01');
  check('Aralık: son gün 31', monthGrid('2026-12').flat().filter(Boolean).pop() === '2026-12-31');

  console.log('Seri ve yoğunluk');
  check('yoğunluk', intensity(0, 5) === 0 && intensity(1, 5) === 1 && intensity(2, 5) === 2 && intensity(4, 5) === 3 && intensity(5, 5) === 4 && intensity(9, 5) === 4 && intensity(1, 0) === 0);
  check('en uzun seri', bestStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-07', '2026-11-08']) === 3 && bestStreak([]) === 0 && bestStreak(['2026-11-05']) === 1);
  check('en uzun seri ay sınırını aşar', bestStreak(['2026-10-30', '2026-10-31', '2026-11-01']) === 3);
  check('tekrarlı günler bir sayılır', bestStreak(['2026-11-01', '2026-11-01', '2026-11-02']) === 2);
  const days = new Set([day(14), day(15), day(16)]);
  check('güncel seri: bugün dahil', currentStreak(days, at(10, 0, 16)) === 3);
  check('güncel seri: bugün yapılmadıysa dünden sayılır', currentStreak(new Set([day(14), day(15)]), at(10, 0, 16)) === 2);
  check('güncel seri: dün de yoksa 0', currentStreak(new Set([day(13)]), at(10, 0, 16)) === 0);
  check('güncel seri ay sınırını aşar', currentStreak(new Set(['2026-10-31', day(1)]), at(10, 0, 1)) === 2);

  console.log('Ay verisi');
  const rs = [routine({ id: 'a' }), routine({ id: 'b', title: 'Su' })];
  const logs = [done('a', 2), done('b', 2), done('a', 3), done('a', 16), done('x', 4), { ...done('a', 5), outcome: 'SKIPPED' as const }];
  const m = buildMonth('2026-11', rs, logs, [mood(2, 4)], at(12, 0, 16));
  const flat = m.weeks.flat().filter(Boolean) as NonNullable<(typeof m.weeks)[number][number]>[];
  const c2 = flat.find((c) => c.day === day(2))!;
  check('2 Kasım: iki rutin yapıldı, seviye 4', c2.done === 2 && c2.total === 2 && c2.level === 4 && c2.mood === 4);
  check('3 Kasım: bir rutin, seviye 2', flat.find((c) => c.day === day(3))!.level === 2);
  check('bilinmeyen rutin ve atlanan gün sayılmaz', flat.find((c) => c.day === day(4))!.done === 0 && flat.find((c) => c.day === day(5))!.done === 0);
  check('bugün işaretli, gelecek gün işaretli', flat.find((c) => c.day === day(16))!.isToday && flat.find((c) => c.day === day(20))!.isFuture && !flat.find((c) => c.day === day(10))!.isFuture);
  check('yapılan gün sayısı 3 (2, 3, 16), geçen gün 16', m.doneDays === 3 && m.activeDays === 16);
  const only = buildMonth('2026-11', rs, logs, [], at(12, 0, 16), 'b');
  const fb = only.weeks.flat().filter(Boolean) as NonNullable<(typeof m.weeks)[number][number]>[];
  check('tek rutin süzgeci: yalnız b, toplam 1', fb.find((c) => c.day === day(2))!.done === 1 && fb.find((c) => c.day === day(3))!.done === 0 && fb[0].total === 1 && only.doneDays === 1);
  const activeLogs = logs.filter((l) => rs.some((r) => r.id === l.routineId));
  const sum = summarize('2026-11', activeLogs, at(12, 0, 16));
  check('özet (etkin rutinler): 3 gün, 4 yapıldı kaydı', sum.doneDays === 3 && sum.totalDone === 4);
  check('özet: seri 1 (yalnız 16), en uzun 2 (2-3), geçen gün 16', sum.currentStreak === 1 && sum.bestStreak === 2 && sum.activeDays === 16);
  check('özet ile ızgara aynı gün sayısını verir', sum.doneDays === m.doneDays);
  const future = summarize('2026-12', activeLogs, at(12, 0, 16));
  check('gelecek ayda geçen gün 0', future.activeDays === 0 && future.doneDays === 0);
  const past = summarize('2026-10', activeLogs, at(12, 0, 16));
  check('geçmiş ayda tüm günler sayılır', past.activeDays === 31);
  const dd = dayDetail(day(2), rs, logs);
  check('gün ayrıntısı: yapılan ve yapılmayan', dd.done.length === 2 && dd.notDone.length === 0 && dayDetail(day(3), rs, logs).notDone[0].id === 'b');
  check('doneByDay yalnız DONE sayar', doneByDay(logs).get(day(5)) === undefined && doneByDay(logs, 'b').get(day(2))?.size === 1);

  console.log('Ruh hali mantığı');
  check('beş ruh hali, 1..5 sıralı', MOODS.length === 5 && MOODS.every((x, i) => x.value === i + 1));
  check('ortalama', moodAverage([mood(1, 2), mood(2, 4)]) === 3 && moodAverage([]) === null);
  const series = moodSeries([mood(15, 3), mood(16, 5)], at(9, 0, 16), 7);
  check('7 günlük seri eskiden yeniye, boşlar null', series.length === 7 && series[6].day === day(16) && series[6].mood === 5 && series[5].mood === 3 && series[0].mood === null);
  check('dağılım: yalnız olanlar', moodCounts([mood(1, 5), mood(2, 5), mood(3, 2)]).map((x) => `${x.info.value}:${x.count}`).join() === '2:1,5:2');
  check('düşük gün serisi: bugün dahil 3', lowRun([mood(14, 2), mood(15, 1), mood(16, 2)], at(9, 0, 16)) === 3);
  check('düşük gün serisi: bugün kayıtsızsa dünden', lowRun([mood(14, 1), mood(15, 2)], at(9, 0, 16)) === 2);
  check('düşük gün serisi: orta gün keser', lowRun([mood(14, 1), mood(15, 3), mood(16, 2)], at(9, 0, 16)) === 1);
  check('hiç kayıt yoksa 0', lowRun([], at(9, 0, 16)) === 0);
  const r5 = moodReply(5, [], at(9));
  const r3 = moodReply(3, [], at(9));
  const r2 = moodReply(2, [], at(9));
  const r1 = moodReply(1, [], at(9));
  check('cevaplar: 1-2 yükü hafifletmeyi önerir, 3-5 önermez', r1.suggestHardDay && r2.suggestHardDay && !r3.suggestHardDay && !r5.suggestHardDay && !moodReply(4, [], at(9)).suggestHardDay);
  const streakReply = moodReply(2, [mood(14, 2), mood(15, 1), mood(16, 2)], at(9, 0, 16));
  check('3 gün düşük: nazik, konuşmayı önerir', streakReply.suggestHardDay && /paylaş|konuş/i.test(streakReply.text) && /3/.test(streakReply.text));
  check('hiçbir cevap yargılamaz ya da suçlamaz', [r1, r2, r3, r5, streakReply, moodReply(4, [], at(9))].every((r) => !hasBannedWords(r.text) && !/boşa|tembel|başarısız|yetersiz/i.test(r.text)));
  const link = moodVsRoutines([mood(1, 5), mood(2, 4), mood(3, 5), mood(4, 4), mood(5, 2), mood(6, 3), mood(7, 2), mood(8, 3)], new Set([day(1), day(2), day(3), day(4)]));
  check('bağlantı: yapılan günler 4,5 ortalama; diğerleri 2,5', link !== null && link.withDone === 4.5 && link.withoutDone === 2.5 && link.nWith === 4 && link.nWithout === 4);
  check('içgörü: fark ≥ 0,5 ve ≥ 4 + 4 gün', /4,5/.test(moodInsight(link) ?? '') && /2,5/.test(moodInsight(link) ?? ''));
  check('içgörü suçlamaz', !/boşa|kötü|tembel/i.test(moodInsight(link) ?? ''));
  check('az veri: içgörü yok', moodInsight(moodVsRoutines([mood(1, 5), mood(2, 2)], new Set([day(1)]))) === null);
  check('tersi (yapılmayan günler daha iyi): içgörü yok', moodInsight({ withDone: 2, withoutDone: 4, nWith: 6, nWithout: 6 }) === null);
  check('küçük fark: içgörü yok', moodInsight({ withDone: 3.2, withoutDone: 3, nWith: 6, nWithout: 6 }) === null);
  check('grup boşsa bağlantı yok', moodVsRoutines([mood(1, 3)], new Set([day(1)])) === null && moodVsRoutines([], new Set()) === null);

  console.log('Ruh hali kaydı (veritabanı)');
  await setMoodLog(db, day(16), 4, at(9, 0));
  check('kaydedilir', (await getMoodLog(db, day(16)))?.mood === 4);
  await setMoodLog(db, day(16), 2, at(10, 0), 'Yorucu bir gün');
  const upd = await getMoodLog(db, day(16));
  check('aynı gün güncellenir, not yazılır, tek satır', upd?.mood === 2 && upd.note === 'Yorucu bir gün' && (raw.prepare("SELECT COUNT(*) AS n FROM MoodLog WHERE day = '2026-11-16'").get() as { n: number }).n === 1);
  await setMoodLog(db, day(16), 3, at(11, 0));
  check('not verilmezse eski not korunur', (await getMoodLog(db, day(16)))?.note === 'Yorucu bir gün');
  await setMoodLog(db, day(16), 3, at(11, 5), '   ');
  check('boş not notu siler', (await getMoodLog(db, day(16)))?.note === null);
  await setMoodLog(db, day(16), 3, at(11, 6), 'x'.repeat(500));
  check('not 280 karakterle sınırlanır', ((await getMoodLog(db, day(16)))?.note ?? '').length === 280);
  let bad = 0;
  for (const v of [0, 6, 2.5]) {
    try {
      await setMoodLog(db, day(16), v as 1, at(9));
    } catch {
      bad += 1;
    }
  }
  check('geçersiz değerler reddedilir', bad === 3);
  const lr = await logMood(db, at(9, 30, 17), 1);
  check('logMood: kaydeder ve cevap döner', lr.log.day === day(17) && lr.log.mood === 1 && lr.reply.suggestHardDay);
  const n1 = await saveMoodNote(db, at(9, 40, 17), 'Uykusuz geçti');
  check('saveMoodNote: bugünün notunu yazar', n1?.note === 'Uykusuz geçti' && (await todayMood(db, at(9, 40, 17)))?.note === 'Uykusuz geçti');
  check('kayıt yoksa saveMoodNote null', (await saveMoodNote(db, at(9, 0, 25), 'x')) === null);
  await setMoodForDay(db, day(10), 5, at(9, 0, 17));
  check('geçmiş gün düzeltilebilir', (await getMoodLog(db, day(10)))?.mood === 5);
  let futureErr = false;
  try {
    await setMoodForDay(db, day(25), 3, at(9, 0, 17));
  } catch {
    futureErr = true;
  }
  check('gelecek gün yazılamaz', futureErr);
  check('listeleme tarihe göre', (await listMoodLogsSince(db, day(10))).map((x) => x.day).join() === `${day(10)},${day(16)},${day(17)}`);

  console.log('Takvim ekranı verisi');
  const sabah = (await listRoutines(db, 'ACTIVE')).find((r) => r.templateId === 'su-ic')!;
  for (const d of [9, 10, 11, 12, 14, 15, 16]) await addRoutineLog(db, { routineId: sabah.id, day: day(d), outcome: 'DONE', loggedAt: at(7, 0, d) });
  const screen = await loadHabitScreen(db, '2026-11', at(12, 0, 17));
  check('ekran verisi: rutinler ve ay', screen.routines.length > 10 && screen.weeks.length === 6);
  check('ekran verisi: seri 1 gün değil, 16. dün olduğu için 3 (14-16)', screen.summary.currentStreak === 3 && screen.summary.bestStreak === 4);
  check('ekran verisi: bugünün ruh hali', screen.today?.mood === 1 && screen.week.length === 7);
  const per = await loadHabitScreen(db, '2026-11', at(12, 0, 17), sabah.id);
  check('tek rutin görünümü', per.summary.doneDays === 7);
  check('ekran verisi: ay ortalaması', screen.moodAvg !== null && screen.monthMoods.length === 3);

  console.log('Gün sonu değerlendirmesine ruh hali');
  await setMoodLog(db, day(18), 2, at(20, 0, 18), 'Çok özel bir not: gizli-metin-123');
  const prompt = await buildManualReviewPrompt(db, at(21, 30, 18));
  check('kopyalanan özette ruh hali var', /Ruh hali .*Düşük \(2\/5\)/.test(prompt));
  check('not özete asla girmez', !prompt.includes('gizli-metin-123'));
  const baseFacts = {
    day: day(18), tasksDone: [{ title: 'A', minutes: 10 }], tasksOpen: 0, driftMinutes: 0, routinesDone: [], routinesSkipped: [], routinesOpen: [],
    energy: { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 }, steps: null, stepsReliable: false, screenMinutes: null, sleepMinutes: null, sleepBed: null, sleepWake: null,
    peakStartHour: 9, peakEndHour: 12,
  } as DayFacts;
  const low = buildRulesReview({ ...baseFacts, mood: { value: 2, label: 'Düşük' } }, [], []).reflection;
  const high = buildRulesReview({ ...baseFacts, mood: { value: 5, label: 'Harika' } }, [], []).reflection;
  const none = buildRulesReview(baseFacts, [], []).reflection;
  check('düşük gün: nazik cümle', /nazik/.test(low) && !hasBannedWords(low));
  check('iyi gün: olumlu cümle', /iyi işaretlemişsin/.test(high) && !hasBannedWords(high));
  check('ruh hali yoksa metin değişmez', !/işaretlemi/.test(none));
  check('özet çipinde ruh hali', factChips({ ...baseFacts, mood: { value: 4, label: 'İyi' } }).some((c) => c.startsWith('ruh hali')) && !factChips(baseFacts).some((c) => c.startsWith('ruh hali')));

  console.log('Yedek');
  const backup = await createBackup(db, {}, at(12, 0, 17));
  const target = makeTestDb();
  await migrateDbIfNeeded(target.db);
  const res = await restoreBackup(target.db, backup);
  check('yedek geri yüklenir', res.ok === true);
  const restoredMood = target.raw.prepare('SELECT COUNT(*) AS n FROM MoodLog').get() as { n: number };
  check('ruh hali kayıtları yedekten gelir', restoredMood.n === 4);
  const restoredRoutine = (await listRoutines(target.db, 'ACTIVE')).find((r) => r.id === custom.id);
  check('rutin simgesi ve rengi yedekten gelir', restoredRoutine?.icon === '🎧' && restoredRoutine?.color === '#7C9CFF');

  console.log('Rutin tarzı testi');
  check('altı soru, hepsinin 2-4 seçeneği var', STYLE_QUIZ.length === 6 && STYLE_QUIZ.every((q) => q.options.length >= 2 && q.options.length <= 4));
  check('puanlar yalnız var olan paketlere gider', STYLE_QUIZ.every((q) => q.options.every((o) => Object.keys(o.points).every((id) => getPack(id)))));
  check('her paketin sonuç metni var', ROUTINE_PACKS.every((p) => STYLE_RESULT[p.id]?.title && STYLE_RESULT[p.id]?.text));
  const morning = scoreQuiz([0, 0, 2, 0, 1, 1]);
  check('sabahçı cevaplar: sabah paketi öne çıkar', morning.packs[0] === 'sabah' && morning.title === STYLE_RESULT.sabah.title);
  const night = scoreQuiz([2, 1, 1, 1, 2, 2]);
  check('akşamcı cevaplar: akşam paketi öne çıkar', night.packs[0] === 'aksam');
  const mover = scoreQuiz([0, 0, 1, 2, 1, 0]);
  check('hareketli cevaplar: hareket paketi öne çıkar', mover.packs[0] === 'hareket');
  const rush = scoreQuiz([1, 3, 0, 1, 0, 2]);
  check('acelesi olan, yolda öğrenen: yolda paketi', rush.packs[0] === 'yolda');
  const gentle = scoreQuiz([2, 2, 2, 0, 1, 1]);
  check('kendine bakım cevapları', gentle.packs.includes('kendine-bakim'));
  check('iki öneri, tekrarsız, geçerli', [morning, night, mover, rush, gentle].every((r) => r.packs.length === 2 && r.packs[0] !== r.packs[1] && r.packs.every((id) => getPack(id))));
  const empty = scoreQuiz([null, null, null, null, null, null]);
  check('cevapsız: eşitlikte paket sırası korunur', empty.packs.join() === 'sabah,yolda');
  check('geçersiz seçenek yok sayılır', scoreQuiz([99, -1, 0, 0, 0, 0]).packs.length === 2);
  check('sonuç metinleri yargılamaz', Object.values(STYLE_RESULT).every((r) => !hasBannedWords(r.title) && !hasBannedWords(r.text)));

  console.log('Günün ipucu');
  check('30 ipucu, hepsi dolu ve benzersiz', SELF_CARE_TIPS.length >= 30 && new Set(SELF_CARE_TIPS).size === SELF_CARE_TIPS.length && SELF_CARE_TIPS.every((t) => t.length > 10));
  check('aynı gün aynı ipucu', tipOfDay('2026-11-16') === tipOfDay('2026-11-16'));
  check('30 gün boyunca hiçbir ipucu tekrarlanmaz', new Set(Array.from({ length: SELF_CARE_TIPS.length }, (_, i) => tipOfDay(day(i + 1)))).size === SELF_CARE_TIPS.length);
  check('bozuk gün anahtarı hata vermez', typeof tipOfDay('bozuk') === 'string');
  check('ipuçları yargılamaz', SELF_CARE_TIPS.every((t) => !hasBannedWords(t) && !/boşa/i.test(t)));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
