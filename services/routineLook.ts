/**
 * Rutinlerin görünümü: simge (emoji) ve renk. Saf mantık; React Native'e bağlı değildir.
 * Kullanıcı bir rutine simge/renk seçmediyse kategorinin varsayılanı gösterilir.
 */
import type { Routine, RoutineCategory } from '../database/types';
import { DRAWN_ICON_TEXT, ICON_PREFIX, isDrawnIcon } from './waterIcon';

/** Seçilebilir renkler (koyu zeminde okunur). */
export const ROUTINE_COLORS: { value: string; label: string }[] = [
  { value: '#5FD6B4', label: 'Nane' },
  { value: '#7C9CFF', label: 'Mavi' },
  { value: '#A78BFA', label: 'Mor' },
  { value: '#F472B6', label: 'Pembe' },
  { value: '#F2B35E', label: 'Turuncu' },
  { value: '#FACC15', label: 'Sarı' },
  { value: '#F0707A', label: 'Kırmızı' },
  { value: '#4ADE80', label: 'Yeşil' },
];

/**
 * Seçilebilir simgeler. "ico:" ile başlayanlar emoji değil, çizilen simgelerdir (bardak ve su şişesi).
 * Yalnızca eski telefonlarda da görünen emojiler seçildi (en yeni sürüm: Emoji 11).
 */
export const ROUTINE_ICONS: string[] = [
  'ico:glass', 'ico:bottle', '💧', '🚰', '🚶', '🏃', '🤸', '🧘',
  '📖', '✍️', '🎯', '🧠', '🗣️', '🎒', '📵', '🌙',
  '🛏️', '🦷', '🍳', '🥗', '🍎', '☕', '🚿', '🧴',
  '🧹', '🧺', '🌬️', '☀️', '🎨', '🎧', '📞', '💊',
  '🌟', '🚭', '🗓️', '🏋️',
];

export const CATEGORY_ICON: Record<RoutineCategory, string> = {
  SAGLIK: '💧',
  ZIHIN: '🧘',
  ODAK: '🎯',
  DUZEN: '🌙',
};

export const CATEGORY_COLOR: Record<RoutineCategory, string> = {
  SAGLIK: '#4ADE80',
  ZIHIN: '#A78BFA',
  ODAK: '#7C9CFF',
  DUZEN: '#F2B35E',
};

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const TR_FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Küçük harf, aksansız ve boşluğu sadeleştirilmiş metin (anahtar sözcük eşlemesi için). */
export function foldTr(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (c) => TR_FOLD[c] ?? c)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Anahtar sözcüğe göre simge. Sıra önemlidir: daha özel kurallar (su şişesi, havalandırma, uyku) genel
 * olanlardan (düzen, ekran, yazı) önce gelir. Metin foldTr ile sadeleştirilmiş olarak aranır.
 */
const ICON_RULES: [RegExp, string][] = [
  [/sise.*(doldur|su)|su sise|matara/, 'ico:bottle'],
  [/\bbardak\b|\bsu\b|hidrasyon/, 'ico:glass'],
  [/havalandir|pencere ac|temiz hava/, '🌬️'],
  [/nefes egzersiz/, '🌬️'],
  [/derin calis|zihinsel|odaklanma/, '🧠'],
  [/nefes|meditasyon|mindful/, '🧘'],
  [/yuruyus|yuruy|\byuru\b/, '🚶'],
  [/esneme|germe|stretch/, '🤸'],
  [/egzersiz|\bspor\b|antrenman|\bkosu\b|squat|sinav/, '🏃'],
  [/yatag/, '🛏️'],
  [/uyku|yatmadan|gece rutin/, '🌙'],
  [/ekransiz|telefonu birak|ekran suresi|\bekran\b/, '📵'],
  [/hafta.*plan/, '🗓️'],
  [/oncelik|oncelig|planla|\bplan\b/, '🎯'],
  [/sukran|guzel sey/, '🌟'],
  [/\b(gunluk|not|notu|notlar|yaz|yazi|yazma)\b/, '✍️'],
  [/kitap|\boku\b|okuma/, '📖'],
  [/dil calis|duolingo|ingilizce|kelime|dil ogren/, '🗣️'],
  [/kahvalti/, '🍳'],
  [/meyve/, '🍎'],
  [/sebze|salata|yemek|\bogun\b|beslen/, '🥗'],
  [/vitamin|\bilac\b/, '💊'],
  [/dis fircal|\bdis\b/, '🦷'],
  [/\bdus\b|banyo|yikan/, '🚿'],
  [/cilt|\bkrem\b/, '🧴'],
  [/camasir|bulasik/, '🧺'],
  [/masa|yuzey|toparla|duzen|temizlik|ev isi|\bcop\b/, '🧹'],
  [/sevdigin|mesaj at|arkadas|\baile\b/, '📞'],
  [/hobi|resim|boya|cizim/, '🎨'],
  [/muzik|dinle/, '🎧'],
  [/kahve|\bcay\b/, '☕'],
  [/sigara/, '🚭'],
  [/hazirla|\bcanta/, '🎒'],
  [/gunes|disari|dis mekan/, '☀️'],
];

/** Rutin adından uygun simge; eşleşme yoksa null. */
export function suggestRoutineIcon(title: string): string | null {
  const t = foldTr(title);
  if (!t) return null;
  for (const [re, icon] of ICON_RULES) if (re.test(t)) return icon;
  return null;
}

/** Saklanan simge varsa o; yoksa rutin adına uyan simge; o da yoksa kategorinin simgesi. */
export function routineIcon(r: Pick<Routine, 'icon' | 'category'> & { title?: string }): string {
  const stored = r.icon?.trim();
  // Tanınmayan "ico:" anahtarı (örn. daha yeni sürümden gelen bir yedek) ham yazı olarak gösterilmez
  if (stored && (!stored.startsWith(ICON_PREFIX) || isDrawnIcon(stored))) return stored;
  return (r.title ? suggestRoutineIcon(r.title) : null) ?? CATEGORY_ICON[r.category];
}

/** Yazı içinde kullanılacak (emoji gerektiren) karşılık: çizilen simgeler en yakın emojiye çevrilir. */
export function routineIconText(r: Pick<Routine, 'icon' | 'category'> & { title?: string }): string {
  const ic = routineIcon(r);
  return isDrawnIcon(ic) ? (DRAWN_ICON_TEXT[ic] ?? '💧') : ic;
}

/**
 * Eski rutinlerin simgesini yeniler: simge boşsa ya da yalnızca kategorinin varsayılanıysa (kullanıcı özel
 * bir şey seçmemişse) ada uyan simge verilir. Eski telefonlarda görünmeyen diş fırçası emojisi de değişir.
 * Değişiklik yoksa null.
 */
export function upgradedRoutineIcon(r: Pick<Routine, 'icon' | 'category' | 'title'>): string | null {
  const cur = (r.icon ?? '').trim();
  if (cur === '🪥') return '🦷';
  if (cur !== '' && cur !== CATEGORY_ICON[r.category]) return null;
  const next = suggestRoutineIcon(r.title);
  return next && next !== cur ? next : null;
}

export function routineColor(r: Pick<Routine, 'color' | 'category'>): string {
  return isHexColor(r.color) ? r.color : CATEGORY_COLOR[r.category];
}

/** "#rrggbb" + 0..1 saydamlık -> "rgba(r,g,b,a)". Geçersiz renkte nane rengi kullanılır. */
export function withAlpha(hex: string, alpha: number): string {
  const h = isHexColor(hex) ? hex : '#5FD6B4';
  const n = parseInt(h.slice(1), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
