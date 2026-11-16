import { useEffect } from 'react';
import { DeviceEventEmitter, Platform, ToastAndroid } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { DATA_CHANGED_EVENT, drainActions, subscribeActions } from '../services/notificationActionQueue';
import { refreshReminders } from '../services/reminderSync';
import { runRoutineAction } from '../services/routineActions';

/** Son işlenen bildirim cevabı: uygulama her açılışta aynı son cevabı yeniden vermesin diye saklanır. */
const LAST_ACTION_KEY = 'notif_last_action';

/**
 * Bildirimdeki "Yaptım / Yapacağım / Bugün değil" düğmelerinin cevaplarını işler. Veritabanı sağlayıcısının
 * içinde durur; uygulama yeni açılırken de, açıkken de gelen cevapları sırayla kaydeder ve küçük bir mesajla onaylar.
 */
export function RoutineActionRunner() {
  const db = useSQLiteContext();

  useEffect(() => {
    let running = false;
    let again = false;
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          for (const item of drainActions()) {
            try {
              if ((await getSetting(db, LAST_ACTION_KEY)) === item.key) continue;
              await setSetting(db, LAST_ACTION_KEY, item.key);
              const res = await runRoutineAction(db, item.action, new Date());
              if (res.changed) {
                await refreshReminders(db, new Date()).catch(() => undefined);
                DeviceEventEmitter.emit(DATA_CHANGED_EVENT);
              }
              if (Platform.OS === 'android') ToastAndroid.show(res.message, ToastAndroid.LONG);
            } catch {
              if (Platform.OS === 'android') ToastAndroid.show('Cevabı kaydedemedim. Rutinlerim ekranından işaretleyebilirsin.', ToastAndroid.LONG);
            }
          }
        } while (again);
      } finally {
        running = false;
      }
    };
    const unsubscribe = subscribeActions(() => {
      run().catch(() => undefined);
    });
    run().catch(() => undefined);
    return unsubscribe;
  }, [db]);

  return null;
}
