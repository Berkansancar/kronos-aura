/**
 * Aktivite verisinin saf (React Native'den bağımsız) mantığı: tarih anahtarı, adım güvenilirliği,
 * koç özeti ve pil ayarı ipuçları. Bu yüzden terminalde de test edilebilir.
 */
import type { ActivitySummary, DailyStat } from '../database/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Yerel tarih anahtarı: "2026-11-16" */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-16" -> yerel Date (gece yarısı) */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 4210 -> "4.210" */
export function formatSteps(n: number): string {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Adım sensörü "telefon açıldığından beri" sayar; uygulama takibi açtığımız andan itibaren günlük
 * sayıyı tutar. Takip bugün geç saatte açıldıysa gün içindeki adımların bir kısmı eksik kalır, bu yüzden
 * "az yürüdün" gibi bir yorum yapmak yanıltıcı olur. Takip dünden beri açıksa ya da bugün sabah
 * (08:00'den önce) açıldıysa sayı güvenilir kabul edilir.
 */
export function isStepsReliable(trackingSinceIso: string | null, now: Date): boolean {
  if (!trackingSinceIso) return false;
  const since = new Date(trackingSinceIso);
  if (Number.isNaN(since.getTime())) return false;
  if (dayKey(since) < dayKey(now)) return true;
  return since.getHours() < 8;
}

export function buildActivitySummary(
  stat: DailyStat | null,
  trackingOn: boolean,
  trackingSinceIso: string | null,
  now: Date
): ActivitySummary | undefined {
  if (!stat) return undefined;
  return {
    steps: trackingOn ? stat.steps : null,
    stepsReliable: trackingOn && isStepsReliable(trackingSinceIso, now),
    screenMinutes: stat.screenMinutes,
    topApps: stat.topApps,
  };
}

/** Telefon markasına göre arka planda çalışmayı açma ipucu (menü adları sürüme göre değişebilir). */
export function batteryHint(manufacturer: string): string {
  const m = manufacturer.toLowerCase();
  if (/(xiaomi|redmi|poco)/.test(m)) {
    return 'Xiaomi/Redmi/Poco: Ayarlar > Uygulamalar > İzinler > Otomatik başlat bölümünden Kronos & Aura\'yı aç. Sonra Ayarlar > Uygulamalar > Kronos & Aura > Pil tasarrufu > "Kısıtlama yok" seç.';
  }
  if (/samsung/.test(m)) {
    return 'Samsung: Ayarlar > Pil > Arka plan kullanım sınırları > "Uyutulmayan uygulamalar" listesine Kronos & Aura\'yı ekle.';
  }
  if (/(huawei|honor)/.test(m)) {
    return 'Huawei/Honor: Ayarlar > Pil > Uygulama başlatma > Kronos & Aura > "Manuel yönet" seç ve üç seçeneği de aç.';
  }
  if (/(oppo|realme|oneplus|vivo|iqoo)/.test(m)) {
    return 'Oppo/Realme/OnePlus/Vivo: Ayarlar > Pil > Kronos & Aura bölümünde "Arka planda çalışmaya izin ver" ve "Otomatik başlat"ı aç.';
  }
  return 'Ayarlar > Uygulamalar > Kronos & Aura > Pil bölümünden "Kısıtlama yok" (pil optimizasyonu kapalı) seç.';
}
