/**
 * Rutin hatırlatma bildirimleri (Android, yerel bildirim; internet gerekmez).
 * Hata verirse sessizce atlanır; bildirim olmadan da uygulama çalışır.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import type { RoutineBrief } from '../database/types';
import { ROUTINE_ACTIONS, ROUTINE_CATEGORY } from './routineActionLogic';
import {
  REMINDER_CAP,
  REMINDER_DAYS,
  REMINDER_ID_PREFIX,
  planReminders,
  reminderSignature,
  type ReminderExtras,
} from './routineRemindersLogic';

const CHANNEL_ID = 'rutinler';
/** Sabah egzersizi: yüksek öncelikli, sesli ve titreşimli ayrı kanal */
const URGENT_CHANNEL_ID = 'egzersiz';

const K_REVIEW_REMINDER = 'review_reminder';

/** Akşam 21:30 "günü değerlendirelim" bildirimi. Varsayılan açık. */
export async function getReviewReminderEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(K_REVIEW_REMINDER)) !== '0';
  } catch {
    return true;
  }
}

export async function setReviewReminderEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.deleteItemAsync(K_REVIEW_REMINDER);
  else await SecureStore.setItemAsync(K_REVIEW_REMINDER, '0');
}

const K_MORNING = 'morning_reminder';
const K_MORNING_HOUR = 'morning_hour';
export const MORNING_HOURS = [7, 8, 9, 10] as const;
export const DEFAULT_MORNING_HOUR = 8;

export interface MorningSettings {
  enabled: boolean;
  hour: number;
}

/** Sabah brifingi bildirimi. Varsayılan: açık, 08:00. */
export async function getMorningSettings(): Promise<MorningSettings> {
  try {
    const off = (await SecureStore.getItemAsync(K_MORNING)) === '0';
    const h = Number(await SecureStore.getItemAsync(K_MORNING_HOUR));
    const hour = (MORNING_HOURS as readonly number[]).includes(h) ? h : DEFAULT_MORNING_HOUR;
    return { enabled: !off, hour };
  } catch {
    return { enabled: true, hour: DEFAULT_MORNING_HOUR };
  }
}

export async function setMorningSettings(s: MorningSettings): Promise<void> {
  if (s.enabled) await SecureStore.deleteItemAsync(K_MORNING);
  else await SecureStore.setItemAsync(K_MORNING, '0');
  await SecureStore.setItemAsync(K_MORNING_HOUR, String(s.hour));
}

export type ReminderStatus = 'ok' | 'no-permission' | 'unavailable';

let handlerSet = false;
let channelReady = false;
let categoryReady = false;
let lastSignature: string | null = null;

function setup(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Rutin hatırlatmaları',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'Günlük rutinlerin için "bugün yapacak mısın?" hatırlatmaları',
  });
  await Notifications.setNotificationChannelAsync(URGENT_CHANNEL_ID, {
    name: 'Sabah egzersizi',
    importance: Notifications.AndroidImportance.HIGH,
    description: 'Egzersiz günlerinde güne başlama saatinde gelen hatırlatma',
    sound: 'default',
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    enableVibrate: true,
  });
  channelReady = true;
}

/**
 * Rutin bildirimlerine "Yaptım / Yapacağım / Bugün değil" düğmeleri ekler. Düğme uygulamayı kısa süre açar:
 * cevabın kaybolmaması için (uygulama kapalıyken arka planda çalıştırmaya güvenmiyoruz).
 */
async function ensureCategory(): Promise<void> {
  if (categoryReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationCategoryAsync(
    ROUTINE_CATEGORY,
    ROUTINE_ACTIONS.map((a) => ({
      identifier: a.identifier,
      buttonTitle: a.title,
      options: { opensAppToForeground: true },
    }))
  );
  categoryReady = true;
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted === true;
  } catch {
    return false;
  }
}

/** Kullanıcıdan bildirim izni ister (Android 13+ için gerekli). */
export async function askNotificationPermission(): Promise<boolean> {
  try {
    setup();
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted === true;
  } catch {
    return false;
  }
}

/** Planı bildirim sistemiyle eşitler: eski rutin bildirimlerini siler, yenilerini kurar. */
export async function syncRoutineReminders(
  briefs: RoutineBrief[],
  now: Date = new Date(),
  extras: ReminderExtras = {}
): Promise<ReminderStatus> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    setup();
    if (!(await hasNotificationPermission())) return 'no-permission';
    await ensureChannel();
    await ensureCategory().catch(() => undefined);

    const morning = await getMorningSettings();
    const plan = planReminders(briefs, now, REMINDER_DAYS, REMINDER_CAP, {
      ...extras,
      review: await getReviewReminderEnabled(),
      morning: morning.enabled ? { hour: morning.hour, minute: 0 } : null,
    });
    const signature = reminderSignature(plan);
    if (signature === lastSignature) return 'ok';

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(REMINDER_ID_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    for (const p of plan) {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: {
          title: p.title,
          body: p.body,
          data: p.route ? { route: p.route } : p.routineId ? { routineId: p.routineId, day: p.day } : {},
          // Yalnızca rutin hatırlatmalarında düğmeler görünür (sabah brifingi, su, değerlendirme gibilerde değil)
          ...(p.routineId && !p.route && categoryReady ? { categoryIdentifier: ROUTINE_CATEGORY } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: p.at,
          channelId: p.urgent ? URGENT_CHANNEL_ID : CHANNEL_ID,
        },
      });
    }
    lastSignature = signature;
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
