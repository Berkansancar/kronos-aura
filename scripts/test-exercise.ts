/**
 * Egzersiz bölümü testi: çizim geometrisi, içerik bütünlüğü, basamak atlama, seans kaydı, hafta sayısı, kayıt ve yedek.
 * Çalıştırmak için:  npm run test:exercise
 */
import { migrateDbIfNeeded } from '../database/schema';
import { BACKUP_TABLES } from '../services/backupLogic';
import { chooseExerciseLevel, loadExercise, saveExerciseSession, updateExercise } from '../services/exercise';
import { planReminders } from '../services/routineRemindersLogic';
import {
  ALT_REST_SECONDS,
  EXERCISES,
  EXERCISE_BY_ID,
  LEVEL_NAMES,
  PRINCIPLES,
  REST_CHOICES,
  SESSION_BLOCKS,
  SESSION_MINUTES,
  WARMUP_STEPS,
  type Level,
  type MoveId,
} from '../services/exerciseData';
import { openAlarmEditorPlan } from './alarmShim';
import {
  FOREARM,
  GROUND_Y,
  HEAD_R,
  SHIN,
  THIGH,
  TORSO,
  UPPER_ARM,
  VIEW_H,
  VIEW_W,
  ang,
  buildFigure,
  figureBounds,
  solveLimb,
} from '../services/exerciseFigure';
import {
  DAY_SHORT,
  EXERCISE_KEY,
  START_CHOICES,
  alarmExtras,
  clock,
  daysSinceLast,
  defaultState,
  estimateMinutes,
  exerciseDayFacts,
  isExerciseDay,
  morningCard,
  nextExerciseDay,
  setRemind,
  setStart,
  toggleDay,
  windowText,
  lastResult,
  parseState,
  qualifiesForLevelUp,
  recordSession,
  serializeState,
  sessionSummary,
  sessionsThisWeek,
  setLevel,
  setsLine,
  targetLine,
  tileLine,
  todayAdvice,
  variantFor,
  weekStartKey,
} from '../services/exerciseLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const at = (d: number, h = 9) => new Date(2026, 10, d, h, 0, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

