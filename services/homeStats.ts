/**
 * Ana ekrandaki üç bugünkü sayı kartı (adım, su, dil). Saf mantık: ekran verileri alınır, gösterilecek metinler ve doluluk oranı döner.
 * Ölçülmemiş değer "sıfır" yazılmaz; "—" ve açıklama görünür.
 */
import { formatSteps } from './activityLogic';
import { compareWater, fmtKm, fmtLiters, fmtNum, strideFromHeight } from './analysisLogic';

export interface HomeStatInput {
  /** Bugünkü adım; null = ölçülemedi / izin yok */
  steps: number | null;
  heightCm: number | null;
  waterMl: number | null;
  waterGoalMl: number | null;
  /** Bugün dil uygulamasında geçen dakika; null = ölçülemedi */
  langMinutes: number | null;
  langGoalMin: number | null;
  /** Ayarlardaki dil uygulaması adı (Duolingo) */
  appLabel: string;
}

export interface HomeStatCard {
  key: 'adim' | 'su' | 'dil';
  title: string;
  value: string;
  sub: string;
  /** Hedefe oran (0-1); hedef yoksa null: çubuk çizilmez */
  ratio: number | null;
  /** Çubuğun rengi: 'aura' (yeşil) ya da 'kronos' (mavi) */
  tone: 'aura' | 'kronos';
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function homeStatCards(i: HomeStatInput): HomeStatCard[] {
  const stride = strideFromHeight(i.heightCm);
  const steps: HomeStatCard =
    i.steps === null
      ? { key: 'adim', title: 'Adım', value: '—', sub: 'ölçülemedi', ratio: null, tone: 'aura' }
      : { key: 'adim', title: 'Adım', value: formatSteps(i.steps), sub: fmtKm((i.steps * stride.m) / 1000), ratio: null, tone: 'aura' };

  const ml = i.waterMl ?? 0;
  const water: HomeStatCard = {
    key: 'su',
    title: 'Su',
    value: fmtLiters(ml),
    sub: `${fmtNum(compareWater(ml).damacana, 2)} damacana`,
    ratio: i.waterGoalMl && i.waterGoalMl > 0 ? clamp01(ml / i.waterGoalMl) : null,
    tone: 'kronos',
  };

  const lang: HomeStatCard =
    i.langMinutes === null
      ? { key: 'dil', title: 'Dil', value: '—', sub: i.appLabel, ratio: null, tone: 'aura' }
      : {
          key: 'dil',
          title: 'Dil',
          value: `${Math.round(i.langMinutes)} dk`,
          sub: i.appLabel,
          ratio: i.langGoalMin && i.langGoalMin > 0 ? clamp01(i.langMinutes / i.langGoalMin) : null,
          tone: 'aura',
        };
  return [steps, water, lang];
}
