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
  /** Bildirime dokununca açılacak ekran (ör. '/morning'); yoksa ana ekran açılır */
  route?: string;
}

export const REMINDER_ID_PREFIX = 'rtn-';
export const REMINDER_DAYS = 5;
/** Android tek uygulamanın kurabileceği alarm sayısını sınırlar; güvenli tarafta kal. */
export const REMINDER_CAP = 60;

export const REVIEW_HOUR = 21;
export const REVIEW_MINUTE = 30;

export interface ReminderExtras {
  /** Bugünün gün sonu değerlendirmesi yapıldı mı? */
  reviewDone?: boolean;
  /** Yarın için "yapacağım / değil" denmiş rutin id'leri: yarın bildirimi gitmez */
  answeredTomorrow?: Set<string>;
  /** Gün sonu hatırlatması açık mı? (varsayılan: açık) */
  review?: boolean;
  /** Sabah brifingi bildirimi: saat ve dakika; null ya da yoksa gönderilmez */
  morning?: { hour: number; minute: number } | null;
  /** Zor gün modu açıksa bugünün sıradan rutin bildirimleri gönderilmez (yalnızca temel rutinler) */
  hardDayToday?: boolean;
  /** Hedef hatırlatmaları (su ve yatış hazırlığı). Yok ya da null: kapalı (varsayılan). */
  goals?: GoalReminders | null;
}

export interface GoalReminders {
  /** Bugünün su hedefi tamamlandıysa bugünün su hatırlatmaları gönderilmez */
  waterGoalReached: boolean;
  /** Yatış saati, gün başından dakika (örn. 23:00 = 1380, 00:30 = 1470); yoksa null */
  bedtime: number | null;
}

/** Su hatırlatmaları: öğle ve ikindi (saat, dakika) */
export const WATER_NUDGES: readonly { hour: number; minute: number; title: string; body: string }[] = [
  { hour: 12, minute: 0, title: 'Bir bardak su', body: 'Bir bardak su iyi gelir. Uygulamada +200 ml\'ye dokunman yeter.' },
  { hour: 16, minute: 30, title: 'Su molası', body: 'Günün ikinci yarısı başlıyor; bir yudum su ya da çay iyi gelir.' },
];
/** Yatıştan kaç dakika önce hazırlık hatırlatması gelsin */
export const WIND_DOWN_MINUTES = 45;

/** Zor günde yalnızca kısa (en çok 10 dk) rutinler sorulur; diğerleri sessizce beklemeye alınır. */
export const ESSENTIAL_MAX_MINUTES = 10;
export const isEssentialRoutine = (r: { estimatedDuration: number }): boolean =>
  r.estimatedDuration <= ESSENTIAL_MAX_MINUTES;

export function planReminders(
  briefs: RoutineBrief[],
  now: Date,
  days: number = REMINDER_DAYS,
  cap: number = REMINDER_CAP,
  extras: ReminderExtras = {}
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const answeredTomorrow = extras.answeredTomorrow ?? new Set<string>();

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
      // Yarın için zaten cevap verildiyse yarın bir daha sorulmaz
      if (d === 1 && answeredTomorrow.has(r.id)) continue;
      // Zor gün: bugünün temel olmayan rutinleri için bildirim gitmez
      if (d === 0 && extras.hardDayToday && !isEssentialRoutine(r)) continue;
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

  // Gün sonu değerlendirmesi hatırlatması (her akşam 21:30)
  if (extras.review !== false) {
    for (let d = 0; d < days; d += 1) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, REVIEW_HOUR, REVIEW_MINUTE);
      if (at.getTime() <= now.getTime()) continue;
      if (d === 0 && extras.reviewDone) continue;
      out.push({
        id: `${REMINDER_ID_PREFIX}review-${dayKey(at)}`,
        routineId: '',
        at,
        title: 'Günü birlikte değerlendirelim',
        body: 'Bugün neler oldu, yarın neleri yapacaksın? Birkaç dokunuşla planı hazırlayalım.',
        route: '/review',
      });
    }
  }

  // Sabah brifingi (her sabah, seçilen saatte). Dokununca /morning açılır.
  if (extras.morning) {
    for (let d = 0; d < days; d += 1) {
      const at = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + d,
        extras.morning.hour,
        extras.morning.minute
      );
      if (at.getTime() <= now.getTime()) continue;
      out.push({
        id: `${REMINDER_ID_PREFIX}morning-${dayKey(at)}`,
        routineId: '',
        at,
        title: 'Günaydın, planın hazır',
        body: 'Bugünün en önemli işi, rutinlerin ve Kronos\'un notu seni bekliyor.',
        route: '/morning',
      });
    }
  }

  // Hedef hatırlatmaları (isteğe bağlı, varsayılan kapalı): su ve yatış hazırlığı
  if (extras.goals) {
    const g = extras.goals;
    for (let d = 0; d < days; d += 1) {
      // Zor günde bugün için hiçbir hedef hatırlatması gönderilmez
      if (d === 0 && extras.hardDayToday) continue;
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      if (!(d === 0 && g.waterGoalReached)) {
        for (const n of WATER_NUDGES) {
          const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), n.hour, n.minute);
          if (at.getTime() <= now.getTime()) continue;
          out.push({
            id: `${REMINDER_ID_PREFIX}water-${dayKey(at)}-${n.hour}`,
            routineId: '',
            at,
            title: n.title,
            body: n.body,
            route: '/nutrition',
          });
        }
      }
      if (g.bedtime !== null) {
        const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, g.bedtime - WIND_DOWN_MINUTES);
        if (at.getTime() > now.getTime()) {
          out.push({
            id: `${REMINDER_ID_PREFIX}winddown-${dayKey(base)}`,
            routineId: '',
            at,
            title: 'Günü yavaşça kapatma zamanı',
            body: `Yatış saatine ${WIND_DOWN_MINUTES} dakika var. Ekranı kısıp günü sakin bir şekilde bitirebilirsin.`,
            route: '/goals',
          });
        }
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, cap);
}

/** Aynı plan tekrar tekrar kurulmasın diye kısa parmak izi. */
export function reminderSignature(plan: PlannedReminder[]): string {
  return plan.map((p) => `${p.id}@${p.at.getTime()}:${p.title}`).join('|');
}
