/**
 * Konum izni, arka plan takibini açıp kapatma ve "buradayım" ile yer kaydetme (expo-location).
 * Bu dosya React Native'e bağlıdır; saf mantık services/locationLogic.ts, veritabanı services/location.ts'dedir.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DeviceActivity } from '../modules/device-activity';
import {
  addPlace,
  isLocationOn,
  recordPoints,
  setLocationOn,
  type AddPlaceResult,
  type SessionProvider,
} from './location';
import { LOCATION_TASK_NAME, type PlaceKind } from './locationLogic';

/** Ekran açık kalma oturumları (Kullanım erişimi yoksa ya da Android değilse null). */
export const screenSessions: SessionProvider = async (startMs, endMs) => {
  if (!DeviceActivity) return null;
  try {
    if (!DeviceActivity.hasUsageAccess()) return null;
    const raw = await DeviceActivity.getScreenSessions(startMs, endMs);
    return raw.map((r) => ({ on: r.on, off: r.off }));
  } catch {
    return null;
  }
};

export const locationAvailable = Platform.OS === 'android';

/**
 * Pil dostu ayar: dengeli doğruluk (GPS yerine çoğunlukla ağ ve kablosuz konumu), dakikada en çok bir örnek.
 * Telefon uyku modunda ve durağansa Android zaten örnek vermez; süre, bir sonraki örneğe kadar aynı yerde sayılır.
 */
const TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 60_000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  foregroundService: {
    notificationTitle: 'Kronos & Aura',
    notificationBody: 'Gün haritası için konum örneği alınıyor',
    notificationColor: '#5FD6B4',
  },
};

export interface LocationPermissionState {
  foreground: boolean;
  /** "Her zaman izin ver" */
  background: boolean;
}

export async function getPermissionState(): Promise<LocationPermissionState> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    return { foreground: fg.granted, background: bg.granted };
  } catch {
    return { foreground: false, background: false };
  }
}

export async function isTaskRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'foreground' | 'background' | 'error'; message: string };

/** Önce uygulama açıkken izin, sonra "her zaman" izni ister (Android 11+ ayarlara yönlendirir). */
export async function startLocationTracking(db: SQLiteDatabase): Promise<StartResult> {
  if (!locationAvailable) return { ok: false, reason: 'unavailable', message: 'Konum takibi yalnızca Android telefonda çalışır.' };
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return { ok: false, reason: 'foreground', message: 'Konum izni verilmedi. İstersen telefonun ayarlarından açabilirsin.' };
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) {
      return {
        ok: false,
        reason: 'background',
        message: 'Arka planda çalışması için konum iznini "Her zaman izin ver" yap: Ayarlar > Uygulamalar > Kronos & Aura > İzinler > Konum.',
      };
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, TASK_OPTIONS);
    await setLocationOn(db, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'Konum takibi başlatılamadı.' };
  }
}

export async function stopLocationTracking(db: SQLiteDatabase): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    // zaten durmuş olabilir
  }
  // Takip kapalıyken geçen süre "evde" sayılmasın: kapanış işareti bırak
  await recordPoints(db, [{ ts: Date.now(), lat: 0, lon: 0, speed: null, acc: null, off: true }]).catch(() => undefined);
  await setLocationOn(db, false);
}

/** Uygulama öne gelince: kullanıcı açık bıraktıysa ve görev düşmüşse yeniden başlatır. Hata vermez. */
export async function ensureLocationTracking(db: SQLiteDatabase): Promise<void> {
  if (!locationAvailable) return;
  try {
    if (!(await isLocationOn(db))) return;
    const perm = await getPermissionState();
    if (!perm.foreground || !perm.background) return;
    if (await isTaskRunning()) return;
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, TASK_OPTIONS);
  } catch {
    // Takip başlatılamazsa uygulamanın geri kalanı etkilenmesin.
  }
}

/** Şu anki konumu bir yer olarak kaydeder ("Şu an evdeyim"). */
export async function saveHere(db: SQLiteDatabase, kind: PlaceKind, name: string): Promise<AddPlaceResult> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return { ok: false, error: 'Konum izni gerekiyor.' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const r = await addPlace(db, { name, kind, lat: pos.coords.latitude, lon: pos.coords.longitude });
    if (r.ok) {
      // İlk örnek hemen yazılsın; gün haritası bu noktadan başlasın
      await recordPoints(db, [
        {
          ts: pos.timestamp,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: null,
          acc: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        },
      ]).catch(() => undefined);
    }
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Konum alınamadı.' };
  }
}
