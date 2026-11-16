/**
 * Bildirim düğmesi cevaplarının küçük bekleme kuyruğu. Saf mantık, React Native'e bağlı değil.
 *
 * Bildirim cevabı, veritabanı hazır olmadan (uygulama yeni açılırken) gelebilir. Cevap önce kuyruğa girer;
 * veritabanı sağlayıcısının içindeki işleyici hazır olunca kuyruğu boşaltır.
 */
import type { ParsedRoutineAction } from './routineActionLogic';

/** Bir cevap işlenip veri değişince yayınlanan olay adı (ekranlar kendini tazeler). */
export const DATA_CHANGED_EVENT = 'kronos-data-changed';

export interface QueuedAction {
  key: string;
  action: ParsedRoutineAction;
}

let pending: QueuedAction[] = [];
const seen = new Set<string>();
const listeners = new Set<() => void>();

/** Aynı anahtarlı cevap bu oturumda bir kez kuyruğa alınır. Alındıysa true. */
export function enqueueAction(item: QueuedAction): boolean {
  if (seen.has(item.key)) return false;
  seen.add(item.key);
  pending = [...pending, item];
  listeners.forEach((l) => l());
  return true;
}

export function drainActions(): QueuedAction[] {
  const out = pending;
  pending = [];
  return out;
}

export function subscribeActions(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Yalnızca testler için. */
export function resetActionQueue(): void {
  pending = [];
  seen.clear();
  listeners.clear();
}
