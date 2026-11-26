/**
 * Gün haritası: kayıtlı yerler, ham konum örnekleri ve günlük dakika toplamları (veritabanı tarafı).
 * Mantık services/locationLogic.ts içindedir. Bu dosya expo-location'a bağlı DEĞİLDİR (Node testlerinde çalışır);
 * konum alma ve arka plan görevi services/locationTracking.ts'dedir.
 *
 * Gizlilik: Place ve LocationPoint tabloları yedeğe girmez. Ham örnekler en çok 3 gün tutulur; sonrasında yalnızca
 * LocationDay'deki dakika toplamları kalır. Yapay zekâ komutlarına yalnızca bu dakika toplamları gider.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { newId } from '../database/ids';
import { dayKey, parseDayKey } from './activityLogic';
import {
  LOCATION_ON_KEY,
  LOCATION_SHARE_KEY,
  dayWindow,
  rawCutoffMs,
  summarizeDay,
  validatePlace,
  type DayLocationSummary,
  type LocPoint,
  type PlaceInput,
  type PlaceKind,
  type PlaceLite,
  type ScreenSession,
} from './locationLogic';

export interface Place extends PlaceLite {
  createdAt: string;
}

/** Bir günün ekran oturumlarını verir (yoksa/okunamıyorsa null). Android modülü buradan dışarıdan sağlanır. */
export type SessionProvider = (startMs: number, endMs: number) => Promise<ScreenSession[] | null>;

// ───────────────────────── Ayarlar ─────────────────────────

export async function isLocationOn(db: SQLiteDatabase): Promise<boolean> {
  return (await getSetting(db, LOCATION_ON_KEY)) === '1';
}

export async function setLocationOn(db: SQLiteDatabase, on: boolean): Promise<void> {
  await setSetting(db, LOCATION_ON_KEY, on ? '1' : '0');
}

/** Dakika toplamlarının yapay zekâ komutuna eklenmesi (varsayılan: açık; kullanıcı konum özetini istedi). */
export async function isLocationShared(db: SQLiteDatabase): Promise<boolean> {
  return (await getSetting(db, LOCATION_SHARE_KEY)) !== '0';
}

export async function setLocationShared(db: SQLiteDatabase, on: boolean): Promise<void> {
  await setSetting(db, LOCATION_SHARE_KEY, on ? '1' : '0');
}

// ───────────────────────── Yerler ─────────────────────────

export async function listPlaces(db: SQLiteDatabase): Promise<Place[]> {
  return db.getAllAsync<Place>('SELECT id, name, kind, lat, lon, radiusM, createdAt FROM Place ORDER BY kind, createdAt');
}

export type AddPlaceResult = { ok: true; place: Place } | { ok: false; error: string };

export async function addPlace(db: SQLiteDatabase, input: PlaceInput, now: Date = new Date()): Promise<AddPlaceResult> {
  const check = validatePlace(input);
  if (!check.ok) return check;
  const p = check.place;
  const place: Place = { id: newId('plc'), name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, radiusM: p.radiusM, createdAt: now.toISOString() };
  await db.runAsync('INSERT INTO Place (id, name, kind, lat, lon, radiusM, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    place.id,
    place.name,
    place.kind,
    place.lat,
    place.lon,
    place.radiusM,
    place.createdAt,
  ]);
  return { ok: true, place };
}

export async function deletePlace(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM Place WHERE id = ?', [id]);
}

export const placeCount = (places: PlaceLite[], kind: PlaceKind): number => places.filter((p) => p.kind === kind).length;

// ───────────────────────── Ham örnekler ─────────────────────────

/**
 * Örnekleri ekler (aynı milisaniye tekrar yazılmaz). "Takip kapandı" işareti (off) doğruluk = -1 olarak saklanır;
 * okunurken yine `off` olur. Geçersiz koordinatlı gerçek örnekler atılır.
 */
export async function recordPoints(db: SQLiteDatabase, pts: LocPoint[]): Promise<number> {
  let n = 0;
  for (const p of pts) {
    if (!Number.isFinite(p.ts)) continue;
    if (p.off) {
      const r = await db.runAsync('INSERT OR IGNORE INTO LocationPoint (ts, lat, lon, speed, acc) VALUES (?, 0, 0, NULL, -1)', [Math.round(p.ts)]);
      n += r.changes;
      continue;
    }
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    const r = await db.runAsync('INSERT OR IGNORE INTO LocationPoint (ts, lat, lon, speed, acc) VALUES (?, ?, ?, ?, ?)', [
      Math.round(p.ts),
      p.lat,
      p.lon,
      p.speed !== null && Number.isFinite(p.speed) && p.speed >= 0 ? p.speed : null,
      p.acc !== null && Number.isFinite(p.acc) && p.acc >= 0 ? p.acc : null,
    ]);
    n += r.changes;
  }
  return n;
}

interface PointRow {
  ts: number;
  lat: number;
  lon: number;
  speed: number | null;
  acc: number | null;
}

const toPoint = (r: PointRow): LocPoint => (r.acc === -1 ? { ts: r.ts, lat: r.lat, lon: r.lon, speed: null, acc: null, off: true } : r);

