/**
 * Akşam günlüğünün saf mantığı: üç kısa soru, temizleme, gün seçimi, Aura'nın cevabı, dünkü hedef ve ay özeti.
 * React Native ve veritabanına bağlı değildir; terminalde test edilir (npm run test:journal).
 *
 * Aura'nın ilkesi: yargılamaz. Boş bırakılan soru, düşük ruh hali ya da yazılmayan gün hiçbir yerde "eksik" diye anılmaz.
 */
import type { JournalEntry, MoodLog } from '../database/types';
import { dayKey, parseDayKey } from './activityLogic';
import { computeStreak } from './effectsLogic';
import { moodInfo } from './moodLogic';

export const JOURNAL_MAX = 280;

export interface JournalFields {
  good: string;
  grateful: string;
  goal: string;
}

export type JournalKey = keyof JournalFields;

export const JOURNAL_QUESTIONS: { key: JournalKey; label: string; placeholder: string }[] = [
  { key: 'good', label: 'Bugün ne iyi gitti?', placeholder: 'Küçük bir şey de olur' },
  { key: 'grateful', label: 'Neye şükrettim?', placeholder: 'Bir kişi, bir an, bir fincan çay' },
  { key: 'goal', label: 'Yarının tek hedefi', placeholder: 'Yalnızca bir şey yaz' },
];

export const EMPTY_FIELDS: JournalFields = { good: '', grateful: '', goal: '' };

/** Boşlukları toparlar, baştaki ve sondaki boşluğu atar, en çok JOURNAL_MAX karakter bırakır. */
export function cleanText(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim().slice(0, JOURNAL_MAX).trim();
}

export function cleanFields(f: Partial<JournalFields>): JournalFields {
  return { good: cleanText(f.good), grateful: cleanText(f.grateful), goal: cleanText(f.goal) };
}

export const isEmptyFields = (f: JournalFields): boolean => !f.good && !f.grateful && !f.goal;

export const fieldsOf = (e: JournalEntry | null): JournalFields => (e ? { good: e.good, grateful: e.grateful, goal: e.goal } : { ...EMPTY_FIELDS });

/** Gece yarısından sonra (04:00'e kadar) yazılan günlük hâlâ "dünün" günlüğüdür. */
export function journalDay(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < 4) d.setDate(d.getDate() - 1);
  return dayKey(d);
}

/** Günlük 20:00'den sonra ve gece 04:00'e kadar "akşam" sayılır; gün içinde de yazılabilir ama hatırlatma akşamdır. */
export const isEvening = (now: Date): boolean => now.getHours() >= 20 || now.getHours() < 4;

const shiftDay = (day: string, delta: number): string => {
  const d = parseDayKey(day);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
};

/**
 * Bugünün hedefi: dün yazılan "yarının tek hedefi". Takvimdeki bugün için dünün kaydına bakılır.
 * Hedef boşsa null.
 */
export function goalForToday(entries: JournalEntry[], calendarToday: string): string | null {
  const y = shiftDay(calendarToday, -1);
  const e = entries.find((x) => x.day === y);
  return e && e.goal ? e.goal : null;
}

/** Aura'nın kaydın ardından verdiği kısa cevap: en çok üç kısa cümle, yargı yok. */
export function auraJournalReply(fields: JournalFields, mood: number | null, streakDays: number): string {
  const out: string[] = [];
  if (isEmptyFields(fields)) {
    out.push('Bugün yazacak bir şey bulamadıysan sorun değil.');
    out.push('Ruh halini not etmen de yeterli.');
    return out.join(' ');
  }
  if (mood !== null && mood <= 2) out.push('Zor bir gün olmuş. Yazman bile bir adım.');
  else if (mood !== null && mood >= 4) out.push('Güzel bir gün gibi duruyor, yazdığın için teşekkürler.');
  else out.push('Günü kelimelere dökmen iyi geldi umarım.');
  if (fields.goal) out.push(`Yarının hedefi sabah gözünün önünde olacak: ${fields.goal}`);
  else if (fields.good || fields.grateful) out.push('Yarın için hedef yazmadın, bu da olur.');
  if (streakDays >= 3) out.push(`${streakDays} gündür yazıyorsun.`);
  return out.slice(0, 3).join(' ');
}

/** Günlük yazılan günlerin serisi (her gün yazılması gerekir; bitince en uzun seri saklanır). */
export function journalStreak(entries: JournalEntry[], today: string) {
  return computeStreak(
    entries.filter((e) => !isEmptyFields(fieldsOf(e))).map((e) => e.day),
    today,
    1,
    false
  );
}

export interface MonthSummary {
  month: string;
  writtenDays: number;
  goalDays: number;
  moodDays: number;
  moodAvg: number | null;
  /** En yüksek ruh halli (en çok 3) günler ve o günün "ne iyi gitti" yazısı */
  bestDays: { day: string; mood: number; good: string }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Bir ayın özeti: kaç gün yazıldı, kaç günün hedefi vardı, ruh hali ortalaması ve en iyi günler. `month` = "YYYY-MM". */
export function monthSummary(entries: JournalEntry[], moods: MoodLog[], month: string): MonthSummary {
  const inMonth = entries.filter((e) => e.day.startsWith(month) && !isEmptyFields(fieldsOf(e)));
  const moodsIn = moods.filter((m) => m.day.startsWith(month));
  const goodByDay = new Map(inMonth.map((e) => [e.day, e.good]));
  const best = moodsIn
    .filter((m) => m.mood >= 4 && (goodByDay.get(m.day) ?? '') !== '')
    .sort((a, b) => b.mood - a.mood || (a.day < b.day ? 1 : -1))
    .slice(0, 3)
    .map((m) => ({ day: m.day, mood: m.mood, good: goodByDay.get(m.day) ?? '' }));
  return {
    month,
    writtenDays: inMonth.length,
    goalDays: inMonth.filter((e) => e.goal !== '').length,
    moodDays: moodsIn.length,
    moodAvg: moodsIn.length === 0 ? null : round1(moodsIn.reduce((a, m) => a + m.mood, 0) / moodsIn.length),
    bestDays: best,
  };
}

/** Özet cümlesi: sayıları olduğu gibi söyler. */
export function monthSummaryText(s: MonthSummary): string {
  if (s.writtenDays === 0) return 'Bu ay henüz günlük yazısı yok.';
  const parts = [`Bu ay ${s.writtenDays} gün yazdın`];
  if (s.goalDays > 0) parts.push(`${s.goalDays} günün hedefi vardı`);
  if (s.moodAvg !== null) parts.push(`ruh hali ortalaman ${String(s.moodAvg).replace('.', ',')} (${moodInfo(s.moodAvg).label.toLowerCase()})`);
  return `${parts.join(', ')}.`;
}

/** Günlük listesi: en yeni önce, boş kayıtlar atlanır. */
export function recentEntries(entries: JournalEntry[], limit: number): JournalEntry[] {
  return entries
    .filter((e) => !isEmptyFields(fieldsOf(e)))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, Math.max(0, limit));
}
