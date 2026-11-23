/**
 * "Seni ne iyi yapıyor?": ruh halini, aynı günlerde yapılan üç işle (egzersiz, su hedefi, dil çalışması) yan yana koyar.
 * Yapay zekâ ya da internet gerekmez; yalnızca kayıtlı günlerin ortalaması karşılaştırılır.
 *
 * Dürüstlük kuralları: yeterli kayıt yoksa sonuç verilmez (en az 14 ruh hali günü ve her iki grupta en az 4 gün);
 * fark küçükse "belirgin fark yok" denir; hiçbir cümle sebep-sonuç iddia etmez ("birlikte görünüyor").
 */
export type InsightFactor = 'exercise' | 'water' | 'study';

export const MIN_MOOD_DAYS = 14;
export const MIN_GROUP_DAYS = 4;
/** Ruh hali ortalaması farkı bundan küçükse "belirgin fark yok" sayılır */
export const MIN_DIFF = 0.3;

export const FACTOR_LABELS: Record<InsightFactor, string> = {
  exercise: 'Egzersiz yaptığın',
  water: 'Su hedefine ulaştığın',
  study: 'Dil çalıştığın',
};

export interface InsightInput {
  moods: { day: string; mood: number }[];
  exerciseDays: string[];
  waterGoalDays: string[];
  studyDays: string[];
}

export interface Insight {
  factor: InsightFactor;
  withDays: number;
  withoutDays: number;
  withAvg: number;
  withoutAvg: number;
  /** withAvg - withoutAvg, tek ondalık */
  diff: number;
  verdict: 'higher' | 'lower' | 'none';
  text: string;
}

export interface InsightResult {
  moodDays: number;
  enough: boolean;
  items: Insight[];
  /** Yeterli kayıt yoksa ne kadar daha gerektiğini söyleyen cümle */
  needText: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round1(n)).replace('.', ',');
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function moodInsights(input: InsightInput): InsightResult {
  const byDay = new Map<string, number>();
  for (const m of input.moods) if (Number.isFinite(m.mood) && m.mood >= 1 && m.mood <= 5) byDay.set(m.day, m.mood);
  const moodDays = byDay.size;
  if (moodDays < MIN_MOOD_DAYS) {
    const left = MIN_MOOD_DAYS - moodDays;
    return { moodDays, enough: false, items: [], needText: `Karşılaştırma için en az ${MIN_MOOD_DAYS} günlük ruh hali kaydı gerekir; ${left} gün daha.` };
  }
  const sets: Record<InsightFactor, Set<string>> = {
    exercise: new Set(input.exerciseDays),
    water: new Set(input.waterGoalDays),
    study: new Set(input.studyDays),
  };
  const items: Insight[] = [];
  for (const factor of ['exercise', 'water', 'study'] as InsightFactor[]) {
    const w: number[] = [];
    const wo: number[] = [];
    for (const [day, mood] of byDay) (sets[factor].has(day) ? w : wo).push(mood);
    if (w.length < MIN_GROUP_DAYS || wo.length < MIN_GROUP_DAYS) continue;
    const withAvg = round1(avg(w));
    const withoutAvg = round1(avg(wo));
    const diff = round1(avg(w) - avg(wo));
    const verdict: Insight['verdict'] = diff >= MIN_DIFF ? 'higher' : diff <= -MIN_DIFF ? 'lower' : 'none';
    const label = FACTOR_LABELS[factor];
    let text: string;
    if (verdict === 'none') text = `${label} günlerle diğer günler arasında ruh halinde belirgin fark görünmüyor.`;
    else if (verdict === 'higher')
      text = `${label} günlerde ruh halin ortalama ${fmt(withAvg)}, diğer günlerde ${fmt(withoutAvg)}. İkisi birlikte görünüyor; sebep olduğu anlamına gelmez.`;
    else text = `${label} günlerde ruh halin ortalama ${fmt(withAvg)}, diğer günlerde ${fmt(withoutAvg)}. Yorgun günlerde de yapılmış olabilir; sebep olduğu anlamına gelmez.`;
    items.push({ factor, withDays: w.length, withoutDays: wo.length, withAvg, withoutAvg, diff, verdict, text });
  }
  return {
    moodDays,
    enough: true,
    items,
    needText: items.length === 0 ? `Her iki grupta da en az ${MIN_GROUP_DAYS} gün olunca karşılaştırma görünür.` : null,
  };
}
