/**
 * Rutin hatırlatma bildirimleri (Android, yerel bildirim; internet gerekmez).
 * Hata verirse sessizce atlanır; bildirim olmadan da uygulama çalışır.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { RoutineBrief } from '../database/types';
import {
  REMINDER_ID_PREFIX,
  planReminders,
  reminderSignature,
} from './routineRemindersLogic';

const CHANNEL_ID = 'rutinler';

export type ReminderStatus = 'ok' | 'no-permission' | 'unavailable';

let handlerSet = false;
let channelReady = false;
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
  channelReady = true;
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
  now: Date = new Date()
): Promise<ReminderStatus> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    setup();
    if (!(await hasNotificationPermission())) return 'no-permission';
    await ensureChannel();

    const plan = planReminders(briefs, now);
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
        content: { title: p.title, body: p.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: p.at,
          channelId: CHANNEL_ID,
        },
      });
    }
    lastSignature = signature;
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
