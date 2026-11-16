/**
 * Rutinlerin görünümü: simge (emoji) ve renk. Saf mantık; React Native'e bağlı değildir.
 * Kullanıcı bir rutine simge/renk seçmediyse kategorinin varsayılanı gösterilir.
 */
import type { Routine, RoutineCategory } from '../database/types';

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

/** Seçilebilir simgeler. */
export const ROUTINE_ICONS: string[] = [
  '💧', '🚶', '🏃', '🧘', '📖', '✍️', '🎯', '🗣️',
  '🛏️', '🪥', '🍳', '🥗', '🚿', '🧴', '🧹', '🌙',
  '☀️', '🌬️', '🤸', '🎨', '🎧', '📞', '💊', '🌟',
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

export function routineIcon(r: Pick<Routine, 'icon' | 'category'>): string {
  return r.icon && r.icon.trim() ? r.icon : CATEGORY_ICON[r.category];
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
