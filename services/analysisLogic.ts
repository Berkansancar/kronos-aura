/**
 * Analiz (saf mantık, test edilebilir): seçtiğin aralıktaki (son N gün) dil, adım, günlük ve su toplamları ve kıyaslar.
 * Aralığı sürgü seçer: en az 1 gün, en çok uygulamayı kullanmaya başladığından bugüne geçen gün sayısı. Zaman geçtikçe sürgünün
 * sınırı kendiliğinden uzar. Hiçbir şey tahmin edilmez; yalnızca kayıtlı olanlar toplanır. Kayıt olmayan gün "sıfır" değil, "kayıt yok" sayılır.
 *
 * Bu ekran hiçbir yere veri göndermez (yapay zekâ yok); günlük yazısının metni değil yalnızca kelime sayısı kullanılır.
 */
import { dayKey, formatSteps, parseDayKey } from './activityLogic';
import { dayDiff } from './effectsLogic';
import { formatDuration } from './format';
import { windowKeys } from './weeklyLogic';

/** Bir damacana: 19 litre (Türkiye'de yaygın damacana boyu) */
export const DAMACANA_ML = 19_000;
/** Boy bilinmiyorsa varsayılan adım uzunluğu (m) */
export const DEFAULT_STRIDE_M = 0.75;
/** Kitap sayfası başına kelime ve kısa bir romanın sayfası */
export const WORDS_PER_PAGE = 250;
export const NOVEL_PAGES = 200;
/** Kelime hızı için aralıkta dil uygulamasında en az bu kadar süre gerekir (dk) */
export const MIN_RATE_MINUTES = 60;

// ───────────────────────── Girdi ─────────────────────────

export interface LearnedWord {
  /** Kelimenin son çalışıldığı gün (bilinmiyorsa null: yalnızca "tüm zamanlar"a girer) */
  day: string | null;
}

export interface AnalysisData {
  today: string;
  /** İlk kaydın günü (hiç kayıt yoksa null) */
  firstDay: string | null;
  /** gün -> dil uygulamasında (Duolingo) geçen süre (dk): ekran süresinden, o okunamıyorsa elle girilen "Uygulama" kaydı */
  appByDay: Record<string, number>;
  /** gün -> kalem-kağıt çalışması (dk); uygulama süresinden ayrı sayılır */
  paperByDay: Record<string, number>;
  /** gün -> dinleme / konuşma (dk); uygulama süresinden ayrı sayılır */
  otherByDay: Record<string, number>;
  /** gün -> adım */
  stepsByDay: Record<string, number>;
  /** gün -> içilen su (ml) */
  waterByDay: Record<string, number>;
  /** gün -> günlükte yazılan kelime sayısı (yazı yoksa gün yok) */
  journalByDay: Record<string, number>;
  /** Kelime defterinde öğrenildi sayılanlar (en yüksek kutuya ulaşan) */
  learned: LearnedWord[];
  /** Kelime defterine eklenme günleri */
  addedDays: string[];
  /** Boy (cm); bilinmiyorsa null */
  heightCm: number | null;
}

export const emptyData = (today: string): AnalysisData => ({
  today,
  firstDay: null,
  appByDay: {},
  paperByDay: {},
  otherByDay: {},
  stepsByDay: {},
  waterByDay: {},
  journalByDay: {},
  learned: [],
  addedDays: [],
  heightCm: null,
});

// ───────────────────────── Aralık ─────────────────────────

/** İlk kayıttan bugüne gün sayısı (bugün dahil); kayıt yoksa 1. */
export function spanDays(firstDay: string | null, today: string): number {
  if (!firstDay || firstDay > today) return 1;
  return Math.max(1, dayDiff(firstDay, today) + 1);
}

export const clampDays = (days: number, span: number): number => Math.max(1, Math.min(Math.max(1, span), Math.round(Number.isFinite(days) ? days : 1)));

/** Sürgü konumu (0-1) -> gün sayısı (1..span) */
export function daysFromFraction(f: number, span: number): number {
  const s = Math.max(1, span);
  if (s === 1) return 1;
  const x = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  return clampDays(1 + x * (s - 1), s);
}

/** Gün sayısı -> sürgü konumu (0-1) */
export function fractionFromDays(days: number, span: number): number {
  const s = Math.max(1, span);
  if (s === 1) return 0;
  return (clampDays(days, s) - 1) / (s - 1);
}

