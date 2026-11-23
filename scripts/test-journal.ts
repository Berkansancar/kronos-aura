/**
 * Akşam günlüğü ve "seni ne iyi yapıyor" testi: yazı temizleme, gün seçimi, Aura cevabı, seri, ay özeti,
 * karşılaştırma dürüstlüğü, veritabanı, v12 -> v13 yükseltmesi, yedek ve ekran bağlantıları.
 * Çalıştırmak için:  npm run test:journal
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteJournalEntry, getJournalEntry, listJournalSince, saveJournalEntry, setMoodLog } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import type { JournalEntry, MoodLog } from '../database/types';
import { BACKUP_TABLES, createBackup, restoreBackup } from '../services/backupLogic';
import { HOME_TILES } from '../services/homeGrid';
import { FACTOR_LABELS, MIN_DIFF, MIN_GROUP_DAYS, MIN_MOOD_DAYS, moodInsights } from '../services/insightLogic';
import {
  EMPTY_FIELDS,
  JOURNAL_MAX,
  JOURNAL_QUESTIONS,
  auraJournalReply,
  cleanFields,
  cleanText,
  fieldsOf,
  goalForToday,
  isEmptyFields,
  isEvening,
  journalDay,
  journalStreak,
  monthSummary,
  monthSummaryText,
  recentEntries,
} from '../services/journalLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const BAD_WORDS = ['tembel', 'başarısız', 'disiplinsiz', 'yetersiz', 'boşa', 'kaybettin'];
const entry = (day: string, good = '', grateful = '', goal = ''): JournalEntry => ({ day, good, grateful, goal, updatedAt: `${day}T20:00:00.000Z` });
const mood = (day: string, m: number): MoodLog => ({ day, mood: m as MoodLog['mood'], note: null, updatedAt: `${day}T20:00:00.000Z` });
const dk = (i: number): string => `2026-10-${String(i).padStart(2, '0')}`;

async function main(): Promise<void> {
  console.log('Yazı temizleme');
  check('boşluklar toparlanır', cleanText('  bir   iki \n üç  ') === 'bir iki üç');
  check('en çok 280 karakter', cleanText('a'.repeat(500)).length === JOURNAL_MAX);
  check('metin olmayan girdi boş sayılır', cleanText(42) === '' && cleanText(null) === '' && cleanText(undefined) === '');
  check('alanlar temizlenir', cleanFields({ good: ' x ', goal: '' }).good === 'x' && cleanFields({ good: ' x ' }).grateful === '');
  check('boş alan kontrolü', isEmptyFields(EMPTY_FIELDS) && !isEmptyFields({ ...EMPTY_FIELDS, goal: 'yürü' }));
  check('üç soru: iyi, şükür, hedef', JOURNAL_QUESTIONS.map((q) => q.key).join() === 'good,grateful,goal');
  check('sorularda yargılayıcı kelime yok', JOURNAL_QUESTIONS.every((q) => BAD_WORDS.every((w) => !`${q.label} ${q.placeholder}`.toLowerCase().includes(w))));
  check('kayıttan alan çıkarılır', fieldsOf(entry('2026-10-01', 'a', 'b', 'c')).grateful === 'b' && isEmptyFields(fieldsOf(null)));

  console.log('Gün seçimi');
  check('gece 02:00 dünün günlüğüdür', journalDay(new Date(2026, 9, 11, 2, 0)) === '2026-10-10');
  check('04:00 ve sonrası aynı gün', journalDay(new Date(2026, 9, 11, 4, 0)) === '2026-10-11' && journalDay(new Date(2026, 9, 11, 21, 30)) === '2026-10-11');
  check('ay başında gece yazılan önceki aya gider', journalDay(new Date(2026, 10, 1, 1, 0)) === '2026-10-31');
  check('akşam: 20:00 - 04:00', isEvening(new Date(2026, 9, 11, 20, 0)) && isEvening(new Date(2026, 9, 11, 3, 59)) && !isEvening(new Date(2026, 9, 11, 14, 0)));

  console.log('Yarının hedefi');
  const goals = [entry('2026-10-10', 'x', '', 'Sabah yürüyüşü'), entry('2026-10-09', '', '', 'Eski hedef')];
  check('dün yazılan hedef bugünün hedefidir', goalForToday(goals, '2026-10-11') === 'Sabah yürüyüşü');
  check('dün hedef yoksa boş', goalForToday(goals, '2026-10-13') === null);
  check('hedefi boş kayıt hedef sayılmaz', goalForToday([entry('2026-10-10', 'x')], '2026-10-11') === null);

  console.log('Aura cevabı');
  const full = { good: 'Yürüdüm', grateful: 'Çay', goal: 'Erken kalk' };
  const replies = [
    auraJournalReply(full, 1, 0),
    auraJournalReply(full, 5, 5),
    auraJournalReply(full, 3, 2),
    auraJournalReply({ ...full, goal: '' }, null, 0),
    auraJournalReply(EMPTY_FIELDS, 2, 0),
    auraJournalReply({ ...EMPTY_FIELDS, good: 'x' }, 4, 9),
  ];
  const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  check('en çok üç cümle', replies.every((r) => sentences(r) <= 3), replies.join(' | '));
  check('yargılayıcı kelime yok', replies.every((r) => BAD_WORDS.every((w) => !r.toLowerCase().includes(w))));
  check('zor günde yumuşak dil', replies[0].includes('Zor bir gün') && !replies[0].includes('!'));
  check('hedef yazıldıysa yarının hedefi anılır', replies[0].includes('Erken kalk'));
  check('hedef yoksa "olur" der, eksik saymaz', replies[3].includes('bu da olur'));
  check('boş yazıda da sorun yok der', replies[4].includes('sorun değil'));
  check('3 gün ve üstü seri anılır, altında anılmaz', replies[1].includes('5 gündür') && !replies[2].includes('gündür'));

  console.log('Seri');
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-10'].map((d) => entry(d, 'x'));
  check('arada gün atlayınca seri 1 gün boşlukla bölünür', journalStreak(week, '2026-10-10').spanDays === 2);
  check('bugün yazılmadıysa dünkü seri sürer', journalStreak(week, '2026-10-11').alive && !journalStreak(week, '2026-10-12').alive);
  check('boş kayıt seriye girmez', journalStreak([entry('2026-10-10')], '2026-10-10').activeDays === 0);

  console.log('Ay özeti');
  const entries = [entry('2026-10-01', 'Koştum', '', 'Su iç'), entry('2026-10-02', 'Kitap'), entry('2026-10-03'), entry('2026-09-30', 'Eski', '', 'x')];
  const moods = [mood('2026-10-01', 5), mood('2026-10-02', 4), mood('2026-10-03', 2), mood('2026-10-04', 1), mood('2026-09-30', 3)];
  const ms = monthSummary(entries, moods, '2026-10');
  check('yazılan gün, hedefli gün sayılır (boş kayıt atlanır)', ms.writtenDays === 2 && ms.goalDays === 1);
  check('ruh hali ortalaması yalnızca o ay', ms.moodDays === 4 && ms.moodAvg === 3);
  check('güzel günler: yüksek ruh halli ve yazısı olan', ms.bestDays.length === 2 && ms.bestDays[0].day === '2026-10-01' && ms.bestDays[0].good === 'Koştum');
  check('özet cümlesi sayıları olduğu gibi söyler', monthSummaryText(ms).startsWith('Bu ay 2 gün yazdın') && monthSummaryText(ms).includes('ortalaman 3'));
  check('boş ay: yargısız cümle', monthSummaryText(monthSummary([], [], '2026-10')) === 'Bu ay henüz günlük yazısı yok.');
  check('liste: yeni önce, boşlar atlanır, sınır', recentEntries(entries, 2).map((e) => e.day).join() === '2026-10-02,2026-10-01' && recentEntries(entries, 0).length === 0);

  console.log('Seni ne iyi yapıyor? (dürüstlük kuralları)');
  const days = Array.from({ length: 20 }, (_, i) => dk(i + 1));
  const exerciseDays = days.filter((_, i) => i % 2 === 0);
  const highOnExercise = days.map((d, i) => ({ day: d, mood: i % 2 === 0 ? 4 : 2 }));
  const r1 = moodInsights({ moods: highOnExercise, exerciseDays, waterGoalDays: [], studyDays: [] });
  const ex = r1.items.find((i) => i.factor === 'exercise');
  check('yeterli kayıtta karşılaştırma gelir', r1.enough && !!ex && ex.withDays === 10 && ex.withoutDays === 10);
  check('ortalamalar doğru, fark 2,0', ex?.withAvg === 4 && ex?.withoutAvg === 2 && ex?.diff === 2 && ex?.verdict === 'higher');
  check('"birlikte görünüyor" der, sebep iddia etmez', !!ex && ex.text.includes('birlikte görünüyor') && ex.text.includes('sebep olduğu anlamına gelmez'));
  check('grup çok küçükse (su, çalışma) o etken gösterilmez', r1.items.length === 1);
  check('etiketler ve yargısız metin', Object.values(FACTOR_LABELS).length === 3 && r1.items.every((i) => BAD_WORDS.every((w) => !i.text.toLowerCase().includes(w))));

  const r2 = moodInsights({ moods: highOnExercise.slice(0, MIN_MOOD_DAYS - 1), exerciseDays, waterGoalDays: [], studyDays: [] });
  check('14 günden az ruh hali kaydında sonuç yok, ne kadar gerektiği söylenir', !r2.enough && r2.items.length === 0 && (r2.needText ?? '').includes('1 gün daha'));
  const same = days.map((d) => ({ day: d, mood: 3 }));
  const r3 = moodInsights({ moods: same, exerciseDays, waterGoalDays: [], studyDays: [] });
  check('fark yoksa "belirgin fark görünmüyor"', r3.items[0]?.verdict === 'none' && r3.items[0].text.includes('belirgin fark görünmüyor'));
  const smallDiff = days.map((d, i) => ({ day: d, mood: i % 2 === 0 ? 3.2 : 3 }));
  check('eşiğin altındaki fark (0,2) fark sayılmaz', moodInsights({ moods: smallDiff, exerciseDays, waterGoalDays: [], studyDays: [] }).items[0].diff === 0.2 && moodInsights({ moods: smallDiff, exerciseDays, waterGoalDays: [], studyDays: [] }).items[0].verdict === 'none' && MIN_DIFF === 0.3);
  const lowOnExercise = days.map((d, i) => ({ day: d, mood: i % 2 === 0 ? 2 : 4 }));
  const r4 = moodInsights({ moods: lowOnExercise, exerciseDays, waterGoalDays: [], studyDays: [] });
  check('ters fark da yargısız söylenir', r4.items[0].verdict === 'lower' && r4.items[0].text.includes('Yorgun günlerde de yapılmış olabilir'));
  const r5 = moodInsights({ moods: days.map((d) => ({ day: d, mood: 9 })), exerciseDays, waterGoalDays: [], studyDays: [] });
  check('bozuk ruh hali değerleri atlanır', !r5.enough && r5.moodDays === 0);
  check('eşikler: en az 14 gün, grupta en az 4 gün', MIN_MOOD_DAYS === 14 && MIN_GROUP_DAYS === 4);
  const r6 = moodInsights({ moods: highOnExercise, exerciseDays: [dk(1), dk(2), dk(3)], waterGoalDays: [], studyDays: [] });
  check('hiçbir grup yeterli değilse açıklayıcı cümle verir', r6.enough && r6.items.length === 0 && (r6.needText ?? '').includes('en az 4 gün'));

  console.log('Veritabanı');
  const t = makeTestDb();
  await migrateDbIfNeeded(t.db);
  const at = new Date(2026, 9, 11, 21, 0);
  await saveJournalEntry(t.db, '2026-10-11', { good: 'a', grateful: 'b', goal: 'c' }, at);
  await saveJournalEntry(t.db, '2026-10-11', { good: 'a2', grateful: '', goal: 'c' }, at);
  const got = await getJournalEntry(t.db, '2026-10-11');
  check('aynı gün tekrar yazılırsa güncellenir (tek satır)', got?.good === 'a2' && got.grateful === '' && (await listJournalSince(t.db, '2026-10-01')).length === 1);
  await saveJournalEntry(t.db, '2026-10-05', { good: 'x', grateful: '', goal: '' }, at);
  check('listeleme tarihe göre ve başlangıçtan itibaren', (await listJournalSince(t.db, '2026-10-06')).length === 1 && (await listJournalSince(t.db, '2026-10-01')).map((e) => e.day).join() === '2026-10-05,2026-10-11');
  await deleteJournalEntry(t.db, '2026-10-05');
  check('silinen kayıt gelmez', (await getJournalEntry(t.db, '2026-10-05')) === null);
  await setMoodLog(t.db, '2026-10-11', 4, at);

  console.log('Veritabanı: v12 -> v13 yükseltme');
  const u = makeTestDb();
  await migrateDbIfNeeded(u.db);
  u.raw.exec('DROP TABLE WeightLog; DROP TABLE Journal; PRAGMA user_version = 12;');
  u.raw.prepare("INSERT INTO MoodLog (day, mood, note, updatedAt) VALUES ('2026-10-01', 3, NULL, '2026-10-01T10:00:00.000Z')").run();
  await migrateDbIfNeeded(u.db);
  const tables = (u.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('WeightLog','Journal')").all() as { name: string }[]).map((x) => x.name).sort().join();
  check('iki yeni tablo oluşur', tables === 'Journal,WeightLog');
  check('sürüm 13 ve eski veri yerinde', DATABASE_VERSION === 13 && (u.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 13 && (u.raw.prepare('SELECT COUNT(*) AS n FROM MoodLog').get() as { n: number }).n === 1);
  check('kilo aralık kuralı: 30 altı reddedilir', (() => { try { u.raw.prepare("INSERT INTO WeightLog (day, kg, updatedAt) VALUES ('2026-10-01', 12, 'x')").run(); return false; } catch { return true; } })());
  await migrateDbIfNeeded(u.db);
  check('tekrar çalışınca bozulmaz', true);

  console.log('Yedek');
  check('yeni tablolar yedek listesinde', BACKUP_TABLES.includes('Journal') && BACKUP_TABLES.includes('WeightLog'));
  const text = await createBackup(t.db, {}, at);
  const b = makeTestDb();
  await migrateDbIfNeeded(b.db);
  const res = await restoreBackup(b.db, text);
  check('geri yüklenir', res.ok === true);
  const back = await getJournalEntry(b.db, '2026-10-11');
  check('günlük yazısı yedekten geri gelir', back?.good === 'a2' && back.goal === 'c');

  console.log('Ekran ve bağlantılar');
  check('ekran dosyası ve rota kaydı', existsSync(join(root, 'app/journal.tsx')) && readFileSync(join(root, 'app/_layout.tsx'), 'utf8').includes('name="journal"'));
  check('ana ekranda günlük kutusu', HOME_TILES.some((x) => x.id === 'gunluk' && x.route === '/journal'));
  const screen = readFileSync(join(root, 'app/journal.tsx'), 'utf8');
  check('ekran yapay zekâya göndermez', !screen.includes('askCoach') && !screen.includes('fetch(') && !screen.toLowerCase().includes('openai'));
  const svc = readFileSync(join(root, 'services/journal.ts'), 'utf8');
  check('veri toplama yapay zekâ servisine bağlı değil', !svc.includes("from './ai") && !svc.includes('/ai'));
  const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);
  check('metinlerde yeni emoji yok', !tooNew(screen) && !tooNew(svc));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
