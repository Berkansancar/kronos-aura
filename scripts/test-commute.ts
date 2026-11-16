/**
 * Yolda yapılabilir işler, günün özet satırı, yedek hatırlatması ve veritabanı v9.
 * Çalıştırmak için:  npm run test:commute
 */
import { addDayEvent, createTask, getTask, setSetting } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import type { DayEvent, Task } from '../database/types';
import { loadTypicalCommute } from '../services/commute';
import {
  COMMUTE_MAX_MINUTES,
  DEFAULT_COMMUTE_MINUTES,
  commuteLine,
  commuteState,
  commuteSuggestions,
  remainingMinutes,
  typicalCommuteMinutes,
} from '../services/commuteLogic';
import { backupNudge, createBackup, restoreBackup } from '../services/backupLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { loadBackupNudge, snoozeBackupNudge } from '../services/backupNudge';
import { updateTaskDetails } from '../services/taskFlow';
import { todayLine } from '../services/todayLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const ev = (kind: DayEvent['kind'], when: Date, id = kind + when.getTime()): DayEvent => ({
  id,
  day: `2026-11-${String(when.getDate()).padStart(2, '0')}`,
  kind,
  at: when.toISOString(),
});
const task = (o: Partial<Task> & { id: string }): Task => ({
  title: o.id,
  estimatedDuration: 15,
  cognitiveWeight: 'LOW',
  status: 'PENDING',
  createdAt: '2026-11-16T05:00:00.000Z',
  startedAt: null,
  routineId: null,
  workOk: false,
  commuteOk: false,
  ...o,
});