async function main(): Promise<void> {
  console.log('Ters kinematik');
  const knee = solveLimb([50, 30], [50, 60], THIGH, SHIN, 'fwd');
  check('ileri bükülen diz hedefin sağında', knee.joint[0] > 50, JSON.stringify(knee));
  check('düz uzuv: uzuv boyları korunur', near(dist(50, 30, knee.joint[0], knee.joint[1]), THIGH) && near(dist(knee.joint[0], knee.joint[1], knee.end[0], knee.end[1]), SHIN));
  const back = solveLimb([50, 30], [50, 60], THIGH, SHIN, 'back');
  check('geri bükülen diz hedefin solunda', back.joint[0] < 50);
  const up = solveLimb([50, 30], [70, 40], UPPER_ARM, FOREARM, 'up');
  const down = solveLimb([50, 30], [70, 40], UPPER_ARM, FOREARM, 'down');
  check('yukarı ve aşağı bükülme farklı yönlere gider', up.joint[1] < down.joint[1]);
  const far = solveLimb([50, 30], [95, 30], UPPER_ARM, FOREARM, 'back');
  check('erişilemeyen hedef: uzuv düz uzanır, erişildi sayılmaz', !far.reached && near(dist(50, 30, far.end[0], far.end[1]), UPPER_ARM + FOREARM, 0.05));
  const p = ang([10, 10], 90, 5);
  check('ang: 90 derece yukarı', near(p[0], 10) && near(p[1], 5));
  const q = ang([10, 10], 0, 5);
  check('ang: 0 derece sağa', near(q[0], 15) && near(q[1], 10));

  console.log('İçerik bütünlüğü');
  check('5 hareket', EXERCISES.length === 5);
  check('hareket kimlikleri benzersiz', new Set(EXERCISES.map((m) => m.id)).size === 5);
  for (const m of EXERCISES) {
    check(`${m.title}: 3 basamak (1,2,3 sırayla)`, m.variants.length === 3 && m.variants.every((v, i) => v.level === i + 1));
    check(`${m.title}: arama tablosu`, EXERCISE_BY_ID[m.id] === m);
    for (const v of m.variants) {
      const tag = `${m.title} ${LEVEL_NAMES[v.level]}`;
      check(`${tag}: ad, özet, adımlar, hatalar, ipuçları dolu`, v.name.length > 3 && v.summary.length > 10 && v.steps.length >= 3 && v.mistakes.length >= 1 && v.tips.length >= 1);
      check(`${tag}: hedef aralığı geçerli`, v.sets >= 2 && v.min >= 1 && v.max > v.min && v.max <= 30 * (v.unit === 'sec' ? 4 : 1));
      check(`${tag}: poz sayısı etiketle eşleşir`, (v.poses.length === 1 || v.poses.length === 2) && v.poseLabels.length === v.poses.length);
      check(`${tag}: adımlar boş değil`, v.steps.every((s) => s.trim().length > 5));
    }
  }
  check('tutuş hareketleri saniye, diğerleri tekrar', EXERCISES.every((m) => m.variants.every((v) => (m.id === 'core') === (v.unit === 'sec'))));
  check('bacak hareketleri her taraf ayrı', EXERCISE_BY_ID.legs.variants.every((v) => v.perSide));
  check('program kuralları var', PRINCIPLES.length >= 4);
  check('her hareket 3 set', EXERCISES.every((m) => m.variants.every((v) => v.sets === 3)));
  check('güvenlik: masa ve sandalye uyarısı yazılı', EXERCISE_BY_ID.pull.variants[0].tips.some((t) => t.includes('sağlam')));

  console.log('Çizimler');
  let poseCount = 0;
  for (const m of EXERCISES) {
    for (const v of m.variants) {
      v.poses.forEach((pose, i) => {
        poseCount += 1;
        const f = buildFigure(pose);
        const tag = `${m.title} ${LEVEL_NAMES[v.level]} ${v.poseLabels[i]}`;
        check(`${tag}: tüm uzuvlar hedefe yetişiyor`, f.warnings.length === 0, f.warnings.join('; '));
        const b = figureBounds(f);
        check(`${tag}: çizim kutunun içinde`, b.minX >= 0 && b.maxX <= VIEW_W && b.minY >= 0 && b.maxY <= VIEW_H, JSON.stringify(b));
        const torso = dist(pose.hip[0], pose.hip[1], pose.neck[0], pose.neck[1]);
        check(`${tag}: gövde uzunluğu makul`, torso >= TORSO - 3 && torso <= TORSO + 3, `torso=${torso.toFixed(1)}`);
        check(`${tag}: yerin altına inmiyor`, b.maxY <= GROUND_Y + 1.5, `maxY=${b.maxY}`);
        check(`${tag}: baş dairesi var`, f.head.r === HEAD_R && f.segs.filter((s) => s.tone === 'ground').length === 1);
      });
    }
  }
  check('toplam 27 poz', poseCount === 27, String(poseCount));

  console.log('Durum okuma ve yazma');
  const d0 = defaultState();
  check('varsayılan: tüm hareketler kolay basamakta, seans yok', EXERCISES.every((m) => d0.levels[m.id] === 1) && d0.sessions.length === 0);
  check('boş ve bozuk metin varsayılana düşer', JSON.stringify(parseState(null)) === JSON.stringify(d0) && JSON.stringify(parseState('{bozuk')) === JSON.stringify(d0) && JSON.stringify(parseState('42')) === JSON.stringify(d0));
  const mixed = parseState(
    JSON.stringify({
      levels: { legs: 3, push: 9, pull: 'x', hinge: 2 },
      sessions: [
        { day: 'bozuk', items: [] },
        { day: day(10), items: [{ move: 'legs', level: 2, sets: [5, 5, '4', -1, 4.4] }, { move: 'yok', level: 1, sets: [1] }, { move: 'push', level: 7, sets: [1] }] },
        'x',
      ],
    })
  );
  check('geçerli basamaklar okunur, geçersizler 1 kalır', mixed.levels.legs === 3 && mixed.levels.push === 1 && mixed.levels.pull === 1 && mixed.levels.hinge === 2 && mixed.levels.core === 1);
  check('bozuk seans satırları atılır', mixed.sessions.length === 1 && mixed.sessions[0].items.length === 1);
  check('geçersiz set sayıları süzülür', JSON.stringify(mixed.sessions[0].items[0].sets) === JSON.stringify([5, 5, 4]));
  const round = parseState(serializeState(mixed));
  check('yaz-oku turu aynı sonucu verir', JSON.stringify(round) === JSON.stringify(mixed));
  const many = { ...d0, sessions: Array.from({ length: 80 }, (_, i) => ({ day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, items: [{ move: 'legs' as MoveId, level: 1 as Level, sets: [3] }] })) };
  check('en fazla 60 seans saklanır', parseState(serializeState(many)).sessions.length === 60);

  console.log('Basamak atlama');
  const legs1 = variantFor('legs', 1);
  check('tüm setler üst sınırda: atlar', qualifiesForLevelUp(legs1, [5, 5, 5]));
  check('bir set eksik: atlamaz', !qualifiesForLevelUp(legs1, [5, 5]));
  check('bir set alt sınırda: atlamaz', !qualifiesForLevelUp(legs1, [5, 5, 4]));
  check('fazla set yapıldıysa atlar', qualifiesForLevelUp(legs1, [5, 5, 5, 5]));
  const r1 = recordSession(d0, day(10), [{ move: 'legs', level: 1, sets: [5, 5, 5] }]);
  check('bacak kolaydan ortaya geçti', r1.state.levels.legs === 2 && r1.levelUps.length === 1 && r1.levelUps[0].from === 1 && r1.levelUps[0].to === 2);
  check('diğer hareketler değişmedi', r1.state.levels.push === 1 && r1.state.levels.core === 1);
  const r2 = recordSession(d0, day(10), [{ move: 'legs', level: 1, sets: [4, 4, 4] }]);
  check('hedefin altında: basamak aynı', r2.state.levels.legs === 1 && r2.levelUps.length === 0);
  const r3 = recordSession(setLevel(d0, 'legs', 3), day(10), [{ move: 'legs', level: 3, sets: [5, 5, 5] }]);
  check('zor basamak en üst: daha öteye geçmez', r3.state.levels.legs === 3 && r3.levelUps.length === 0);
  const r4 = recordSession(setLevel(d0, 'legs', 2), day(10), [{ move: 'legs', level: 1, sets: [5, 5, 5] }]);
  check('eski basamakta yapılan çalışma basamak atlatmaz', r4.state.levels.legs === 2 && r4.levelUps.length === 0);
  const r5 = recordSession(d0, day(10), [{ move: 'core', level: 1, sets: [20, 20, 20] }]);
  check('karın tutuşu: 3 set x 20 sn ile atlar', r5.state.levels.core === 2);
  const r6 = recordSession(d0, day(10), []);
  check('boş seans kaydedilmez', r6.state === d0 && r6.levelUps.length === 0);
  const r7 = recordSession(d0, day(10), [{ move: 'push', level: 1, sets: [] }]);
  check('seti olmayan hareket atlanır', r7.state === d0);
  check('giriş durumu değişmez (saf)', d0.sessions.length === 0 && d0.levels.legs === 1);

  console.log('Seans geçmişi');
  let st = defaultState();
  st = recordSession(st, day(12), [{ move: 'legs', level: 1, sets: [3, 3] }]).state;
  st = recordSession(st, day(10), [{ move: 'push', level: 1, sets: [4] }]).state;
  check('seanslar tarihe göre sıralı', st.sessions.map((s) => s.day).join() === `${day(10)},${day(12)}`);
  st = recordSession(st, day(12), [{ move: 'pull', level: 1, sets: [3] }, { move: 'legs', level: 1, sets: [5, 4] }]).state;
  check('aynı güne ikinci kayıt birleşir', st.sessions.length === 2 && st.sessions[1].items.length === 2);
  check('aynı hareketin son sonucu geçerli', JSON.stringify(lastResult(st, 'legs')?.item.sets) === JSON.stringify([5, 4]));
  check('hiç yapılmamış hareket için sonuç yok', lastResult(st, 'core') === null);
  check('seans özeti', sessionSummary(st.sessions[1]) === '2 hareket, 3 set', sessionSummary(st.sessions[1]));
  check('set satırı tekrar', setsLine(variantFor('legs', 1), [5, 5, 4]) === '5-5-4');
  check('set satırı saniye', setsLine(variantFor('core', 1), [20, 18]) === '20-18 sn');
  check('boş set satırı', setsLine(variantFor('legs', 1), []) === '-');
  check('hedef satırı tekrar, her taraf', targetLine(variantFor('legs', 1)) === '3 set x 3-5 tekrar (her taraf)', targetLine(variantFor('legs', 1)));
  check('hedef satırı saniye', targetLine(variantFor('core', 1)) === '3 set x 10-20 sn', targetLine(variantFor('core', 1)));

  console.log('Hafta sayısı ve öneri');
  check('hafta Pazartesi başlar (Çarşamba)', weekStartKey(at(18)) === day(16));
  check('hafta Pazartesi başlar (Pazar)', weekStartKey(at(22)) === day(16));
  check('hafta Pazartesi başlar (Pazartesi)', weekStartKey(at(16)) === day(16));
  let wk = defaultState();
  for (const d of [16, 18, 18, 22, 23]) wk = recordSession(wk, day(d), [{ move: 'legs', level: 1, sets: [3] }]).state;
  check('Pzt-Paz arası aynı gün bir kez sayılır (16, 18, 22)', sessionsThisWeek(wk, at(22)) === 3);
  check('sonraki hafta ayrı sayılır', sessionsThisWeek(wk, at(23)) === 1);
  check('önceki hafta sayılmaz', sessionsThisWeek(wk, at(11)) === 0);
  check('son seanstan bu yana gün', daysSinceLast(wk, at(25)) === 2 && daysSinceLast(wk, at(23)) === 0 && daysSinceLast(defaultState(), at(23)) === null);
  // 2026-11-16 Pazartesi; varsayılan program Pzt-Çar-Cum, 06:00
  check('öneri: egzersiz günü, henüz yapılmadı', todayAdvice(defaultState(), at(23)) === 'Bugün egzersiz günü: 06:00–06:30. Hazır olunca seansı başlat.', todayAdvice(defaultState(), at(23)));
  check('öneri: bugün yapıldı', todayAdvice(wk, at(23)).includes('tamam'));
  check('öneri: dinlenme günü, sonraki yarın', todayAdvice(defaultState(), at(24)) === 'Bugün dinlenme günü. Sonraki egzersiz: yarın 06:00.', todayAdvice(defaultState(), at(24)));
  check('öneri: Cumartesi, sonraki Pazartesi', todayAdvice(defaultState(), at(28)) === 'Bugün dinlenme günü. Sonraki egzersiz: Pazartesi 06:00.', todayAdvice(defaultState(), at(28)));
  check('program satırı: hafta sayısı ve bugün yapıldı', tileLine(wk, at(23)) === 'Pzt Çar Cum · 06:00–06:30 · bu hafta 1/3 · bugün yapıldı', tileLine(wk, at(23)));
  check('program satırı: bugün yapılmadıysa', tileLine(wk, at(24)) === 'Pzt Çar Cum · 06:00–06:30 · bu hafta 1/3', tileLine(wk, at(24)));

  console.log('Program: günler, güne başlama saati, hatırlatma');
  check('varsayılan program: Pzt-Çar-Cum, 06:00, hatırlatma açık', JSON.stringify(d0.plan) === JSON.stringify({ days: [1, 3, 5], startMin: 360, remind: true }));
  check('eski kayıt (programsız) varsayılan programı alır', JSON.stringify(parseState(JSON.stringify({ v: 1, levels: { legs: 2 }, sessions: [] })).plan) === JSON.stringify(d0.plan));
  const badPlan = parseState(JSON.stringify({ plan: { days: [3, 3, 1, 9, -1, 'x', 2.5], startMin: 9999, remind: 'evet' } }));
  check('bozuk gün listesi süzülür, sıralanır, tekrar atılır', JSON.stringify(badPlan.plan.days) === JSON.stringify([1, 3]));
  check('geçersiz saat ve hatırlatma varsayılana düşer', badPlan.plan.startMin === 360 && badPlan.plan.remind === true);
  check('hiç geçerli gün yoksa varsayılan günler', JSON.stringify(parseState(JSON.stringify({ plan: { days: [] } })).plan.days) === JSON.stringify([1, 3, 5]));
  const custom = setRemind(setStart(toggleDay(d0, 6), 330), false);
  check('gün eklenir ve sıralı kalır', JSON.stringify(custom.plan.days) === JSON.stringify([1, 3, 5, 6]));
  check('gün çıkarılır', JSON.stringify(toggleDay(custom, 3).plan.days) === JSON.stringify([1, 5, 6]));
  check('son gün çıkarılamaz (en az bir gün)', JSON.stringify(toggleDay(toggleDay(toggleDay(d0, 1), 3), 5).plan.days) === JSON.stringify([5]));
  check('güne başlama saati ve hatırlatma değişir', custom.plan.startMin === 330 && custom.plan.remind === false);
  check('geçersiz saat reddedilir', setStart(d0, 30) === d0 && setStart(d0, 9999) === d0);
  check('yaz-oku turunda program korunur', JSON.stringify(parseState(serializeState(custom)).plan) === JSON.stringify(custom.plan));
  check('seans kaydı programı korur', JSON.stringify(recordSession(custom, day(23), [{ move: 'legs', level: 1, sets: [3] }]).state.plan) === JSON.stringify(custom.plan));
  check('basamak seçmek programı korur', JSON.stringify(setLevel(custom, 'legs', 2).plan) === JSON.stringify(custom.plan));
  check('pencere metni varsayılan', windowText(d0.plan) === '06:00–06:30');
  check('pencere metni 05:30', windowText(custom.plan) === '05:30–06:00');
  check('saat metni gece yarısını aşınca sarar', clock(1500) === '01:00' && clock(-30) === '23:30' && clock(0) === '00:00');
  check('saat seçenekleri 05:00-07:00 arası, 06:00 dahil', START_CHOICES.includes(360) && Math.min(...START_CHOICES) === 300 && Math.max(...START_CHOICES) === 420);
  check('gün kısaltmaları', DAY_SHORT[0] === 'Paz' && DAY_SHORT[1] === 'Pzt' && DAY_SHORT[6] === 'Cmt');
  check('egzersiz günü kontrolü', isExerciseDay(d0.plan, at(23)) && !isExerciseDay(d0.plan, at(24)) && isExerciseDay(d0.plan, at(27)));
  check('sonraki egzersiz günü: Cumartesi -> Pazartesi', nextExerciseDay(d0.plan, at(28)).offset === 2 && nextExerciseDay(d0.plan, at(28)).date.getDay() === 1);
  check('sonraki egzersiz günü: bugün sayılmaz', nextExerciseDay(d0.plan, at(23)).offset === 2);
  check('sonraki egzersiz günü: Cuma -> Pazartesi 3 gün', nextExerciseDay(d0.plan, at(27)).offset === 3);

  console.log('Sabah kartı (ana ekran)');
  const cardOn = morningCard(d0, at(23, 6));
  check('egzersiz günü 06:00: yapılacak kartı', cardOn !== null && cardOn.kind === 'TODO' && cardOn.title === 'Sabah egzersizi · 06:00–06:30', JSON.stringify(cardOn));
  check('kart açıklaması süreyi söyler', cardOn !== null && /yaklaşık \d+ dk/.test(cardOn.sub));
  check('05:00\'dan önce kart yok', morningCard(d0, at(23, 4)) === null);
  check('öğleden sonra kart yok (menüde de yok)', morningCard(d0, at(23, 12)) === null && morningCard(d0, at(23, 18)) === null);
  check('dinlenme gününde kart yok', morningCard(d0, at(24, 6)) === null);
  check('yapıldıysa tamam kartı', morningCard(wk, at(23, 7))?.kind === 'DONE');
  check('zor gün modunda yapılmamış kart gizlenir', morningCard(d0, at(23, 6), true) === null);
  check('zor günde yapılmış tamam kartı kalır', morningCard(wk, at(23, 7), true)?.kind === 'DONE');
  check('özel program: Cumartesi eklenince kart çıkar', morningCard(custom, at(21, 6))?.kind === 'TODO');

  console.log('Seans: 30 dakika, dönüşümlü bloklar');
  const flat = SESSION_BLOCKS.flat();
  check('bloklar 5 hareketi birer kez kapsar', flat.length === 5 && new Set(flat).size === 5 && EXERCISES.every((m) => flat.includes(m.id)));
  check('ilk iki blokta ikişer karşıt hareket, son blokta karın', SESSION_BLOCKS[0].length === 2 && SESSION_BLOCKS[1].length === 2 && SESSION_BLOCKS[2].length === 1 && SESSION_BLOCKS[2][0] === 'core');
  check('ısınma adımları var', WARMUP_STEPS.length >= 3 && WARMUP_STEPS.every((w) => w.trim().length > 10));
  check('dinlenme seçenekleri 60 sn - 3 dk, varsayılan 60', REST_CHOICES[0] === 60 && REST_CHOICES[REST_CHOICES.length - 1] === 180 && ALT_REST_SECONDS === 60);
  const est60 = estimateMinutes(d0.levels);
  const est180 = estimateMinutes(d0.levels, 180);
  check('kolay basamakta 60 sn dinlenmeyle seans 30 dakikaya sığar', est60 <= SESSION_MINUTES && est60 >= 15, String(est60));
  check('3 dakika dinlenmeyle sığmaz (bu yüzden dönüşümlü)', est180 > SESSION_MINUTES, String(est180));
  const hard = { ...d0.levels, legs: 3 as Level, push: 3 as Level, pull: 3 as Level, hinge: 3 as Level, core: 3 as Level };
  check('en zor basamakta tahmin hâlâ makul (en çok 35 dk)', estimateMinutes(hard) <= 35, String(estimateMinutes(hard)));
  check('süre tahmini dinlenmeyle artar', estimateMinutes(d0.levels, 90) > est60);

  console.log('Alarm (Saat uygulaması)');
  const ax = alarmExtras(360);
  check('alarm: saat 6, dakika 0, mesaj', ax.length === 3 && ax[0].key === 'android.intent.extra.alarm.HOUR' && ax[0].value === 6 && ax[1].key === 'android.intent.extra.alarm.MINUTES' && ax[1].value === 0 && ax[2].key === 'android.intent.extra.alarm.MESSAGE' && ax[2].value === 'Sabah egzersizi');
  const ax2 = alarmExtras(345);
  check('alarm: 05:45', ax2[0].value === 5 && ax2[1].value === 45);
  const ax3 = alarmExtras(1500, 'Test');
  check('alarm: gün sonunu aşan dakika sarar ve mesaj değişir', ax3[0].value === 1 && ax3[1].value === 0 && ax3[2].value === 'Test');
  check('alarm saati programın güne başlama saatini izler', alarmExtras(custom.plan.startMin)[0].value === 5 && alarmExtras(custom.plan.startMin)[1].value === 30);

  console.log('Bildirim planı');
  const planEx = (now: Date, ex: Parameters<typeof planReminders>[4], days = 8) => planReminders([], now, days, 60, { review: false, ...ex });
  const exOf = (list: ReturnType<typeof planReminders>) => list.filter((p) => p.id.includes('exercise'));
  const base = { days: [1, 3, 5], startMin: 360, doneToday: false };
  check('program yoksa egzersiz bildirimi yok', exOf(planEx(at(22, 20), {})).length === 0 && exOf(planEx(at(22, 20), { exercise: null })).length === 0);
  const exList = exOf(planEx(at(22, 20), { exercise: base }));
  check('8 günlük pencerede Pzt, Çar, Cum günleri: 23, 25, 27', exList.map((p) => p.at.getDate()).join() === '23,25,27', exList.map((p) => p.at.getDate()).join());
  check('bildirim güne başlama saatinde (06:00)', exList.every((p) => p.at.getHours() === 6 && p.at.getMinutes() === 0));
  check('dokununca seans açılır', exList.every((p) => p.route === '/exercise-run'));
  check('yüksek öncelikli kanal işareti', exList.every((p) => p.urgent === true));
  check('başlık ve gövde pencereyi söyler', exList[0].title === 'Sabah egzersizi' && exList[0].body.includes('06:00–06:30'));
  check('kimlikler benzersiz', new Set(exList.map((p) => p.id)).size === exList.length);
  const late = exOf(planEx(at(23, 6), { exercise: base }));
  check('saati geçmiş bugünün bildirimi yok (06:00 = şimdi dahil değil)', late.every((p) => p.at.getDate() !== 23));
  const early = exOf(planEx(at(23, 5), { exercise: base }));
  check('bugün henüz 06:00 olmadıysa bugünün bildirimi var', early[0].at.getDate() === 23);
  check('bugün yapıldıysa bugünün bildirimi yok', exOf(planEx(at(23, 5), { exercise: { ...base, doneToday: true } })).every((p) => p.at.getDate() !== 23));
  check('zor gün modunda bugünün bildirimi yok', exOf(planEx(at(23, 5), { exercise: base, hardDayToday: true })).every((p) => p.at.getDate() !== 23));
  const shifted = exOf(planEx(at(22, 20), { exercise: { ...base, startMin: 330 } }));
  check('güne başlama saati 05:30 olunca bildirim 05:30', shifted.length > 0 && shifted.every((p) => p.at.getHours() === 5 && p.at.getMinutes() === 30));
  check('günler değişince bildirim günleri değişir', exOf(planEx(at(22, 20), { exercise: { ...base, days: [6] } })).map((p) => p.at.getDate()).join() === '28');

  console.log('Günü değerlendirme için gerçekler');
  const withSession = recordSession(d0, day(23), [{ move: 'legs', level: 1, sets: [5, 5, 4] }, { move: 'core', level: 1, sets: [20, 20, 15] }]).state;
  const fx = exerciseDayFacts(withSession, at(23));
  check('yapıldı: planlı gün ve seans var', fx.planned && fx.done && fx.items.length === 2 && fx.window === '06:00–06:30' && fx.startMin === 360);
  check('hareket adları ve setler', fx.items[0].title === 'Bacak' && fx.items[0].name === variantFor('legs', 1).name && JSON.stringify(fx.items[0].sets) === JSON.stringify([5, 5, 4]), JSON.stringify(fx.items[0]));
  const fxNo = exerciseDayFacts(d0, at(23));
  check('planlı ama yapılmadı', fxNo.planned && !fxNo.done && fxNo.items.length === 0);
  const fxRest = exerciseDayFacts(d0, at(24));
  check('dinlenme günü: planlı değil', !fxRest.planned && !fxRest.done);

  console.log('Veritabanı (Setting tablosu)');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const empty = await loadExercise(db);
  check('boş veritabanında varsayılan durum', empty.sessions.length === 0 && empty.levels.legs === 1);
  const saved = await saveExerciseSession(db, [{ move: 'legs', level: 1, sets: [5, 5, 5] }, { move: 'core', level: 1, sets: [20, 20, 20] }], at(23));
  check('kayıt: iki basamak atladı', saved.levelUps.length === 2 && saved.state.levels.legs === 2 && saved.state.levels.core === 2);
  const reloaded = await loadExercise(db);
  check('yeniden yükleyince aynı durum', JSON.stringify(reloaded) === JSON.stringify(saved.state));
  check('Setting tablosunda tek satır', Number((raw.prepare('SELECT COUNT(*) AS c FROM Setting WHERE key = ?').get(EXERCISE_KEY) as { c: number }).c) === 1);
  const none = await saveExerciseSession(db, [{ move: 'push', level: 1, sets: [] }], at(24));
  check('boş seans veritabanını değiştirmez', JSON.stringify(none.state) === JSON.stringify(saved.state) && (await loadExercise(db)).sessions.length === 1);
  const chosen = await chooseExerciseLevel(db, 'pull', 3);
  check('basamağı elle seçmek kaydedilir', chosen.levels.pull === 3 && (await loadExercise(db)).levels.pull === 3);
  check('seans geçmişi elle seçimle silinmez', (await loadExercise(db)).sessions.length === 1);
  const planned = await updateExercise(db, (st0) => setStart(toggleDay(st0, 6), 345));
  check('program kaydedilir: Cumartesi eklendi, 05:45', JSON.stringify(planned.plan.days) === JSON.stringify([1, 3, 5, 6]) && planned.plan.startMin === 345);
  const planReload = await loadExercise(db);
  check('program yeniden yüklenince korunur, seanslar ve basamaklar da', planReload.plan.startMin === 345 && planReload.sessions.length === 1 && planReload.levels.pull === 3);
  const afterSave = await saveExerciseSession(db, [{ move: 'push', level: 1, sets: [3] }], at(25));
  check('seans kaydı programı bozmaz', afterSave.state.plan.startMin === 345 && afterSave.state.plan.days.length === 4);
  check('yedek, Setting tablosunu içerir (egzersiz yedeğe dahil)', (BACKUP_TABLES as readonly string[]).includes('Setting'));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
