/**
 * Aktivite (ekran süresi + adım) katmanı testi: saf mantık, koç kuralları, yapay zekâ özeti ve
 * veritabanı (gerçek SQLite ile). Çalıştırmak için:  npm run test:activity
 */
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { getDailyStat, listDailyStats, upsertDailyStat } from '../database/repository';
import type { ActivitySummary, DailyStat, Task, UserProfile } from '../database/types';
import {
  batteryHint,
  buildActivitySummary,
  dayKey,
  formatSteps,
  isStepsReliable,
  parseDayKey,
} from '../services/activityLogic';
import { describeSituation } from '../services/ai/coachAI';
import { getAuraMessage, type CoachContext } from '../services/coachEngine';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ───────────── Saf mantık ─────────────

const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m);

console.log('Tarih ve biçim');
check('dayKey yerel tarih verir', dayKey(new Date(2026, 0, 5, 23, 59)) === '2026-01-05');
check('parseDayKey gidiş-dönüş', dayKey(parseDayKey('2026-11-16')) === '2026-11-16');
check('formatSteps binlik ayraç', formatSteps(4210) === '4.210' && formatSteps(1234567) === '1.234.567');
check('formatSteps küçük sayı ve negatif', formatSteps(0) === '0' && formatSteps(-5) === '0');

console.log('Adım güvenilirliği');
check('takip kapalı: güvenilmez', isStepsReliable(null, at(16)) === false);
check('dünden beri açık: güvenilir', isStepsReliable(at(14, 0, 15).toISOString(), at(16)) === true);
check('bugün 06:30 açıldı: güvenilir', isStepsReliable(at(6, 30).toISOString(), at(16)) === true);
check('bugün 14:00 açıldı: güvenilmez', isStepsReliable(at(14).toISOString(), at(16)) === false);
check('bozuk tarih: güvenilmez', isStepsReliable('x', at(16)) === false);

const stat = (over: Partial<DailyStat> = {}): DailyStat => ({
  day: '2026-11-16',
  steps: 1200,
  screenMinutes: 95,
  topApps: [{ label: 'Chrome', minutes: 40 }],
  updatedAt: '2026-11-16T10:00:00.000Z',
  ...over,
});

console.log('Koç özeti');
check('kayıt yoksa özet yok', buildActivitySummary(null, true, null, at(16)) === undefined);
const off = buildActivitySummary(stat(), false, null, at(16));
check('takip kapalıyken adım null', off?.steps === null && off.stepsReliable === false);
check('ekran süresi takipten bağımsız', off?.screenMinutes === 95);
const on = buildActivitySummary(stat(), true, at(6).toISOString(), at(16));
check('takip açıkken adım dolu ve güvenilir', on?.steps === 1200 && on.stepsReliable === true);

console.log('Pil ipuçları');
check('Xiaomi', batteryHint('Xiaomi').includes('Otomatik başlat'));
check('Samsung', batteryHint('samsung').includes('Uyutulmayan'));
check('Huawei', batteryHint('HUAWEI').includes('Manuel yönet'));
check('Oppo', batteryHint('OPPO').includes('Otomatik başlat'));
check('bilinmeyen marka genel ipucu', batteryHint('Nokia').includes('Kısıtlama yok'));
check('boş marka genel ipucu', batteryHint('').includes('Pil'));

// ───────────── Koç kuralları ─────────────

