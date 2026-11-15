/**
 * Zor gün modu testi (saf mantık + gerçek SQLite). Çalıştırmak için:  npm run test:hardday
 */
import {
  createTask,
  getTask,
  isHardDay,
  listDayBlocks,
  listVisibleTasks,
  setHardDay,
} from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import type { Task } from '../database/types';
import { describeSituation } from '../services/ai/coachAI';
import { getAuraMessage, getKronosMessage, type CoachContext } from '../services/coachEngine';
import { dayKey } from '../services/activityLogic';
import { hasBannedWords } from '../services/dayReviewLogic';
import { endHardDay, startHardDay } from '../services/hardDay';
import {
  chooseHardDayKeep,
  countExhaustedSince,
  EXHAUSTED_SUGGEST_COUNT,
  HARD_DAY_MAX_MINUTES,
  HARD_DAY_MAX_TASKS,
  shouldSuggestHardDay,
} from '../services/hardDayLogic';
import { dayBounds, planningDay } from '../services/planner';
import { acceptRoutine, addRoutineFromTemplate } from '../services/routineFlow';
import { removeTask, restoreTask } from '../services/taskFlow';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m);

let n = 0;
const t = (title: string, minutes: number, weight: Task['cognitiveWeight'], over: Partial<Task> = {}): Task => {
  n += 1;
  return {
    id: `t${n}`,
    title,
    estimatedDuration: minutes,
    cognitiveWeight: weight,
    status: 'PENDING',
    createdAt: new Date(2026, 10, 16, 7, n).toISOString(),
    startedAt: null,
    routineId: null,
    ...over,
  };
};

console.log('Hangi işler kalır');
const rapor = t('Rapor', 120, 'HIGH');
const sunum = t('Sunum', 60, 'HIGH');
const mail = t('Mail', 15, 'LOW');
const arama = t('Arama', 20, 'LOW');
const kitap = t('Okuma', 30, 'MEDIUM');
const c1 = chooseHardDayKeep([rapor, sunum, mail, arama, kitap]);
check(`en fazla ${HARD_DAY_MAX_TASKS} iş kalır`, c1.keep.length === HARD_DAY_MAX_TASKS, c1.keep.map((x) => x.title).join());
check('en hafif ve kısa işler kalır', c1.keep.map((x) => x.title).join() === 'Mail,Arama', c1.keep.map((x) => x.title).join());
check('gerisi ertelenir', c1.defer.map((x) => x.title).sort().join() === 'Okuma,Rapor,Sunum');
check('kalan toplam süre sınırı aşmaz', c1.keep.reduce((a, x) => a + x.estimatedDuration, 0) <= HARD_DAY_MAX_MINUTES);

const started = t('Başlamış iş', 45, 'HIGH', { status: 'IN_PROGRESS' });
const c2 = chooseHardDayKeep([started, mail, arama]);
check('başlamış iş her zaman kalır', c2.keep[0].title === 'Başlamış iş' && c2.keep.length === HARD_DAY_MAX_TASKS);
check('başlamış iş ertelenmez', !c2.defer.includes(started));

const c3 = chooseHardDayKeep([rapor, sunum]);
check('hepsi uzunsa en az bir iş kalır (en kısası)', c3.keep.length === 1 && c3.keep[0].title === 'Sunum');
const c4 = chooseHardDayKeep([t('Uzun', 80, 'LOW'), t('Orta', 50, 'LOW')]);
check('toplam süre sınırı ikinci işi eler', c4.keep.length === 1 && c4.keep[0].title === 'Orta', c4.keep.map((x) => x.title).join());
check('görev yoksa boş', chooseHardDayKeep([]).keep.length === 0);
const routineTask = t('Su iç', 5, 'LOW', { routineId: 'r1' });
const c5 = chooseHardDayKeep([routineTask, mail]);
check('rutin görevine dokunulmaz', !c5.keep.includes(routineTask) && !c5.defer.includes(routineTask));
const c6 = chooseHardDayKeep([t('Bitmiş', 10, 'LOW', { status: 'COMPLETED' }), t('Ertelenmiş', 10, 'LOW', { status: 'POSTPONED' })]);
check('biten ve ertelenmiş görev sayılmaz', c6.keep.length === 0 && c6.defer.length === 0);

