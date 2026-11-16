/**
 * Telefon aktivitesi (yalnızca Android): ekran süresi, adım sayısı ve arka plan takibi.
 *
 * Tüm veriler telefonda kalır. Yapay zekâya gönderim ayrı bir ayarla (varsayılan: kapalı) açılır.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DeviceActivity, deviceActivityAvailable } from '../modules/device-activity';
import { getDailyStat, listSleepLogs, upsertDailyStat, upsertSleepLog } from '../database/repository';
import type { ActivitySummary, SleepSummary } from '../database/types';
import { buildActivitySummary, dayKey } from './activityLogic';
import { getLanguageSettings } from './language';
import { matchesApp } from './languageLogic';
import { estimateSleep, sleepWindow, summarizeSleep, toSleepLog } from './sleepLogic';

const K_TRACKING = 'activity_tracking';
const K_SINCE = 'activity_tracking_since';
const K_SHARE_AI = 'activity_share_ai';

export { deviceActivityAvailable };

// ───────────────────────── Ayarlar ─────────────────────────

export async function isTrackingEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_TRACKING)) === '1';
}

export async function getTrackingSince(): Promise<string | null> {
  return SecureStore.getItemAsync(K_SINCE);
}

export async function isSharingWithAi(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_SHARE_AI)) === '1';
}

export async function setSharingWithAi(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(K_SHARE_AI, '1');
  else await SecureStore.deleteItemAsync(K_SHARE_AI);
}

// ───────────────────────── İzinler ─────────────────────────

export async function hasStepPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 29) return true; // Android 10 öncesinde çalışma anı izni yok
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
  } catch {
    return false;
  }
}

export async function requestStepPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 29) return true;
  try {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Bildirim izni verilmese de sayım çalışır; yalnızca kalıcı bildirim görünmez.
  }
}

// ───────────────────────── Arka plan takibi ─────────────────────────

export async function enableTracking(): Promise<{ ok: boolean; reason?: string }> {
  if (!DeviceActivity) return { ok: false, reason: 'Bu özellik yalnızca Android sürümünde çalışır.' };
  if (!DeviceActivity.hasStepSensor()) {
    return { ok: false, reason: 'Telefonunda adım sensörü bulunamadı.' };
  }
  if (!(await requestStepPermission())) {
    return {
      ok: false,
      reason:
        'Fiziksel aktivite izni verilmedi. Ayarlar > Uygulamalar > Kronos & Aura > İzinler bölümünden açabilirsin.',
    };
  }
  await requestNotificationPermission();
  if (!DeviceActivity.startTracking()) {
    return { ok: false, reason: 'Takip servisi başlatılamadı. Uygulama açıkken tekrar dene.' };
  }
  await SecureStore.setItemAsync(K_TRACKING, '1');
  await SecureStore.setItemAsync(K_SINCE, new Date().toISOString());
  return { ok: true };
}

export async function disableTracking(): Promise<void> {
  DeviceActivity?.stopTracking();
  await SecureStore.deleteItemAsync(K_TRACKING);
}

/** Uygulama her öne geldiğinde: takip açık bırakıldıysa ve servis düşmüşse yeniden başlatır. */
export async function ensureTracking(): Promise<void> {
  if (!DeviceActivity) return;
  try {
    if (!(await isTrackingEnabled())) return;
    if (!(await hasStepPermission())) return;
    if (!DeviceActivity.isTracking()) DeviceActivity.startTracking();
  } catch {
    // Takip başlatılamazsa uygulamanın geri kalanı etkilenmesin.
  }
}

// ───────────────────────── Okuma ve kaydetme ─────────────────────────

export interface ActivityReading {
  available: boolean;
  usageAccess: boolean;
  stepSensor: boolean;
  stepPermission: boolean;
  /** Kullanıcı arka plan takibini açmış mı? */
  trackingEnabled: boolean;
  /** Servis şu an çalışıyor mu? */
  serviceRunning: boolean;
  steps: number;
  screenMinutes: number | null;
  apps: { label: string; minutes: number }[];
  batteryUnrestricted: boolean;
  manufacturer: string;
}

function emptyReading(): ActivityReading {
  return {
    available: false,
    usageAccess: false,
    stepSensor: false,
    stepPermission: false,
    trackingEnabled: false,
    serviceRunning: false,
    steps: 0,
    screenMinutes: null,
    apps: [],
    batteryUnrestricted: false,
    manufacturer: '',
  };
}

