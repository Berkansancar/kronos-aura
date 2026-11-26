/**
 * Arka plan konum görevi. Bu dosya uygulama açılırken (app/_layout.tsx) YÜKLENMELİDİR; görev tanımı ancak o zaman
 * kayıtlıdır ve uygulama kapalıyken bile sistem görevi uyandırabilir.
 *
 * Görev yalnızca ham örnekleri veritabanına yazar ve (en çok 3 saatte bir) günlük toplamları yeniler.
 * Veritabanı bağlantısı KAPATILMAZ: uygulama açıkken aynı bağlantı paylaşılır, kapatmak uygulamayı bozar.
 */
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { getSetting, setSetting } from '../database/repository';
import { DB_NAME } from '../database/schema';
import { recordPoints, rollupLocation } from './location';
import { LOCATION_ROLLUP_KEY, LOCATION_TASK_NAME, ROLLUP_EVERY_MS, type LocPoint } from './locationLogic';
import { screenSessions } from './locationTracking';

export function toPoint(l: Location.LocationObject): LocPoint {
  const c = l.coords;
  return {
    ts: l.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    speed: typeof c.speed === 'number' && c.speed >= 0 ? c.speed : null,
    acc: typeof c.accuracy === 'number' && c.accuracy >= 0 ? c.accuracy : null,
  };
}

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data?.locations || data.locations.length === 0) return;
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await recordPoints(db, data.locations.map(toPoint));
    const last = Number((await getSetting(db, LOCATION_ROLLUP_KEY)) ?? 0);
    const now = new Date();
    if (!Number.isFinite(last) || now.getTime() - last > ROLLUP_EVERY_MS) {
      await rollupLocation(db, now, screenSessions);
      await setSetting(db, LOCATION_ROLLUP_KEY, String(now.getTime()));
    }
  } catch {
    // Görev sessizce geçer: bir örnek yazılamazsa sonraki gelir.
  }
});
