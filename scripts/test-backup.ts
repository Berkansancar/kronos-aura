/**
 * Yedek ve geri yükleme testi (tek işlemlilik, bozuk metin, eski sürüm, gizli bilgi sızmaması).
 * Çalıştırmak için:  npm run test:backup
 */
import {
  addDayEvent,
  createTask,
  setSetting,
  upsertDailyStat,
} from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { addWater } from '../services/nutrition';
import { addSmoke } from '../services/dayFlow';
import { completeTask, markTaskMissed } from '../services/taskFlow';
import {
  BACKUP_END,
  BACKUP_PREF_KEYS,
  BACKUP_START,
  BACKUP_TABLES,
  checksum,
  createBackup,
  inspectBackup,
  restoreBackup,
} from '../services/backupLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (h: number, m = 0, d = 15) => new Date(2026, 10, d, h, m, 0, 0);
const NOW = at(8, 10, 16);

async function fresh() {
  const t = makeTestDb();
  await migrateDbIfNeeded(t.db);
  return t;
}

/** Yedeğe giren tüm tabloların içeriği, karşılaştırma için tek metin */
function snapshot(raw: ReturnType<typeof makeTestDb>['raw']): string {
  return JSON.stringify(
    BACKUP_TABLES.map((t) => raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())
  );
}

