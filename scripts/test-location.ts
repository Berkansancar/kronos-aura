/**
 * Gün haritası testi: konum örneklerinden evde / yolda / durakta / iş noktasında dakikaları, evden çıkış ve dönüş saatleri,
 * ekran süresinin parçalara bölünmesi, uzun boşluklar, takip kapanışı, veritabanı, eski verinin silinmesi, yedek,
 * "tüm günler" komutuna yalnızca dakikaların girmesi (koordinat ve yer adı girmez) ve ekran bağlantıları.
 * Çalıştırmak için:  npm run test:location
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMoodLog } from '../database/repository';
import { DATABASE_VERSION, migrateDbIfNeeded } from '../database/schema';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { hasBannedWords, type DayFacts } from '../services/dayReviewLogic';
import {
  addPlace,
  clearLocationData,
  computeDay,
  deletePlace,
  getLocationDay,
  isLocationOn,
  isLocationShared,
  listLocationDays,
  listPlaces,
  loadPointsForDay,
  recordPoints,
  rollupLocation,
  setLocationOn,
  setLocationShared,
  type SessionProvider,
} from '../services/location';
import {
  DEFAULT_HOME_RADIUS_M,
  DEFAULT_WORK_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  barSegments,
  buildIntervals,
  dayIntervals,
  dayWindow,
  distanceM,
  hasLocationRecord,
  inPlace,
  isMovingBetween,
  placeStateOf,
  rawCutoffMs,
  screenOverlapMs,
  smoothShortStops,
  summarizeDay,
  summaryText,
  validatePlace,
  visitedWork,
  type LocPoint,
  type PlaceLite,
  type StateInterval,
} from '../services/locationLogic';
import { LOCATION_NOTE, buildPeriodPrompt, dayLine, periodStats, statLines } from '../services/periodLogic';
import { gatherPeriodFacts } from '../services/periodReview';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const near = (a: number | null, b: number, tol = 2): boolean => a !== null && Math.abs(a - b) <= tol;

const root = join(__dirname, '..');
const T = (d: number, h: number, m = 0, s = 0): number => new Date(2026, 10, d, h, m, s).getTime();
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

// Ev (41.01234567, 29.01234567) ve 20 km kuzeyde bir iş noktası
const HOME_LAT = 41.01234567;
const HOME_LON = 29.01234567;
const M = 1 / 111_195; // 1 metre = bu kadar enlem derecesi
const north = (m: number): number => HOME_LAT + m * M;
const home: PlaceLite = { id: 'h', name: 'Ev', kind: 'HOME', lat: HOME_LAT, lon: HOME_LON, radiusM: DEFAULT_HOME_RADIUS_M };
const shop: PlaceLite = { id: 'w', name: 'Dükkan-SIR-77', kind: 'WORK', lat: north(20_000), lon: HOME_LON, radiusM: DEFAULT_WORK_RADIUS_M };
const pt = (ts: number, northM: number, speed: number | null = null, acc: number | null = 20): LocPoint => ({ ts, lat: north(northM), lon: HOME_LON, speed, acc });

/** from -> to (kuzeyden metre) arası 15 m/sn ile sürer; her 30 sn'de bir örnek. Son örnek varış noktasıdır. */
function drive(startTs: number, fromM: number, toM: number): LocPoint[] {
  const dir = toM >= fromM ? 1 : -1;
  const secs = Math.round(Math.abs(toM - fromM) / 15);
  const out: LocPoint[] = [];
  for (let s = 0; s < secs; s += 30) out.push(pt(startTs + s * 1000, fromM + dir * 15 * s, 15));
  out.push(pt(startTs + secs * 1000, toM, 0));
  return out;
}

/**
 * Bir gün: gece evde (önceki akşamın örneği) → 07:20 çıkış → 07:42 dükkan → 12:00 çıkış → 12:10 durak (40 dk)
 * → 12:50 yola devam → 13:02 eve varış → akşam evde.
 */
function scenario(d: number): LocPoint[] {
  return [
    pt(T(d - 1, 22, 0), 0), // evde, önceki akşam
    ...drive(T(d, 7, 20), 150, 20_000),
    ...drive(T(d, 12, 0), 19_850, 11_000),
    ...drive(T(d, 12, 50), 10_850, 0),
  ];
}

