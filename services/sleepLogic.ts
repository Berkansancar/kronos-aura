/**
 * Uyku tahmini (saf mantık, test edilebilir).
 *
 * Telefon uykuyu doğrudan ölçemez. Bu yüzden gece ekranın en uzun süre kapalı kaldığı aralık "uyku"
 * sayılır: aralığın başı yatış, sonu kalkış saatidir. Gece bildirimle birkaç saniye yanan ekranlar
 * (5 dakikadan kısa kullanımlar) yok sayılır. Telefon başka odadaysa ya da gece uzun kullanıldıysa tahmin
 * yanılabilir; arayüz bunu açıkça belirtir.
 */
import type { Chronotype, SleepLog, SleepSummary } from '../database/types';
import { dayKey } from './activityLogic';

export interface ScreenSession {
  /** ms (epoch) */
  on: number;
  off: number;
}

export interface SleepEstimate {
  bedtime: number;
  wake: number;
  minutes: number;
}

const MIN = 60_000;

/** Gece için arama penceresi: önceki gün 18:00 → o gün 16:00 (şimdiden ileri gitmez). */
export function sleepWindow(day: Date, now: Date): { start: number; end: number } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 18, 0).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 16, 0).getTime();
  return { start, end: Math.min(end, now.getTime()) };
}

/**
 * Pencere içindeki ekran oturumlarından en uzun "ekran kapalı" aralığı bulur.
 * Aralık en az `minSleepMinutes` (varsayılan 3 saat) olmalı ve bir kalkış (sonraki ekran açılışı) içermelidir.
 */
export function estimateSleep(
  sessions: ScreenSession[],
  opts: { minSleepMinutes?: number; noiseMinutes?: number } = {}
): SleepEstimate | null {
  const minSleep = (opts.minSleepMinutes ?? 180) * MIN;
  const noise = (opts.noiseMinutes ?? 5) * MIN;

  const real = sessions
    .filter((s) => Number.isFinite(s.on) && Number.isFinite(s.off) && s.off > s.on)
    .filter((s) => s.off - s.on >= noise)
    .sort((a, b) => a.on - b.on);

  let best: SleepEstimate | null = null;
  for (let i = 0; i < real.length - 1; i += 1) {
    const bedtime = real[i].off;
    const wake = real[i + 1].on;
    const gap = wake - bedtime;
    // Gündüz boşta kalan telefon uyku sayılmaz: yatış 19:00 ile 05:59 arasında olmalı.
    const h = new Date(bedtime).getHours();
    if (!(h >= 19 || h < 6)) continue;
    if (gap >= minSleep && (best === null || gap > best.minutes * MIN)) {
      best = { bedtime, wake, minutes: Math.round(gap / MIN) };
    }
  }
  return best;
}

export function toSleepLog(est: SleepEstimate): SleepLog {
  return {
    day: dayKey(new Date(est.wake)),
    bedtime: new Date(est.bedtime).toISOString(),
    wakeTime: new Date(est.wake).toISOString(),
    durationMinutes: est.minutes,
  };
}

// ───────────────────────── Özet ve içgörüler ─────────────────────────

const minuteOfDay = (iso: string): number => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/** Yatış saatini gece yarısı sorununu aşmak için 18:00'den itibaren dakikaya çevirir (00:30 -> 390). */
const shiftBed = (m: number): number => (m - 18 * 60 + 1440) % 1440;
const unshiftBed = (s: number): number => (Math.round(s) + 18 * 60) % 1440;

