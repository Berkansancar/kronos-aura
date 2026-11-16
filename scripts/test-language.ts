/**
 * Dil öğrenme testi (otomatik uygulama süresi, kalem-kağıt, hedef, geçmiş, gün sonu analizi, yolda önerisi).
 * Çalıştırmak için:  npm run test:language
 */
import { upsertDailyStat } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { commuteSuggestions } from '../services/commuteLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { gatherHistory } from '../services/history';
import { buildSeries } from '../services/historyLogic';
import { addStudy, languageForDay, languageForDays, loadLanguageDay, removeStudy, saveLanguageSettings, getLanguageSettings } from '../services/language';
import {
  DEFAULT_LANGUAGE,
  autoAppMinutes,
  goalRatio,
  languageDay,
  languageLine,
  languageWeek,
  matchesApp,
  parseAppNames,
  parseLanguage,
  serializeLanguage,
} from '../services/languageLogic';
import { analyzeTimeUse, screenAlternatives, timeUsePromptLines, type TimeUseInput } from '../services/timeUseLogic';
import { todayLine } from '../services/todayLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

async function main(): Promise<void> {
  console.log('Ayarlar');
  check('varsayılan: 20 dk hedef, Duolingo', DEFAULT_LANGUAGE.goalMin === 20 && DEFAULT_LANGUAGE.apps[0] === 'Duolingo');
  check('bozuk ayar varsayılana döner', JSON.stringify(parseLanguage('{bozuk')) === JSON.stringify(DEFAULT_LANGUAGE) && parseLanguage(null).goalMin === 20);
  check('hedef kapatılabilir (null), saçma hedef varsayılana döner', parseLanguage(serializeLanguage({ goalMin: null, apps: ['Babbel'] })).goalMin === null && parseLanguage('{"goalMin":9999,"apps":["X"]}').goalMin === 20);
  check('uygulama adları: kırpılır, tekrarsız, en çok 8', JSON.stringify(parseAppNames(' Duolingo , duolingo; Dilim  Dilim\n\n')) === JSON.stringify(['Duolingo', 'Dilim Dilim']) && parseAppNames('a,b,c,d,e,f,g,h,i,j').length === 8);
  check('boş adlar listesi varsayılan uygulamaya döner', parseLanguage('{"goalMin":15,"apps":[]}').apps[0] === 'Duolingo');

  console.log('Otomatik uygulama süresi');
  const top = [
    { label: 'Chrome', minutes: 40 },
    { label: 'Duolingo', minutes: 18 },
    { label: 'Dilim Dilim', minutes: 7 },
  ];
  check('Duolingo süresi okunur', autoAppMinutes(top, ['Duolingo']) === 18);
  check('birden çok uygulama toplanır', autoAppMinutes(top, ['Duolingo', 'dilim dilim']) === 25);
  check('listede yoksa 0; ekran okunamadıysa null', autoAppMinutes([{ label: 'Chrome', minutes: 40 }], ['Duolingo']) === 0 && autoAppMinutes(null, ['Duolingo']) === null);
  check('ad içinde geçmesi yeter, büyük/küçük harf ve ı/İ fark etmez', matchesApp('DUOLİNGO: Dil Öğren', ['duolingo']) && matchesApp('Dılım', ['DİLİM']) && matchesApp('Dilim Dilim', ['DİLİM']) && !matchesApp('Dolim', ['DİLİM']));
  check('boş ad hiçbir şeyle eşleşmez', !matchesApp('Chrome', ['']) && autoAppMinutes(top, []) === 0);

  console.log('Günlük toplam');
  let d = languageDay(18, [{ kind: 'PAPER', minutes: 20 }, { kind: 'OTHER', minutes: 10 }]);
  check('uygulama + kalem kağıt + diğer toplanır', d.total === 48 && d.appMinutes === 18 && d.paperMinutes === 20 && d.otherMinutes === 10);
  check('ekran içi 18, ekran dışı 30', d.screenMinutes === 18 && d.offScreenMinutes === 30);
  d = languageDay(18, [{ kind: 'APP', minutes: 25 }]);
  check('otomatik süre varken elle uygulama kaydı çift sayılmaz', d.total === 18 && d.offScreenMinutes === 0);
  d = languageDay(0, [{ kind: 'APP', minutes: 25 }]);
  check('Duolingo 0 ise elle uygulama süresi sayılır (ekran dışı)', d.total === 25 && d.offScreenMinutes === 25 && d.screenMinutes === 0);
  d = languageDay(null, [{ kind: 'APP', minutes: 25 }]);
  check('ekran okunamıyorsa elle uygulama süresi sayılır', d.total === 25 && d.measured);
  check('hiçbir kayıt yok: ölçülmedi; ekran okundu ve 0: ölçüldü', !languageDay(null, []).measured && languageDay(0, []).measured && languageDay(0, []).total === 0);
  check('hedef oranı 0..1, hedef yoksa null', goalRatio(10, 20) === 0.5 && goalRatio(30, 20) === 1 && goalRatio(10, null) === null);
  check('satır: hedefli, hedefsiz, hiç yok', languageLine(12, 20) === 'dil 12 / 20 dk' && languageLine(12, null) === 'dil 12 dk' && languageLine(0, null) === null);

  console.log('Hafta karşılaştırması');
  const wk = languageWeek(Array.from({ length: 14 }, (_, i) => ({ day: day(i + 1), total: i < 7 ? 10 : 30 })));
  check('son 7 gün öncekiyle yan yana, yorum yok', wk.recent === 210 && wk.earlier === 70 && wk.recentDays === 7 && /Son 7 gün: 3 sa 30 dk \(7 gün\)\. Öncesindeki 7 gün: 1 sa 10 dk \(7 gün\)\./.test(wk.text) && !hasBannedWords(wk.text), wk.text);
  check('hiç kayıt yoksa tek cümle', languageWeek([]).text === 'Son iki haftada dil çalışması kaydı yok.');
  check('yalnızca bir hafta varsa öncesi yazılmaz', /^Son 7 gün: 1 sa \(2 gün\)\.$/.test(languageWeek([{ day: day(1), total: 30 }, { day: day(2), total: 30 }]).text));

  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('varsayılan ayar okunur', (await getLanguageSettings(db)).goalMin === 20);
  const s2 = await saveLanguageSettings(db, { goalMin: 30, apps: ['Duolingo', 'Dilim Dilim'] });
  check('ayar kaydedilir', s2.goalMin === 30 && (await getLanguageSettings(db)).apps.length === 2);
  check('hedef kapatılır; kısmi güncelleme diğer alanı korur', (await saveLanguageSettings(db, { goalMin: null })).goalMin === null && (await getLanguageSettings(db)).apps.length === 2);
  check('hedef 5-240 aralığına çekilir', (await saveLanguageSettings(db, { goalMin: 1 })).goalMin === 5 && (await saveLanguageSettings(db, { goalMin: 9999 })).goalMin === 240);
  await saveLanguageSettings(db, { goalMin: 20, apps: [] });
  check('boş uygulama listesi varsayılana döner', (await getLanguageSettings(db)).apps[0] === 'Duolingo');

  await upsertDailyStat(db, { day: day(16), steps: 0, screenMinutes: 120, topApps: [{ label: 'Chrome', minutes: 60 }, { label: 'Duolingo', minutes: 22 }] });
  await addStudy(db, 'PAPER', 20, at(21, 0));
  const st = await addStudy(db, 'OTHER', 10, at(21, 30));
  let ld = await loadLanguageDay(db, at(22, 0));
  check('bugün: Duolingo 22 + kalem kağıt 20 + diğer 10 = 52', ld.summary.total === 52 && ld.logs.length === 2, JSON.stringify(ld.summary));
  await removeStudy(db, st.id);
  ld = await loadLanguageDay(db, at(22, 0));
  check('kayıt silinince toplam düşer', ld.summary.total === 42 && ld.logs.length === 1);
  check('gece 02:00\'de kayıt önceki güne yazılır', (await addStudy(db, 'PAPER', 15, at(2, 0, 17))).day === day(16));
  let err = '';
  await addStudy(db, 'PAPER', 0, at(10)).catch((e) => (err = e.message));
  check('0 ve saçma dakika reddedilir', /1 ile 600/.test(err));
  await addStudy(db, 'PAPER', 700, at(10)).catch((e) => (err = e.message));
  check('600 dakikadan fazlası reddedilir', /1 ile 600/.test(err));
  const agoLog = await addStudy(db, 'OTHER', 10, at(10, 0, 15), 20);
  check('geriye dönük kayıt: 20 dk önce', new Date(agoLog.loggedAt).getHours() === 9 && new Date(agoLog.loggedAt).getMinutes() === 40 && agoLog.day === day(15));

  console.log('Geçmiş grafiği');
  const h = await gatherHistory(db, at(22, 0), 14);
  const last = h.days[h.days.length - 1];
  check('son gün: dil süresi toplamı (Duolingo + elle)', last.day === day(16) && last.languageMinutes === 22 + 20 + 15, JSON.stringify(last));
  const quiet = h.days.find((x) => x.day === day(10));
  check('hiç ölçülmeyen gün: kayıt yok (null)', quiet?.languageMinutes === null);
  const series = buildSeries(h.days, 'LANG', 14);
  check('seri: etiket ve çubuk', series.label === 'Dil öğrenme' && series.bars[series.bars.length - 1].label === '57 dk' && series.trackedDays >= 2, JSON.stringify(series.bars.slice(-3)));
  check('özette yargı yok', !hasBannedWords(series.summary));
  const many = await languageForDays(db, [day(14), day(15), day(16)]);
  check('çok günlü okuma tek sorguda aynı sonucu verir', many[2].summary.total === 57 && many[1].summary.total === 10 && many[0].summary.measured === false);

  console.log('Gün sonu analizi');
  const base: TimeUseInput = {
    wakeMin: 7 * 60, wakeSource: 'STAMP', endMin: 22 * 60, work: { startMin: 9 * 60, endMin: 18 * 60, source: 'SETTING' },
    commuteMinutes: 60, prepMinutes: 60, doneMinutes: 60, doneInWorkMinutes: 0, driftMinutes: 0, screenMinutes: 200,
  };
  const none = analyzeTimeUse(base);
  const withLang = analyzeTimeUse({ ...base, languageScreenMinutes: 40, languageOffScreenMinutes: 20 });
  check('dil verisi yokken sonuç eskisiyle aynı', none.unaccountedMinutes === 180 && none.screenNetMinutes === 200 && !none.chips.some((c) => /Dil/.test(c)));
  check('ekran dışı dil çalışması "kayıt dışı"dan düşer', withLang.unaccountedMinutes === (none.unaccountedMinutes as number) - 20, String(withLang.unaccountedMinutes));
  check('uygulamadaki dil süresi ekrandan düşer (net 160)', withLang.screenNetMinutes === 160 && withLang.screenMinutes === 200);
  check('çip ve metin: "Dil öğrenme 1 sa" ve ekranın dilde geçen kısmı', withLang.chips.includes('Dil öğrenme: 1 sa') && /bunun 40 dk'sı dil öğrenme uygulamasında geçti, kalan 2 sa 40 dk\./.test(withLang.text) && /20 dk dil çalışmasına gitti/.test(withLang.text), withLang.text);
  check('metinde yargı yok', !hasBannedWords(withLang.text));
  const all = analyzeTimeUse({ ...base, screenMinutes: 40, languageScreenMinutes: 40 });
  check('ekranın tamamı dilse bunu söyler', /hepsi dil öğrenme uygulamasında geçti/.test(all.text));
  const lines = timeUsePromptLines(withLang, true).join('\n');
  check('yapay zekâ satırları: dil bilgisi yalnızca ekran paylaşımı açıkken', /dil öğrenme uygulamasında geçti/.test(lines) && !/dil öğrenme uygulamasında/.test(timeUsePromptLines(withLang, false).join('\n')) && /ekran dışı dil çalışması 20 dk/.test(timeUsePromptLines(withLang, false).join('\n')));
  const open = [{ title: 'Rapor yaz', minutes: 20, workOk: false, missed: null, reason: null }];
  check('ekran yerine bütçesi dil süresi düşülmüş ekrandan hesaplanır', screenAlternatives(withLang.screenNetMinutes, open, 0).items.length >= 0 && screenAlternatives(65, open, 0).items.length > 0 && screenAlternatives(55, open, 0).items.length === 0);

  console.log('Yolda ve ana ekran');
  const sg = commuteSuggestions([], 25, 'TO_WORK', 0, 3, { goalMin: 20, doneMin: 12, appName: 'Duolingo' });
  check('yolda ilk öneri dil öğrenme, kalan süre kadar (8 dk)', sg[0].kind === 'LANGUAGE' && sg[0].minutes === 8 && /Dil öğrenme \(Duolingo\) · bugün 12 \/ 20 dk/.test(sg[0].title), JSON.stringify(sg[0]));
  check('dil satırı + iki kısa fikir (iş yoksa), toplam 3', sg.length === 3 && sg[1].kind === 'IDEA');
  const done = commuteSuggestions([], 25, 'HOME', 0, 3, { goalMin: 20, doneMin: 25, appName: 'Duolingo' });
  check('hedef tamamsa dil satırı kalır (0 dk), baskı yok', done[0].kind === 'LANGUAGE' && done[0].minutes === 0 && !hasBannedWords(done[0].title));
  check('hedef yoksa 10 dk önerilir', commuteSuggestions([], 25, 'HOME', 0, 3, { goalMin: null, doneMin: 3, appName: 'Duolingo' })[0].minutes === 10);
  check('dil bilgisi verilmezse eski davranış', commuteSuggestions([], 25, 'HOME', 0).every((x) => x.kind !== 'LANGUAGE'));
  check('günün özet satırına dil eklenir, 0 dk eklenmez', todayLine({ done: 1, open: 0, waterMl: null, waterGoalMl: null, smoke: null, smokeLimit: null, language: 12, languageGoal: 20 }) === '1 iş bitti · dil 12 / 20 dk' && todayLine({ done: 1, open: 0, waterMl: null, waterGoalMl: null, smoke: null, smokeLimit: null, language: 0, languageGoal: 20 }) === '1 iş bitti');

  console.log('Yedek');
  const text = await createBackup(db, {}, at(22));
  const fresh = makeTestDb();
  await migrateDbIfNeeded(fresh.db);
  const res = await restoreBackup(fresh.db, text);
  check('dil kayıtları ve ayar yedekle geri gelir', res.ok && (await loadLanguageDay(fresh.db, at(22, 0))).summary.total === 57 && (fresh.raw.prepare('SELECT COUNT(*) AS n FROM StudyLog').get() as { n: number }).n === 3 && (await getLanguageSettings(fresh.db)).goalMin === 20, JSON.stringify(res));
  void raw;
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
