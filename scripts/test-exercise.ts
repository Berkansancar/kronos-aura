/**
 * Egzersiz bölümü testi: çizim geometrisi, içerik bütünlüğü, basamak atlama, seans kaydı, hafta sayısı, kayıt ve yedek.
 * Çalıştırmak için:  npm run test:exercise
 */
import { migrateDbIfNeeded } from '../database/schema';
import { BACKUP_TABLES } from '../services/backupLogic';
import { chooseExerciseLevel, loadExercise, saveExerciseSession } from '../services/exercise';
import { EXERCISES, EXERCISE_BY_ID, LEVEL_NAMES, PRINCIPLES, SESSIONS_PER_WEEK, type Level, type MoveId } from '../services/exerciseData';
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
  EXERCISE_KEY,
  daysSinceLast,
  defaultState,
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
  check('program kuralları var', PRINCIPLES.length >= 4 && SESSIONS_PER_WEEK === 3);
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
  check('tüm setler üst sınırda: atlar', qualifiesForLevelUp(legs1, [5, 5, 5, 5]));
  check('bir set eksik: atlamaz', !qualifiesForLevelUp(legs1, [5, 5, 5]));
  check('bir set alt sınırda: atlamaz', !qualifiesForLevelUp(legs1, [5, 5, 5, 4]));
  check('fazla set yapıldıysa atlar', qualifiesForLevelUp(legs1, [5, 5, 5, 5, 5]));
  const r1 = recordSession(d0, day(10), [{ move: 'legs', level: 1, sets: [5, 5, 5, 5] }]);
  check('bacak kolaydan ortaya geçti', r1.state.levels.legs === 2 && r1.levelUps.length === 1 && r1.levelUps[0].from === 1 && r1.levelUps[0].to === 2);
  check('diğer hareketler değişmedi', r1.state.levels.push === 1 && r1.state.levels.core === 1);
  const r2 = recordSession(d0, day(10), [{ move: 'legs', level: 1, sets: [4, 4, 4, 4] }]);
  check('hedefin altında: basamak aynı', r2.state.levels.legs === 1 && r2.levelUps.length === 0);
  const r3 = recordSession(setLevel(d0, 'legs', 3), day(10), [{ move: 'legs', level: 3, sets: [5, 5, 5, 5] }]);
  check('zor basamak en üst: daha öteye geçmez', r3.state.levels.legs === 3 && r3.levelUps.length === 0);
  const r4 = recordSession(setLevel(d0, 'legs', 2), day(10), [{ move: 'legs', level: 1, sets: [5, 5, 5, 5] }]);
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
  check('hedef satırı tekrar, her taraf', targetLine(variantFor('legs', 1)) === '4 set x 3-5 tekrar (her taraf)', targetLine(variantFor('legs', 1)));
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
  check('öneri: ilk seans', todayAdvice(defaultState(), at(23)).includes('İlk seans'));
  check('öneri: bugün yapıldı', todayAdvice(wk, at(23)).includes('tamam'));
  check('öneri: dün çalıştı, dinlen', todayAdvice(wk, at(24)).includes('dinlen'));
  check('öneri: dinlendi, seans yapabilir', todayAdvice(wk, at(26)).includes('seans yapabilirsin'));
  check('ana ekran satırı: hiç seans yokken tanıtım', tileLine(defaultState(), at(23)).includes('çizimli'));
  check('ana ekran satırı: hafta sayısı', tileLine(wk, at(23)) === 'Bu hafta 1/3 seans · bugün yapıldı', tileLine(wk, at(23)));
  check('ana ekran satırı: bugün yapılmadıysa', tileLine(wk, at(24)) === 'Bu hafta 1/3 seans', tileLine(wk, at(24)));

  console.log('Veritabanı (Setting tablosu)');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const empty = await loadExercise(db);
  check('boş veritabanında varsayılan durum', empty.sessions.length === 0 && empty.levels.legs === 1);
  const saved = await saveExerciseSession(db, [{ move: 'legs', level: 1, sets: [5, 5, 5, 5] }, { move: 'core', level: 1, sets: [20, 20, 20] }], at(23));
  check('kayıt: iki basamak atladı', saved.levelUps.length === 2 && saved.state.levels.legs === 2 && saved.state.levels.core === 2);
  const reloaded = await loadExercise(db);
  check('yeniden yükleyince aynı durum', JSON.stringify(reloaded) === JSON.stringify(saved.state));
  check('Setting tablosunda tek satır', Number((raw.prepare('SELECT COUNT(*) AS c FROM Setting WHERE key = ?').get(EXERCISE_KEY) as { c: number }).c) === 1);
  const none = await saveExerciseSession(db, [{ move: 'push', level: 1, sets: [] }], at(24));
  check('boş seans veritabanını değiştirmez', JSON.stringify(none.state) === JSON.stringify(saved.state) && (await loadExercise(db)).sessions.length === 1);
  const chosen = await chooseExerciseLevel(db, 'pull', 3);
  check('basamağı elle seçmek kaydedilir', chosen.levels.pull === 3 && (await loadExercise(db)).levels.pull === 3);
  check('seans geçmişi elle seçimle silinmez', (await loadExercise(db)).sessions.length === 1);
  check('yedek, Setting tablosunu içerir (egzersiz yedeğe dahil)', (BACKUP_TABLES as readonly string[]).includes('Setting'));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
