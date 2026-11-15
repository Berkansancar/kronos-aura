/**
 * Android'e özel yerel modül: ekran süresi (Kullanım erişimi), adım sensörü ve arka plan takip servisi.
 * Android dışında ya da yerel modül yoksa (ör. Expo Go) `DeviceActivity` null olur ve uygulama
 * bu özellikleri sessizce gizler.
 */
import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

export interface UsageApp {
  package: string;
  label: string;
  ms: number;
}

export interface UsageSummary {
  screenMs: number;
  apps: UsageApp[];
}

export interface DeviceActivityApi {
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): boolean;
  getUsageSummary(startMs: number, endMs: number): Promise<UsageSummary>;
  hasStepSensor(): boolean;
  getTodaySteps(): number;
  startTracking(): boolean;
  stopTracking(): boolean;
  isTracking(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  openBatterySettings(): boolean;
  getManufacturer(): string;
}

function load(): DeviceActivityApi | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<DeviceActivityApi>('DeviceActivity');
  } catch {
    return null;
  }
}

export const DeviceActivity: DeviceActivityApi | null = load();
export const deviceActivityAvailable = DeviceActivity !== null;