console.log('Öneri');
check('kısa uyku önerir', shouldSuggestHardDay({ hardDay: false, sleepMinutes: 300, exhaustedToday: 0 }));
check('yeterli uykuda önermez', !shouldSuggestHardDay({ hardDay: false, sleepMinutes: 420, exhaustedToday: 0 }));
check('uyku bilinmiyorsa önermez', !shouldSuggestHardDay({ hardDay: false, sleepMinutes: null, exhaustedToday: 0 }));
check(`${EXHAUSTED_SUGGEST_COUNT} tükenmişlik kaydı önerir`, shouldSuggestHardDay({ hardDay: false, sleepMinutes: null, exhaustedToday: EXHAUSTED_SUGGEST_COUNT }));
check('bir kayıt yetmez', !shouldSuggestHardDay({ hardDay: false, sleepMinutes: 480, exhaustedToday: 1 }));
check('zaten açıksa önermez', !shouldSuggestHardDay({ hardDay: true, sleepMinutes: 100, exhaustedToday: 5 }));
const logs = [
  { energyStateAtCompletion: 'EXHAUSTED', loggedAt: at(10).toISOString() },
  { energyStateAtCompletion: 'EXHAUSTED', loggedAt: at(15).toISOString() },
  { energyStateAtCompletion: 'EXHAUSTED', loggedAt: at(10, 0, 15).toISOString() },
  { energyStateAtCompletion: 'HIGH', loggedAt: at(11).toISOString() },
];
check('yalnızca bugünün tükendim kayıtları sayılır', countExhaustedSince(logs, at(0)) === 2);

console.log('Koç mesajları');
const baseCtx = (over: Partial<CoachContext> = {}): CoachContext => ({
  now: at(10),
  user: { id: 'u', chronotype: 'BALANCED', peakStartHour: 9, peakEndHour: 12 },
  tasks: [{ ...mail }, { ...arama }],
  blocks: [],
  recentLogs: [],
  dayEndHour: 22,
  hardDay: true,
  ...over,
});
const k = getKronosMessage(baseCtx());
const a = getAuraMessage(baseCtx());
check('Kronos hafif planı söyler', k.headline === 'Hafif plan' && k.body.includes('"Mail"') && k.actions.length === 0);
check('Kronos baskı kurmaz (aksiyon düğmesi yok)', k.actions.length === 0 && !k.body.includes('Tepe'));
check('Aura yargılamadan destekler', a.headline.includes('sorun değil') && a.tone === 'CALM');
check('mesajlarda yargılayıcı sözcük yok', ![k.headline, k.body, a.headline, a.body].some(hasBannedWords));
check('zor gün kapalıyken normal mesaj', getKronosMessage(baseCtx({ hardDay: false })).headline !== 'Hafif plan');
check('yapay zekâya zor gün bilgisi gider', describeSituation(baseCtx()).includes('ZOR GÜN MODU AÇIK') && !describeSituation(baseCtx({ hardDay: false })).includes('ZOR GÜN'));
check('hiç iş kalmadıysa dinlenmeyi söyler', getKronosMessage(baseCtx({ tasks: [] })).body.includes('dinlenmeye'));

