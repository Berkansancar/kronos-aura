/**
 * Sakin Mod testi (saf mantık + gerçek SQLite): ayarlar, renk okunurluğu, gün enerjisi, tek görev seçimi, adımlar,
 * geri sayım, yumuşak ilerleme, veritabanı işlemleri, yedek, ana ekran bağlantıları ve dilin yargılamaması.
 * Çalıştırmak için:  npm run test:calm
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTask, getSetting, getTask, setSetting } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import type { Task } from '../database/types';
import { createBackup, restoreBackup } from '../services/backupLogic';
import {
  beginFocus,
  finishFocus,
  getCalmPrefs,
  getDayEnergy,
  getTaskSteps,
  getTimer,
  getWeekStarts,
  leaveFocus,
  saveCalmPrefs,
  saveTaskSteps,
  setDayEnergy,
} from '../services/calm';
import {
  CALM_PALETTE,
  CALM_PREFS_KEY,
  CALM_STARTS_KEY,
  CALM_TIMER_KEY,
  DEFAULT_PREFS,
  ENERGY_OPTIONS,
  FOCUS_MINUTES,
  MAX_STEPS,
  MICRO_MINUTES,
  STALE_TIMER_MS,
  STANDARD_PALETTE,
  STEP_MAX_LENGTH,
  addStartDay,
  addStep,
  currentStepIndex,
  daysBetween,
  discSize,
  focusHint,
  formatClock,
  isTimerOver,
  lineHeightFor,
  maxMinutesFor,
  needsSplit,
  newTimer,
  paletteFor,
  parseDayEnergy,
  parsePrefs,
  parseStartDays,
  parseSteps,
  parseTimer,
  pickFocusTask,
  rankFocusTasks,
  remainingMs,
  removeStep,
  scaleFont,
  serializeDayEnergy,
  serializePrefs,
  serializeSteps,
  serializeTimer,
  shouldOfferHardDay,
  startsInWindow,
  stepsKey,
  stepsProgress,
  suggestSteps,
  timerFraction,
  timerOverText,
  toggleStep,
  weekLine,
} from '../services/calmLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { ALL_TILES, EXTRA_TILES } from '../services/homeGrid';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** WCAG karşıtlık oranı (#rrggbb) */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

let n = 0;
const t = (title: string, minutes: number, weight: Task['cognitiveWeight'], over: Partial<Task> = {}): Task => {
  n += 1;
  return {
    id: `t${n}`,
    title,
    estimatedDuration: minutes,
    cognitiveWeight: weight,
    status: 'PENDING',
    createdAt: new Date(2026, 10, 28, 7, n).toISOString(),
    startedAt: null,
    routineId: null,
    ...over,
  };
};

const at = (h: number, m = 0, d = 28) => new Date(2026, 10, d, h, m);

