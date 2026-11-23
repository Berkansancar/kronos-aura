import { Suspense, useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/theme';
import { DB_NAME, migrateDbIfNeeded } from '../database/schema';
import { ensureWorkSeed } from '../services/workSettings';
import { ensureTracking } from '../services/activity';
import { OpeningQuote } from '../components/OpeningQuote';
import { RoutineActionRunner } from '../components/RoutineActionRunner';
import { enqueueAction } from '../services/notificationActionQueue';
import { actionKey, isStale, parseRoutineAction } from '../services/routineActionLogic';

// Telefonun açılış penceresi (koyu zemin + logo), açılış sözü ekranı çizilene kadar açık kalır; böylece beyaz ekran görünmez.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Bildirime dokunulunca bildirimin belirttiği ekranı (sabah brifingi, gün sonu) açar. */
const ALLOWED_ROUTES = new Set(['/morning', '/review', '/nutrition', '/goals', '/mark', '/day', '/exercise-run']);

function openFromNotification(response: Notifications.NotificationResponse | null | undefined): void {
  const route = response?.notification.request.content.data?.route;
  if (typeof route !== 'string' || !ALLOWED_ROUTES.has(route)) return;
  // Uygulama yeni açılıyorsa gezinme hazır olana kadar kısa bekle
  setTimeout(() => {
    try {
      router.push(route as '/morning' | '/review' | '/nutrition' | '/goals' | '/mark' | '/day' | '/exercise-run');
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
      // Rutin bildirimindeki düğme ("Yaptım" gibi): cevabı kuyruğa al; veritabanı hazır olunca işlenir
      const action = parseRoutineAction(r.actionIdentifier, r.notification.request.content.data);
      if (action) {
        const date = r.notification.date;
        if (!isStale(date, Date.now())) {
          enqueueAction({ key: actionKey(r.notification.request.identifier, r.actionIdentifier, date), action });
        }
        return;
      }
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
  // Her ihtimale karşı: açılış penceresi 8 saniyeden uzun takılı kalmasın
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 8000);
    return () => clearTimeout(t);
  }, []);
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
        <RoutineActionRunner />
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
          <Stack.Screen name="week" />
          <Stack.Screen name="guide" />
          <Stack.Screen name="habits" />
          <Stack.Screen name="quiz" />
          <Stack.Screen name="vocab" />
          <Stack.Screen name="routine-run" />
          <Stack.Screen name="monthly" />
          <Stack.Screen name="exercise" />
          <Stack.Screen name="exercise-move" />
          <Stack.Screen name="exercise-run" />
        </Stack>
        <OpeningQuote />
      </SQLiteProvider>
    </Suspense>
  );
}
