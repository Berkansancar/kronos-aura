/**
 * Kelime defteri testi (ekleme, tekrar kutuları, seans, yedek).
 * Çalıştırmak için:  npm run test:vocab
 */
import { listStudyLogsSince } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { BACKUP_TABLES, createBackup, restoreBackup } from '../services/backupLogic';
import { addVocab, answerVocab, editVocab, loadVocab, logVocabSession, removeVocab } from '../services/vocab';
import {
  BOX_DAYS,
  answerCard,
  boxDots,
  dueCards,
  isDuplicate,
  sessionAnswer,
  sessionCurrent,
  sessionDone,
  sessionMinutes,
  startSession,
  validateCard,
  vocabStats,
} from '../services/vocabLogic';
import type { VocabCard } from '../database/types';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const at = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

function card(over: Partial<VocabCard>): VocabCard {
  return { id: 'x', word: 'w', meaning: 'm', note: null, box: 0, dueDay: day(16), lastDay: null, seen: 0, known: 0, createdAt: at(16).toISOString(), ...over };
}

async function main(): Promise<void> {
  console.log('Doğrulama ve kopya');
  check('boş kelime reddedilir', validateCard('  ', 'anlam') !== null);
  check('boş anlam reddedilir', validateCard('kelime', ' ') !== null);
  check('çok uzun kelime reddedilir', validateCard('a'.repeat(61), 'x') !== null);
  check('geçerli kart', validateCard('Hello', 'Merhaba', 'selamlaşma') === null);
  check('kopya: büyük/küçük harf fark etmez', isDuplicate([card({ word: 'Hello' })], '  hello '));
  check('kopya: Türkçe İ/ı doğru karşılaşır', isDuplicate([card({ word: 'ISIK' })], 'ısık') && !isDuplicate([card({ word: 'ISIK' })], 'isik'));
  check('kopya: kendi kaydı hariç tutulur', !isDuplicate([card({ id: 'a', word: 'Hello' })], 'hello', 'a'));

  console.log('Kutular ve tekrar günleri');
  const a1 = answerCard({ box: 0, seen: 0, known: 0 }, true, day(16));
  check('bilinen kart bir kutu çıkar, yarın tekrar', a1.box === 1 && a1.dueDay === day(17) && a1.seen === 1 && a1.known === 1);
  const a2 = answerCard({ box: 1, seen: 1, known: 1 }, true, day(17));
  check('kutu 2: 3 gün sonra', a2.box === 2 && a2.dueDay === day(20));
  const a3 = answerCard({ box: 3, seen: 5, known: 4 }, false, day(16));
  check('bilinmeyen kart iki kutu geri düşer (sıfırlanmaz)', a3.box === 1 && a3.known === 4 && a3.seen === 6);
  const a4 = answerCard({ box: 0, seen: 0, known: 0 }, false, day(16));
  check('kutu 0\'da bilinmeyince 0 kalır, aynı gün tekrar uygun', a4.box === 0 && a4.dueDay === day(16));
  const a5 = answerCard({ box: 5, seen: 9, known: 9 }, true, day(16));
  check('en üst kutuda 5 kalır', a5.box === 5 && a5.dueDay === '2026-12-21');
  check('kutu günleri artan', BOX_DAYS.every((d, i) => i === 0 || d > BOX_DAYS[i - 1]));
  const ay = answerCard({ box: 4, seen: 1, known: 1 }, true, day(28));
  check('ay sonu: 35 gün sonrası doğru tarih', ay.dueDay === '2027-01-02');
  check('kutu göstergesi', boxDots(0) === '○○○○○' && boxDots(3) === '●●●○○' && boxDots(9) === '●●●●●');

  console.log('Bugünkü kartlar');
  const cards = [
    card({ id: 'b3', box: 3, dueDay: day(10) }),
    card({ id: 'b0', box: 0, dueDay: day(16) }),
    card({ id: 'fut', box: 2, dueDay: day(17) }),
    card({ id: 'b1old', box: 1, dueDay: day(12) }),
    card({ id: 'b1new', box: 1, dueDay: day(15) }),
  ];
  check('yalnızca vadesi gelenler, zayıf kutu önce, sonra eski gün', dueCards(cards, day(16)).map((c) => c.id).join() === 'b0,b1old,b1new,b3');
  check('sınır uygulanır', dueCards(cards, day(16), 2).length === 2);
  check('istatistik', JSON.stringify(vocabStats(cards.concat(card({ id: 'l', box: 5, dueDay: day(30) })), day(16))) === JSON.stringify({ total: 6, due: 4, learned: 1, inProgress: 5, addedToday: 6 }));

  console.log('Seans');
  let s = startSession(cards, day(16));
  check('seans 4 kartla başlar', s.queue.length === 4 && sessionCurrent(s) === 'b0' && !sessionDone(s));
  s = sessionAnswer(s, false);
  check('bilinmeyen kart sona bir kez eklenir', s.queue.length === 5 && s.queue[4] === 'b0' && s.againCount === 1);
  s = sessionAnswer(s, true);
  s = sessionAnswer(s, true);
  s = sessionAnswer(s, true);
  check('sıra ilerler: son kart yine b0', sessionCurrent(s) === 'b0' && s.knownCount === 3);
  s = sessionAnswer(s, false);
  check('ikinci kez bilinmezse tekrar eklenmez, seans biter', s.queue.length === 5 && sessionDone(s) && s.againCount === 2);
  check('bitmiş seansta cevap bir şey değiştirmez', sessionAnswer(s, true) === s);
  check('süre en az 1, en çok 30 dk', sessionMinutes(0, 5_000) === 1 && sessionMinutes(0, 12 * 60_000) === 12 && sessionMinutes(0, 90 * 60_000) === 30);

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const r1 = await addVocab(db, '  Journey ', ' yolculuk ', ' ilk kelime ', at(16, 9));
  check('kelime eklenir, boşluklar temizlenir', r1.ok && r1.card.word === 'Journey' && r1.card.meaning === 'yolculuk' && r1.card.note === 'ilk kelime' && r1.card.dueDay === day(16));
  const dup = await addVocab(db, 'journey', 'başka', null, at(16, 9));
  check('aynı kelime ikinci kez eklenmez', !dup.ok && dup.error.includes('zaten'));
  const bad = await addVocab(db, '', 'x', null, at(16, 9));
  check('boş kelime eklenmez', !bad.ok);
  await addVocab(db, 'Bus', 'otobüs', null, at(16, 9));
  await addVocab(db, 'Road', 'yol', '   ', at(16, 9));
  let data = await loadVocab(db, at(16, 10));
  check('üç kelime, hepsi bugün vadeli', data.stats.total === 3 && data.stats.due === 3 && data.stats.addedToday === 3);
  check('boş not null olarak saklanır', data.cards.find((c) => c.word === 'Road')?.note === null);
  const j = data.cards.find((c) => c.word === 'Journey')!;
  const upd = await answerVocab(db, j.id, true, at(16, 10));
  check('doğru cevap kaydedilir', upd?.box === 1 && upd.dueDay === day(17));
  data = await loadVocab(db, at(16, 10));
  check('cevaplanan kart bugün vadeli değil', data.stats.due === 2);
  data = await loadVocab(db, at(17, 10));
  check('ertesi gün yeniden vadeli', data.stats.due === 3);
  data = await loadVocab(db, at(17, 2, 30));
  check('gece 04:00\'ten önce hâlâ önceki gün sayılır', data.today === day(16) && data.stats.due === 2);
  const ed = await editVocab(db, j.id, 'Journeys', 'yolculuklar', null);
  check('düzenleme çalışır, ilerleme korunur', ed.ok && ed.card.word === 'Journeys' && ed.card.box === 1);
  const edDup = await editVocab(db, j.id, 'bus', 'x', null);
  check('düzenlerken başka kelimeyle çakışma reddedilir', !edDup.ok);
  check('bilinmeyen id: cevap null', (await answerVocab(db, 'yok', true, at(16))) === null);

  console.log('Seans süresi kaydı');
  check('hiç kart çalışılmadıysa kayıt yok', (await logVocabSession(db, 0, 0, 600_000, at(16, 12))) === 0);
  const min = await logVocabSession(db, 5, 0, 7 * 60_000, at(16, 12));
  const study = await listStudyLogsSince(db, day(16));
  check('çalışma süresi dil kaydına yazılır', min === 7 && study.some((l) => l.minutes === 7 && l.kind === 'OTHER'));

  console.log('Yedek');
  check('Vocab yedek tablolarında', (BACKUP_TABLES as readonly string[]).includes('Vocab'));
  const backup = await createBackup(db, {}, at(16, 13));
  const { db: db2 } = makeTestDb();
  await migrateDbIfNeeded(db2);
  await restoreBackup(db2, backup);
  const restored = await loadVocab(db2, at(16, 13));
  check('yedekten kelimeler ve ilerleme geri gelir', restored.stats.total === 3 && restored.cards.some((c) => c.word === 'Journeys' && c.box === 1));
  await removeVocab(db, j.id);
  check('silme çalışır', (await loadVocab(db, at(16, 13))).stats.total === 2);

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
