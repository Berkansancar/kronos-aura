/**
 * Gün haritası (saf mantık, test edilebilir): telefonun arka planda aldığı konum örneklerinden bir günün
 * "evde / yolda / durakta / kayıtlı iş noktasında" dakikalarını çıkarır; ekran açık kalma süresini de bu parçalara böler.
 *
 * Neden böyle: sürücünün iş yeri sabit olmayabilir ama EV kesindir. Bu yüzden ev çıpadır: evden çıkış, dışarıda geçen
 * süre ve eve dönüş her gün hesaplanır. İş noktaları isteğe bağlıdır (dükkan değişirse yenisi eklenir); kaydedilmemiş
 * bir yerde durmak "durakta" sayılır. Dükkana uğranmayan gün bir kusur değildir; yalnızca dakikalar yazılır.
 *
 * Gizlilik: koordinatlar ve yer adları bu dosyadan dışarı çıkan hiçbir özette yer almaz; yalnızca dakika toplamları vardır.
 */
import { parseDayKey } from './activityLogic';
import { formatClock, formatDuration } from './format';

export type PlaceKind = 'HOME' | 'WORK';
export type LocState = 'HOME' | 'WORK' | 'ROAD' | 'STOP';

export interface PlaceLite {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface LocPoint {
  /** Milisaniye (Unix) */
  ts: number;
  lat: number;
  lon: number;
  /** m/sn; yoksa null */
  speed: number | null;
  /** Doğruluk yarıçapı (m); yoksa null */
  acc: number | null;
  /**
   * Takip bu anda kapatıldı işareti (gerçek bir konum değildir). Bundan sonraki süre, takip yeniden açılıp yeni örnek
   * gelene kadar "bilinmiyor" sayılır; kapalıyken evde saymayız.
   */
  off?: boolean;
}

export interface StateInterval {
  from: number;
  to: number;
  state: LocState;
}

export interface ScreenSession {
  on: number;
  off: number;
}

/** Ayar anahtarları (Setting tablosu) */
export const LOCATION_ON_KEY = 'location_on';
export const LOCATION_SHARE_KEY = 'location_share';
/** Son günlük toplam hesabının zamanı (arka plan görevi sık sık hesaplamasın) */
export const LOCATION_ROLLUP_KEY = 'location_rollup_at';
/** Arka plan konum görevinin adı */
export const LOCATION_TASK_NAME = 'kronos-aura-location';
/** Arka plan görevi en çok bu sürede bir günlük toplamları yeniler (ms) */
export const ROLLUP_EVERY_MS = 3 * 60 * 60 * 1000;

export const DEFAULT_HOME_RADIUS_M = 200;
export const DEFAULT_WORK_RADIUS_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 500;
export const MAX_PLACE_NAME = 24;
/** Ham konum örnekleri bu kadar gün saklanır; sonrası günlük dakika toplamına çevrilip silinir. */
export const RAW_KEEP_DAYS = 3;

/** Bu hızın (m/sn, ≈ 9 km/sa) üstü "hareket hâlinde" sayılır. */
export const MOVING_MS = 2.5;
/** Ardışık iki örnek arası bu süreden uzunsa ve hareketliyse, fazlası "bilinmiyor" sayılır. */
export const MAX_MOVING_GAP_MIN = 30;
/**
 * Durağan telefon örnek üretmez (uyku modu, hareketsizlik): evde geçen gece ve hafta sonu bu yüzden uzun boşluktur.
 * Bu yüzden evde boşluk 60 saate kadar "hâlâ evde" sayılır (Pazar dahil bir hafta sonu); dışarıda (durak, iş noktası)
 * 14 saate kadar. Aşan kısım "bilinmiyor" olur.
 */
export const MAX_HOME_GAP_MIN = 60 * 60;
export const MAX_STILL_GAP_MIN = 14 * 60;
const stillCapMs = (state: LocState): number => (state === 'HOME' ? MAX_HOME_GAP_MIN : MAX_STILL_GAP_MIN) * 60_000;
/** Kayıtlı iş noktasında bu kadar dakika kalınmadıysa "uğrandı" sayılmaz (yoldan geçiş). */
export const MIN_WORK_STAY_MIN = 5;
/** Kırmızı ışık gibi, iki hareketin arasına sıkışmış bu kısa duruşlar "yolda" sayılır. */
export const SHORT_STOP_MIN = 4;

const MIN = 60_000;

// ───────────────────────── Geometri ─────────────────────────

const toRad = (d: number): number => (d * Math.PI) / 180;

/** İki nokta arası metre (haversine). */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nokta bir kayıtlı yerin içinde mi? (doğruluk payı en çok 50 m eklenir) */
export function inPlace(p: Pick<LocPoint, 'lat' | 'lon' | 'acc'>, place: PlaceLite): boolean {
  const margin = Math.min(Math.max(p.acc ?? 0, 0), 50);
  return distanceM(p.lat, p.lon, place.lat, place.lon) <= place.radiusM + margin;
}

/** Noktanın bulunduğu yer: önce ev, sonra iş noktası; hiçbiri değilse null. */
export function placeStateOf(p: Pick<LocPoint, 'lat' | 'lon' | 'acc'>, places: PlaceLite[]): 'HOME' | 'WORK' | null {
  if (places.some((pl) => pl.kind === 'HOME' && inPlace(p, pl))) return 'HOME';
  if (places.some((pl) => pl.kind === 'WORK' && inPlace(p, pl))) return 'WORK';
  return null;
}

// ───────────────────────── Parçalara ayırma ─────────────────────────

/**
 * İki ardışık örnek arası "hareket" mi? Ortalama hız yer değiştirmeden bulunur (konum gürültüsü payı bırakılır);
 * kısa aralıkta cihazın verdiği hız da güvenilir kabul edilir.
 */
export function isMovingBetween(a: LocPoint, b: LocPoint): boolean {
  const dt = (b.ts - a.ts) / 1000;
  if (dt <= 0) return false;
  const d = distanceM(a.lat, a.lon, b.lat, b.lon);
  const noise = (a.acc ?? 30) + (b.acc ?? 30);
  if (d > Math.max(150, noise * 1.5) && d / dt >= MOVING_MS) return true;
  if (dt <= 120 && b.speed !== null && b.speed >= 5 && (b.acc ?? 0) <= 100) return true;
  return false;
}

/**
 * Örnekleri sürekli durum aralıklarına çevirir. Aralık i → i+1:
 *  - hareketliyse "yolda";
 *  - değilse aracın o an durduğu yerdir (ev, kayıtlı iş noktası ya da "durakta").
 * Son örnek `endMs`e kadar sürer. Boşluk çok uzunsa fazlası aralığa alınmaz ("bilinmiyor").
 */
export function buildIntervals(points: LocPoint[], places: PlaceLite[], endMs: number): StateInterval[] {
  const pts = [...points].sort((a, b) => a.ts - b.ts).filter((p, i, arr) => i === 0 || p.ts !== arr[i - 1].ts);
  const out: StateInterval[] = [];
  const push = (from: number, to: number, state: LocState): void => {
    if (to <= from) return;
    const last = out[out.length - 1];
    if (last && last.state === state && last.to === from) last.to = to;
    else out.push({ from, to, state });
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.off) continue; // "takip kapandı" işareti kendi başına süre üretmez
    const next = i + 1 < pts.length ? pts[i + 1] : null;
    const stillState: LocState = placeStateOf(p, places) ?? 'STOP';
    if (next && next.off) {
      // Takip kapanana kadar aynı yerde; sonrası bilinmiyor
      push(p.ts, p.ts + Math.min(next.ts - p.ts, stillCapMs(stillState)), stillState);
    } else if (next) {
      const gap = next.ts - p.ts;
      if (isMovingBetween(p, next)) push(p.ts, p.ts + Math.min(gap, MAX_MOVING_GAP_MIN * MIN), 'ROAD');
      else push(p.ts, p.ts + Math.min(gap, stillCapMs(stillState)), stillState);
    } else {
      const gap = Math.max(0, endMs - p.ts);
      const movingNow = p.speed !== null && p.speed >= MOVING_MS && (p.acc ?? 0) <= 100;
      if (movingNow) push(p.ts, p.ts + Math.min(gap, MAX_MOVING_GAP_MIN * MIN), 'ROAD');
      else push(p.ts, p.ts + Math.min(gap, stillCapMs(stillState)), stillState);
    }
  }
  return smoothShortStops(out);
}

