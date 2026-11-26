import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { ensureLocationTracking } from '../services/locationTracking';

/**
 * Gün haritası açık bırakıldıysa, uygulama her öne geldiğinde arka plan görevinin çalıştığından emin olur
 * (telefon yeniden başladıysa ya da sistem görevi durdurduysa yeniden başlatır). Görünür bir şey çizmez.
 */
export function LocationBoot() {
  const db = useSQLiteContext();
  useEffect(() => {
    void ensureLocationTracking(db);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ensureLocationTracking(db);
    });
    return () => sub.remove();
  }, [db]);
  return null;
}