/** Günün örnekleri ve gece yarısını kapatan, günden hemen önceki son örnek. */
export async function loadPointsForDay(db: SQLiteDatabase, day: string): Promise<LocPoint[]> {
  const { start, end } = dayWindow(day);
  const before = await db.getFirstAsync<PointRow>('SELECT ts, lat, lon, speed, acc FROM LocationPoint WHERE ts < ? ORDER BY ts DESC LIMIT 1', [start]);
  const inside = await db.getAllAsync<PointRow>('SELECT ts, lat, lon, speed, acc FROM LocationPoint WHERE ts >= ? AND ts < ? ORDER BY ts', [start, end]);
  const rows = before ? [before, ...inside] : inside;
  return rows.map(toPoint);
}

// ───────────────────────── Günlük toplamlar ─────────────────────────

interface DayRow {
  day: string;
  homeMin: number;
  workMin: number | null;
  roadMin: number;
  stopMin: number;
  trackedMin: number;
  leftHome: string | null;
  backHome: string | null;
  screenHomeMin: number | null;
  screenRoadMin: number | null;
  screenOutMin: number | null;
}

const COLS = 'day, homeMin, workMin, roadMin, stopMin, trackedMin, leftHome, backHome, screenHomeMin, screenRoadMin, screenOutMin';

/** Bir günü ham örneklerden hesaplar (kaydetmez). */
export async function computeDay(db: SQLiteDatabase, day: string, now: Date, sessions?: SessionProvider): Promise<DayLocationSummary> {
  const [points, places] = await Promise.all([loadPointsForDay(db, day), listPlaces(db)]);
  const { start, end } = dayWindow(day);
  let screen: ScreenSession[] | null = null;
  if (sessions) {
    try {
      screen = await sessions(start, Math.min(end, now.getTime()));
    } catch {
      screen = null;
    }
  }
  return summarizeDay(day, points, places, now.getTime(), screen);
}

async function saveDay(db: SQLiteDatabase, s: DayLocationSummary, now: Date): Promise<void> {
  await db.runAsync(
    `INSERT INTO LocationDay (${COLS}, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET homeMin = excluded.homeMin, workMin = excluded.workMin, roadMin = excluded.roadMin,
       stopMin = excluded.stopMin, trackedMin = excluded.trackedMin, leftHome = excluded.leftHome, backHome = excluded.backHome,
       screenHomeMin = COALESCE(excluded.screenHomeMin, screenHomeMin),
       screenRoadMin = COALESCE(excluded.screenRoadMin, screenRoadMin),
       screenOutMin = COALESCE(excluded.screenOutMin, screenOutMin),
       updatedAt = excluded.updatedAt`,
    [s.day, s.homeMin, s.workMin, s.roadMin, s.stopMin, s.trackedMin, s.leftHome, s.backHome, s.screenHomeMin, s.screenRoadMin, s.screenOutMin, now.toISOString()]
  );
}

export async function getLocationDay(db: SQLiteDatabase, day: string): Promise<DayLocationSummary | null> {
  return db.getFirstAsync<DayRow>(`SELECT ${COLS} FROM LocationDay WHERE day = ?`, [day]);
}

export async function listLocationDays(db: SQLiteDatabase, fromDay: string, toDay: string): Promise<DayLocationSummary[]> {
  return db.getAllAsync<DayRow>(`SELECT ${COLS} FROM LocationDay WHERE day >= ? AND day <= ? ORDER BY day`, [fromDay, toDay]);
}

/**
 * Ham örneklerden günlük toplamları yazar, sonra eski ham örnekleri siler.
 *  - Dün ve bugün her seferinde yeniden hesaplanır.
 *  - Daha eski günler yalnızca satırı yoksa hesaplanır (ham örnekler silinmeye başladığında bozulmasın).
 *  - Silme sınırından önceki SON örnek (gece yarısını kapatmak için) saklanır.
 * Döner: yazılan gün sayısı.
 */
export async function rollupLocation(db: SQLiteDatabase, now: Date, sessions?: SessionProvider): Promise<number> {
  const today = dayKey(now);
  const first = await db.getFirstAsync<{ ts: number | null }>('SELECT MIN(ts) AS ts FROM LocationPoint');
  if (first?.ts == null) return 0;
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  let written = 0;
  let d = dayKey(new Date(first.ts));
  // Gün gün ilerle (en çok ~RAW_KEEP_DAYS + birkaç gün; tekrar çalışsa da ucuz)
  for (let guard = 0; guard < 400 && d <= today; guard++) {
    const existing = d >= yesterday ? null : await getLocationDay(db, d);
    if (!existing) {
      const s = await computeDay(db, d, now, sessions);
      if (s.trackedMin > 0) {
        await saveDay(db, s, now);
        written += 1;
      }
    }
    const p = parseDayKey(d);
    d = dayKey(new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1));
  }
  const cutoff = rawCutoffMs(today);
  const keep = await db.getFirstAsync<{ ts: number }>('SELECT ts FROM LocationPoint WHERE ts < ? ORDER BY ts DESC LIMIT 1', [cutoff]);
  await db.runAsync('DELETE FROM LocationPoint WHERE ts < ? AND ts <> ?', [cutoff, keep?.ts ?? -1]);
  return written;
}

/** Tüm konum verisini siler (kayıtlı yerler dahil). Ayar anahtarlarına dokunmaz. */
export async function clearLocationData(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM LocationPoint');
  await db.runAsync('DELETE FROM LocationDay');
  await db.runAsync('DELETE FROM Place');
}