/** İki "yolda" arasındaki kısa "durakta" aralıkları (ışık, trafik) "yolda"ya katılır; sonra komşular birleşir. */
export function smoothShortStops(list: StateInterval[]): StateInterval[] {
  const arr = list.map((x) => ({ ...x }));
  for (let i = 1; i < arr.length - 1; i++) {
    const cur = arr[i];
    if (cur.state === 'STOP' && cur.to - cur.from < SHORT_STOP_MIN * MIN && arr[i - 1].state === 'ROAD' && arr[i + 1].state === 'ROAD') {
      cur.state = 'ROAD';
    }
  }
  const merged: StateInterval[] = [];
  for (const x of arr) {
    const last = merged[merged.length - 1];
    if (last && last.state === x.state && last.to === x.from) last.to = x.to;
    else merged.push({ ...x });
  }
  return merged;
}

/** Aralıkları [from, to) penceresine keser. */
export function clipIntervals(list: StateInterval[], from: number, to: number): StateInterval[] {
  const out: StateInterval[] = [];
  for (const x of list) {
    const a = Math.max(x.from, from);
    const b = Math.min(x.to, to);
    if (b > a) out.push({ from: a, to: b, state: x.state });
  }
  return out;
}

// ───────────────────────── Günün özeti ─────────────────────────

