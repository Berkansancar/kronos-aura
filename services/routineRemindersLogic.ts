/**
 * Hangi rutin hatırlatmaları ne zaman gönderilecek? (saf mantık, test edilebilir)
 *
 * Bildirimler tek seferlik olarak önümüzdeki günler için planlanır; uygulama her açıldığında ve her cevaptan
 * sonra yeniden hesaplanır. Böylece bugün zaten cevapladığın rutin için bugün bir daha bildirim gelmez.
 */
import type { RoutineBrief } from '../database/types';
import { dayKey } from './activityLogic';

export interface PlannedReminder {
  /** Bildirim kimliği: aynı rutin + gün için tekil */
  id: string;
  routineId: string;
  at: Date;
  title: string;
  body: string;
}

export const REMINDER_ID_PREFIX = 'rtn-';
export const REMINDER_DAYS = 5;
/** Android tek uygulamanın kurabileceği alarm sayısını sınırlar; güvenli tarafta kal. */
export const REMINDER_CAP = 60;

export function planReminders(
  briefs: RoutineBrief[],
  now: Date,
  days: number = REMINDER_DAYS,
  cap: number = REMINDER_CAP
): PlannedReminder[] {
  const out: PlannedReminder[] = [];

  for (const b of briefs) {
    const r = b.routine;

    // "Sonra" denmişse: söz verilen saatte yeniden sor
    if (b.state === 'SNOOZED' && b.snoozeUntil) {
      const at = new Date(b.snoozeUntil);
      if (at.getTime() > now.getTime()) {
        out.push({
          id: `${REMINDER_ID_PREFIX}${r.id}-snooze`,
          routineId: r.id,
          at,
          title: r.title,
          body: 'Sonra demiştin. Şimdi uygun mu? Açıp cevap verebilirsin.',
        });
      }
    }

    for (let d = 0; d < days; d += 1) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, r.askHour, r.askMinute);
      if (at.getTime() <= now.getTime()) continue;
      // Bugün zaten cevap verilmiş ya da kapanmışsa bugünün bildirimi gönderilmez
      if (d === 0 && (b.state === 'DONE' || b.state === 'SKIPPED' || b.state === 'ACCEPTED')) continue;
      out.push({
        id: `${REMINDER_ID_PREFIX}${r.id}-${dayKey(at)}`,
        routineId: r.id,
        at,
        title: r.title,
        body:
          b.stats.streak >= 2 && d === 0
            ? `${b.stats.streak} gündür devam ediyorsun. Bugün de yapacak mısın?`
            : 'Bugün bunu yapacak mısın? Yapacağım, sonra ya da bugün değil diyebilirsin.',
      });
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, cap);
}

/** Aynı plan tekrar tekrar kurulmasın diye kısa parmak izi. */
export function reminderSignature(plan: PlannedReminder[]): string {
  return plan.map((p) => `${p.id}@${p.at.getTime()}:${p.title}`).join('|');
}
