const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

/** 09:05 */
export function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 16 Kasım, Pazartesi */
export function formatDayTitle(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${DAYS[d.getDay()]}`;
}

/** 90 -> "1 sa 30 dk", 45 -> "45 dk" */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} sa` : `${h} sa ${rest} dk`;
}