export function formatMinuteOfDay(m: number): string {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

export function formatClockIso(iso: string): string {
  return formatMinuteOfDay(minuteOfDay(iso));
}

/** `logs` yeniden eskiye sıralı olmalıdır. Son gece yalnızca bugün ya da dün uyanılmışsa verilir. */
export function summarizeSleep(logs: SleepLog[], now: Date): SleepSummary {
  const recent = logs.slice(0, 7);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const last = logs.length > 0 && logs[0].day >= yesterday ? logs[0] : null;
  const avg =
    recent.length >= 3
      ? Math.round(recent.reduce((a, l) => a + l.durationMinutes, 0) / recent.length)
      : null;
  return {
    lastMinutes: last ? last.durationMinutes : null,
    lastBedtime: last ? last.bedtime : null,
    lastWake: last ? last.wakeTime : null,
    avgMinutes: avg,
    nights: recent.length,
  };
}

export interface SleepPattern {
  nights: number;
  avgBedMinute: number;
  avgWakeMinute: number;
  avgDuration: number;
  /** Yatış saatinin gün gün oynaması (dakika, standart sapma) */
  bedSpread: number;
}

/** En az 3 gece gerekir. */
export function analyzePattern(logs: SleepLog[]): SleepPattern | null {
  const recent = logs.slice(0, 7);
  if (recent.length < 3) return null;
  const n = recent.length;
  const beds = recent.map((l) => shiftBed(minuteOfDay(l.bedtime)));
  const wakes = recent.map((l) => minuteOfDay(l.wakeTime));
  const avgBed = beds.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(beds.reduce((a, b) => a + (b - avgBed) ** 2, 0) / n);
  return {
    nights: n,
    avgBedMinute: unshiftBed(avgBed),
    avgWakeMinute: Math.round(wakes.reduce((a, b) => a + b, 0) / n),
    avgDuration: Math.round(recent.reduce((a, l) => a + l.durationMinutes, 0) / n),
    bedSpread: Math.round(spread),
  };
}

/**
 * Uykunun orta noktasına bakar (kronotip ölçümünde yaygın yöntem): 03:00'ten önce sabahçı,
 * 04:30'dan sonra gececi, arası dengeli.
 */
export function suggestChronotype(p: SleepPattern): Chronotype {
  const sinceEvening = shiftBed(p.avgBedMinute) + p.avgDuration / 2; // 18:00'den beri dakika
  if (sinceEvening < 9 * 60) return 'MORNING';
  if (sinceEvening >= 10.5 * 60) return 'NIGHT';
  return 'BALANCED';
}

const CHRONO_TR: Record<Chronotype, string> = {
  MORNING: 'sabahçı',
  BALANCED: 'dengeli',
  NIGHT: 'gececi',
};

function fmtDur(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} sa` : `${h} sa ${r} dk`;
}

/** Ekranda gösterilecek yargısız içgörü cümleleri. */
export function sleepInsights(logs: SleepLog[], profile: Chronotype): string[] {
  const p = analyzePattern(logs);
  if (!p) return ['Birkaç gece veri biriktikçe uyku düzenin burada özetlenecek.'];

  const out: string[] = [];
  out.push(
    `Son ${p.nights} gecede ortalama ${formatMinuteOfDay(p.avgBedMinute)} gibi yatıp ${formatMinuteOfDay(p.avgWakeMinute)} gibi kalkmışsın (${fmtDur(p.avgDuration)}).`
  );
  if (p.avgDuration < 6 * 60) {
    out.push('Uykun kısa görünüyor. Bu bir kusur değil, bir sinyal: bu dönemde ağır işleri tepe saatine tek parça koymak yardımcı olur.');
  } else if (p.avgDuration > 9 * 60 + 30) {
    out.push('Uykun uzun görünüyor. Telefon gece boyunca kapalı kalmış olabilir; yine de dinlenmek değerlidir.');
  } else {
    out.push('Uyku süren dengeli aralıkta görünüyor.');
  }
  if (p.bedSpread > 60) {
    out.push(`Yatış saatin gün gün yaklaşık ${p.bedSpread} dakika oynuyor. Daha sabit bir saat, enerjini dengelemeye yardımcı olur.`);
  }
  const suggested = suggestChronotype(p);
  if (suggested !== profile) {
    out.push(
      `Uyku düzenin ${CHRONO_TR[suggested]} ritme yakın görünüyor, profilinde ${CHRONO_TR[profile]} yazıyor. İstersen tepe enerji saatini profilinden güncelle.`
    );
  }
  return out;
}