/** Telefondan o anki durumu okur (veritabanına yazmaz). */
export async function readActivity(now = new Date()): Promise<ActivityReading> {
  if (!DeviceActivity) return emptyReading();
  const r = emptyReading();
  r.available = true;
  try {
    r.usageAccess = DeviceActivity.hasUsageAccess();
    r.stepSensor = DeviceActivity.hasStepSensor();
    r.stepPermission = await hasStepPermission();
    r.trackingEnabled = await isTrackingEnabled();
    r.serviceRunning = DeviceActivity.isTracking();
    r.steps = r.trackingEnabled ? DeviceActivity.getTodaySteps() : 0;
    r.batteryUnrestricted = DeviceActivity.isIgnoringBatteryOptimizations();
    r.manufacturer = DeviceActivity.getManufacturer();

    if (r.usageAccess) {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const usage = await DeviceActivity.getUsageSummary(startOfDay, now.getTime());
      r.screenMinutes = Math.round(usage.screenMs / 60_000);
      r.apps = usage.apps
        .map((a) => ({ label: a.label, minutes: Math.round(a.ms / 60_000) }))
        .filter((a) => a.minutes >= 1);
    }
  } catch {
    // Bir okuma başarısız olursa eldeki değerlerle devam edilir.
  }
  return r;
}

// ───────────────────────── Uyku ─────────────────────────

let lastSleepRefresh = 0;

/**
 * Son 3 gecenin uykusunu ekran oturumlarından tahmin edip kaydeder. Android olay geçmişini kısa süre
 * tuttuğu için uygulama açıldıkça güncellenir; 20 dakikada bir çalışır (zorlanmadıkça).
 */
export async function refreshSleep(db: SQLiteDatabase, now = new Date(), force = false): Promise<void> {
  if (!DeviceActivity) return;
  try {
    if (!DeviceActivity.hasUsageAccess()) return;
    if (!force && now.getTime() - lastSleepRefresh < 20 * 60_000) return;
    lastSleepRefresh = now.getTime();
    for (let back = 0; back < 3; back += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const { start, end } = sleepWindow(day, now);
      if (end <= start) continue;
      const est = estimateSleep(await DeviceActivity.getScreenSessions(start, end));
      if (est) await upsertSleepLog(db, toSleepLog(est));
    }
  } catch {
    // Uyku tahmini yapılamazsa uygulamanın geri kalanı etkilenmez.
  }
}

export async function loadSleepSummary(
  db: SQLiteDatabase,
  now = new Date()
): Promise<SleepSummary | undefined> {
  if (!deviceActivityAvailable) return undefined;
  try {
    const logs = await listSleepLogs(db, 14);
    return logs.length > 0 ? summarizeSleep(logs, now) : undefined;
  } catch {
    return undefined;
  }
}

/** Bugünün özetini veritabanına yazar ve koçların kullanacağı özeti döndürür. */
export async function refreshActivity(
  db: SQLiteDatabase,
  now = new Date()
): Promise<{ reading: ActivityReading; summary: ActivitySummary | undefined }> {
  const reading = await readActivity(now);
  await refreshSleep(db, now);
  if (reading.available && (reading.trackingEnabled || reading.screenMinutes !== null)) {
    try {
      // En çok kullanılan 10 uygulama; dil uygulaması 11-15. sıradaysa o da korunur (dil süresi eksik kalmasın)
      const langApps = (await getLanguageSettings(db).catch(() => null))?.apps ?? [];
      const extra = reading.apps.slice(10).filter((a) => matchesApp(a.label, langApps));
      await upsertDailyStat(db, {
        day: dayKey(now),
        steps: reading.steps,
        screenMinutes: reading.screenMinutes,
        topApps: [...reading.apps.slice(0, 10), ...extra],
      });
    } catch {
      // Kayıt yazılamazsa anlık okuma yine de gösterilir.
    }
  }
  return { reading, summary: await loadActivitySummary(db, now) };
}

/** Veritabanındaki bugünkü özet (koç sohbeti gibi yerlerde telefonu yeniden okumadan kullanılır). */
export async function loadActivitySummary(
  db: SQLiteDatabase,
  now = new Date()
): Promise<ActivitySummary | undefined> {
  if (!deviceActivityAvailable) return undefined;
  try {
    const stat = await getDailyStat(db, dayKey(now));
    return buildActivitySummary(stat, await isTrackingEnabled(), await getTrackingSince(), now);
  } catch {
    return undefined;
  }
}