async function fill(t: Awaited<ReturnType<typeof fresh>>): Promise<void> {
  const { db, raw } = t;
  raw.prepare("INSERT INTO User (id, chronotype, peakStartHour, peakEndHour) VALUES ('u1','MORNING',9,12)").run();
  raw.prepare(
    "INSERT INTO Routine (id,title,category,estimatedDuration,cognitiveWeight,askHour,askMinute,status,createdAt) VALUES ('r1','Yürüyüş','SAGLIK',20,'LOW',18,30,'ACTIVE','2026-11-01T10:00:00.000Z')"
  ).run();
  raw.prepare("INSERT INTO RoutineLog (id,routineId,day,outcome,loggedAt) VALUES ('rl1','r1','2026-11-15','DONE','2026-11-15T18:40:00.000Z')").run();
  const t1 = await createTask(db, { title: 'Rapor "yaz"', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  const t2 = await createTask(db, { title: 'Arama ğüşiöç', estimatedDuration: 15, cognitiveWeight: 'LOW' });
  await completeTask(db, t1, 'HIGH', at(20, 0), { loggedAt: at(19, 0), minutes: 50 });
  await markTaskMissed(db, t2, 'COULD_NOT', 'WORK', at(21, 0));
  raw.prepare(
    `INSERT INTO TimeBlock (id,taskId,startTime,endTime,bufferTime) VALUES ('b1','${t2.id}','2026-11-16T09:00:00.000Z','2026-11-16T09:15:00.000Z',5)`
  ).run();
  await addWater(db, at(9), 300);
  await upsertDailyStat(db, { day: '2026-11-15', steps: 7000, screenMinutes: 150, topApps: [] });
  await addDayEvent(db, '2026-11-15', 'WAKE', at(7));
  await addSmoke(db, at(10), 0);
  await setSetting(db, 'work_v1', '{"enabled":true}');
  raw.prepare("INSERT INTO SleepLog (day,bedtime,wakeTime,durationMinutes,updatedAt) VALUES ('2026-11-15','23:30','07:00',450,'2026-11-15T07:00:00.000Z')").run();
  raw.prepare("INSERT INTO DayReview (day,payload,createdAt) VALUES ('2026-11-15','{\"x\":1}','2026-11-15T21:00:00.000Z')").run();
  raw.prepare("INSERT INTO CoachChat (id,coach,role,content,createdAt) VALUES ('c1','AURA','user','merhaba','2026-11-15T10:00:00.000Z')").run();
}

async function main(): Promise<void> {
  console.log('Yedek metni');
  const a = await fresh();
  await fill(a);
  const prefs = { water_goal_ml: '2500', kcal_target: '2000', goals_v1: '{"reminders":true}', morning_hour: '8', bogus_api_key: 'SECRET', review_reminder: null };
  const text = await createBackup(a.db, prefs, NOW);
  check('başlangıç ve bitiş işaretleri, sağlama kodu var', text.includes(BACKUP_START) && text.includes(BACKUP_END) && /kod=[0-9a-f]{8}-----/.test(text));
  check('yedeğe yalnızca izinli ayarlar girer (API anahtarı sızmaz)', !text.includes('SECRET') && !text.includes('bogus_api_key') && text.includes('"water_goal_ml":"2500"'));
  check('izinli ayar listesinde anahtar/api içeren ad yok', BACKUP_PREF_KEYS.every((k) => !/key|api|token|secret/i.test(k)));
  check('koç sohbeti yedeğe girmez', !text.includes('merhaba') && !text.includes('CoachChat'));
  check('Türkçe karakter ve tırnak korunur', text.includes('Arama ğüşiöç') && text.includes('Rapor \\"yaz\\"'));
  const ins = inspectBackup(text);
  check('metin açılır, özet doğru', ins.ok && ins.summary.lines.includes('Görev: 2') && ins.summary.lines.includes('Rutin: 1') && ins.summary.lines.includes('Su kaydı: 1') && ins.summary.lines.includes('Sigara kaydı: 1'), JSON.stringify(ins.ok ? ins.summary : ins));
  check('özette sürüm ve boş olmayan ayar sayısı', ins.ok && ins.summary.dbVersion === DATABASE_VERSION && ins.summary.prefCount === 4);

  console.log('Geri yükleme');
  const b = await fresh();
  const r = await restoreBackup(b.db, text);
  check('boş telefona geri yüklenir', r.ok, JSON.stringify(r));
  check('tüm tablolar birebir aynı (ilişkili kayıtlar dahil)', snapshot(a.raw) === snapshot(b.raw));
  check('ayarlar geri döner (bildirim kapalı olan null atlanır)', r.ok && r.prefs.water_goal_ml === '2500' && r.prefs.kcal_target === '2000' && r.prefs.review_reminder === undefined && r.prefs.bogus_api_key === undefined);

  // dolu telefonun üstüne: eski kayıtlar gider, sohbet kalır
  const c = await fresh();
  await createTask(c.db, { title: 'Eski iş', estimatedDuration: 10, cognitiveWeight: 'LOW' });
  c.raw.prepare("INSERT INTO CoachChat (id,coach,role,content,createdAt) VALUES ('c9','KRONOS','user','selam','2026-11-15T10:00:00.000Z')").run();
  const rc = await restoreBackup(c.db, text);
  check('dolu telefonda yedektekiyle değişir', rc.ok && snapshot(a.raw) === snapshot(c.raw) && !JSON.stringify(c.raw.prepare('SELECT title FROM Task').all()).includes('Eski iş'));
  check('koç sohbetine dokunulmaz', (c.raw.prepare('SELECT COUNT(*) AS n FROM CoachChat').get() as { n: number }).n === 1);

  console.log('Bozuk ve yanlış metinler (mevcut kayıtlar korunur)');
  const keep = async () => {
    const t = await fresh();
    await createTask(t.db, { title: 'Korunan', estimatedDuration: 10, cognitiveWeight: 'LOW' });
    return { t, before: snapshot(t.raw) };
  };
  {
    const { t, before } = await keep();
    const broken = text.replace('Rapor', 'Rapar');
    if (broken === text) throw new Error('test hazırlığı: metin değişmedi');
    const res = await restoreBackup(t.db, broken);
    check('bir harf değişirse sağlama kodu yakalar', !res.ok && /sağlama kodu/.test(res.error) && snapshot(t.raw) === before, JSON.stringify(res));
  }
  {
    const { t, before } = await keep();
    const cut = text.slice(0, text.length - 400);
    const res = await restoreBackup(t.db, cut);
    check('kısaltılmış metin reddedilir', !res.ok && /eksik|bozul/.test(res.error) && snapshot(t.raw) === before, JSON.stringify(res));
  }
  {
    const wrapped = text
      .split('\n')
      .map((line, i) => (i === 2 ? line.replace(/(.{80})/g, '$1\n') : line))
      .join('\n');
    const t = await fresh();
    const res = await restoreBackup(t.db, wrapped);
    check('uygulamanın böldüğü satırlar sorun olmaz', res.ok && snapshot(t.raw) === snapshot(a.raw), JSON.stringify(res));
  }
  {
    const t = await fresh();
    const res = await restoreBackup(t.db, 'Selam, bugün hava güzel');
    check('yedek olmayan metin: anlaşılır hata', !res.ok && /yedeği gibi görünmüyor/.test(res.error));
    const res2 = await restoreBackup(t.db, '{"app":"baska"}');
    check('başka uygulamanın JSON\'u reddedilir', !res2.ok && /Kronos/.test(res2.error));
  }
  const parsedOf = (): Record<string, any> => JSON.parse(text.split('\n')[2]);
  const rawText = (o: unknown): string => JSON.stringify(o); // işaretsiz, sağlama kodsuz (elle yazılmış JSON)
  {
    const { t, before } = await keep();
    const o = parsedOf();
    o.dbVersion = DATABASE_VERSION + 1;
    const res = await restoreBackup(t.db, rawText(o));
    check('daha yeni sürümün yedeği reddedilir', !res.ok && /daha yeni/.test(res.error) && snapshot(t.raw) === before);
  }
  {
    const { t, before } = await keep();
    const o = parsedOf();
    o.tables.Task.c.push('olmayanSutun');
    o.tables.Task.r = o.tables.Task.r.map((row: unknown[]) => [...row, 1]);
    const res = await restoreBackup(t.db, rawText(o));
    check('bilinmeyen sütun: yazmadan önce reddedilir', !res.ok && /uyumsuz/.test(res.error) && snapshot(t.raw) === before);
  }
  {
    const { t, before } = await keep();
    const o = parsedOf();
    o.tables.Task.r[0][o.tables.Task.c.indexOf('estimatedDuration')] = 0; // CHECK (>0) ihlali, işlem ortasında patlar
    const res = await restoreBackup(t.db, rawText(o));
    check('işlem ortasında hata: tamamı geri alınır, eski kayıtlar durur', !res.ok && /olduğu gibi/.test(res.error) && snapshot(t.raw) === before, JSON.stringify(res));
  }
  {
    const { t, before } = await keep();
    const o = parsedOf();
    o.tables.TimeBlock.r[0][o.tables.TimeBlock.c.indexOf('taskId')] = 'yok-boyle-bir-gorev';
    const res = await restoreBackup(t.db, rawText(o));
    check('kopuk ilişki (olmayan göreve bağlı kayıt): geri alınır', !res.ok && snapshot(t.raw) === before, JSON.stringify(res));
  }
  {
    const t = await fresh();
    const o = parsedOf();
    o.tables.Task.r[0][0] = { evil: true };
    const res = await restoreBackup(t.db, rawText(o));
    check('hücrede nesne gibi beklenmeyen değer reddedilir', !res.ok && /bozuk/.test(res.error));
  }

  console.log('Eski sürüm ve boş yedek');
  {
    // v7 yedeği: Task.workOk sütunu yok, sürüm 7
    const t = await fresh();
    const o = parsedOf();
    const ix = o.tables.Task.c.indexOf('workOk');
    o.tables.Task.c.splice(ix, 1);
    o.tables.Task.r = o.tables.Task.r.map((row: unknown[]) => row.filter((_: unknown, i: number) => i !== ix));
    o.dbVersion = 7;
    const res = await restoreBackup(t.db, rawText(o));
    const n = t.raw.prepare('SELECT COUNT(*) AS n, MAX(workOk) AS w FROM Task').get() as { n: number; w: number };
    check('eski sürüm yedeği yüklenir, eksik sütun varsayılanla dolar', res.ok && n.n === 2 && n.w === 0, JSON.stringify(res));
  }
  {
    // yedekte olmayan tabloya dokunulmaz
    const t = await fresh();
    t.raw.prepare("INSERT INTO SmokeLog (id,day,at) VALUES ('s1','2026-11-10','2026-11-10T10:00:00.000Z')").run();
    const o = parsedOf();
    delete o.tables.SmokeLog;
    const res = await restoreBackup(t.db, rawText(o));
    const n = (t.raw.prepare('SELECT COUNT(*) AS n FROM SmokeLog').get() as { n: number }).n;
    check('yedekte olmayan tablo olduğu gibi kalır', res.ok && n === 1);
  }
  {
    const e = await fresh();
    const empty = await createBackup(e.db, {}, NOW);
    const t = await fresh();
    await createTask(t.db, { title: 'Silinecek', estimatedDuration: 10, cognitiveWeight: 'LOW' });
    const res = await restoreBackup(t.db, empty);
    check('boş yedek yüklenir: kayıtlar sıfırlanır', res.ok && res.summary.totalRows === 0 && (t.raw.prepare('SELECT COUNT(*) AS n FROM Task').get() as { n: number }).n === 0);
  }
  check('sağlama kodu aynı metinde aynı, farklıda farklı', checksum('abc') === checksum('abc') && checksum('abc') !== checksum('abd') && /^[0-9a-f]{8}$/.test(checksum('')));
  check('metin başlığında yalnızca Türkçe yönerge var, JSON dışında süslü parantez yok', !text.split('\n')[0].includes('{') && !text.split('\n')[0].includes('}'));
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
