/**
 * Ana ekranın ilk sayfası: simgeli ızgara (saf mantık). Kutuya kısa dokunmak hızlı işlem yapar ya da ipucu verir,
 * basılı tutmak ilgili ekranı açar. Yana kaydırınca ikinci sayfada eski (tam) ana ekran durur.
 * Çizimi components/HomeGrid.tsx yapar; burada kutuların listesi, sayfa hesabı ve ipucu metinleri vardır.
 */

export type TileGroup = 'health' | 'plan' | 'coach';

/** Özel simgeler: uygulamanın içinde çizilir (emoji değildir). */
export const ICON_DAMACANA = '@damacana';
export const ICON_KRONOS = '@kronos';
export const ICON_AURA = '@aura';

export interface HomeTileDef {
  id: string;
  /** Simgenin altındaki kısa ad (en çok 10 harf: üç sütuna sığsın) */
  label: string;
  /** Emoji ya da özel simge anahtarı ('@' ile başlar) */
  icon: string;
  group: TileGroup;
  /** Basılı tutunca açılan ekran */
  route: string;
  params?: Record<string, string>;
}

export const TILE_COLUMNS = 3;
export const HOME_PAGES = 2;
/** Basılı tutma süresi (ms) */
export const LONG_PRESS_MS = 400;

export const HOME_TILES: HomeTileDef[] = [
  // Rutin ve sağlık
  { id: 'rutin', label: 'Rutinler', icon: '🔁', group: 'health', route: '/routines' },
  { id: 'rutin-yap', label: 'Rutin yap', icon: '⏱️', group: 'health', route: '/routine-run' },
  { id: 'egzersiz', label: 'Egzersiz', icon: '💪', group: 'health', route: '/exercise' },
  { id: 'su', label: 'Su, yemek', icon: ICON_DAMACANA, group: 'health', route: '/nutrition' },
  { id: 'dil', label: 'Dil', icon: '🗣️', group: 'health', route: '/language' },
  { id: 'kelime', label: 'Kelime', icon: '📖', group: 'health', route: '/vocab' },
  { id: 'etki', label: 'Etki', icon: '🌱', group: 'health', route: '/effects' },
  { id: 'kilo', label: 'Kilo', icon: '⚖️', group: 'health', route: '/body' },
  { id: 'rekor', label: 'Rekorlar', icon: '🥇', group: 'health', route: '/body', params: { tab: 'rekor' } },
  // Plan ve takip
  { id: 'rehber', label: 'Rehber', icon: '🧭', group: 'plan', route: '/guide' },
  { id: 'gun-akisi', label: 'Gün akışı', icon: '🕐', group: 'plan', route: '/day' },
  { id: 'harita', label: 'Harita', icon: '📍', group: 'plan', route: '/location' },
  { id: 'isaretle', label: 'İşaretle', icon: '✅', group: 'plan', route: '/mark' },
  { id: 'hafta', label: 'Hafta', icon: '📋', group: 'plan', route: '/week' },
  { id: 'haftalik', label: 'Haftalık', icon: '📆', group: 'plan', route: '/weekly' },
  { id: 'takvim', label: 'Takvim', icon: '📅', group: 'plan', route: '/habits' },
  { id: 'gecmis', label: 'Geçmiş', icon: '📈', group: 'plan', route: '/history' },
  { id: 'analiz', label: 'Analiz', icon: '📊', group: 'plan', route: '/analysis' },
  { id: 'hedef', label: 'Hedefler', icon: '🎯', group: 'plan', route: '/goals' },
  { id: 'karne', label: 'Karne', icon: '📑', group: 'plan', route: '/monthly' },
  { id: 'gunluk', label: 'Günlük', icon: '📓', group: 'plan', route: '/journal' },
  { id: 'kahraman', label: 'Kahraman', icon: '🏆', group: 'plan', route: '/hero' },
  // Koçlar
  { id: 'kronos', label: 'Kronos', icon: ICON_KRONOS, group: 'coach', route: '/chat', params: { coach: 'KRONOS' } },
  { id: 'aura', label: 'Aura', icon: ICON_AURA, group: 'coach', route: '/chat', params: { coach: 'AURA' } },
];

/** Varsayılan düzende görünmeyen ama istenirse ana ekrana eklenebilen kutular (2. sayfadaki ve diğer menüler). */
export const EXTRA_TILES: HomeTileDef[] = [
  { id: 'aktivite', label: 'Aktivite', icon: '📱', group: 'plan', route: '/activity' },
  { id: 'sabah', label: 'Sabah', icon: '🌅', group: 'plan', route: '/morning' },
  { id: 'gun-sonu', label: 'Gün sonu', icon: '🌙', group: 'plan', route: '/review' },
  { id: 'profil', label: 'Profil', icon: '👤', group: 'plan', route: '/profile' },
  { id: 'ayarlar', label: 'Ayarlar', icon: '⚙️', group: 'plan', route: '/settings' },
];

/** Düzenleme ekranında seçilebilecek tüm kutular. */
export const ALL_TILES: HomeTileDef[] = [...HOME_TILES, ...EXTRA_TILES];

export const isSpecialIcon = (icon: string): boolean => icon.startsWith('@');

/** Satırlara böler (son satır eksik kalabilir). */
export function chunkTiles<T>(items: T[], cols: number = TILE_COLUMNS): T[][] {
  const size = Math.max(1, Math.floor(cols));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Yatay kaydırma konumundan sayfa numarası (0 tabanlı); sınırlar içinde kalır. */
export function pageFromOffset(x: number, width: number, pages: number = HOME_PAGES): number {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
  const p = Math.round(x / width);
  return Math.max(0, Math.min(pages - 1, p));
}

/** Kısa dokunuşta gösterilen ipucu (su kutusu hariç; o hızlı işlem yapar). */
export function tapHint(tile: HomeTileDef): string {
  return `Basılı tut: ${tile.label} açılır`;
}

/** Su kutusuna kısa dokunuşun eklediği miktar (ml) */
export const QUICK_WATER_ML = 200;
export const quickWaterMessage = (ml: number = QUICK_WATER_ML): string => `+${ml} ml su eklendi`;

/** Görevler özeti: başlık ve en çok 3 açık görev adı. */
export function taskPeek(titles: string[], max: number = 3): { shown: string[]; more: number } {
  const clean = titles.map((t) => t.trim()).filter((t) => t.length > 0);
  const shown = clean.slice(0, Math.max(0, max));
  return { shown, more: Math.max(0, clean.length - shown.length) };
}
