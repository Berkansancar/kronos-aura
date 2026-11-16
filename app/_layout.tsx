import { Suspense, useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/theme';
import { DB_NAME, migrateDbIfNeeded } from '../database/schema';
import { ensureWorkSeed } from '../services/workSettings';
import { ensureTracking } from '../services/activity';

/** Bildirime dokunulunca bildirimin belirttiği ekranı (sabah brifingi, gün sonu) açar. */
const ALLOWED_ROUTES = new Set(['/morning', '/review', '/nutrition', '/goals', '/mark', '/day']);

function openFromNotification(response: Notifications.NotificationResponse | null | undefined): void {
  const route = response?.notification.request.content.data?.route;
  if (typeof route !== 'string' || !ALLOWED_ROUTES.has(route)) return;
  // Uygulama yeni açılıyorsa gezinme hazır olana kadar kısa bekle
  setTimeout(() => {
    try {
      router.push(route as '/morning' | '/review' | '/nutrition' | '/goals' | '/mark' | '/day');
    } catch {
      // Gezinme hazır değilse ana ekran açık kalır; kullanıcı kartlardan girebilir.
    }
  }, 400);
}

function useNotificationOpen(): void {
  useEffect(() => {
    let alive = true;
    let handled: string | null = null;
    const handle = (r: Notifications.NotificationResponse | null | undefined) => {
      if (!alive || !r) return;
      if (handled === r.notification.request.identifier) return;
      handled = r.notification.request.identifier;
      openFromNotification(r);
    };
    Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
}

function Loading() {
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <ActivityIndicator color={colors.kronos} />
    </View>
  );
}

/** Veritabanını hazırlar; iş programı ilk açılışta bir kez kaydedilir (hata uygulamayı durdurmaz). */
async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrateDbIfNeeded(db);
  await ensureWorkSeed(db).catch(() => undefined);
}

export default function RootLayout() {
  useNotificationOpen();
  // Arka plan takibi açık bırakıldıysa, uygulama her öne geldiğinde servisin çalıştığından emin ol.
  useEffect(() => {
    ensureTracking();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ensureTracking();
    });
    return () => sub.remove();
  }, []);

  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider databaseName={DB_NAME} onInit={initDatabase} useSuspense>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="chat" />
          <Stack.Screen name="activity" />
          <Stack.Screen name="routines" />
          <Stack.Screen name="review" />
          <Stack.Screen name="morning" />
          <Stack.Screen name="weekly" />
          <Stack.Screen name="nutrition" />
          <Stack.Screen name="goals" />
          <Stack.Screen name="mark" />
          <Stack.Screen name="day" />
          <Stack.Screen name="history" />
          <Stack.Screen name="language" />
          <Stack.Screen name="hero" />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}
