/**
 * "Etki" testi: içerik doğruluğu (rakamlar kaynaklarla uyumlu), seri hesabı, aşamalar, tekrar ve kalori toplamı,
 * ekran satırları ve bağlantılar. Çalıştırmak için:  npm run test:effects
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HONESTY_NOTE,
  MOVE_EFFECT_IDS,
  PROFILES,
  PROFILE_BY_ID,
  SOURCES,
  STAGES,
} from '../services/effectsData';
import {
  buildEffects,
  computeStreak,
  dayDiff,
  formatKcal,
  moveFacts,
  nextHint,
  safeWeight,
  stageRows,
  toStage,
  waterGoalDays,
} from '../services/effectsLogic';
import { defaultState, recordSession } from '../services/exerciseLogic';
import { HOME_TILES } from '../services/homeGrid';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);

console.log('İçerik');
check('6 aşama, gün eşikleri artan', STAGES.length === 6 && STAGES.every((s, i) => i === 0 || s.afterDays > STAGES[i - 1].afterDays));
check('aşama kimlikleri benzersiz', new Set(STAGES.map((s) => s.id)).size === 6);
check('7 etki: 5 güç hareketi, su, dil', PROFILES.length === 7 && MOVE_EFFECT_IDS.length === 5 && !!PROFILE_BY_ID.water && !!PROFILE_BY_ID.language);
check('kimlikler benzersiz', new Set(PROFILES.map((p) => p.id)).size === PROFILES.length);
check('her etkinin her aşaması dolu ve makul uzunlukta', PROFILES.every((p) => STAGES.every((s) => p.stages[s.id].trim().length >= 40 && p.stages[s.id].length <= 420)));
check('her etkinin etkilenen listesi dolu', PROFILES.every((p) => p.focus.length >= 2 && p.focus.every((f) => f.trim().length > 0)));
check('güç hareketlerinde kalori katsayısı var, diğerlerinde yok', PROFILES.filter((p) => p.strength).every((p) => (p.kcalPer70 ?? 0) > 0) && PROFILES.filter((p) => !p.strength).every((p) => p.kcalPer70 === undefined));
check('simgeler eski telefonlarda görünür (Emoji 11 ve öncesi)', PROFILES.every((p) => p.icon.length > 0 && !tooNew(p.icon)));
check('güç hareketlerinde seri aralığı 3 gün ve dinlenme sayılır', PROFILES.filter((p) => p.strength).every((p) => p.maxGap === 3 && p.restCounts));
check('günlük alışkanlıklarda seri aralığı 1 gün', PROFILES.filter((p) => !p.strength).every((p) => p.maxGap === 1 && !p.restCounts));

// Uydurma kalınlık rakamı yok: yalnızca şınavın 8. haftasında "mm" geçer ve kaynaktaki farklarla birebir uyar
const withMm = PROFILES.flatMap((p) => STAGES.filter((s) => /\bmm\b/.test(p.stages[s.id])).map((s) => `${p.id}:${s.id}`));
check('"mm" yalnızca şınavın 8. haftasında geçer', withMm.length === 1 && withMm[0] === 'push:w8', withMm.join());
const pushW8 = PROFILE_BY_ID.push.stages.w8;
const pecDiff = (20.8 - 17.0).toFixed(1).replace('.', ',');
const triDiff = (30.4 - 27.7).toFixed(1).replace('.', ',');
check('şınav 8. hafta rakamları kaynak farklarıyla aynı (3,8 ve 2,7 mm)', pushW8.includes(`${pecDiff} mm`) && pushW8.includes(`${triDiff} mm`), `${pecDiff} ${triDiff}`);
check('kaynak listesi bu rakamları ve 66 günü içerir', SOURCES.some((s) => s.includes('17,0 → 20,8') && s.includes('27,7 → 30,4')) && SOURCES.some((s) => s.includes('66 gün')));
check('kaynak sayısı 5, hepsi yıl içerir', SOURCES.length === 5 && SOURCES.every((s) => /(19|20)\d{2}/.test(s)));
check('1. ve 2. gün metinlerinde kalınlık sözü verilmez', PROFILES.filter((p) => p.strength).every((p) => !/kalın(laş|lık)[^.]*(artar|arttı)/i.test(p.stages.d1 + p.stages.d2)));
check('1. gün metni kalınlığın değişmediğini açıkça söyler', PROFILES.filter((p) => p.strength).every((p) => p.stages.d1.includes('Kalınlık bugün değişmez')));
check('güç hareketlerinde program notu var', PROFILES.filter((p) => p.strength).every((p) => (p.note ?? '').includes('kalınlaşmadan güç')));
check('dürüstlük notu rakamların ortalama olduğunu söyler', HONESTY_NOTE.includes('araştırma ortalamaları') && HONESTY_NOTE.includes('Kalori'));

console.log('Seri');
const today = '2026-11-23'; // Pazartesi
check('gün farkı', dayDiff('2026-11-20', '2026-11-23') === 3 && dayDiff('2026-11-23', '2026-11-23') === 0);
const emptyS = computeStreak([], today, 1, false);
check('kayıt yoksa seri yok', !emptyS.alive && emptyS.activeDays === 0 && emptyS.progressDays === 0 && emptyS.sinceLast === null);

const monWedFri = ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20'];
const ex = computeStreak(monWedFri, today, 3, true);
check('Pzt-Çar-Cum düzeni tek seri sayılır', ex.alive && ex.activeDays === 6 && ex.spanDays === 12 && ex.start === '2026-11-09' && ex.last === '2026-11-20', JSON.stringify(ex));
check('güçte dinlenme günleri aşamayı ilerletir (bugüne kadar 15 gün)', ex.progressDays === 15 && ex.sinceLast === 3 && !ex.doneToday);
const exLate = computeStreak(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18'], today, 3, true);
check('3 günden uzun ara seriyi bitirir ama en uzun seri saklanır', !exLate.alive && exLate.progressDays === 0 && exLate.bestSpan === 10 && exLate.sinceLast === 5, JSON.stringify(exLate));
check('yeni seri eski seriyle karışmaz', (() => { const s = computeStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-22', '2026-11-23'], today, 1, false); return s.alive && s.spanDays === 2 && s.bestSpan === 5 && s.doneToday; })());
check('günlük: dün ve bugün yapıldıysa 2 gün', (() => { const s = computeStreak(['2026-11-22', '2026-11-23'], today, 1, false); return s.alive && s.spanDays === 2 && s.progressDays === 2 && s.doneToday; })());
check('günlük: yalnızca dün yapıldıysa seri sürer, bugün sayılmaz', (() => { const s = computeStreak(['2026-11-21', '2026-11-22'], today, 1, false); return s.alive && !s.doneToday && s.progressDays === 2 && s.sinceLast === 1; })());
check('günlük: evvelsi gün yapıldıysa seri biter', (() => { const s = computeStreak(['2026-11-20', '2026-11-21'], today, 1, false); return !s.alive && s.progressDays === 0 && s.bestSpan === 2; })());
check('gelecek tarih, bozuk anahtar ve tekrar sayılmaz', (() => { const s = computeStreak(['2026-11-23', '2026-11-23', '2026-12-30', 'abc', '2026-1-5'], today, 1, false); return s.activeDays === 1 && s.spanDays === 1 && s.bestSpan === 1; })());
check('geçmişte tek gün: seri 1 gün', (() => { const s = computeStreak(['2026-11-23'], today, 3, true); return s.alive && s.progressDays === 1 && s.doneToday; })());

console.log('Aşamalar');
const r0 = stageRows(PROFILE_BY_ID.push, 0);
check('seri yokken hepsi ileride, 1. gün 1 gün kaldı', r0.every((r) => r.state === 'later') && r0[0].daysLeft === 1 && r0[5].daysLeft === 84);
const r1 = stageRows(PROFILE_BY_ID.push, 1);
check('1. gün: 1. gün şu an, 2. gün ileride (1 kaldı)', r1[0].state === 'current' && r1[1].state === 'later' && r1[1].daysLeft === 1);
const r2 = stageRows(PROFILE_BY_ID.push, 2);
check('2. gün: 1. gün geçti, 2. gün şu an', r2[0].state === 'reached' && r2[1].state === 'current' && r2[2].daysLeft === 5);
const r15 = stageRows(PROFILE_BY_ID.push, 15);
check('15. gün: 1 hafta şu an, 4 hafta 13 gün kaldı', r15[2].state === 'current' && r15[3].daysLeft === 13 && r15[0].state === 'reached' && r15[1].state === 'reached');
const r90 = stageRows(PROFILE_BY_ID.water, 90);
check('90. gün: 12. hafta şu an, hepsi geçti', r90[5].state === 'current' && r90.slice(0, 5).every((r) => r.state === 'reached') && r90.every((r) => r.daysLeft === 0));
check('her satır kendi profilinin metnini taşır', r15.every((r) => r.text === PROFILE_BY_ID.push.stages[r.id]));

console.log('Tekrar ve kalori');
check('kilo geçersizse 70 kg', safeWeight(null) === 70 && safeWeight(undefined) === 70 && safeWeight(10) === 70 && safeWeight(900) === 70 && safeWeight(NaN) === 70 && safeWeight(84.5) === 84.5);
check('kalori yazımı', formatKcal(0) === '0 kcal' && formatKcal(0.4) === '1 kcal\'den az' && formatKcal(5.6) === '6 kcal' && formatKcal(NaN) === '0 kcal');

let ex1 = defaultState();
ex1 = recordSession(ex1, '2026-11-20', [
  { move: 'push', level: 1, sets: [5, 5, 4] },
  { move: 'legs', level: 1, sets: [4, 4, 4] },
  { move: 'core', level: 1, sets: [30, 30] },
]).state;
ex1 = recordSession(ex1, today, [{ move: 'push', level: 1, sets: [5, 5, 5] }]).state;
const pf = moveFacts(ex1, 'push', today, 70);
check('şınav: 2 seans, 29 tekrar, bugünkü kayıt', pf.sessions === 2 && pf.units === 29 && pf.today?.units === 15 && pf.today?.sets.join() === '5,5,5');
check('şınav kalorisi tekrar x 0,4 (70 kg)', Math.abs(pf.kcal - 29 * 0.4) < 1e-9 && Math.abs((pf.today?.kcal ?? 0) - 6) < 1e-9);
check('kilo arttıkça kalori orantılı artar', Math.abs(moveFacts(ex1, 'push', today, 140).kcal - 2 * pf.kcal) < 1e-9);
const lf = moveFacts(ex1, 'legs', today, 70);
check('bacakta her iki bacak sayılır (kalori 2 katı), tekrar kaydedildiği gibi', lf.units === 12 && Math.abs(lf.kcal - 24 * 0.5) < 1e-9 && lf.today === null);
const cf = moveFacts(ex1, 'core', today, null);
check('karın saniye olarak toplanır', cf.units === 60 && Math.abs(cf.kcal - 60 * 0.07) < 1e-9);
check('kayıtsız hareket boş döner', (() => { const f = moveFacts(ex1, 'pull', today, 70); return f.sessions === 0 && f.units === 0 && f.kcal === 0 && f.days.length === 0; })());

console.log('Su');
check('su hedefine ulaşılan günler (kayıtlar toplanır)', waterGoalDays([{ day: 'a', ml: 1000 }, { day: 'a', ml: 1000 }, { day: 'b', ml: 1900 }], 2000).join() === 'a');
check('hedef 500 ml\'nin altına inemez', waterGoalDays([{ day: 'a', ml: 400 }, { day: 'b', ml: 500 }], 100).join() === 'b');

console.log('Ekran satırları');
const water = [
  { day: '2026-11-21', ml: 2100 },
  { day: '2026-11-22', ml: 2000 },
  { day: '2026-11-23', ml: 800 },
];
const study = [
  { day: '2026-11-22', minutes: 20 },
  { day: '2026-11-23', minutes: 15 },
  { day: '2026-11-20', minutes: 0 },
];
const views = buildEffects({ exercise: ex1, water, waterGoalMl: 2000, study, today, weightKg: 70 });
const byId = (id: string) => views.find((v) => v.id === id)!;
check('7 görünüm, profil sırasıyla', views.length === 7 && views.map((v) => v.id).join() === PROFILES.map((p) => p.id).join());
const vp = byId('push');
check('şınav başlığı: 2 gün arayla seans, seri 4 gün 2 seans', vp.headline === 'Seri 4 gün · 2 seans', vp.headline);
check('şınav bugün yapıldı ve metin set ve kaloriyi söyler', vp.todayDone && vp.todayText.includes('5 + 5 + 5') && vp.todayText.includes('15 tekrar') && vp.todayText.includes('6 kcal'), vp.todayText);
check('şınav şu an 4. gün: 2. gün aşamasında, sıradaki 1. hafta', vp.current?.id === 'd2' && vp.next?.id === 'w1');
check('şınav sıradaki aşama ipucu', nextHint(vp) === '1. haftaya 3 gün kaldı', String(nextHint(vp)));
check('şınav toplam satırı', vp.totalText === 'Toplam 2 seans, 29 tekrar, yaklaşık 12 kcal', String(vp.totalText));
const vw = byId('water');
check('su: hedefe ulaşılan 2 gün, bugün henüz değil, seri sürüyor', vw.streak.alive && vw.streak.spanDays === 2 && !vw.todayDone && vw.todayText === 'Bugün 800 ml / 2000 ml' && vw.headline === 'Seri 2 gün', `${vw.headline} | ${vw.todayText}`);
const vl = byId('language');
check('dil: dakikası 0 olan gün sayılmaz, 2 gün seri, bugün çalışıldı', vl.streak.spanDays === 2 && vl.todayDone && vl.todayText === 'Bugün 15 dk çalıştın' && vl.totalText === '2 gün çalıştın, toplam 35 dk', `${vl.todayText} | ${vl.totalText}`);
const vpull = byId('pull');
check('kaydı olmayan hareket: başlamadın, aşama yok, ipucu yok', vpull.headline === 'Henüz başlamadın' && vpull.current === null && nextHint(vpull) === null && vpull.totalText === null && vpull.todayText === 'Bugün yapılmadı');
const viewsOld = buildEffects({ exercise: ex1, water: [], waterGoalMl: 2000, study: [], today: '2026-12-10', weightKg: null });
check('uzun aradan sonra: seri bitti metni, aşama yok', byIdIn(viewsOld, 'push').headline.startsWith('Seri bitti (en uzunu 4 gün)') && byIdIn(viewsOld, 'push').current === null);
check('su kaydı yoksa bugün için kayıt yok der', byIdIn(viewsOld, 'water').todayText === 'Bugün su kaydı yok' && byIdIn(viewsOld, 'language').todayText === 'Bugün çalışma kaydı yok');
check('aşama adının "-e" hali', toStage('4. hafta') === '4. haftaya' && toStage('2. gün') === '2. güne' && toStage('12. hafta') === '12. haftaya');

function byIdIn(list: ReturnType<typeof buildEffects>, id: string) {
  return list.find((v) => v.id === id)!;
}

console.log('Bağlantılar');
const effectsSrc = readFileSync(join(root, 'app', 'effects.tsx'), 'utf8');
const layoutSrc = readFileSync(join(root, 'app', '_layout.tsx'), 'utf8');
const gatherSrc = readFileSync(join(root, 'services', 'effects.ts'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
check('ekran dosyası var ve kaynakları gösterir', existsSync(join(root, 'app', 'effects.tsx')) && effectsSrc.includes('SOURCES') && effectsSrc.includes('HONESTY_NOTE'));
check('ekran _layout içinde kayıtlı', layoutSrc.includes('<Stack.Screen name="effects" />'));
check('ana ekran ızgarasında Etki kutusu /effects açar', HOME_TILES.find((t) => t.id === 'etki')?.route === '/effects');
check('veri toplayıcı egzersiz, su, dil ve kiloyu okur', ['loadExercise', 'listWaterLogsSince', 'languageForDays', 'getBody', 'getWaterGoal'].every((k) => gatherSrc.includes(k)));
check('README Etki bölümü var', readme.includes('## Etki:') && readme.includes('npm run test:effects'));

console.log(`\nTüm kontroller geçti: ${passed}`);