async function main(): Promise<void> {
  console.log('Geometri ve yerler');
  check('1 metre ≈ 0,000009 derece: 450 m ölçülür', Math.abs(distanceM(HOME_LAT, HOME_LON, north(450), HOME_LON) - 450) < 2);
  check('evin içi ev sayılır, uzağı hiçbiri', placeStateOf(pt(0, 100), [home, shop]) === 'HOME' && placeStateOf(pt(0, 5_000), [home, shop]) === null);
  check('dükkanın içi iş noktası', placeStateOf(pt(0, 20_050), [home, shop]) === 'WORK');
  check('doğruluk payı en çok 50 m eklenir', inPlace(pt(0, 240, null, 40), home) && !inPlace(pt(0, 270, null, 500), home));
  check('ev iş noktasından önce gelir (aynı yerdeyse)', placeStateOf(pt(0, 0), [{ ...shop, lat: HOME_LAT, lon: HOME_LON }, home]) === 'HOME');

  console.log('Hareket mi, durak mı');
  check('30 sn\'de 450 m: hareket', isMovingBetween(pt(0, 0), pt(30_000, 450)));
  check('2 saatte 120 m (konum sapması): hareket değil', !isMovingBetween(pt(0, 0, null, 80), pt(7_200_000, 120, null, 80)));
  check('40 dk\'da 150 m: hareket değil (araç durmuş)', !isMovingBetween(pt(0, 0), pt(2_400_000, 150)));
  check('kısa aralıkta cihaz hızı yeterli (100 m, 6 m/sn)', isMovingBetween(pt(0, 0), pt(30_000, 100, 6)));
  check('hız var ama doğruluk kötüyse güvenilmez', !isMovingBetween(pt(0, 0), pt(30_000, 100, 6, 200)));
  check('aynı an iki örnek: hareket değil', !isMovingBetween(pt(1000, 0), pt(1000, 500)));

  console.log('Bir günün haritası');
  const places = [home, shop];
  const now16 = new Date(2026, 10, 16, 20, 0);
  const sessions = [
    { on: T(16, 7, 25), off: T(16, 7, 35) }, // yolda 10 dk
    { on: T(16, 7, 40), off: T(16, 7, 50) }, // yolda ~2 dk + dükkanda ~8 dk
    { on: T(16, 12, 20), off: T(16, 12, 30) }, // durakta 10 dk
    { on: T(16, 18, 0), off: T(16, 19, 0) }, // evde 60 dk
  ];
  const s16 = summarizeDay(day(16), scenario(16), places, now16.getTime(), sessions);
  check('evde: gece 440 + akşam 418 dk', near(s16.homeMin, 858), `${s16.homeMin}`);
  check('yolda: 22 + 10 + 12 dk', near(s16.roadMin, 44), `${s16.roadMin}`);
  check('kayıtlı dükkanda: 07:42 – 12:00', near(s16.workMin, 258), `${s16.workMin}`);
  check('durakta: 40 dk bekleyiş', near(s16.stopMin, 40), `${s16.stopMin}`);
  check('toplam, günün başından 20:00\'ye', near(s16.trackedMin, 1200, 3), `${s16.trackedMin}`);
  check('evden çıkış 07:20, eve dönüş 13:02', s16.leftHome === '07:20' && s16.backHome === '13:02', `${s16.leftHome}/${s16.backHome}`);
  check('ekran: evde 60, yolda ~12, dışarıda ~18', s16.screenHomeMin === 60 && near(s16.screenRoadMin, 12, 1) && near(s16.screenOutMin, 18, 1), `${s16.screenHomeMin}/${s16.screenRoadMin}/${s16.screenOutMin}`);
  check('dükkana uğrandı', visitedWork(s16) === true && hasLocationRecord(s16));
  check('özet metni: evde, yolda, iş noktasında, durakta', summaryText(s16).startsWith('Evde 14 sa 18 dk') && summaryText(s16).includes('Yolda 44 dk') && summaryText(s16).includes('İş noktasında 4 sa 18 dk') && summaryText(s16).includes('Durakta 40 dk'));
  check('ekran verisi yoksa ekran alanları null', summarizeDay(day(16), scenario(16), places, now16.getTime(), null).screenHomeMin === null);

  const noShop = summarizeDay(day(16), scenario(16), [home], now16.getTime(), null);
  check('iş noktası kaydı yoksa dükkandaki süre "durakta" sayılır, iş noktası dakikası bilinmez', noShop.workMin === null && near(noShop.stopMin, 298) && visitedWork(noShop) === null);

  // Dükkana uğramadan eve giden gün: yalnızca ev ↔ yol
  const direct: LocPoint[] = [pt(T(17, 6, 0), 0), ...drive(T(17, 8, 0), 150, 9_000), ...drive(T(17, 8, 10, 0), 8_850, 0)];
  const sDirect = summarizeDay(day(17), direct, places, T(17, 18, 0), null);
  check('dükkana uğramayan gün: iş noktası 0, yargı yok', sDirect.workMin === 0 && visitedWork(sDirect) === false && sDirect.stopMin === 0);
  check('uğramayan günde de çıkış ve dönüş bulunur', sDirect.leftHome === '08:00' && sDirect.backHome === '08:19', `${sDirect.leftHome}/${sDirect.backHome}`);

  console.log('Boşluklar ve takip kapanışı');
  const lone = summarizeDay(day(18), [pt(T(18, 0, 30), 0)], [home], T(18, 23, 0), null);
  check('tek örnek evdeyse gün sonuna kadar evde (örnek yoksa hareket yok)', near(lone.homeMin, 22 * 60 + 30) && lone.leftHome === null);
  const weekend = summarizeDay(day(22), [pt(T(20, 14, 0), 0)], [home], T(22, 23, 0), null);
  check('hafta sonu: 2 gün örneksiz evde sayılır (60 saat sınırı)', near(weekend.homeMin, 23 * 60), `${weekend.homeMin}`);
  const longGap = summarizeDay(day(23), [pt(T(20, 14, 0), 0)], [home], T(23, 23, 0), null);
  check('60 saatten uzun boşluk bilinmiyor sayılır', longGap.homeMin < 23 * 60 && longGap.homeMin > 0, `${longGap.homeMin}`);
  const away: LocPoint[] = [pt(T(19, 8, 0), 5_000), pt(T(19, 8, 1), 5_000)];
  const awayDay = summarizeDay(day(19), away, [home], T(19, 23, 0), null);
  check('dışarıda örneksiz süre 14 saatle sınırlı', near(awayDay.stopMin, 14 * 60, 2), `${awayDay.stopMin}`);
  const slow = buildIntervals([pt(T(19, 8, 0), 0), pt(T(19, 8, 45), 20_000)], [home], T(19, 9, 0));
  check('hareketli seyirde 30 dk üstü bilinmiyor (45 dk boşluk)', slow[0].state === 'ROAD' && slow[0].to - slow[0].from === 30 * 60_000);
  const off: LocPoint[] = [pt(T(21, 8, 0), 0), { ts: T(21, 9, 0), lat: 0, lon: 0, speed: null, acc: null, off: true }, pt(T(21, 15, 0), 0)];
  const offDay = summarizeDay(day(21), off, [home], T(21, 16, 0), null);
  check('takip kapalıyken geçen süre evde sayılmaz (09:00 – 15:00)', near(offDay.homeMin, 60 + 60, 1) && offDay.trackedMin === offDay.homeMin, `${offDay.homeMin}`);
  check('kapanış işareti tek başına süre üretmez', buildIntervals([{ ts: T(21, 9, 0), lat: 0, lon: 0, speed: null, acc: null, off: true }], [home], T(21, 12, 0)).length === 0);

  console.log('Sapma ve ışıklar');
  const jitter: LocPoint[] = [];
  for (let i = 0; i < 24; i++) jitter.push(pt(T(24, 10, i * 5), (i * 37) % 130, null, 80));
  const sJ = summarizeDay(day(24), [pt(T(23, 22, 0), 0), ...jitter], [home], T(24, 12, 0), null);
  check('evde konum sapması hareket sayılmaz', sJ.roadMin === 0 && sJ.stopMin === 0 && sJ.leftHome === null && near(sJ.homeMin, 720, 1), `${sJ.homeMin}/${sJ.roadMin}/${sJ.stopMin}`);
  const mk = (from: number, to: number, state: StateInterval['state']): StateInterval => ({ from, to, state });
  const light = smoothShortStops([mk(0, 600_000, 'ROAD'), mk(600_000, 720_000, 'STOP'), mk(720_000, 1_500_000, 'ROAD')]);
  check('iki hareket arası 2 dk\'lık duruş yola katılır', light.length === 1 && light[0].state === 'ROAD' && light[0].to === 1_500_000);
  const longStop = smoothShortStops([mk(0, 600_000, 'ROAD'), mk(600_000, 1_200_000, 'STOP'), mk(1_200_000, 1_500_000, 'ROAD')]);
  check('10 dk\'lık duruş durak kalır', longStop.length === 3 && longStop[1].state === 'STOP');
  check('evdeki kısa duruş yola katılmaz', smoothShortStops([mk(0, 600_000, 'ROAD'), mk(600_000, 720_000, 'HOME'), mk(720_000, 900_000, 'ROAD')]).length === 3);

  console.log('Ekran süresi ve çubuk');
  const iv: StateInterval[] = [mk(0, 100, 'HOME'), mk(100, 200, 'ROAD')];
  const ov = screenOverlapMs(iv, [{ on: 50, off: 150 }, { on: 180, off: 400 }]);
  check('oturumlar durumlarla kesiştirilir', ov.HOME === 50 && ov.ROAD === 70 && ov.WORK === 0 && ov.STOP === 0);
  const win = dayWindow(day(16));
  const bar = barSegments(dayIntervals(day(16), scenario(16), places, now16.getTime()), win.start, now16.getTime());
  check('çubuk gün başından şimdiye boşluksuz', bar[0].from === win.start && bar[bar.length - 1].to === now16.getTime() && bar.every((b, i) => i === 0 || b.from === bar[i - 1].to));
  check('bilinmeyen süre NONE ile doldurulur', barSegments([mk(100, 200, 'HOME')], 0, 300).map((b) => b.state).join() === 'NONE,HOME,NONE');
  check('saat değişimi olmayan günde gün 24 saat', dayWindow(day(16)).end - dayWindow(day(16)).start === 24 * 3_600_000);

  console.log('Yer kaydı doğrulama');
  check('boş ad reddedilir', !validatePlace({ name: '  ', kind: 'WORK', lat: 41, lon: 29 }).ok);
  check('uzun ad reddedilir', !validatePlace({ name: 'x'.repeat(25), kind: 'WORK', lat: 41, lon: 29 }).ok);
  check('bozuk koordinat reddedilir', !validatePlace({ name: 'Ev', kind: 'HOME', lat: 91, lon: 29 }).ok && !validatePlace({ name: 'Ev', kind: 'HOME', lat: NaN, lon: 29 }).ok);
  const vp = validatePlace({ name: '  Ana   depo ', kind: 'WORK', lat: 41, lon: 29 });
  check('ad temizlenir, varsayılan yarıçap türe göre', vp.ok && vp.place.name === 'Ana depo' && vp.place.radiusM === DEFAULT_WORK_RADIUS_M && (validatePlace({ name: 'Ev', kind: 'HOME', lat: 41, lon: 29 }) as { place: { radiusM: number } }).place.radiusM === DEFAULT_HOME_RADIUS_M);
  check('yarıçap sınırlanır', (validatePlace({ name: 'A', kind: 'WORK', lat: 1, lon: 1, radiusM: 5 }) as { place: { radiusM: number } }).place.radiusM === MIN_RADIUS_M && (validatePlace({ name: 'A', kind: 'WORK', lat: 1, lon: 1, radiusM: 9999 }) as { place: { radiusM: number } }).place.radiusM === MAX_RADIUS_M);
  check('ham örnek sınırı: 3 gün önceki gün başı', rawCutoffMs(day(16)) === T(13, 0, 0));
  check('yarım saatten az kayıt "kayıt" sayılmaz', !hasLocationRecord({ ...s16, trackedMin: 29 }) && hasLocationRecord({ ...s16, trackedMin: 30 }) && !hasLocationRecord(null));

  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  const ver = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  check('şema 14: Place, LocationPoint, LocationDay', ver === DATABASE_VERSION && DATABASE_VERSION === 14 && ['Place', 'LocationPoint', 'LocationDay'].every((t) => tables.includes(t)));

  const up = makeTestDb();
  await migrateDbIfNeeded(up.db);
  await up.db.runAsync("INSERT INTO Setting (key, value) VALUES ('eski', 'kalsin')");
  up.raw.exec('DROP TABLE Place; DROP TABLE LocationPoint; DROP TABLE LocationDay; PRAGMA user_version = 13;');
  await migrateDbIfNeeded(up.db);
  check('v13 → v14: tablolar gelir, eski ayar yerinde', (up.raw.prepare('SELECT COUNT(*) AS n FROM Place').get() as { n: number }).n === 0 && (up.raw.prepare("SELECT value FROM Setting WHERE key = 'eski'").get() as { value: string }).value === 'kalsin' && (up.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 14);

  check('takip ve paylaşım varsayılanı: kapalı ve açık', (await isLocationOn(db)) === false && (await isLocationShared(db)) === true);
  await setLocationOn(db, true);
  await setLocationShared(db, false);
  check('ayarlar saklanır', (await isLocationOn(db)) === true && (await isLocationShared(db)) === false);
  await setLocationShared(db, true);

  const bad = await addPlace(db, { name: '', kind: 'HOME', lat: HOME_LAT, lon: HOME_LON });
  check('geçersiz yer eklenmez', !bad.ok && (await listPlaces(db)).length === 0);
  const h = await addPlace(db, { name: 'Ev', kind: 'HOME', lat: HOME_LAT, lon: HOME_LON }, now16);
  const w = await addPlace(db, { name: shop.name, kind: 'WORK', lat: shop.lat, lon: shop.lon }, now16);
  const w2 = await addPlace(db, { name: 'Depo', kind: 'WORK', lat: north(40_000), lon: HOME_LON }, now16);
  const list = await listPlaces(db);
  check('yerler eklenir, evler önce', h.ok && w.ok && w2.ok && list.length === 3 && list[0].kind === 'HOME' && list.filter((p) => p.kind === 'WORK').length === 2);
  if (w2.ok) await deletePlace(db, w2.place.id);
  check('yer silinir', (await listPlaces(db)).length === 2);

  const pts: LocPoint[] = [];
  for (const d of [14, 15, 16]) pts.push(...scenario(d));
  const added = await recordPoints(db, pts);
  check('örnekler yazılır', added === pts.length, `${added}/${pts.length}`);
  check('aynı örnek iki kez yazılmaz', (await recordPoints(db, pts.slice(0, 5))) === 0);
  const junk = await recordPoints(db, [
    { ts: T(16, 3, 0), lat: 999, lon: 29, speed: null, acc: null },
    { ts: T(16, 3, 1), lat: NaN, lon: 29, speed: null, acc: null },
    { ts: T(16, 3, 2), lat: 41, lon: 29, speed: -1, acc: -5 },
  ]);
  check('geçersiz koordinat yazılmaz; eksi hız ve doğruluk boş olur', junk === 1 && (raw.prepare('SELECT speed, acc FROM LocationPoint WHERE ts = ?').get(T(16, 3, 2)) as { speed: number | null; acc: number | null }).speed === null);
  raw.prepare('DELETE FROM LocationPoint WHERE ts = ?').run(T(16, 3, 2));

  const loaded = await loadPointsForDay(db, day(16));
  check('günün örnekleri ve önceki son örnek yüklenir', loaded[0].ts < dayWindow(day(16)).start && loaded.length > 50);

  const provider: SessionProvider = async (start, end) => (start === dayWindow(day(16)).start ? sessions.filter((s) => s.on >= start && s.off <= end + 1) : []);
  const c16 = await computeDay(db, day(16), now16, provider);
  check('veritabanından hesap, bellekteki hesapla aynı', c16.homeMin === s16.homeMin && c16.roadMin === s16.roadMin && c16.workMin === s16.workMin && c16.screenHomeMin === 60, JSON.stringify(c16));

  console.log('Günlük toplamlar ve silme');
  // Eski günlerden iki örnek: biri silinecek, biri (sınırdan önceki son) gece yarısını kapatmak için kalacak
  await recordPoints(db, [pt(T(5, 12, 0), 0), pt(T(10, 8, 0), 0)]);
  const written = await rollupLocation(db, now16, provider);
  check('günlük toplamlar yazılır', written >= 5, `${written}`);
  const days = await listLocationDays(db, day(1), day(16));
  check('eski günlerin toplamı da saklandı (5 ve 10 Kasım)', days.some((d) => d.day === day(5)) && days.some((d) => d.day === day(10)));
  check('14, 15, 16 Kasım satırları var', [14, 15, 16].every((d) => days.some((x) => x.day === day(d))));
  const row16 = await getLocationDay(db, day(16));
  check('16 Kasım satırı hesapla aynı (ekran dahil)', !!row16 && row16.homeMin === s16.homeMin && row16.leftHome === '07:20' && row16.backHome === '13:02' && row16.screenHomeMin === 60);
  const left = raw.prepare('SELECT ts FROM LocationPoint WHERE ts < ? ORDER BY ts').all(rawCutoffMs(day(16))) as { ts: number }[];
  check('sınırdan eski ham örnekler silindi, yalnızca sınırdan önceki SON örnek kaldı', left.length === 1 && left[0].ts === T(10, 8, 0), JSON.stringify(left));

  raw.prepare('UPDATE LocationDay SET homeMin = 999 WHERE day = ?').run(day(10));
  raw.prepare('UPDATE LocationDay SET homeMin = 1 WHERE day = ?').run(day(16));
  const noSessions = await rollupLocation(db, now16);
  const after = await listLocationDays(db, day(1), day(16));
  check('eski gün (dünden önce) yeniden hesaplanmaz', after.find((d) => d.day === day(10))?.homeMin === 999 && noSessions >= 1);
  const again16 = after.find((d) => d.day === day(16));
  check('bugün yeniden hesaplanır, ekran verisi boş gelince eskisi silinmez', again16?.homeMin === s16.homeMin && again16?.screenHomeMin === 60);

  console.log('Yedek ve gizlilik');
  const text = await createBackup(db, {}, now16);
  check('yedekte günlük dakika toplamları var', text.includes('LocationDay'));
  check('yedekte kayıtlı yerler ve ham örnekler yok', !text.includes('"Place"') && !text.includes('"LocationPoint"') && !text.includes('Dükkan-SIR-77') && !text.includes('41.01234'));
  const b = makeTestDb();
  await migrateDbIfNeeded(b.db);
  check('geri yükleyince günlük toplamlar gelir, yerler gelmez', (await restoreBackup(b.db, text)).ok === true && (await listLocationDays(b.db, day(1), day(30))).length === days.length && (await listPlaces(b.db)).length === 0);

  console.log('Tüm günler komutu');
  await setMoodLog(db, day(14), 3, new Date(2026, 10, 14, 20, 0), '');
  const baseToday = {
    day: day(16), tasksDone: [], tasksOpen: 0, driftMinutes: 0, routinesDone: [], routinesSkipped: [], routinesOpen: [],
    energy: { HIGH: 0, EXHAUSTED: 0, DISTRACTED: 0 }, steps: null, stepsReliable: false, screenMinutes: null, sleepMinutes: null, sleepBed: null, sleepWake: null,
    peakStartHour: 9, peakEndHour: 12,
  } as DayFacts;
  const facts = await gatherPeriodFacts(db, now16, undefined, provider);
  check('3 günlük dönem, her güne konum eklenir', facts.days.length === 3 && facts.days.every((d) => d.loc && d.loc.trackedMin > 0), `${facts.days.length}`);
  const st = periodStats(facts);
  const lines = statLines(st);
  check('"şu kadar günde böyle" konum satırları', st.locDays === 3 && lines.includes('Konum kaydı olan gün: 3') && lines.some((l) => l.startsWith('Evde (konumdan): günlük ortalama')) && lines.some((l) => l.startsWith('Dışarıda (konumdan): günlük ortalama') && l.includes('bunun yolda')), JSON.stringify(lines));
  check('dükkana uğranan gün sayısı ve ortalama saatler', lines.includes('Kayıtlı iş noktasında bulunulan gün: 3 / 3') && lines.includes('Evden çıkış: ortalama 07:20') && lines.includes('Eve dönüş: ortalama 13:02'), JSON.stringify(lines));
  check('ekranın evde / yolda / duraklarda dağılımı', lines.some((l) => l.startsWith('Ekran açık (konuma göre, günlük ortalama)')));
  const prompt = buildPeriodPrompt(facts, st, baseToday, []);
  check('komutta konum açıklaması var, "konum verilmedi" yok', prompt.includes(LOCATION_NOTE) && !prompt.includes('Konum verisi verilmedi'));
  check('gün satırında yalnızca dakika ve saat', prompt.includes('konum: evde') && prompt.includes('yolda 44 dk') && prompt.includes('kayıtlı iş noktasında 4 sa 18 dk') && prompt.includes('evden çıkış 07:20') && prompt.includes('eve dönüş 13:02'));
  check('koordinat, yer adı ve adres komuta girmez', !prompt.includes('Dükkan-SIR-77') && !prompt.includes('41.01') && !prompt.includes('29.01') && !prompt.includes('Depo'));
  check('yargılamayan, kınamayan açıklama', !hasBannedWords(LOCATION_NOTE) && LOCATION_NOTE.includes('bir kusur değildir') && LOCATION_NOTE.includes('kınama') && prompt.includes('Sürüş sırasında telefon kullanımı gerektiren fikir verme'));
  check('gün satırı yalnızca konum alanı olan günde konum yazar', !dayLine({ ...facts.days[0], loc: null }).includes('konum:') && dayLine(facts.days[2]).includes('konum:'));
  await setLocationShared(db, false);
  const hidden = await gatherPeriodFacts(db, now16, undefined, provider);
  const hiddenPrompt = buildPeriodPrompt(hidden, periodStats(hidden), baseToday, []);
  check('paylaşım kapalıysa konum komuta hiç girmez', hidden.days.every((d) => !d.loc) && !hiddenPrompt.includes('konum:') && hiddenPrompt.includes('Konum verisi verilmedi') && !hiddenPrompt.includes('Konum özeti verildi'));
  await setLocationShared(db, true);

  await clearLocationData(db);
  check('tüm konum verisi silinir', (await listPlaces(db)).length === 0 && (await listLocationDays(db, day(1), day(30))).length === 0 && (raw.prepare('SELECT COUNT(*) AS n FROM LocationPoint').get() as { n: number }).n === 0);

  console.log('Ekran ve bağlantılar');
  const read = (p: string): string => readFileSync(join(root, p), 'utf8');
  const screen = read('app/location.tsx');
  check('ekran: takip, yerler, bugün, gizlilik', ['Gün haritasını aç', 'Şu an evdeyim, evi kaydet', 'Buradayım, iş noktası olarak kaydet', 'Son günler', 'Tüm konum verisini sil', 'Dakika toplamlarını gün sonu analizine ekle'].every((t) => screen.includes(t)));
  check('ekranda koordinat gösterilmez', !/\.lat\b|\.lon\b|latitude|longitude/.test(screen));
  check('gizlilik metni: koordinat ve yer adı gitmez', screen.includes('Koordinat, adres ve yer adı hiçbir zaman gitmez'));
  const layout = read('app/_layout.tsx');
  check('kök yerleşim: görev yüklenir, kutu ve ekran kayıtlı', layout.includes("import '../services/locationTask'") && layout.includes('<LocationBoot />') && layout.includes('name="location"'));
  const task = read('services/locationTask.ts');
  check('arka plan görevi tanımlı, bağlantıyı kapatmaz', task.includes('defineTask') && task.includes('LOCATION_TASK_NAME') && !task.includes('closeAsync'));
  const track = read('services/locationTracking.ts');
  check('takip: dengeli doğruluk, dakikada bir, ön plan bildirimi, kapanış işareti', track.includes('Accuracy.Balanced') && track.includes('timeInterval: 60_000') && track.includes('foregroundService') && track.includes('off: true'));
  const app = JSON.parse(read('app.json')) as { expo: { plugins: unknown[] } };
  const loc = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location') as [string, Record<string, unknown>] | undefined;
  check('app.json: konum eklentisi arka plan ve ön plan hizmeti açık', !!loc && loc[1].isAndroidBackgroundLocationEnabled === true && loc[1].isAndroidForegroundServiceEnabled === true);
  check('APK akışı konum paketlerini kurar', read('.github/workflows/build-apk.yml').includes('expo-location expo-task-manager'));
  check('Gün akışı ekranından açılır', read('app/day.tsx').includes("router.push('/location')"));
  check('günlük analiz ekranı konum paylaşımını doğru anlatır', read('app/review.tsx').includes('adres ve koordinat değil'));
  const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);
  check('yeni emoji yok', [screen, task, track, read('services/locationLogic.ts'), read('services/periodLogic.ts')].every((s) => !tooNew(s)));
  check('dosyalar var', ['services/locationLogic.ts', 'services/location.ts', 'services/locationTracking.ts', 'services/locationTask.ts', 'components/LocationBoot.tsx'].every((f) => existsSync(join(root, f))));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