async function dbTests(): Promise<void> {
  console.log('Zor günü aç ve kapat');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);

  const water = await addRoutineFromTemplate(db, 'su-ic');
  const big = await createTask(db, { title: 'Rapor yaz', estimatedDuration: 120, cognitiveWeight: 'HIGH' });
  const deck = await createTask(db, { title: 'Sunum hazırla', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const small = await createTask(db, { title: 'Mail yaz', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  const small2 = await createTask(db, { title: 'Arama yap', estimatedDuration: 20, cognitiveWeight: 'LOW' });
  await acceptRoutine(db, water, at(8, 30));

  const now = at(9, 0);
  const res = await startHardDay(db, now);
  const key = dayKey(planningDay(now));
  check('zor gün kaydedilir', await isHardDay(db, key));
  check('iki hafif iş planda kalır', res.kept.map((x) => x.id).sort().join() === [small.id, small2.id].sort().join());
  check('ağır işler ertelenir', (await getTask(db, big.id))?.status === 'POSTPONED' && (await getTask(db, deck.id))?.status === 'POSTPONED');
  check('hafif işler beklemede kalır', (await getTask(db, small.id))?.status === 'PENDING' && (await getTask(db, small2.id))?.status === 'PENDING');
  const { start, end } = dayBounds(planningDay(now));
  const blocks = await listDayBlocks(db, start, end);
  const planned = new Set(blocks.map((b) => b.taskId));
  check('plan yalnızca kalan işleri içerir', planned.has(small.id) && planned.has(small2.id) && !planned.has(big.id) && !planned.has(deck.id));
  const visible = await listVisibleTasks(db, start.toISOString());
  const waterTask = visible.find((x) => x.routineId === water.id);
  check('rutinden gelen görev bozulmaz', !!waterTask && waterTask.status === 'PENDING' && planned.has(waterTask.id));

  // İkinci kez açmak ek iş ertelemez, kaydı bozmaz
  const again = await startHardDay(db, at(9, 30));
  check('ikinci açış zararsız', again.deferred.length === 0 && (await isHardDay(db, key)));

  // Kullanıcı bir görevi silsin, biri elle geri alsın
  await removeTask(db, deck.id, at(10, 0));
  await restoreTask(db, big.id, at(10, 5));
  const restored = await endHardDay(db, at(11, 0));
  check('kapatınca silinmiş görev geri gelmez', (await getTask(db, deck.id)) === null);
  check('elle geri alınan görev tekrar sayılmaz', restored === 0, String(restored));
  check('zor gün kapanır', !(await isHardDay(db, key)));

  // Yeni tur: bu kez kapatınca ertelenenler geri gelir
  const { db: db2 } = makeTestDb();
  await migrateDbIfNeeded(db2);
  const r1 = await createTask(db2, { title: 'Büyük iş', estimatedDuration: 100, cognitiveWeight: 'HIGH' });
  const r2 = await createTask(db2, { title: 'Orta iş', estimatedDuration: 60, cognitiveWeight: 'MEDIUM' });
  const r3 = await createTask(db2, { title: 'Küçük iş', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  const r4 = await createTask(db2, { title: 'Küçük iş 2', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  const res2 = await startHardDay(db2, at(9, 0));
  check('iki iş ertelendi', res2.deferred.length === 2 && (await getTask(db2, r1.id))?.status === 'POSTPONED' && (await getTask(db2, r2.id))?.status === 'POSTPONED');
  const back = await endHardDay(db2, at(12, 0));
  check('kapatınca ertelenenler geri gelir', back === 2 && (await getTask(db2, r1.id))?.status === 'PENDING' && (await getTask(db2, r2.id))?.status === 'PENDING');
  check('kalan işler yerinde', (await getTask(db2, r3.id))?.status === 'PENDING' && (await getTask(db2, r4.id))?.status === 'PENDING');
  const { start: s2, end: e2 } = dayBounds(planningDay(at(12, 0)));
  const planned2 = new Set((await listDayBlocks(db2, s2, e2)).map((b) => b.taskId));
  check('kapatınca plan tüm işlerle yeniden kurulur', [r1, r2, r3, r4].every((x) => planned2.has(x.id)), String(planned2.size));

  // Gün sınırı: 22:00'den sonra yarın için açılır
  const { db: db3 } = makeTestDb();
  await migrateDbIfNeeded(db3);
  await createTask(db3, { title: 'Yarın işi', estimatedDuration: 20, cognitiveWeight: 'LOW' });
  await startHardDay(db3, at(22, 30));
  check('22:00 sonrası zor gün yarın için açılır', (await isHardDay(db3, '2026-11-17')) && !(await isHardDay(db3, '2026-11-16')));
  await setHardDay(db3, '2026-11-17', false);
}

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