const user: UserProfile = { id: 'u', chronotype: 'BALANCED', peakStartHour: 10, peakEndHour: 14 };
const task: Task = {
  id: 't1',
  title: 'Rapor',
  estimatedDuration: 60,
  cognitiveWeight: 'LOW',
  status: 'PENDING',
  createdAt: '2026-11-16T05:00:00.000Z',
  startedAt: null,
};
const ctxAt = (h: number, activity?: ActivitySummary, share = false): CoachContext => ({
  now: at(h),
  user,
  tasks: [task],
  blocks: [],
  recentLogs: [],
  dayEndHour: 22,
  activity,
  shareActivityWithAi: share,
});
const act = (over: Partial<ActivitySummary> = {}): ActivitySummary => ({
  steps: 5000,
  stepsReliable: true,
  screenMinutes: 60,
  topApps: [],
  ...over,
});
const BANNED = /(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i;

console.log('Aura: telefon kullanımı');
const longScreen = getAuraMessage(ctxAt(16, act({ screenMinutes: 300 })));
check('4+ saat ekran: ara önerir', longScreen.headline === 'Ekran uzun süredir açık');
check('ekran mesajı süreyi içerir', longScreen.body.includes('5 sa'));
check('ekran mesajı yargılamaz', !BANNED.test(longScreen.headline + ' ' + longScreen.body));

const lowSteps = getAuraMessage(ctxAt(16, act({ steps: 800 })));
check('öğleden sonra az adım: hareket önerir', lowSteps.headline === 'Biraz hareket iyi gelir');
check('adım mesajı yargılamaz', !BANNED.test(lowSteps.headline + ' ' + lowSteps.body));
check('adım mesajı sayıyı içerir', lowSteps.body.includes('800'));

const morningLow = getAuraMessage(ctxAt(11, act({ steps: 300 })));
check('sabah az adım: uyarı yok', morningLow.headline !== 'Biraz hareket iyi gelir');
const unreliable = getAuraMessage(ctxAt(16, act({ steps: 300, stepsReliable: false })));
check('takip geç açıldıysa adım yorumu yok', unreliable.headline !== 'Biraz hareket iyi gelir');
const trackingOff = getAuraMessage(ctxAt(16, act({ steps: null, stepsReliable: false })));
check('takip kapalıyken adım yorumu yok', trackingOff.headline !== 'Biraz hareket iyi gelir');
const fine = getAuraMessage(ctxAt(16, act({ steps: 7000, screenMinutes: 90 })));
check(
  'normal gün: olağan mesaj',
  fine.headline !== 'Ekran uzun süredir açık' && fine.headline !== 'Biraz hareket iyi gelir'
);
const noActivity = getAuraMessage(ctxAt(16));
check('aktivite verisi yoksa eski davranış', noActivity.headline === fine.headline);

const tired = getAuraMessage({
  ...ctxAt(16, act({ screenMinutes: 400 })),
  recentLogs: [
    {
      id: 'l1',
      taskId: 't1',
      actualDuration: 50,
      energyStateAtCompletion: 'EXHAUSTED',
      coachNotes: null,
      loggedAt: at(15, 30).toISOString(),
    },
  ],
});
check('yorgunluk mesajı ekran uyarısından önce gelir', tired.headline === 'Yorgunluk de bir veri');

console.log('Yapay zekâ özeti');
const shared = describeSituation(
  ctxAt(
    16,
    act({
      steps: 4210,
      screenMinutes: 135,
      topApps: [
        { label: 'Chrome', minutes: 50 },
        { label: 'WhatsApp', minutes: 40 },
        { label: 'YouTube', minutes: 30 },
        { label: 'Notlar', minutes: 20 },
        { label: 'Harita', minutes: 15 },
        { label: 'Oyun', minutes: 10 },
      ],
    }),
    true
  )
);
check('paylaşım açık: adım var', shared.includes('Adım: 4210'));
check('paylaşım açık: ekran süresi var', shared.includes('Ekran süresi: 2 sa 15 dk'));
check('paylaşım açık: en çok 5 uygulama', shared.includes('Harita') && !shared.includes('Oyun'));
const notShared = describeSituation(ctxAt(16, act({ steps: 4210, topApps: [{ label: 'Chrome', minutes: 50 }] }), false));
check('paylaşım kapalı: telefon verisi gitmez', !notShared.includes('telefon kullanımı') && !notShared.includes('Chrome'));
const lateStart = describeSituation(ctxAt(16, act({ stepsReliable: false }), true));
check('geç açılan takip eksik olarak işaretlenir', lateStart.includes('eksik olabilir'));
const noSteps = describeSituation(ctxAt(16, act({ steps: null }), true));
check('takip kapalıyken adım satırı yok', !noSteps.includes('Adım:'));

// ───────────── Veritabanı (gerçek SQLite) ─────────────

function makeDb(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      const r = raw.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      raw.prepare(sql).get(...(params as never[])) ?? null,
    getAllAsync: async (sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...(params as never[])),
  } as unknown as SQLiteDatabase;
  return { db, raw };
}

