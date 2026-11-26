/**
 * Ana ekran düzeni: hangi kutular görünür ve hangi sırada (saf mantık + ayar tablosuna kayıt).
 * Kayıt yalnızca görünen kutuların sırasıdır; listede olmayan kutu "eklenebilir"dir. Ayar tablosu yedeğe girdiği için düzen de yedekte gelir.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { ALL_TILES, HOME_TILES, TILE_COLUMNS, type HomeTileDef } from './homeGrid';

export const HOME_LAYOUT_KEY = 'home_layout_v1';

const BY_ID = new Map(ALL_TILES.map((t) => [t.id, t]));

/** Ana ekranda "Sık kullanılanlar" olarak görünen kutu sayısı; düzendeki ilk bu kadar kutu gösterilir, gerisi "Tüm menü"dedir. */
export const HOME_FAVORITE_COUNT = 5;

/** Varsayılan sık kullanılanlar (sırayla): su, dil, egzersiz, günlük, rutinler */
export const DEFAULT_FAVORITES = ['su', 'dil', 'egzersiz', 'gunluk', 'rutin'];

/** Varsayılan düzen: önce sık kullanılanlar, sonra kalan kutular HOME_TILES sırasıyla */
export const defaultOrder = (): string[] => {
  const rest = HOME_TILES.map((t) => t.id).filter((id) => !DEFAULT_FAVORITES.includes(id));
  return [...DEFAULT_FAVORITES, ...rest];
};

/** Düzendeki ilk HOME_FAVORITE_COUNT kutu: ana ekranda görünenler. */
export const favoriteTiles = (order: string[]): HomeTileDef[] => tilesFor(order).slice(0, HOME_FAVORITE_COUNT);

/** Kayıtlı metni düzene çevirir. Bozuksa ya da yoksa varsayılan; bilinmeyen ve tekrar eden kimlikler atılır. Boş liste geçerlidir. */
export function parseLayout(raw: string | null | undefined): string[] {
  if (!raw) return defaultOrder();
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return defaultOrder();
    const out: string[] = [];
    for (const id of v) if (typeof id === 'string' && BY_ID.has(id) && !out.includes(id)) out.push(id);
    return out;
  } catch {
    return defaultOrder();
  }
}

export const serializeLayout = (order: string[]): string => JSON.stringify(order);

/** Düzendeki kutular, sırayla. */
export const tilesFor = (order: string[]): HomeTileDef[] => order.map((id) => BY_ID.get(id)).filter((t): t is HomeTileDef => t !== undefined);

/** Düzende olmayan, eklenebilir kutular (katalog sırasıyla). */
export const availableTiles = (order: string[]): HomeTileDef[] => ALL_TILES.filter((t) => !order.includes(t.id));

/** Bir kutuyu `delta` kadar kaydırır (+1 sağa, −1 sola, ±3 bir satır aşağı/yukarı); başa ya da sona gelince durur. */
export function moveBy(order: string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  if (from < 0 || !Number.isFinite(delta)) return order;
  const to = Math.max(0, Math.min(order.length - 1, from + Math.trunc(delta)));
  if (to === from) return order;
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

export const removeTile = (order: string[], id: string): string[] => order.filter((x) => x !== id);

/** Kutuyu sona ekler (zaten varsa ya da tanınmıyorsa değiştirmez). */
export const addTile = (order: string[], id: string): string[] => (BY_ID.has(id) && !order.includes(id) ? [...order, id] : order);

/** Silinen ya da taşınan kutudan sonra seçimin nereye gideceği: aynı sıradaki kutu, yoksa sondaki, hiç yoksa null. */
export function selectionAfterRemove(order: string[], removedId: string): string | null {
  const i = order.indexOf(removedId);
  if (i < 0) return null;
  const rest = removeTile(order, removedId);
  return rest[Math.min(i, rest.length - 1)] ?? null;
}

export const isDefaultOrder = (order: string[]): boolean => {
  const d = defaultOrder();
  return order.length === d.length && order.every((id, i) => id === d[i]);
};

/** "3. satır, 2. sütun" */
export const positionLabel = (index: number, cols: number = TILE_COLUMNS): string => `${Math.floor(index / cols) + 1}. satır, ${(index % cols) + 1}. sütun`;

export async function getHomeLayout(db: SQLiteDatabase): Promise<string[]> {
  return parseLayout(await getSetting(db, HOME_LAYOUT_KEY).catch(() => null));
}

export async function saveHomeLayout(db: SQLiteDatabase, order: string[]): Promise<void> {
  await setSetting(db, HOME_LAYOUT_KEY, serializeLayout(parseLayout(serializeLayout(order))));
}

export async function resetHomeLayout(db: SQLiteDatabase): Promise<string[]> {
  await db.runAsync('DELETE FROM Setting WHERE key = ?', [HOME_LAYOUT_KEY]);
  return defaultOrder();
}