async function main(): Promise<void> {
  console.log('Rahatlık ayarları');
  check('varsayılan: normal boyut, geniş aralık, yumuşak renk, sesli', DEFAULT_PREFS.textSize === 'NORMAL' && DEFAULT_PREFS.spacious && DEFAULT_PREFS.calmColors && !DEFAULT_PREFS.quiet);
  check('kayıt boşsa ya da bozuksa varsayılan', parsePrefs(null).textSize === 'NORMAL' && parsePrefs('{bozuk').calmColors === true && parsePrefs('7').spacious === true && parsePrefs('null').quiet === false);
  check('geçersiz alanlar tek tek varsayılana döner', (() => { const p = parsePrefs('{"textSize":"DEV","spacious":"evet","quiet":true,"calmColors":false}'); return p.textSize === 'NORMAL' && p.spacious === true && p.quiet === true && p.calmColors === false; })());
  check('yazılıp okunur', (() => { const p = { textSize: 'XLARGE' as const, spacious: false, quiet: true, calmColors: false }; const q = parsePrefs(serializePrefs(p)); return q.textSize === 'XLARGE' && !q.spacious && q.quiet && !q.calmColors; })());
  check('yazı boyutu büyür: 16 → 16, 19, 22', scaleFont(16, 'NORMAL') === 16 && scaleFont(16, 'LARGE') === 19 && scaleFont(16, 'XLARGE') === 22);
  check('geniş aralıkta satır yüksekliği daha büyük', lineHeightFor(16, true) > lineHeightFor(16, false) && lineHeightFor(16, true) >= 24);

  console.log('Renkler');
  check('yumuşak palet: metin/zemin karşıtlığı en az 7:1', contrast(CALM_PALETTE.text, CALM_PALETTE.bg) >= 7, String(contrast(CALM_PALETTE.text, CALM_PALETTE.bg)));
  check('yumuşak palet: soluk metin ve vurgu en az 4.5:1', contrast(CALM_PALETTE.textMuted, CALM_PALETTE.bg) >= 4.5 && contrast(CALM_PALETTE.accent, CALM_PALETTE.bg) >= 4.5);
  check('yumuşak palet: düğme yazısı (zemin rengi) vurgu üstünde en az 4.5:1', contrast(CALM_PALETTE.bg, CALM_PALETTE.accent) >= 4.5);
  check('yumuşak palet: soluk metin kart üstünde de okunur', contrast(CALM_PALETTE.textMuted, CALM_PALETTE.surface) >= 4.5 && contrast(CALM_PALETTE.textMuted, CALM_PALETTE.surfaceAlt) >= 4.5);
  check('yumuşak palette en parlak metin saf beyaz değil', CALM_PALETTE.text.toLowerCase() !== '#ffffff' && luminance(CALM_PALETTE.text) < 0.85);
  check('ayara göre palet seçilir', paletteFor({ ...DEFAULT_PREFS, calmColors: true }) === CALM_PALETTE && paletteFor({ ...DEFAULT_PREFS, calmColors: false }) === STANDARD_PALETTE && CALM_PALETTE.bg !== STANDARD_PALETTE.bg);

  console.log('Gün enerjisi');
  check('üç seçenek: düşük, orta, yüksek; sığan süre artar', ENERGY_OPTIONS.map((o) => o.value).join() === 'LOW,MID,HIGH' && ENERGY_OPTIONS[0].maxMinutes < ENERGY_OPTIONS[1].maxMinutes && ENERGY_OPTIONS[1].maxMinutes < ENERGY_OPTIONS[2].maxMinutes);
  check('seçilmemişse orta sayılır', maxMinutesFor(null) === maxMinutesFor('MID'));
  check('bugünün seçimi okunur', parseDayEnergy(serializeDayEnergy('2026-11-28', 'LOW'), '2026-11-28') === 'LOW');
  check('dünün seçimi bugünü bağlamaz', parseDayEnergy(serializeDayEnergy('2026-11-27', 'HIGH'), '2026-11-28') === null);
  check('bozuk ya da geçersiz kayıt null', parseDayEnergy('{x', '2026-11-28') === null && parseDayEnergy(null, '2026-11-28') === null && parseDayEnergy('{"day":"2026-11-28","energy":"ÇOK"}', '2026-11-28') === null);

  console.log('Tek görev seçimi');
  const big = t('Rapor', 90, 'HIGH');
  const med = t('Sunum notları', 40, 'MEDIUM');
  const mail = t('Mail yaz', 10, 'LOW');
  const call = t('Arama yap', 15, 'LOW');
  const all = [big, med, mail, call];
  check('düşük enerji: en kısa hafif iş önce', pickFocusTask(all, 'LOW')?.id === mail.id);
  check('düşük enerji: enerjiye sığmayan büyük iş en sona kalır', rankFocusTasks(all, 'LOW').at(-1)?.id === big.id);
  check('orta enerji: sığan orta iş önce', pickFocusTask(all, 'MID')?.id === med.id);
  check('yüksek enerji: derin odak işi önce', pickFocusTask(all, 'HIGH')?.id === big.id);
  check('enerji seçilmemişse orta gibi davranır', pickFocusTask(all, null)?.id === pickFocusTask(all, 'MID')?.id);
  const running = t('Başlamış iş', 60, 'HIGH', { status: 'IN_PROGRESS', startedAt: new Date(2026, 10, 28, 9).toISOString() });
  check('başlamış iş her zaman en üstte', pickFocusTask([...all, running], 'LOW')?.id === running.id);
  check('biten ve ertelenen işler seçilmez', pickFocusTask([t('Bitti', 10, 'LOW', { status: 'COMPLETED' }), t('Ertelendi', 10, 'LOW', { status: 'POSTPONED' })], 'LOW') === null);
  check('hiç iş yoksa null', pickFocusTask([], 'LOW') === null);
  check('"başka iş göster": geçilen atlanır', pickFocusTask(all, 'LOW', [mail.id])?.id === call.id);
  check('hepsi geçilince başa döner', pickFocusTask(all, 'LOW', all.map((x) => x.id))?.id === mail.id);
  check('girdi listesi değiştirilmez', (() => { const copy = [...all]; rankFocusTasks(all, 'HIGH'); return all.every((x, i) => x === copy[i]); })());
  check('büyük iş bölünmeye önerilir; küçük iş önerilmez', needsSplit(big, 'LOW') && needsSplit(med, 'LOW') && !needsSplit(mail, 'LOW') && needsSplit(t('Uzun', 30, 'LOW'), 'HIGH'));
  check('zor gün yalnızca düşük enerjide ve kapalıyken önerilir', shouldOfferHardDay('LOW', false) && !shouldOfferHardDay('LOW', true) && !shouldOfferHardDay('MID', false) && !shouldOfferHardDay(null, false));
  check('odak ipucu: başlamış / büyük / küçük işe göre', focusHint(running, 'LOW').includes('Başlamıştın') && focusHint(big, 'LOW').includes('böl') && focusHint(mail, 'LOW').includes('Tek bir iş'));

  console.log('Adımlar');
  const s3 = suggestSteps('Çamaşırları katla', 4);
  check('çok kısa iş: iki adım', s3.length === 2 && s3[0].text.includes('Çamaşırları katla'));
  const s20 = suggestSteps('Raporu yaz', 20);
  check('20 dk: hazırlan + 2 parça + toparla = 4 adım', s20.length === 4 && s20[0].text.startsWith('Hazırlan') && s20[1].text.startsWith('1. parça') && s20[3].text.startsWith('Toparla'), s20.map((s) => s.text).join(' | '));
  const s8 = suggestSteps('Mail', 8);
  check('8 dk: tek parça ("Yap")', s8.length === 3 && s8[1].text.startsWith('Yap:'));
  check('uzun iş en çok 6 parçaya bölünür', suggestSteps('Büyük proje', 300).length === 8);
  check('öneriler yapılmamış başlar, metin sınırı aşılmaz', [3, 20, 90, 600].every((m) => suggestSteps('x'.repeat(200), m).every((s) => !s.done && s.text.length <= STEP_MAX_LENGTH && s.text.length > 0)));
  check('boş başlık ve geçersiz süre çökmez', suggestSteps('   ', NaN).length >= 2 && suggestSteps('', -5).length === 2);
  check('süreler toplamı yaklaşık iş süresi (60 dk)', (() => { const mins = suggestSteps('İş', 60).map((s) => Number(/(\d+) dk/.exec(s.text)?.[1] ?? 0)); const sum = mins.reduce((a, b) => a + b, 0); return sum >= 50 && sum <= 70; })());
  check('yazılıp okunur, bozuk kayıt boş', parseSteps(serializeSteps(s20)).length === 4 && parseSteps('{x').length === 0 && parseSteps('{"a":1}').length === 0 && parseSteps(null).length === 0);
  check('okurken boş ve yanlış tipli satırlar atılır, sınır uygulanır', (() => { const raw = JSON.stringify([{ text: ' ', done: true }, { text: 5 }, null, { text: 'tamam', done: true }, ...Array.from({ length: 30 }, (_, i) => ({ text: `a${i}`, done: false }))]); const p = parseSteps(raw); return p.length === MAX_STEPS && p[0].text === 'tamam' && p[0].done; })());
  check('işaretle / geri al', (() => { const a = toggleStep(s20, 1); return a[1].done && !s20[1].done && !toggleStep(a, 1)[1].done; })());
  check('ekle: boşluklar sadeleşir, boş eklenmez, sınır aşılmaz', (() => { const a = addStep([], '  su   iç  '); const full = Array.from({ length: MAX_STEPS }, (_, i) => ({ text: `s${i}`, done: false })); return a[0].text === 'su iç' && addStep(a, '   ').length === 1 && addStep(full, 'bir tane daha').length === MAX_STEPS; })());
  check('sil', removeStep(s20, 0).length === 3 && removeStep(s20, 9).length === 4);
  check('ilerleme ve sıradaki adım', (() => { const a = toggleStep(toggleStep(s20, 0), 1); return stepsProgress(a).done === 2 && stepsProgress(a).total === 4 && currentStepIndex(a) === 2 && currentStepIndex(a.map((s) => ({ ...s, done: true }))) === -1 && currentStepIndex([]) === -1; })());

  console.log('Geri sayım');
  const start = at(10, 0).getTime();
  const micro = newTimer('t1', 'MICRO', start);
  const focus = newTimer('t1', 'FOCUS', start);
  check('"sadece 2 dakika" 2 dk, odak 10 dk', micro.endsAt - micro.startedAt === MICRO_MINUTES * 60_000 && MICRO_MINUTES === 2 && focus.endsAt - focus.startedAt === FOCUS_MINUTES * 60_000 && FOCUS_MINUTES === 10);
  check('kalan süre bitiş anından hesaplanır', remainingMs(micro, start) === 120_000 && remainingMs(micro, start + 30_000) === 90_000 && remainingMs(micro, start + 999_999) === 0);
  check('uygulama arka plandayken geçen süre de sayılır', remainingMs(micro, start + 100_000) === 20_000);
  check('süre bitti mi', !isTimerOver(micro, start + 119_999) && isTimerOver(micro, start + 120_000));
  check('oran: başta 1, ortada 0.5, sonda 0', timerFraction(micro, start) === 1 && timerFraction(micro, start + 60_000) === 0.5 && timerFraction(micro, start + 120_000) === 0);
  check('oran saat geri alınsa da 0-1 arasında', timerFraction(micro, start - 50_000) === 1 && timerFraction({ ...micro, endsAt: micro.startedAt }, start) === 0);
  check('saat yazısı: 2:00, 1:01, 0:01, 0:00', formatClock(120_000) === '2:00' && formatClock(61_000) === '1:01' && formatClock(500) === '0:01' && formatClock(0) === '0:00' && formatClock(-5) === '0:00');
  check('saniye yukarı yuvarlanır: 0:00 yalnızca bitince', formatClock(119_001) === '2:00' && formatClock(1) === '0:01');
  check('daire küçülür, hiç kaybolmaz', discSize(1, 150) === 150 && discSize(0.5, 150) < 150 && discSize(0.5, 150) > discSize(0.1, 150) && discSize(0, 150) === 10 && discSize(NaN, 150) === 10 && discSize(7, 150) === 150);
  check('daire alanı kalan süreyle orantılı (çap karekökle)', (() => { const d = discSize(0.25, 100, 0); return d === 50; })());
  check('sayaç yazılıp okunur', (() => { const p = parseTimer(serializeTimer(micro), start + 1000); return p !== null && p.taskId === 't1' && p.kind === 'MICRO' && p.endsAt === micro.endsAt; })());
  check('bozuk sayaç null', ['', '{x', 'null', '{"taskId":"a"}', '{"taskId":"a","kind":"X","minutes":2,"startedAt":1,"endsAt":2}', '{"taskId":"a","kind":"MICRO","minutes":2,"startedAt":5,"endsAt":5}', '{"taskId":"","kind":"MICRO","minutes":2,"startedAt":1,"endsAt":9}'].every((r) => parseTimer(r, 100) === null));
  check('günler önce bitmiş sayaç silinir; yeni bitmiş kalır (bitti mesajı görünsün)', parseTimer(serializeTimer(micro), micro.endsAt + STALE_TIMER_MS + 1) === null && parseTimer(serializeTimer(micro), micro.endsAt + 60_000) !== null);
  check('bitiş mesajı: bırakmak da olur, suçlama yok', timerOverText('MICRO').includes('bırakmak da olur') && timerOverText('MICRO').includes('10 dakika') && timerOverText('FOCUS').includes('mola'));

  console.log('Yumuşak ilerleme');
  check('günler okunur: tekrarsız, sıralı, geçersiz atılır', parseStartDays('["2026-11-27","2026-11-25","2026-11-27","yarın",5]').join() === '2026-11-25,2026-11-27' && parseStartDays('{x').length === 0 && parseStartDays(null).length === 0);
  check('gün eklenir (aynı gün iki kez sayılmaz), geçersiz gün eklenmez', addStartDay(addStartDay([], '2026-11-28'), '2026-11-28').length === 1 && addStartDay([], 'bugün').length === 0);
  check('en çok 60 gün tutulur, eskiler gider', (() => { let d: string[] = []; for (let i = 1; i <= 28; i++) d = addStartDay(d, `2026-10-${String(i).padStart(2, '0')}`); for (let i = 1; i <= 30; i++) d = addStartDay(d, `2026-11-${String(i).padStart(2, '0')}`); return d.length === 58 && addStartDay(Array.from({ length: 60 }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, '0')}-${i}`.slice(0, 10)), '2026-12-01').length <= 60; })());
  check('gün farkı: ay ve yıl geçişi', daysBetween('2026-11-28', '2026-11-30') === 2 && daysBetween('2026-12-30', '2027-01-02') === 3 && daysBetween('2026-11-30', '2026-11-28') === -2 && daysBetween('2026-03-28', '2026-03-30') === 2);
  check('son 7 günde kaç gün: bugün dahil, 8. gün ve gelecek sayılmaz', startsInWindow(['2026-11-22', '2026-11-21', '2026-11-28', '2026-11-29'], '2026-11-28', 7) === 2);
  check('ara vermek hiçbir şeyi sıfırlamaz: 5 gün ara sonra önceki günler hâlâ sayılır', startsInWindow(['2026-11-23', '2026-11-24', '2026-11-25'], '2026-11-28', 7) === 3);
  check('hafta satırı: 0, 1, birkaç, 7', weekLine(0).includes('2 dakika yeter') && weekLine(1).includes('Her başlangıç sayılır') && weekLine(4).includes('4 gün') && weekLine(7).includes('her gün'));

  console.log('Dil: yargılama ve suçlama yok');
  const texts = [
    ...ENERGY_OPTIONS.map((o) => `${o.label} ${o.hint}`),
    weekLine(0), weekLine(1), weekLine(3), weekLine(7),
    timerOverText('MICRO'), timerOverText('FOCUS'),
    focusHint(big, 'LOW'), focusHint(mail, 'LOW'), focusHint(running, 'HIGH'),
    ...suggestSteps('Rapor', 30).map((s) => s.text),
    read('app/calm.tsx'),
  ];
  check('yasaklı sözcük yok (tembel, başarısız, yetersiz, boşa...)', texts.every((x) => !hasBannedWords(x)), texts.filter((x) => hasBannedWords(x)).join(' | ').slice(0, 200));
  check('"kaçırdın", "seri bozuldu", "geride kaldın" gibi ifadeler yok', texts.every((x) => !/(kaçırdın|seri bozuldu|serin bozuldu|geride kaldın|neden yapmadın|utan)/i.test(x)));

  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const now = at(10, 0);

  check('ayar yokken varsayılan', (await getCalmPrefs(db)).textSize === 'NORMAL');
  const saved = await saveCalmPrefs(db, { textSize: 'LARGE', spacious: false, quiet: true, calmColors: true });
  const back = await getCalmPrefs(db);
  check('ayar kaydedilir ve okunur', saved.textSize === 'LARGE' && back.textSize === 'LARGE' && back.quiet && !back.spacious && back.calmColors);
  check('ayar tek satır', raw.prepare('SELECT COUNT(*) AS c FROM Setting WHERE key = ?').get(CALM_PREFS_KEY)?.c === 1);
  await setSetting(db, CALM_PREFS_KEY, '{bozuk');
  check('bozuk ayar uygulamayı durdurmaz', (await getCalmPrefs(db)).textSize === 'NORMAL');
  await saveCalmPrefs(db, { textSize: 'LARGE', spacious: false, quiet: true, calmColors: true });

  check('enerji seçilmemişse null', (await getDayEnergy(db, now)) === null);
  await setDayEnergy(db, 'LOW', now);
  check('enerji bugün için kaydedilir', (await getDayEnergy(db, now)) === 'LOW');
  check('ertesi gün enerji yeniden sorulur (null)', (await getDayEnergy(db, at(10, 0, 29))) === null);
  await setDayEnergy(db, 'HIGH', now);
  check('enerji değiştirilebilir, tek satır kalır', (await getDayEnergy(db, now)) === 'HIGH' && raw.prepare("SELECT COUNT(*) AS c FROM Setting WHERE key = 'calm_energy_v1'").get()?.c === 1);

  const task = await createTask(db, { title: 'Rapor yaz', estimatedDuration: 30, cognitiveWeight: 'MEDIUM' });
  check('ilerleme başta 0', (await getWeekStarts(db, now)) === 0);

  const t1 = await beginFocus(db, task, 'MICRO', now);
  const afterStart = await getTask(db, task.id);
  check('"sadece 2 dakika" işi başlatır', afterStart?.status === 'IN_PROGRESS' && afterStart.startedAt === now.toISOString());
  check('sayaç saklanır ve okunur', (await getTimer(db, now.getTime()))?.endsAt === t1.endsAt && t1.kind === 'MICRO');
  check('başlanan gün sayılır', (await getWeekStarts(db, now)) === 1);

  const later = new Date(now.getTime() + 3 * 60_000);
  const t2 = await beginFocus(db, afterStart as Task, 'FOCUS', later);
  const stillRunning = await getTask(db, task.id);
  check('"10 dakika daha": başlama anı değişmez (gerçek süre bozulmaz)', stillRunning?.startedAt === now.toISOString() && t2.kind === 'FOCUS' && (await getTimer(db, later.getTime()))?.kind === 'FOCUS');
  check('aynı gün ikinci başlatma günü iki kez saymaz', (await getWeekStarts(db, later)) === 1);

  await leaveFocus(db, stillRunning as Task, later);
  const left = await getTask(db, task.id);
  check('"burada bırakıyorum": iş beklemeye döner, sayaç silinir', left?.status === 'PENDING' && left.startedAt === null && (await getTimer(db, later.getTime())) === null);
  check('bırakmak ilerlemeyi azaltmaz', (await getWeekStarts(db, later)) === 1);

  await beginFocus(db, left as Task, 'MICRO', at(11, 0));
  await saveTaskSteps(db, task.id, suggestSteps(task.title, task.estimatedDuration));
  check('adımlar saklanır (30 dk: hazırlan + 3 parça + toparla)', (await getTaskSteps(db, task.id)).length === 5 && (await getSetting(db, stepsKey(task.id))) !== null);
  const toFinish = (await getTask(db, task.id)) as Task;
  await finishFocus(db, toFinish, 'HIGH', at(11, 20));
  const done = await getTask(db, task.id);
  check('"bitirdim": iş tamamlanır', done?.status === 'COMPLETED');
  check('bitince sayaç ve adımlar temizlenir', (await getTimer(db, at(11, 20).getTime())) === null && (await getTaskSteps(db, task.id)).length === 0 && (await getSetting(db, stepsKey(task.id))) === null);
  check('süre kaydı yazılır (20 dk, enerji yüksek)', (raw.prepare('SELECT actualDuration AS a, energyStateAtCompletion AS e FROM TimeLog WHERE taskId = ?').get(task.id) as { a: number; e: string } | undefined)?.a === 20);

  await saveTaskSteps(db, 'x1', [{ text: 'bir', done: false }]);
  await saveTaskSteps(db, 'x1', []);
  check('boş adım listesi kaydı siler', (await getSetting(db, stepsKey('x1'))) === null);

  await setSetting(db, CALM_TIMER_KEY, serializeTimer({ taskId: 'eski', kind: 'MICRO', minutes: 2, startedAt: 1000, endsAt: 121_000 }));
  check('eskimiş sayaç okunurken silinir', (await getTimer(db, 121_000 + STALE_TIMER_MS + 5)) === null && (await getSetting(db, CALM_TIMER_KEY)) === null);
  await setSetting(db, CALM_TIMER_KEY, 'çöp');
  check('bozuk sayaç okunurken silinir', (await getTimer(db, 0)) === null && (await getSetting(db, CALM_TIMER_KEY)) === null);
  await setSetting(db, CALM_STARTS_KEY, '{bozuk');
  check('bozuk gün listesi ilerlemeyi 0 yapar, çökmez', (await getWeekStarts(db, now)) === 0);
  await beginFocus(db, (await createTask(db, { title: 'Yeni', estimatedDuration: 10, cognitiveWeight: 'LOW' })), 'MICRO', now);
  check('bozuk listenin üstüne yeniden başlanır', (await getWeekStarts(db, now)) === 1);

  console.log('Yedek');
  await setSetting(db, CALM_TIMER_KEY, 'geçici');
  const text = await createBackup(db, {}, now);
  const other = makeTestDb();
  await migrateDbIfNeeded(other.db);
  const restored = await restoreBackup(other.db, text);
  check('yedek geri yüklenir', restored.ok, JSON.stringify(restored));
  const p2 = await getCalmPrefs(other.db);
  check('rahatlık ayarları yedekle gelir', p2.textSize === 'LARGE' && p2.quiet && !p2.spacious);
  check('gün enerjisi ve başlama günleri yedekle gelir', (await getDayEnergy(other.db, now)) === 'HIGH' && (await getWeekStarts(other.db, now)) === 1);

  console.log('Ana ekran ve bağlantılar');
  const tile = ALL_TILES.find((x) => x.id === 'sakin');
  check('"Sakin" kutusu katalogda ve ek kutularda', !!tile && tile.route === '/calm' && EXTRA_TILES.some((x) => x.id === 'sakin') && !!tile.label && tile.label.length <= 10);
  check('kutu kimlikleri ve adları hâlâ benzersiz', new Set(ALL_TILES.map((x) => x.id)).size === ALL_TILES.length && new Set(ALL_TILES.map((x) => x.label)).size === ALL_TILES.length);
  check('ekran dosyası var ve gezinme kaydında tanımlı', existsSync(join(root, 'app/calm.tsx')) && read('app/_layout.tsx').includes('name="calm"'));
  check('ana ekranın her iki sayfasında Sakin düğmesi var', read('app/index.tsx').includes("router.push('/calm')") && read('app/index.tsx').includes('onCalm=') && read('components/HomeGrid.tsx').includes('onCalm'));
  check('ekran erişilebilir: düğme rolleri, onay kutusu, en az 44 dp dokunma alanı', (() => { const s = read('app/calm.tsx'); return s.includes('accessibilityRole="button"') && s.includes('accessibilityRole="checkbox"') && s.includes('minHeight: 52') && s.includes('minHeight: 44'); })());
  check('sessiz mod titreşimi kapatır', read('app/calm.tsx').includes('!prefs.quiet') && read('app/calm.tsx').includes('Vibration.vibrate'));
  check('ekranda animasyon ya da yanıp sönen öğe yok', !/Animated|LayoutAnimation|useNativeDriver/.test(read('app/calm.tsx')));
  check('internet ya da API anahtarı gerekmez', !/fetch\(|claudeClient|freeClient|getApiKey/.test(read('app/calm.tsx') + read('services/calm.ts') + read('services/calmLogic.ts')));

  console.log(`\n${passed} kontrol geçti.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
