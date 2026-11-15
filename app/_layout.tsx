import { Suspense, useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/theme';
import { DB_NAME, migrateDbIfNeeded } from '../database/schema';
import { ensureTracking } from '../services/activity';

/** Bildirime dokunulunca bildirimin belirttiği ekranı (sabah brifingi, gün sonu) açar. */
const ALLOWED_ROUTES = new Set(['/morning', '/review']);

function openFromNotification(response: Notifications.NotificationResponse | null | undefined): void {
  const route = response?.notification.request.content.data?.route;
  if (typeof route !== 'string' || !ALLOWED_ROUTES.has(route)) return;
  // Uygulama yeni açılıyorsa gezinme hazır olana kadar kısa bekle
  setTimeout(() => {
    try {
      router.push(route as '/morning' | '/review');
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
      <SQLiteProvider databaseName={DB_NAME} onInit={migrateDbIfNeeded} useSuspense>
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
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}
