export const colors = {
  bg: '#0B0D12',
  surface: '#141821',
  surfaceAlt: '#1B2130',
  border: '#262D3D',
  text: '#E8ECF4',
  textMuted: '#8B94A8',

  // Koç renkleri
  kronos: '#7C9CFF',
  kronosSoft: 'rgba(124,156,255,0.10)',
  aura: '#5FD6B4',
  auraSoft: 'rgba(95,214,180,0.10)',

  // Durum / bilişsel ağırlık renkleri
  warning: '#F2B35E',
  danger: '#F0707A',
  weightHigh: '#F0707A',
  weightMedium: '#F2B35E',
  weightLow: '#6FD0A0',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
