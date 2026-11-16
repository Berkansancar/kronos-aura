/** Ana ekranın tek satırlık günün özeti (saf mantık). Sayıları söyler, yorum yapmaz. */
import { formatWater } from './nutritionLogic';

export interface TodayFacts {
  done: number;
  open: number;
  waterMl: number | null;
  waterGoalMl: number | null;
  smoke: number | null;
  smokeLimit: number | null;
}

/** "3 iş bitti, 2 açık · su 1,2 / 2 L · sigara 4/10". Gösterecek bir şey yoksa null. */
export function todayLine(f: TodayFacts): string | null {
  const parts: string[] = [];
  if (f.done > 0 || f.open > 0) {
    parts.push(f.done > 0 ? `${f.done} iş bitti${f.open > 0 ? `, ${f.open} açık` : ''}` : `${f.open} açık iş`);
  }
  if (f.waterMl !== null && (f.waterMl > 0 || f.waterGoalMl !== null)) {
    parts.push(
      f.waterGoalMl !== null ? `su ${formatWater(f.waterMl)} / ${formatWater(f.waterGoalMl)}` : `su ${formatWater(f.waterMl)}`
    );
  }
  if (f.smoke !== null && f.smoke > 0) {
    parts.push(f.smokeLimit !== null ? `sigara ${f.smoke}/${f.smokeLimit}` : `sigara ${f.smoke}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
