/**
 * Ruh hali kaydı: gün başına 1–5 arası seçim ve kısa not. Saf mantık.
 *
 * Aura'nın ilkesi: ruh hali bir not değildir, hiçbir değer "kötü" diye damgalanmaz. Düşük günlerde yargılamak yerine
 * yük hafifletmeyi önerir; yüksek günlerde sadece fark ettirir.
 */
import type { MoodLog, MoodValue } from '../database/types';
import { dayKey } from './activityLogic';

export interface MoodInfo {
  value: MoodValue;
  emoji: string;
  label: string;
  color: string;
}

export const MOODS: MoodInfo[] = [
  { value: 1, emoji: '😞', label: 'Çok zor', color: '#F0707A' },
  { value: 2, emoji: '😕', label: 'Düşük', color: '#F29A5E' },
  { value: 3, emoji: '😐', label: 'İdare eder', color: '#E6D26A' },
  { value: 4, emoji: '🙂', label: 'İyi', color: '#8FD694' },
  { value: 5, emoji: '😄', label: 'Harika', color: '#5FD6B4' },
];

export function moodInfo(v: number): MoodInfo {
  return MOODS[Math.min(5, Math.max(1, Math.round(v))) - 1];
}

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const round1 = (n: number) => Math.round(n * 10) / 10;
export const formatMood = (n: number): string => round1(n).toFixed(1).replace('.', ',');

export function moodAverage(logs: MoodLog[]): number | null {
  return avg(logs.map((l) => l.mood));
}

/** Bugünden geriye `days` günlük seri (eskiden yeniye); kayıt yoksa mood null. */
export function moodSeries(
  logs: MoodLog[],
  now: Date,
  days = 7
): { day: string; mood: MoodValue | null }[] {
  const byDay = new Map(logs.map((l) => [l.day, l.mood]));
  const out: { day: string; mood: MoodValue | null }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dayKey(d);
    out.push({ day: k, mood: byDay.get(k) ?? null });
  }
  return out;
}

/** Bugünden (kayıt varsa) ya da dünden geriye doğru, arka arkaya ruh hali ≤ 2 olan gün sayısı. */
export function lowRun(logs: MoodLog[], now: Date): number {
  const byDay = new Map(logs.map((l) => [l.day, l.mood]));
  let cursor = byDay.has(dayKey(now)) ? 0 : 1;
  let run = 0;
  while (cursor < 60) {
    const k = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - cursor));
    const m = byDay.get(k);
    if (m === undefined || m > 2) break;
    run += 1;
    cursor += 1;
  }
  return run;
}

export interface MoodReply {
  text: string;
  /** Zor gün modu önerilsin mi? */
  suggestHardDay: boolean;
}

/** Kayıttan sonra Aura'nın kısa cevabı. Yargılamaz; düşük günlerde yükü hafifletmeyi önerir. */
export function moodReply(mood: MoodValue, logs: MoodLog[], now: Date): MoodReply {
  const run = lowRun(logs, now);
  if (mood <= 2 && run >= 3) {
    return {
      text: `Son ${run} gündür ruh halin düşük görünüyor. Bunu yazman iyi. Yakınında konuşabileceğin biri varsa paylaşmak iyi gelebilir; bugün de senden fazlası beklenmiyor.`,
      suggestHardDay: true,
    };
  }
  switch (mood) {
    case 1:
      return { text: 'Zor bir gün. Bugün senden fazlası beklenmiyor; istersen planı hafifletelim.', suggestHardDay: true };
    case 2:
      return { text: 'Biraz ağır bir gün olmuş. İstersen planı sadeleştirebiliriz; küçük adımlar da sayılır.', suggestHardDay: true };
    case 3:
      return { text: 'İdare eden günler de günün bir parçası. Bugün küçük bir şey seç, o yeter.', suggestHardDay: false };
    case 4:
      return { text: 'İyi bir gün. Bu hissin neyden geldiğini fark etmek güzel.', suggestHardDay: false };
    default:
      return { text: 'Harika! Bu güzel günü bir köşeye yaz; zor günlerde işe yarar.', suggestHardDay: false };
  }
}

export interface MoodLink {
  withDone: number;
  withoutDone: number;
  nWith: number;
  nWithout: number;
}

/** Rutin yapılan günlerle yapılmayan günlerdeki ortalama ruh hali. Yetersiz veri varsa null. */
export function moodVsRoutines(logs: MoodLog[], doneDays: Set<string>): MoodLink | null {
  const a = logs.filter((l) => doneDays.has(l.day)).map((l) => l.mood);
  const b = logs.filter((l) => !doneDays.has(l.day)).map((l) => l.mood);
  const wa = avg(a);
  const wb = avg(b);
  if (wa === null || wb === null) return null;
  return { withDone: wa, withoutDone: wb, nWith: a.length, nWithout: b.length };
}

/**
 * Yalnızca olumlu yönde ve yeterli veri varsa bir gözlem döner; aksi halde null.
 * Gözlem suçlamaz: "yapmadığın günler kötü" demez, yalnızca farkı gösterir.
 */
export function moodInsight(link: MoodLink | null): string | null {
  if (!link) return null;
  if (link.nWith < 4 || link.nWithout < 4) return null;
  if (link.withDone - link.withoutDone < 0.5) return null;
  return `Rutinlerinden en az birini yaptığın günlerde ruh halin ortalama ${formatMood(link.withDone)}, diğer günlerde ${formatMood(link.withoutDone)}. Küçük adımlar fark yaratıyor olabilir.`;
}

/** Ayın ruh hali dağılımı (en çok görülenden aza). */
export function moodCounts(logs: MoodLog[]): { info: MoodInfo; count: number }[] {
  return MOODS.map((info) => ({ info, count: logs.filter((l) => l.mood === info.value).length })).filter(
    (x) => x.count > 0
  );
}