/** Hızlı seçimler: yalnızca sınırın içindekiler, sonda "Tümü" */
export function quickPicks(span: number): { days: number; label: string }[] {
  const s = Math.max(1, span);
  const base = [
    { days: 1, label: '1 gün' },
    { days: 7, label: '1 hafta' },
    { days: 30, label: '1 ay' },
    { days: 90, label: '3 ay' },
    { days: 365, label: '1 yıl' },
  ].filter((p) => p.days < s);
  return [...base, { days: s, label: s === 1 ? 'Bugün' : 'Tümü' }];
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortDate = (key: string): string => {
  const d = parseDayKey(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

/** "Son 30 gün · 27 Eki – 25 Kas" ya da "Bugün" ya da "Tüm zamanlar · 48 gün" */
export function windowLabel(days: number, span: number, today: string): string {
  const n = clampDays(days, span);
  if (n === 1) return 'Bugün';
  const from = windowKeys(today, n)[0];
  if (n >= span) return `Tüm zamanlar · ${n} gün`;
  return `Son ${n} gün · ${shortDate(from)} – ${shortDate(today)}`;
}

// ───────────────────────── Sayı biçimi ─────────────────────────

/** 3,2 · 12,5 · 150 (büyükte tam sayı, binlik nokta) */
export function fmtNum(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '0';
  if (Math.abs(x) >= 100) return formatSteps(Math.round(x));
  const rounded = Math.round(x * 10 ** digits) / 10 ** digits;
  return String(rounded).replace('.', ',');
}

export const fmtKm = (km: number): string => `${fmtNum(km, km < 10 ? 2 : 1)} km`;

/** 1500 ml -> "1,5 L"; 120000 ml -> "120 L" */
export function fmtLiters(ml: number): string {
  const l = ml / 1000;
  return `${fmtNum(l, l < 10 ? 2 : 1)} L`;
}

// ───────────────────────── Kıyaslar ─────────────────────────

export interface Landmark {
  id: string;
  /** Metre */
  m: number;
  /** "…'nin" biçiminde, cümle içinde kullanılır */
  gen: string;
  /** Kısa ad (sıradaki hedef satırında) */
  short: string;
}

/** Yol ve yapı uzunlukları (artan sırayla). Karayolu uzaklıkları yaklaşıktır. */
export const LANDMARKS: Landmark[] = [
  { id: 'saha', m: 105, gen: 'bir futbol sahası boyunun', short: 'futbol sahası boyu' },
  { id: 'eyfel', m: 330, gen: "Eyfel Kulesi'nin yüksekliğinin", short: 'Eyfel Kulesi' },
  { id: 'burj', m: 828, gen: "Burj Khalifa'nın yüksekliğinin", short: 'Burj Khalifa' },
  { id: 'koprusu', m: 1_560, gen: "15 Temmuz Şehitler Köprüsü'nün uzunluğunun", short: '15 Temmuz Şehitler Köprüsü' },
  { id: 'canakkale', m: 2_023, gen: "1915 Çanakkale Köprüsü'nün ana açıklığının", short: '1915 Çanakkale Köprüsü ana açıklığı' },
  { id: 'everest', m: 8_849, gen: "Everest'in yüksekliğinin", short: 'Everest' },
  { id: 'maraton', m: 42_195, gen: 'maraton mesafesinin', short: 'maraton' },
  { id: 'edirne', m: 235_000, gen: 'İstanbul–Edirne yolunun', short: 'İstanbul–Edirne yolu' },
  { id: 'ankara', m: 450_000, gen: 'İstanbul–Ankara yolunun', short: 'İstanbul–Ankara yolu' },
  { id: 'izmir', m: 480_000, gen: 'İstanbul–İzmir yolunun', short: 'İstanbul–İzmir yolu' },
  { id: 'dunya', m: 40_075_000, gen: "Dünya'nın çevresinin", short: 'Dünya çevresi' },
  { id: 'ay', m: 384_400_000, gen: "Dünya'dan Ay'a uzaklığın", short: "Dünya'dan Ay'a uzaklık" },
];

export interface DistanceCompare {
  /** "maraton mesafesinin 3,2 katı" ya da "İstanbul–Ankara yolunun yüzde 62 kadarı" */
  text: string;
  /** Kıyas yapılan yapı ve oran */
  landmark: Landmark;
  times: number;
  /** Sıradaki hedef (yoksa null) ve ona ne kadar yaklaşıldı (0-1) */
  next: { landmark: Landmark; ratio: number; remainingKm: number } | null;
}

const kmOf = (m: number): number => m / 1000;

/** Toplam yürünen yolu bilinen bir yola ya da yapıya kıyaslar. `km` = 0 ise null. */
export function compareDistance(km: number): DistanceCompare | null {
  if (!Number.isFinite(km) || km <= 0) return null;
  const m = km * 1000;
  let idx = -1;
  for (let i = 0; i < LANDMARKS.length; i++) if (LANDMARKS[i].m <= m) idx = i;
  const lm = LANDMARKS[Math.max(0, idx)];
  const times = m / lm.m;
  const text = times < 1 ? `${lm.gen} yüzde ${Math.max(1, Math.round(times * 100))} kadarı` : `${lm.gen} ${fmtNum(times, 1)} katı`;
  const nextLm = LANDMARKS[idx + 1] ?? null;
  return {
    text,
    landmark: lm,
    times,
    next: nextLm ? { landmark: nextLm, ratio: Math.min(1, m / nextLm.m), remainingKm: kmOf(nextLm.m - m) } : null,
  };
}

export interface WaterCompare {
  /** Kesirli damacana sayısı */
  damacana: number;
  full: number;
  /** Son damacananın doluluğu (0-1) */
  fraction: number;
  text: string;
}

export function compareWater(ml: number): WaterCompare {
  const d = Math.max(0, ml) / DAMACANA_ML;
  const full = Math.floor(d + 1e-9);
  const fraction = Math.max(0, Math.min(1, d - full));
  const text = d < 1 ? `bir damacananın yüzde ${Math.round(d * 100)} kadarı` : `${fmtNum(d, 1)} damacana`;
  return { damacana: d, full, fraction, text };
}

export interface JournalCompare {
  pages: number;
  novels: number;
  text: string;
}

export function compareJournal(words: number): JournalCompare {
  const pages = Math.max(0, words) / WORDS_PER_PAGE;
  const novels = pages / NOVEL_PAGES;
  const text =
    words <= 0
      ? 'henüz yazı yok'
      : novels >= 1
        ? `yaklaşık ${fmtNum(pages, 0)} kitap sayfası, ${fmtNum(novels, 1)} kısa roman`
        : `yaklaşık ${fmtNum(pages, 1)} kitap sayfası (kısa bir romanın yüzde ${Math.max(1, Math.round(novels * 100))} kadarı)`;
  return { pages, novels, text };
}

// ───────────────────────── Adım uzunluğu ─────────────────────────

/** Boydan adım uzunluğu (m): boy × 0,415; makul sınırlar içinde. Boy yoksa varsayılan. */
export function strideFromHeight(heightCm: number | null): { m: number; assumed: boolean } {
  if (heightCm === null || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 230) return { m: DEFAULT_STRIDE_M, assumed: true };
  return { m: Math.round(Math.max(0.5, Math.min(1.1, (heightCm * 0.415) / 100)) * 1000) / 1000, assumed: false };
}

// ───────────────────────── Aralık hesabı ─────────────────────────

export interface LanguageStats {
  /** Dil uygulamasında (Duolingo) geçen süre: asıl çalışma süresi budur, kelime hızı bununla hesaplanır */
  minutes: number;
  hours: number;
  /** Uygulamayı kullandığın gün sayısı */
  studyDays: number;
  /** Kalem-kağıt ve dinleme / konuşma: uygulama süresine eklenmez, kelime hızına girmez */
  paperMinutes: number;
  otherMinutes: number;
  learned: number;
  added: number;
  /** Aralıktaki kelime hızı (kelime / saat); en az 1 saat çalışma yoksa null */
  wordsPerHour: number | null;
}

export interface StepStats {
  steps: number;
  days: number;
  km: number;
  avgPerDay: number | null;
  strideM: number;
  strideAssumed: boolean;
  compare: DistanceCompare | null;
}

export interface WaterStats {
  ml: number;
  days: number;
  avgMlPerDay: number | null;
  compare: WaterCompare;
}

export interface JournalStats {
  entries: number;
  words: number;
  avgWords: number | null;
  compare: JournalCompare;
}

export interface WindowAnalysis {
  days: number;
  from: string;
  to: string;
  language: LanguageStats;
  /** Tüm zamanlardaki kelime hızı (aralık kısa kalınca da bir fikir verir) */
  languageAllTimeRate: number | null;
  steps: StepStats;
  water: WaterStats;
  journal: JournalStats;
  /** Günlük: bir önceki aynı uzunluktaki aralıkla kıyas. Önceki aralık kayıt başlamadan önceye taşıyorsa null. */
  journalVsPrevious: { previousWords: number; previousEntries: number; diffWords: number } | null;
}

const sumKeys = (map: Record<string, number>, keys: string[]): { total: number; days: number } => {
  let total = 0;
  let days = 0;
  for (const k of keys) {
    const v = map[k];
    if (v !== undefined && v > 0) {
      total += v;
      days += 1;
    }
  }
  return { total, days };
};

function languageIn(data: AnalysisData, keys: string[], all: boolean): LanguageStats {
  const first = keys[0];
  const study = sumKeys(data.appByDay, keys);
  const paper = sumKeys(data.paperByDay, keys);
  const other = sumKeys(data.otherByDay, keys);
  const inWin = (day: string | null): boolean => (all ? true : day !== null && day >= first && day <= data.today);
  const learned = data.learned.filter((w) => inWin(w.day)).length;
  const added = data.addedDays.filter((d) => inWin(d)).length;
  const hours = study.total / 60;
  return {
    minutes: study.total,
    hours,
    studyDays: study.days,
    paperMinutes: paper.total,
    otherMinutes: other.total,
    learned,
    added,
    wordsPerHour: study.total >= MIN_RATE_MINUTES ? learned / hours : null,
  };
}

/** Son `days` günün toplamları. `all` = tüm kayıtlar (kelime hızının tüm zamanlar değeri için). */
export function analyze(data: AnalysisData, days: number): WindowAnalysis {
  const span = spanDays(data.firstDay, data.today);
  const n = clampDays(days, span);
  const keys = windowKeys(data.today, n);
  const allKeys = windowKeys(data.today, span);
  const lang = languageIn(data, keys, n >= span);
  const allLang = languageIn(data, allKeys, true);

  const st = sumKeys(data.stepsByDay, keys);
  const stride = strideFromHeight(data.heightCm);
  const km = (st.total * stride.m) / 1000;

  const wt = sumKeys(data.waterByDay, keys);
  const jr = sumKeys(data.journalByDay, keys);

  // Günlük: bir önceki aynı uzunluktaki aralıkla kıyas (önceki aralığın tamamı kayıt süresinin içindeyse)
  let journalVsPrevious: WindowAnalysis['journalVsPrevious'] = null;
  if (data.firstDay && n * 2 <= span) {
    const pj = sumKeys(data.journalByDay, windowKeys(keyBefore(keys[0]), n));
    journalVsPrevious = { previousWords: pj.total, previousEntries: pj.days, diffWords: jr.total - pj.total };
  }

  return {
    days: n,
    from: keys[0],
    to: data.today,
    language: lang,
    languageAllTimeRate: allLang.wordsPerHour,
    steps: {
      steps: st.total,
      days: st.days,
      km,
      avgPerDay: st.days > 0 ? Math.round(st.total / st.days) : null,
      strideM: stride.m,
      strideAssumed: stride.assumed,
      compare: compareDistance(km),
    },
    water: {
      ml: wt.total,
      days: wt.days,
      avgMlPerDay: wt.days > 0 ? Math.round(wt.total / wt.days) : null,
      compare: compareWater(wt.total),
    },
    journal: {
      entries: jr.days,
      words: jr.total,
      avgWords: jr.days > 0 ? Math.round(jr.total / jr.days) : null,
      compare: compareJournal(jr.total),
    },
    journalVsPrevious,
  };
}

/** Verilen günden bir önceki gün anahtarı */
function keyBefore(key: string): string {
  const d = parseDayKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

// ───────────────────────── Metinler ─────────────────────────

/** "12 sa 30 dk" ya da dakika yoksa "—" */
export const fmtStudy = (minutes: number): string => (minutes > 0 ? formatDuration(minutes) : 'kayıt yok');

/** "Saatte ortalama 7,1 kelime" ya da neden hesaplanamadığı (yargısız) */
export function wordRateText(lang: LanguageStats, allTimeRate: number | null): string {
  if (lang.wordsPerHour !== null) return `Uygulamada saatte ortalama ${fmtNum(lang.wordsPerHour, 1)} kelime öğrenildi`;
  const base = lang.minutes > 0 ? 'Kelime hızı için bu aralıkta dil uygulamasında en az 1 saat gerekir.' : 'Bu aralıkta dil uygulaması süresi kaydı yok.';
  return allTimeRate !== null ? `${base} Tüm zamanlarda uygulamada saatte ortalama ${fmtNum(allTimeRate, 1)} kelime.` : base;
}

/** Günlük kıyas satırı: "Önceki 30 güne göre 120 kelime fazla" */
export function journalCompareText(prev: WindowAnalysis['journalVsPrevious'], days: number): string | null {
  if (!prev) return null;
  if (prev.previousWords === 0 && prev.diffWords === 0) return null;
  const label = days === 1 ? 'Önceki güne' : `Önceki ${days} güne`;
  if (prev.diffWords === 0) return `${label} göre aynı kelime sayısı`;
  return `${label} göre ${fmtNum(Math.abs(prev.diffWords), 0)} kelime ${prev.diffWords > 0 ? 'fazla' : 'az'} (önceki aralıkta ${fmtNum(prev.previousWords, 0)} kelime)`;
}
