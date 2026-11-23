/**
 * Su bardağı ve su şişesi simgeleri (saf geometri). Emoji kümesinde düzgün bir "bardak su" ve "su şişesi"
 * olmadığı ve telefonun yazı tipine göre değiştiği için bu iki simge dikdörtgenlerle çizilir.
 * Çizimi components/WaterIcon.tsx yapar; burada yalnızca şekiller ve renkler vardır (test edilebilir).
 */

export type WaterKind = 'glass' | 'bottle-s' | 'bottle' | 'bottle-l';

/** Çizim kutusu (birim). Bileşen bunu istenen boyuta ölçekler. */
export const WATER_BOX = { w: 40, h: 48 } as const;

export const WATER_COLORS = {
  outline: '#CFE6FF',
  water: '#4FB3FF',
  surface: '#9AD3FF',
  cap: '#7C9CFF',
  label: 'rgba(255,255,255,0.28)',
  glint: 'rgba(255,255,255,0.55)',
} as const;

export interface IconRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  /** Çerçeve rengi ve kalınlığı (birim) */
  border?: string;
  bw?: number;
  /** Üst kenarda çerçeve yok (açık ağızlı bardak) */
  openTop?: boolean;
  /** Köşe yarıçapları: sol üst, sağ üst, sağ alt, sol alt */
  r?: [number, number, number, number];
}

const BOTTLE_SIZES: Record<'bottle-s' | 'bottle' | 'bottle-l', { bodyW: number; bodyH: number }> = {
  'bottle-s': { bodyW: 18, bodyH: 21 },
  bottle: { bodyW: 21, bodyH: 27 },
  'bottle-l': { bodyW: 24, bodyH: 33 },
};

const BASE_Y = 45;
const BW = 2.5;
const CX = WATER_BOX.w / 2;
const C = WATER_COLORS;

function glass(): IconRect[] {
  const x = 7;
  const w = 26;
  const top = 16;
  const h = BASE_Y - top;
  const inX = x + BW;
  const inW = w - 2 * BW;
  const waterTop = 24;
  return [
    { x, y: top, w, h, border: C.outline, bw: BW, openTop: true, r: [0, 0, 7, 7] },
    { x: inX, y: waterTop, w: inW, h: BASE_Y - BW - waterTop, fill: C.water, r: [0, 0, 4.5, 4.5] },
    { x: inX, y: waterTop, w: inW, h: 2.2, fill: C.surface },
    { x: inX + 3, y: waterTop + 5, w: 2.6, h: 9, fill: C.glint, r: [1.3, 1.3, 1.3, 1.3] },
  ];
}

function bottle(kind: 'bottle-s' | 'bottle' | 'bottle-l'): IconRect[] {
  const { bodyW, bodyH } = BOTTLE_SIZES[kind];
  const bx = CX - bodyW / 2;
  const by = BASE_Y - bodyH;
  const neckH = 5;
  const neckY = by - neckH + 1;
  const capH = 4.5;
  const waterTop = by + bodyH * 0.38;
  const inX = bx + BW;
  const inW = bodyW - 2 * BW;
  const labelY = by + bodyH * 0.58;
  return [
    { x: CX - 4, y: neckY, w: 8, h: neckH, border: C.outline, bw: 2 },
    { x: CX - 4.5, y: neckY - capH, w: 9, h: capH, fill: C.cap, r: [1.5, 1.5, 0.5, 0.5] },
    { x: bx, y: by, w: bodyW, h: bodyH, border: C.outline, bw: BW, r: [8, 8, 6, 6] },
    { x: inX, y: waterTop, w: inW, h: BASE_Y - BW - waterTop, fill: C.water, r: [0, 0, 3.5, 3.5] },
    { x: inX, y: waterTop, w: inW, h: 2, fill: C.surface },
    { x: inX, y: labelY, w: inW, h: 5, fill: C.label },
    { x: inX + 2, y: waterTop + 4, w: 2.2, h: bodyH * 0.22, fill: C.glint, r: [1.1, 1.1, 1.1, 1.1] },
  ];
}

export function waterIconRects(kind: WaterKind): IconRect[] {
  return kind === 'glass' ? glass() : bottle(kind);
}

/** Su miktarına (ml) göre simge: bardak, küçük şişe, şişe, büyük şişe. */
export function waterKindForMl(ml: number): WaterKind {
  if (ml <= 260) return 'glass';
  if (ml <= 420) return 'bottle-s';
  if (ml <= 620) return 'bottle';
  return 'bottle-l';
}

export const WATER_KIND_LABEL: Record<WaterKind, string> = {
  glass: 'Bardak',
  'bottle-s': 'Küçük şişe',
  bottle: 'Şişe',
  'bottle-l': 'Büyük şişe',
};

/** Rutin simgesi olarak saklanan anahtarlar ("ico:" öneki emoji olmadığını gösterir). */
export const ICON_PREFIX = 'ico:';
export const ROUTINE_WATER_ICONS: Record<string, WaterKind> = {
  'ico:glass': 'glass',
  'ico:bottle': 'bottle',
};

export const isDrawnIcon = (icon: string | null | undefined): icon is string =>
  typeof icon === 'string' && icon in ROUTINE_WATER_ICONS;

/** Çizilen simgenin yazı içinde (emoji gerektiren yerlerde) gösterilecek karşılığı. */
export const DRAWN_ICON_TEXT: Record<string, string> = {
  'ico:glass': '🥛',
  'ico:bottle': '🚰',
};