async function main(): Promise<void> {
  console.log('Yolda mı?');
  const morning = [ev('WAKE', at(7, 0)), ev('SHOWER', at(7, 20)), ev('BUS', at(8, 0))];
  let s = commuteState(morning, at(8, 12));
  check('minibüse bindi, dükkana gidiyor', s.onBus && s.direction === 'TO_WORK' && s.elapsedMinutes === 12);
  check('dükkana vardıysa yolda değil', !commuteState([...morning, ev('SHOP_IN', at(8, 40))], at(8, 41)).onBus);
  const evening = [...morning, ev('SHOP_IN', at(8, 40)), ev('SHOP_OUT', at(18, 0)), ev('BUS', at(18, 10))];
  s = commuteState(evening, at(18, 25));
  check('dükkandan sonra minibüs: eve gidiyor', s.onBus && s.direction === 'HOME' && s.elapsedMinutes === 15);
  check('eve geldiyse yolda değil', !commuteState([...evening, ev('HOME', at(18, 50))], at(19, 0)).onBus);
  check('damga çok eskiyse (unutulmuş) yolda sayılmaz', !commuteState(morning, at(8 + Math.ceil((COMMUTE_MAX_MINUTES + 1) / 60), 5)).onBus && !commuteState([], at(9)).onBus);
  check('gelecekteki damga yolda sayılmaz', !commuteState(morning, at(7, 30)).onBus);

  console.log('Tipik yol süresi');
  check('ortanca, 5 dakikaya yuvarlanır', typicalCommuteMinutes([28, 33, 31, 40, 29]) === 30);
  check('en az 3 örnek gerekir', typicalCommuteMinutes([30, 30]) === null && typicalCommuteMinutes([]) === null);
  check('saçma değerler (0, 500, NaN) atlanır', typicalCommuteMinutes([0, 500, NaN, 20, 22, 21]) === 20);
  check('kalan süre: tipik süre eksi geçen, en az 10', remainingMinutes({ onBus: true, direction: 'TO_WORK', startedAt: at(8), elapsedMinutes: 12 }, 30) === 18 &&
    remainingMinutes({ onBus: true, direction: 'TO_WORK', startedAt: at(8), elapsedMinutes: 50 }, 30) === 10 &&
    remainingMinutes({ onBus: true, direction: 'TO_WORK', startedAt: at(8), elapsedMinutes: 5 }, null) === DEFAULT_COMMUTE_MINUTES - 5);
  check('kart satırı', commuteLine({ onBus: true, direction: 'HOME', startedAt: at(8), elapsedMinutes: 12 }, 30) === 'Yolun ≈ 30 dk · 12 dk oldu' &&
    commuteLine({ onBus: true, direction: 'HOME', startedAt: at(8), elapsedMinutes: 12 }, null) === '12 dk oldu');

  console.log('Öneriler');
  const tasks = [
    task({ id: 'hafif15', estimatedDuration: 15 }),
    task({ id: 'isaretli10', estimatedDuration: 10, commuteOk: true, cognitiveWeight: 'MEDIUM' }),
    task({ id: 'isaretli20', estimatedDuration: 20, commuteOk: true }),
    task({ id: 'derin', estimatedDuration: 10, cognitiveWeight: 'HIGH' }),
    task({ id: 'uzun', estimatedDuration: 90, commuteOk: true }),
    task({ id: 'ertelenmis', estimatedDuration: 5, commuteOk: true, status: 'POSTPONED' }),
    task({ id: 'bitmis', estimatedDuration: 5, commuteOk: true, status: 'COMPLETED' }),
  ];
  let sug = commuteSuggestions(tasks, 30, 'TO_WORK', 0);
  check('önce işaretliler (uzun olan önce), süreler yolu aşmaz', sug.map((x) => x.taskId).join() === 'isaretli20,isaretli10' && sug.every((x) => x.kind === 'TASK') && sug.reduce((a, x) => a + x.minutes, 0) <= 30, JSON.stringify(sug));
  sug = commuteSuggestions(tasks, 45, 'TO_WORK', 0);
  check('yer varsa işaretsiz hafif iş de eklenir; derin odak, ertelenmiş, biten, yola sığmayan eklenmez', sug.map((x) => x.taskId).join() === 'isaretli20,isaretli10,hafif15', JSON.stringify(sug));
  check('en fazla 3 öneri (yol uzunsa ilk üçü: işaretliler, uzun olan önce)', commuteSuggestions(tasks, 200, 'TO_WORK', 0).map((x) => x.taskId).join() === 'uzun,isaretli20,isaretli10');
  const none = commuteSuggestions([task({ id: 'derin', cognitiveWeight: 'HIGH' })], 30, 'HOME', 1);
  check('uygun iş yoksa iki kısa fikir (eve giderken akşam fikirleri)', none.length === 2 && none.every((x) => x.kind === 'IDEA' && x.taskId === null && x.minutes === 5) && none[0].title !== none[1].title);
  const a = commuteSuggestions([], 30, 'TO_WORK', 0)[0].title;
  const b = commuteSuggestions([], 30, 'TO_WORK', 1)[0].title;
  check('fikirler tohumla döner', a !== b);
  const all = [0, 1, 2, 3].flatMap((i) => [...commuteSuggestions([], 30, 'TO_WORK', i), ...commuteSuggestions([], 30, 'HOME', i)]);
  check('fikirlerde yargı sözcüğü yok', all.every((x) => !hasBannedWords(x.title)));

  console.log('Günün özet satırı');
  check('tam özet', todayLine({ done: 3, open: 2, waterMl: 1200, waterGoalMl: 2000, smoke: 4, smokeLimit: 10 }) === '3 iş bitti, 2 açık · su 1,2 L / 2,0 L · sigara 4/10');
  check('yalnızca açık işler, sigara sınırı yok', todayLine({ done: 0, open: 3, waterMl: 0, waterGoalMl: 2000, smoke: 2, smokeLimit: null }) === '3 açık iş · su 0 ml / 2,0 L · sigara 2');
  check('hiçbiri yoksa null; sigara 0 yazılmaz', todayLine({ done: 0, open: 0, waterMl: null, waterGoalMl: null, smoke: 0, smokeLimit: 10 }) === null);

  console.log('Yedek hatırlatması');
  const now = at(12, 0);
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  check('az kayıt: hatırlatma yok', backupNudge({ lastBackup: null, snoozeUntil: null, now, records: 10 }) === null);
  check('hiç yedek yok ve yeterince kayıt var', /yalnızca bu telefonda/.test(backupNudge({ lastBackup: null, snoozeUntil: null, now, records: 40 }) ?? ''));
  check('yedek yeniyse yok', backupNudge({ lastBackup: days(3), snoozeUntil: null, now, records: 400 }) === null);
  check('14 gün sonra gün sayısıyla hatırlatır', backupNudge({ lastBackup: days(20), snoozeUntil: null, now, records: 400 }) === 'Son yedeğin 20 gün önce. Yeni bir yedek alalım mı?');
  check('"şimdi değil" sessizlik süresince yok', backupNudge({ lastBackup: null, snoozeUntil: new Date(now.getTime() + 3600_000), now, records: 400 }) === null);
  check('sessizlik bitince yine gelir', backupNudge({ lastBackup: null, snoozeUntil: new Date(now.getTime() - 3600_000), now, records: 400 }) !== null);

  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('temiz kurulum sürüm 9', (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 9 && DATABASE_VERSION === 9);
  const t = await createTask(db, { title: 'Mesaj yaz', estimatedDuration: 10, cognitiveWeight: 'LOW', commuteOk: true });
  const plain = await createTask(db, { title: 'Normal', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  check('yolda işareti yazılır ve okunur; varsayılan kapalı', (await getTask(db, t.id))?.commuteOk === true && (await getTask(db, plain.id))?.commuteOk === false);
  await updateTaskDetails(db, t.id, { title: 'Mesaj yaz', estimatedDuration: 10, cognitiveWeight: 'LOW', commuteOk: false }, at(9));
  check('düzenlemede kapatılır', (await getTask(db, t.id))?.commuteOk === false);
  await updateTaskDetails(db, t.id, { title: 'Mesaj yaz', estimatedDuration: 10, cognitiveWeight: 'LOW', commuteOk: true, workOk: true }, at(9));
  await updateTaskDetails(db, t.id, { title: 'Mesaj yaz 2', estimatedDuration: 10, cognitiveWeight: 'LOW' }, at(9));
  const kept = await getTask(db, t.id);
  check('işaret verilmezse iki işaret de korunur', kept?.commuteOk === true && kept.workOk === true);

  // v8 veritabanından yükseltme: eski görevler korunur, işaret kapalı
  const old = makeTestDb();
  await migrateDbIfNeeded(old.db);
  old.raw.exec('ALTER TABLE Task DROP COLUMN commuteOk; PRAGMA user_version = 8;');
  old.raw.prepare("INSERT INTO Task (id,title,estimatedDuration,cognitiveWeight,status,createdAt) VALUES ('eski','Eski görev',30,'LOW','PENDING','2026-11-01T10:00:00.000Z')").run();
  await migrateDbIfNeeded(old.db);
  const up = await getTask(old.db, 'eski');
  check('v8 → v9: görev korunur, yolda işareti kapalı', up?.title === 'Eski görev' && up.commuteOk === false && (old.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 9);

  // v8 yedeği (commuteOk sütunu yok) yeni sürüme yüklenir
  const text = await createBackup(db, {}, at(9));
  const o = JSON.parse(text.split('\n')[2]);
  const ix = o.tables.Task.c.indexOf('commuteOk');
  o.tables.Task.c.splice(ix, 1);
  o.tables.Task.r = o.tables.Task.r.map((row: unknown[]) => row.filter((_: unknown, i: number) => i !== ix));
  o.dbVersion = 8;
  const fresh = makeTestDb();
  await migrateDbIfNeeded(fresh.db);
  const res = await restoreBackup(fresh.db, JSON.stringify(o));
  check('sürüm 8 yedeği yüklenir, yolda işareti kapalı kalır', res.ok && (fresh.raw.prepare('SELECT MAX(commuteOk) AS m FROM Task').get() as { m: number }).m === 0, JSON.stringify(res));
  const full = await restoreBackup(fresh.db, text);
  check('sürüm 9 yedeği işareti korur', full.ok && (await getTask(fresh.db, t.id))?.commuteOk === true);

  console.log('Tipik yol süresi (veritabanı)');
  const d = makeTestDb();
  await migrateDbIfNeeded(d.db);
  check('kayıt yokken null', (await loadTypicalCommute(d.db, at(12))) === null);
  for (const [day, start, shopIn, out, bus2, home] of [
    [12, [8, 0], [8, 30], [18, 0], [18, 10], [18, 45]],
    [13, [8, 5], [8, 40], [18, 0], [18, 5], [18, 35]],
    [14, [8, 0], [8, 30], [18, 0], [18, 10], [18, 40]],
  ] as const) {
    await addDayEvent(d.db, `2026-11-${day}`, 'BUS', at(start[0], start[1], day));
    await addDayEvent(d.db, `2026-11-${day}`, 'SHOP_IN', at(shopIn[0], shopIn[1], day));
    await addDayEvent(d.db, `2026-11-${day}`, 'SHOP_OUT', at(out[0], out[1], day));
    await addDayEvent(d.db, `2026-11-${day}`, 'BUS', at(bus2[0], bus2[1], day));
    await addDayEvent(d.db, `2026-11-${day}`, 'HOME', at(home[0], home[1], day));
  }
  check('3 gün, 6 yolculuktan tipik süre (30, 35, 35, 30, 30, 30 → 30)', (await loadTypicalCommute(d.db, at(12))) === 30);

  console.log('Yedek hatırlatması (veritabanı)');
  const n = makeTestDb();
  await migrateDbIfNeeded(n.db);
  check('boş telefonda hatırlatma yok', (await loadBackupNudge(n.db, now)) === null);
  for (let i = 0; i < 35; i++) {
    n.raw.prepare('INSERT INTO SmokeLog (id,day,at) VALUES (?,?,?)').run(`s${i}`, '2026-11-10', at(10).toISOString());
  }
  check('35 kayıt, hiç yedek yok: hatırlatır', /Bir yedek alalım mı/.test((await loadBackupNudge(n.db, now)) ?? ''));
  await snoozeBackupNudge(n.db, now);
  check('"şimdi değil" bir hafta susturur', (await loadBackupNudge(n.db, now)) === null && (await loadBackupNudge(n.db, new Date(now.getTime() + 8 * 86_400_000))) !== null);
  await setSetting(n.db, 'last_backup', new Date(now.getTime() - 2 * 86_400_000).toISOString());
  check('yeni yedek varsa hatırlatma yok', (await loadBackupNudge(n.db, new Date(now.getTime() + 8 * 86_400_000))) === null);
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
