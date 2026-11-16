/**
 * Bildirimden rutin cevabı: hatırlatma bildirimindeki "Yaptım / Yapacağım / Bugün değil" düğmeleri. Saf mantık.
 *
 * Düğmeye basılınca uygulama kısa süre açılır, cevap kaydedilir ve küçük bir mesajla onaylanır. Cevap, bildirimin
 * ait olduğu güne göre işlenir: dünkü bir bildirimden "Yaptım" dünü işaretler; "Yapacağım" ve "Bugün değil" yalnızca
 * bugünün bildirimleri için geçerlidir (geçmiş güne plan yapılmaz).
 */
import type { RoutineDayState } from '../database/types';

export type RoutineActionKind = 'DONE' | 'ACCEPT' | 'SKIP';

/** Bildirim kategorisi ve düğmeler (sıra: bildirimde görünen sıra). */
export const ROUTINE_CATEGORY = 'routine-actions';
export const ROUTINE_ACTIONS: readonly { identifier: string; title: string; kind: RoutineActionKind }[] = [
  { identifier: 'rtn-done', title: 'Yaptım ✓', kind: 'DONE' },
  { identifier: 'rtn-accept', title: 'Yapacağım', kind: 'ACCEPT' },
  { identifier: 'rtn-skip', title: 'Bugün değil', kind: 'SKIP' },
];

/** Bildirimin bu kadar saatten eskisi işlenmez (yanlışlıkla yeniden gelen eski cevaplara karşı). */
export const MAX_RESPONSE_AGE_HOURS = 36;

export interface ParsedRoutineAction {
  routineId: string;
  /** Bildirimin ait olduğu gün (yyyy-mm-dd); yoksa bugün sayılır */
  day: string | null;
  kind: RoutineActionKind;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Bildirim cevabından rutin eylemini çıkarır; rutin bildirimi ya da düğmesi değilse null. */
export function parseRoutineAction(actionIdentifier: string, data: unknown): ParsedRoutineAction | null {
  const action = ROUTINE_ACTIONS.find((a) => a.identifier === actionIdentifier);
  if (!action) return null;
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const routineId = typeof o.routineId === 'string' && o.routineId.length > 0 && o.routineId.length <= 80 ? o.routineId : null;
  if (!routineId) return null;
  const day = typeof o.day === 'string' && DAY_RE.test(o.day) ? o.day : null;
  return { routineId, day, kind: action.kind };
}

/** Aynı cevabın iki kez işlenmesini engelleyen anahtar. */
export const actionKey = (notificationId: string, actionIdentifier: string, dateMs: number): string =>
  `${notificationId}|${actionIdentifier}|${Math.round(dateMs)}`;

/** Saniye olarak gelen tarihi milisaniyeye çevirir (1e11 altı saniye sayılır). */
export const toMs = (date: number): number => (Number.isFinite(date) && date > 0 && date < 1e11 ? date * 1000 : date);

/** Çok eski bildirim cevabı mı? Tarih okunamıyorsa eski sayılmaz (tekrarı kayıtlı anahtar engeller). */
export const isStale = (dateMs: number, nowMs: number): boolean =>
  Number.isFinite(dateMs) && nowMs - toMs(dateMs) > MAX_RESPONSE_AGE_HOURS * 3_600_000;

export type ActionDecision =
  | { run: 'DONE_TODAY' | 'DONE_PAST' | 'ACCEPT' | 'SKIP'; day: string; message: string }
  | { run: 'NONE'; message: string };

/** Hangi işlemin yapılacağına karar verir (veritabanına dokunmaz). `state`: rutinin bugünkü durumu. */
export function decideAction(
  kind: RoutineActionKind,
  state: RoutineDayState,
  day: string | null,
  today: string,
  title: string
): ActionDecision {
  const d = day ?? today;
  if (d > today) return { run: 'NONE', message: 'Bu hatırlatma henüz gelmedi.' };

  if (kind === 'DONE') {
    if (d < today) return { run: 'DONE_PAST', day: d, message: `✓ ${title}: o gün yapıldı olarak işaretlendi.` };
    if (state === 'DONE') return { run: 'NONE', message: `✓ ${title} zaten tamamdı.` };
    return { run: 'DONE_TODAY', day: d, message: `✓ ${title} yapıldı olarak işaretlendi.` };
  }

  if (d < today) return { run: 'NONE', message: `${title}: bu hatırlatma geçmiş bir güne ait, bir şey değiştirmedim.` };
  if (state === 'OFF') return { run: 'NONE', message: `${title} bugün planlı değil.` };
  if (state === 'DONE') return { run: 'NONE', message: `✓ ${title} zaten yapılmış, olduğu gibi bıraktım.` };

  if (kind === 'ACCEPT') {
    if (state === 'ACCEPTED') return { run: 'NONE', message: `${title} zaten "yapacağım" olarak kayıtlı.` };
    return { run: 'ACCEPT', day: d, message: `👍 ${title}: yapacağım olarak kaydettim.` };
  }
  if (state === 'SKIPPED') return { run: 'NONE', message: `${title} bugünlük zaten geçilmişti.` };
  return { run: 'SKIP', day: d, message: `${title} bugünlük geçildi. Sorun değil, yarın yeniden sorulur.` };
}
