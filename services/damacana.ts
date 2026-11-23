/**
 * Damacana simgesi (saf geometri): içilen su hedefe oranla damacanayı doldurur. Çizimi
 * components/Damacana.tsx yapar; burada şekiller, suyun yüksekliği ve renkler vardır (test edilebilir).
 * Boyun hep boş kalır; su gövdede yükselir (gerçek damacanalar da omuza kadar doldurulur).
 */
import { WATER_COLORS } from './waterIcon';

/** Çizim kutusu (birim). Bileşen bunu istenen yüksekliğe ölçekler. */
export const DAMACANA_BOX = { w: 40, h: 64 } as const;

export const DAMACANA_COLORS = {
  ...WATER_COLORS,
  /** Boş damacananın hafif mavi plastik tonu */
  tint: 'rgba(79,179,255,0.08)',
  /** Hedef tamamlanınca suyun rengi (Aura nanesi) */
  done: '#5FD6B4',
  ridge: 'rgba(255,255,255,0.22)',
} as const;

type Corners = [number, number, number, number];

export const DAMACANA_PARTS = {
  cap: { x: 14, y: 1, w: 12, h: 5.5, r: [2, 2, 1, 1] as Corners },
  neck: { x: 16, y: 5.5, w: 8, h: 8, bw: 2 },
  body: { x: 3, y: 12, w: 34, h: 50, bw: 2.5, r: [16, 16, 8, 8] as Corners },
  /** Gövdedeki kabartma çizgiler ve etiket bandı (su seviyesinden bağımsız, sabit) */
  ridges: [
    { x: 12, y: 17.5, w: 16, h: 1.2 },
    { x: 12, y: 20.5, w: 16, h: 1.2 },
  ],
  label: { y: 38, h: 7 },
  glint: { x: 8.5, y: 25, w: 2.6, h: 14 },
} as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Gövdenin iç alanı (çerçevenin içi) ve iç köşe yarıçapları. */
export function damacanaInner(): Box & { r: Corners } {
  const b = DAMACANA_PARTS.body;
  const [tl, tr, br, bl] = b.r;
  return {
    x: b.x + b.bw,
    y: b.y + b.bw,
    w: b.w - 2 * b.bw,
    h: b.h - 2 * b.bw,
    r: [tl - b.bw, tr - b.bw, br - b.bw, bl - b.bw],
  };
}

/** 0..1 arasına sıkıştırır; sayı olmayan ya da negatif değer 0 olur. */
export function clampRatio(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return v >= 1 ? 1 : v;
}

/** Suyun dolgusu: iç alanın altına yaslı, yüksekliği orana göre. */
export function damacanaWaterRect(ratio: number): Box {
  const inner = damacanaInner();
  const r = clampRatio(ratio);
  const h = inner.h * r;
  return { x: inner.x, y: inner.y + inner.h - h, w: inner.w, h };
}

/** Yüzde (tam sayı, 0-100). */
export const damacanaPercent = (ratio: number): number => Math.round(clampRatio(ratio) * 100);

/** Su rengi: hedef tamamlanınca nane yeşili, değilse mavi. */
export const damacanaWaterColor = (ratio: number): string => (clampRatio(ratio) >= 1 ? DAMACANA_COLORS.done : DAMACANA_COLORS.water);
