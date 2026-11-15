/**
 * Sigara sayacı (saf mantık, test edilebilir). Amaç farkındalık: sayı, aralık ve isteğe bağlı günlük sınır.
 * Aura yargılamaz, ders vermez; bırakma baskısı yoktur. Veri yalnızca telefonda durur.
 */
import { formatDuration } from './format';

export const SMOKE_LIMIT_KEY = 'smoke_limit';
export const SMOKE_LIMIT_CHOICES = [3, 5, 8, 10, 15, 20] as const;

export interface SmokeStats {
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
  /** Son sigaradan bu yana (bugünse); yoksa null */
  sinceLastMinutes: number | null;
  /** Ardışık sigaralar arasındaki ortalama süre (en az 2 sigara gerekir) */
  avgGapMinutes: number | null;
  longestGapMinutes: number | null;
  byPart: { morning: number; afternoon: number; evening: number };
  limit: number | null;
  /** Sınıra kalan (0'a iner, eksiye düşmez); sınır yoksa null */
  leftToLimit: number | null;
  /** Sınırı aşan miktar; aşılmadıysa 0 */
  overLimit: number;
  line: string;
}

export function parseSmokeLimit(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}

/** `isToday`: son sigaradan bu yana geçen süre yalnızca bugünün sayacında anlamlıdır. */
export function analyzeSmoking(times: Date[], now: Date, limit: number | null, isToday = true): SmokeStats {
  const list = [...times].sort((a, b) => a.getTime() - b.getTime());
  const count = list.length;
  const byPart = { morning: 0, afternoon: 0, evening: 0 };
  for (const t of list) {
    const h = t.getHours();
    if (h >= 4 && h < 12) byPart.morning += 1;
    else if (h >= 12 && h < 18) byPart.afternoon += 1;
    else byPart.evening += 1;
  }

  const gaps: number[] = [];
  for (let i = 1; i < count; i += 1) gaps.push(Math.round((list[i].getTime() - list[i - 1].getTime()) / 60_000));
  const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const longestGap = gaps.length > 0 ? Math.max(...gaps) : null;

  const lastAt = count > 0 ? list[count - 1] : null;
  const sinceLast = lastAt && isToday ? Math.max(0, Math.round((now.getTime() - lastAt.getTime()) / 60_000)) : null;

  const leftToLimit = limit === null ? null : Math.max(0, limit - count);
  const overLimit = limit === null ? 0 : Math.max(0, count - limit);

  let line: string;
  if (count === 0) {
    line = 'Henüz kayıt yok.';
  } else {
    const parts: string[] = [`Bugün ${count} sigara.`];
    if (sinceLast !== null) parts.push(`Sonuncudan beri ${formatDuration(sinceLast)} geçti.`);
    if (avgGap !== null) parts.push(`Ortalama aralık ${formatDuration(avgGap)}.`);
    if (limit !== null) {
      if (overLimit > 0) parts.push(`Sınırın ${overLimit} üstünde kaldı; bu sadece veri, yarın küçük bir adım yeterli.`);
      else if (leftToLimit === 0) parts.push('Günlük sınıra ulaştın.');
      else parts.push(`Sınıra ${leftToLimit} kaldı.`);
    }
    line = parts.join(' ');
  }

  return {
    count,
    firstAt: count > 0 ? list[0] : null,
    lastAt,
    sinceLastMinutes: sinceLast,
    avgGapMinutes: avgGap,
    longestGapMinutes: longestGap,
    byPart,
    limit,
    leftToLimit,
    overLimit,
    line,
  };
}

/** Yapay zekâya gidecek toplu özet satırı (yalnızca sayı ve aralık; paylaşım izniyle). */
export function smokePromptLine(s: SmokeStats): string | null {
  if (s.count === 0) return null;
  const bits = [`${s.count} adet`];
  if (s.avgGapMinutes !== null) bits.push(`ortalama aralık ${formatDuration(s.avgGapMinutes)}`);
  if (s.limit !== null) bits.push(`kendi koyduğu günlük sınır ${s.limit}`);
  return `- Sigara sayacı: ${bits.join(', ')} (yargılama, yalnızca veri)`;
}