async function dbTests(): Promise<void> {
  console.log('Veritabanı: migrasyon ve günlük özet');
  const { db, raw } = makeDb();
  await migrateDbIfNeeded(db);
  const version = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  check('temiz kurulum son sürüme gelir', version === DATABASE_VERSION && DATABASE_VERSION === 12);

  // v2'den yükseltme: DailyStat yokken sürüm 2 görünür.
  raw.exec('DROP TABLE DailyStat; PRAGMA user_version = 2;');
  await migrateDbIfNeeded(db);
  const tbl = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='DailyStat'").get();
  check('v2 veritabanı son sürüme yükselir', tbl !== undefined);
  await migrateDbIfNeeded(db);
  check('migrasyon tekrar çalışınca bozulmaz', true);

  await upsertDailyStat(db, {
    day: '2026-11-16',
    steps: 1000,
    screenMinutes: 80,
    topApps: [{ label: 'Chrome', minutes: 40 }],
  });
  let s = await getDailyStat(db, '2026-11-16');
  check('ilk kayıt yazılır', s?.steps === 1000 && s.screenMinutes === 80 && s.topApps[0].label === 'Chrome');

  await upsertDailyStat(db, { day: '2026-11-16', steps: 600, screenMinutes: 120, topApps: [{ label: 'YouTube', minutes: 70 }] });
  s = await getDailyStat(db, '2026-11-16');
  check('adım düşmez (en büyük korunur)', s?.steps === 1000);
  check('ekran süresi ve uygulamalar güncellenir', s?.screenMinutes === 120 && s.topApps[0].label === 'YouTube');

  await upsertDailyStat(db, { day: '2026-11-16', steps: 1500, screenMinutes: null, topApps: [] });
  s = await getDailyStat(db, '2026-11-16');
  check('adım artınca güncellenir', s?.steps === 1500);
  check('ekran süresi okunamazsa eski değer korunur', s?.screenMinutes === 120 && s.topApps[0].label === 'YouTube');

  await upsertDailyStat(db, { day: '2026-11-15', steps: -50, screenMinutes: -3, topApps: [] });
  const neg = await getDailyStat(db, '2026-11-15');
  check('negatif değerler sıfıra çekilir', neg?.steps === 0 && neg.screenMinutes === 0);

  await upsertDailyStat(db, { day: '2026-11-14', steps: 9000, screenMinutes: null, topApps: [] });
  const list = await listDailyStats(db, 7);
  check('günler yeniden eskiye sıralanır', list.map((d) => d.day).join(',') === '2026-11-16,2026-11-15,2026-11-14');
  check('ekran süresi null kalabilir', list[2].screenMinutes === null);
  check('sınır (limit) uygulanır', (await listDailyStats(db, 2)).length === 2);
  check('olmayan gün null döner', (await getDailyStat(db, '2020-01-01')) === null);

  raw.prepare("UPDATE DailyStat SET topApps = 'bozuk{' WHERE day = '2026-11-14'").run();
  const broken = await getDailyStat(db, '2026-11-14');
  check('bozuk uygulama listesi çökertmez', broken !== null && broken.topApps.length === 0);
}

dbTests()
  .then(() => {
    console.log(`\nTüm kontroller geçti (${passed}).`);
  })
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