export interface DayLocationSummary {
  day: string;
  homeMin: number;
  /** Kayıtlı iş noktası yoksa null; varsa o noktalarda geçen dakika (uğranmadıysa 0) */
  workMin: number | null;
  roadMin: number;
  stopMin: number;
  /** Dakikası bilinen toplam süre (ev + iş noktası + yol + durak) */
  trackedMin: number;
  /** İlk evden çıkış "SS:DD"; gün dışarıda başladıysa ya da çıkış görülmediyse null */
  leftHome: string | null;
  /** Son eve dönüş "SS:DD"; dönüş görülmediyse null */
  backHome: string | null;
  /** Ekran açık dakika: evde, yolda, dışarıda (durak + iş noktası); ekran verisi yoksa null */
  screenHomeMin: number | null;
  screenRoadMin: number | null;
  screenOutMin: number | null;
}

/** Günün [başlangıç, bitiş) milisaniyesi (yerel saat; saat değişimi günlerinde de doğru). */
export function dayWindow(day: string): { start: number; end: number } {
  const s = parseDayKey(day);
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
  return { start: s.getTime(), end: e.getTime() };
}

const msTo = (ms: number): number => Math.round(ms / MIN);

function minutesBy(list: StateInterval[], state: LocState): number {
  return msTo(list.filter((x) => x.state === state).reduce((a, x) => a + (x.to - x.from), 0));
}

/** Ekran oturumlarının her durum aralığıyla kesişimi (ms). */
export function screenOverlapMs(list: StateInterval[], sessions: ScreenSession[]): Record<LocState, number> {
  const acc: Record<LocState, number> = { HOME: 0, WORK: 0, ROAD: 0, STOP: 0 };
  for (const iv of list) {
    for (const s of sessions) {
      const a = Math.max(iv.from, s.on);
      const b = Math.min(iv.to, s.off);
      if (b > a) acc[iv.state] += b - a;
    }
  }
  return acc;
}

/** Saat damgası: ilk "evden çıkış" ve son "eve dönüş". */
export function homeTransitions(list: StateInterval[]): { leftHome: number | null; backHome: number | null } {
  let leftHome: number | null = null;
  let backHome: number | null = null;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1].state;
    const cur = list[i].state;
    if (prev === 'HOME' && cur !== 'HOME' && leftHome === null) leftHome = list[i].from;
    if (prev !== 'HOME' && cur === 'HOME') backHome = list[i].from;
  }
  return { leftHome, backHome };
}

/** Günün durum aralıkları (gün penceresine ve "şimdi"ye kesilmiş). */
export function dayIntervals(day: string, points: LocPoint[], places: PlaceLite[], nowMs: number): StateInterval[] {
  const { start, end } = dayWindow(day);
  const stop = Math.min(end, nowMs);
  if (stop <= start) return [];
  // Pencereden sonraki örnekler hesaba girmez
  const usable = points.filter((p) => p.ts < stop);
  return clipIntervals(buildIntervals(usable, places, stop), start, stop);
}

/**
 * Bir günün özeti. `points`: o güne ait ve ondan hemen önceki örnekler (gece yarısını kapatmak için);
 * `nowMs`: bugün için bitiş. `sessions` null ise ekran alanları null kalır.
 */
