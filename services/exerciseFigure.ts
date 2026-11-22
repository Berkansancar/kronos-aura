/**
 * Egzersiz çizimleri için çubuk adam geometrisi (saf mantık; React Native'den bağımsız, terminalde test edilir).
 *
 * Bir poz; kalça, boyun (omuz) ve el/ayak hedef noktalarıyla tarif edilir. Dirsek ve diz konumunu
 * iki kemikli ters kinematik (IK) bulur, böylece uzuv boyları her pozda aynı kalır.
 * Bileşen bu parçaları (çizgi + baş dairesi) görünüm olarak çizer.
 *
 * Koordinat sistemi: 100 x 70 kutu, y aşağı doğru artar, zemin y = 62. Figür sağa bakar.
 */

export type Pt = [number, number];
/** Eklemin hangi yöne kıvrılacağı: 'fwd' ileri (sağ), 'back' geri (sol), 'up' yukarı, 'down' aşağı. */
export type Bend = 'fwd' | 'back' | 'up' | 'down';

export interface LimbSpec {
  to: Pt;
  bend?: Bend;
  /** Karşı taraftaki (uzak) uzuv: soluk çizilir. */
  far?: boolean;
}

export type PropSpec =
  | { kind: 'line'; from: Pt; to: Pt }
  | { kind: 'rect'; x: number; y: number; w: number; h: number };

export interface PoseSpec {
  hip: Pt;
  neck: Pt;
  /** Boyundan çıkan kollar. */
  arms?: LimbSpec[];
  /** Kalçadan çıkan bacaklar. */
  legs?: LimbSpec[];
  /** Yatış gibi pozlarda başın merkezini elle koymak için. Yoksa gövde yönünde devam eder. */
  head?: Pt;
  /** Sandalye, masa, kanepe gibi gereçler. */
  props?: PropSpec[];
}

export type SegTone = 'body' | 'far' | 'prop' | 'ground';

export interface FigureSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: SegTone;
}

export interface FigureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Figure {
  segs: FigureSeg[];
  rects: FigureRect[];
  head: { cx: number; cy: number; r: number };
  /** Hedefe yetişemeyen uzuvlar (poz verisi hatası): boş olmalı. */
  warnings: string[];
}

export const VIEW_W = 100;
export const VIEW_H = 70;
export const GROUND_Y = 62;

export const THIGH = 15;
export const SHIN = 14;
export const UPPER_ARM = 10;
export const FOREARM = 9.5;
export const TORSO = 18;
export const HEAD_R = 4.3;

/** Başlangıç noktasından, matematik açısıyla (0° sağ, 90° yukarı) verilen uzaklıkta nokta. */
export function ang(origin: Pt, deg: number, len: number): Pt {
  const r = (deg * Math.PI) / 180;
  return [round(origin[0] + len * Math.cos(r)), round(origin[1] - len * Math.sin(r))];
}

const round = (n: number) => Math.round(n * 100) / 100;
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

interface Solved {
  joint: Pt;
  end: Pt;
  reached: boolean;
}

/** İki kemikli uzuv: kökten hedefe, ara eklem (diz/dirsek) seçilen yöne bakacak şekilde. */
export function solveLimb(origin: Pt, target: Pt, l1: number, l2: number, bend: Bend): Solved {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.01;
  const dd = Math.min(Math.max(d, minD), maxD);
  const a = Math.atan2(dy, dx);
  const end: Pt = d === 0 ? [origin[0] + dd, origin[1]] : [origin[0] + (dx / d) * dd, origin[1] + (dy / d) * dd];
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd)));
  const A = Math.acos(cosA);
  const c1: Pt = [origin[0] + l1 * Math.cos(a + A), origin[1] + l1 * Math.sin(a + A)];
  const c2: Pt = [origin[0] + l1 * Math.cos(a - A), origin[1] + l1 * Math.sin(a - A)];
  const pick = (better: (p: Pt, q: Pt) => boolean) => (better(c1, c2) ? c1 : c2);
  const joint =
    bend === 'fwd'
      ? pick((p, q) => p[0] >= q[0])
      : bend === 'back'
        ? pick((p, q) => p[0] <= q[0])
        : bend === 'up'
          ? pick((p, q) => p[1] <= q[1])
          : pick((p, q) => p[1] >= q[1]);
  // Hedef erişilemeyecek kadar uzaksa uzuv düz uzanır; hedefle arasındaki fark uyarı olur.
  const reached = d <= maxD + 0.6 && d >= minD - 0.01;
  return { joint: [round(joint[0]), round(joint[1])], end: [round(end[0]), round(end[1])], reached };
}

/** Pozu çizilecek parçalara çevirir. */
export function buildFigure(spec: PoseSpec): Figure {
  const segs: FigureSeg[] = [];
  const rects: FigureRect[] = [];
  const warnings: string[] = [];

  segs.push({ x1: 4, y1: GROUND_Y, x2: 96, y2: GROUND_Y, tone: 'ground' });

  for (const p of spec.props ?? []) {
    if (p.kind === 'line') segs.push({ x1: p.from[0], y1: p.from[1], x2: p.to[0], y2: p.to[1], tone: 'prop' });
    else rects.push({ x: p.x, y: p.y, w: p.w, h: p.h });
  }

  const [hx, hy] = spec.hip;
  const [nx, ny] = spec.neck;
  segs.push({ x1: hx, y1: hy, x2: nx, y2: ny, tone: 'body' });

  const limb = (origin: Pt, l: LimbSpec, l1: number, l2: number, defaultBend: Bend, name: string) => {
    const s = solveLimb(origin, l.to, l1, l2, l.bend ?? defaultBend);
    if (!s.reached) warnings.push(`${name} hedefe yetişmiyor (${l.to[0]},${l.to[1]})`);
    const tone: SegTone = l.far ? 'far' : 'body';
    segs.push({ x1: origin[0], y1: origin[1], x2: s.joint[0], y2: s.joint[1], tone });
    segs.push({ x1: s.joint[0], y1: s.joint[1], x2: s.end[0], y2: s.end[1], tone });
  };

  (spec.legs ?? []).forEach((l, i) => limb(spec.hip, l, THIGH, SHIN, 'fwd', `bacak ${i + 1}`));
  (spec.arms ?? []).forEach((l, i) => limb(spec.neck, l, UPPER_ARM, FOREARM, 'back', `kol ${i + 1}`));

  let head: Pt;
  if (spec.head) {
    head = spec.head;
  } else {
    const len = dist(spec.hip, spec.neck) || 1;
    const k = (HEAD_R + 1.5) / len;
    head = [round(nx + (nx - hx) * k), round(ny + (ny - hy) * k)];
  }

  return { segs, rects, head: { cx: head[0], cy: head[1], r: HEAD_R }, warnings };
}

/** Çizimin kutudan taşıp taşmadığını denetlemek için sınırlar. */
export function figureBounds(f: Figure): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs: number[] = [f.head.cx - f.head.r, f.head.cx + f.head.r];
  const ys: number[] = [f.head.cy - f.head.r, f.head.cy + f.head.r];
  for (const s of f.segs) {
    if (s.tone === 'ground') continue;
    xs.push(s.x1, s.x2);
    ys.push(s.y1, s.y2);
  }
  for (const r of f.rects) {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