export function summarizeDay(
  day: string,
  points: LocPoint[],
  places: PlaceLite[],
  nowMs: number,
  sessions: ScreenSession[] | null
): DayLocationSummary {
  const hasWork = places.some((p) => p.kind === 'WORK');
  const clipped = dayIntervals(day, points, places, nowMs);
  const home = minutesBy(clipped, 'HOME');
  const work = minutesBy(clipped, 'WORK');
  const road = minutesBy(clipped, 'ROAD');
  const stopMin = minutesBy(clipped, 'STOP');
  const tr = homeTransitions(clipped);
  let screen: Record<LocState, number> | null = null;
  if (sessions) screen = screenOverlapMs(clipped, sessions);
  return {
    day,
    homeMin: home,
    workMin: hasWork ? work : null,
    roadMin: road,
    stopMin: stopMin,
    trackedMin: home + work + road + stopMin,
    leftHome: tr.leftHome !== null ? formatClock(new Date(tr.leftHome)) : null,
    backHome: tr.backHome !== null ? formatClock(new Date(tr.backHome)) : null,
    screenHomeMin: screen ? msTo(screen.HOME) : null,
    screenRoadMin: screen ? msTo(screen.ROAD) : null,
    screenOutMin: screen ? msTo(screen.STOP + screen.WORK) : null,
  };
}

/** Günün özeti "kayıt sayılır" mı? (en az yarım saatlik bilinen süre) */
export const hasLocationRecord = (s: DayLocationSummary | null | undefined): s is DayLocationSummary => !!s && s.trackedMin >= 30;

/** Dışarıda geçen dakika: yol + durak + iş noktası */
export const outMinutes = (s: DayLocationSummary): number => s.roadMin + s.stopMin + (s.workMin ?? 0);

/** Kayıtlı iş noktasında bir süre kalındı mı? İş noktası kaydı yoksa null (bilinmez). */
export function visitedWork(s: DayLocationSummary): boolean | null {
  if (s.workMin === null) return null;
  return s.workMin >= MIN_WORK_STAY_MIN;
}

// ───────────────────────── Ekran çizimi ─────────────────────────

export interface BarSegment {
  state: LocState | 'NONE';
  from: number;
  to: number;
}

/** Günün çubuğu: aralıklar arasındaki boşluklar "NONE" (bilinmiyor) ile doldurulur. */
export function barSegments(list: StateInterval[], from: number, to: number): BarSegment[] {
  const out: BarSegment[] = [];
  let cursor = from;
  for (const x of clipIntervals(list, from, to)) {
    if (x.from > cursor) out.push({ state: 'NONE', from: cursor, to: x.from });
    out.push({ state: x.state, from: x.from, to: x.to });
    cursor = x.to;
  }
  if (cursor < to) out.push({ state: 'NONE', from: cursor, to });
  return out;
}

export const STATE_LABELS: Record<LocState, string> = {
  HOME: 'Evde',
  WORK: 'İş noktasında',
  ROAD: 'Yolda',
  STOP: 'Durakta',
};

/** "Evde 6 sa 10 dk · Yolda 9 sa 50 dk · Durakta 40 dk" (sıfır olanlar yazılmaz) */
export function summaryText(s: DayLocationSummary): string {
  const parts: string[] = [];
  if (s.homeMin > 0) parts.push(`Evde ${formatDuration(s.homeMin)}`);
  if (s.roadMin > 0) parts.push(`Yolda ${formatDuration(s.roadMin)}`);
  if ((s.workMin ?? 0) > 0) parts.push(`İş noktasında ${formatDuration(s.workMin as number)}`);
  if (s.stopMin > 0) parts.push(`Durakta ${formatDuration(s.stopMin)}`);
  return parts.join(' · ');
}

// ───────────────────────── Yer kaydı doğrulama ─────────────────────────

export interface PlaceInput {
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  radiusM?: number;
}

export type PlaceCheck = { ok: true; place: Required<PlaceInput> } | { ok: false; error: string };

export function validatePlace(input: PlaceInput): PlaceCheck {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length === 0) return { ok: false, error: 'Yere bir ad ver (ör. Dükkan).' };
  if (name.length > MAX_PLACE_NAME) return { ok: false, error: `Ad en çok ${MAX_PLACE_NAME} harf olabilir.` };
  if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lon) || Math.abs(input.lon) > 180) {
    return { ok: false, error: 'Konum okunamadı. Açık havada ya da pencere kenarında tekrar dene.' };
  }
  const fallback = input.kind === 'HOME' ? DEFAULT_HOME_RADIUS_M : DEFAULT_WORK_RADIUS_M;
  const r = Math.round(input.radiusM ?? fallback);
  const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Number.isFinite(r) ? r : fallback));
  return { ok: true, place: { name, kind: input.kind, lat: input.lat, lon: input.lon, radiusM } };
}

/** Ham örneklerin silineceği sınır: bugünden RAW_KEEP_DAYS gün öncesinin başlangıcı. */
export function rawCutoffMs(today: string): number {
  const s = parseDayKey(today);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - RAW_KEEP_DAYS).getTime();
}
