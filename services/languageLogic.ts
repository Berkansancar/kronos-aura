/**
 * Dil öğrenme (saf mantık, test edilebilir).
 *
 * Süre iki yerden gelir:
 *  1. Otomatik: ekran süresindeki uygulama listesinden (varsayılan "Duolingo"; kullanıcı başka ad ekleyebilir).
 *     Ekran süresi okunamıyorsa (izin yok) bu değer null'dır.
 *  2. Elle: kalem-kağıt, dinleme/konuşma ve (ekran okunamıyorsa) uygulamada geçen süre.
 *
 * Aynı süre iki kez sayılmasın diye: ekrandan otomatik uygulama süresi varsa, elle girilen "Uygulama" kayıtları
 * o gün sayılmaz. Sayılar iyi/kötü diye yorumlanmaz.
 */
import type { StudyKind } from '../database/types';
import { formatDuration } from './format';

export const LANGUAGE_SETTING_KEY = 'lang_v1';

export interface LanguageSettings {
  /** Günlük hedef (dakika); null = hedef yok */
  goalMin: number | null;
  /** Ekran süresinde aranacak uygulama adları (büyük/küçük harf ayırmaz, ad içinde geçmesi yeter) */
  apps: string[];
}

export const DEFAULT_LANGUAGE: LanguageSettings = { goalMin: 20, apps: ['Duolingo'] };
export const GOAL_CHOICES: (number | null)[] = [null, 10, 15, 20, 30, 45, 60];
export const QUICK_MINUTES = [10, 15, 20, 30] as const;
export const MAX_APPS = 8;

export const STUDY_KINDS: { kind: StudyKind; label: string; icon: string }[] = [
  { kind: 'PAPER', label: 'Kalem kağıt', icon: '✏️' },
  { kind: 'OTHER', label: 'Dinleme / konuşma', icon: '🎧' },
  { kind: 'APP', label: 'Uygulama (elle)', icon: '📱' },
];

export const studyLabel = (k: StudyKind): string => STUDY_KINDS.find((x) => x.kind === k)?.label ?? k;

const fold = (s: string): string =>
  s
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** "Duolingo, Dilim Dilim" → ['Duolingo', 'Dilim Dilim'] (boşlar atılır, aynı ad bir kez, en çok 8) */
export function parseAppNames(input: string): string[] {
  const out: string[] = [];
  for (const part of String(input ?? '').split(/[,\n;]/)) {
    const name = part.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) continue;
    if (out.some((x) => fold(x) === fold(name))) continue;
    out.push(name);
    if (out.length >= MAX_APPS) break;
  }
  return out;
}

export function parseLanguage(raw: string | null | undefined): LanguageSettings {
  if (!raw) return { ...DEFAULT_LANGUAGE, apps: [...DEFAULT_LANGUAGE.apps] };
  try {
    const o = JSON.parse(raw) as { goalMin?: unknown; apps?: unknown };
    const goal =
      o.goalMin === null
        ? null
        : typeof o.goalMin === 'number' && Number.isFinite(o.goalMin) && o.goalMin >= 5 && o.goalMin <= 240
          ? Math.round(o.goalMin)
          : DEFAULT_LANGUAGE.goalMin;
    const apps = Array.isArray(o.apps) ? parseAppNames(o.apps.filter((x) => typeof x === 'string').join(',')) : DEFAULT_LANGUAGE.apps;
    return { goalMin: goal, apps: apps.length > 0 ? apps : [...DEFAULT_LANGUAGE.apps] };
  } catch {
    return { ...DEFAULT_LANGUAGE, apps: [...DEFAULT_LANGUAGE.apps] };
  }
}

export const serializeLanguage = (s: LanguageSettings): string =>
  JSON.stringify({ goalMin: s.goalMin, apps: s.apps });

/** Uygulama adı, dil uygulaması listesindeki bir adı içeriyor mu? (büyük/küçük harf ve Türkçe karakter ayırmaz) */
export function matchesApp(label: string, apps: string[]): boolean {
  const l = fold(label);
  return apps.map(fold).filter(Boolean).some((n) => l.includes(n));
}

/**
 * Ekran süresindeki en çok kullanılan uygulamalardan dil uygulamalarının toplamı (dakika).
 * `topApps` null ise (ekran süresi okunamadı) null döner; listede yoksa 0.
 */
export function autoAppMinutes(
  topApps: { label: string; minutes: number }[] | null | undefined,
  apps: string[]
): number | null {
  if (!topApps) return null;
  let sum = 0;
  for (const a of topApps) {
    if (matchesApp(a.label, apps)) sum += Math.max(0, a.minutes);
  }
  return Math.round(sum);
}

export interface LanguageDay {
  /** Ekrandan otomatik okunan uygulama süresi; null = ekran süresi okunamadı */
  autoAppMinutes: number | null;
  /** Sayıma giren uygulama süresi (otomatik varsa o, yoksa elle girilen) */
  appMinutes: number;
  paperMinutes: number;
  otherMinutes: number;
  total: number;
  /** Ekran süresinin içinde olan kısım (günün zaman dökümünde ekrandan düşülür) */
  screenMinutes: number;
  /** Ekran dışı, elle girilen süre (günün zaman dökümünde "kayıt dışı"dan düşülür) */
  offScreenMinutes: number;
  /** Ölçülmüş bir şey var mı (ekran okundu ya da elle kayıt var); yoksa "kayıt yok" */
  measured: boolean;
}

export function languageDay(auto: number | null, logs: { kind: StudyKind; minutes: number }[]): LanguageDay {
  const sum = (k: StudyKind) => logs.filter((l) => l.kind === k).reduce((a, l) => a + l.minutes, 0);
  const manualApp = sum('APP');
  const paper = sum('PAPER');
  const other = sum('OTHER');
  const useAuto = auto !== null && auto > 0;
  const app = useAuto ? (auto as number) : manualApp;
  return {
    autoAppMinutes: auto,
    appMinutes: app,
    paperMinutes: paper,
    otherMinutes: other,
    total: app + paper + other,
    screenMinutes: useAuto ? (auto as number) : 0,
    offScreenMinutes: (useAuto ? 0 : manualApp) + paper + other,
    measured: auto !== null || logs.length > 0,
  };
}

/** 0..1 (hedef yoksa null) */
export function goalRatio(total: number, goalMin: number | null): number | null {
  if (goalMin === null || goalMin <= 0) return null;
  return Math.min(1, total / goalMin);
}

/** "Dil 12 / 20 dk" ya da hedef yoksa "Dil 12 dk"; hiç süre yoksa null */
export function languageLine(total: number, goalMin: number | null): string | null {
  if (total <= 0 && goalMin === null) return null;
  return goalMin !== null ? `dil ${total} / ${goalMin} dk` : `dil ${total} dk`;
}

export interface LanguageWeek {
  recent: number;
  earlier: number;
  recentDays: number;
  earlierDays: number;
  /** Yargısız tek cümle */
  text: string;
}

/** `days` eskiden yeniye günlük toplamlar; son 7 günü bir önceki 7 günle karşılaştırır. */
export function languageWeek(days: { day: string; total: number }[]): LanguageWeek {
  const last = days.slice(-7);
  const prev = days.slice(-14, -7);
  const sum = (l: { total: number }[]) => l.reduce((a, d) => a + d.total, 0);
  const active = (l: { total: number }[]) => l.filter((d) => d.total > 0).length;
  const recent = sum(last);
  const earlier = sum(prev);
  const text =
    recent === 0 && earlier === 0
      ? 'Son iki haftada dil çalışması kaydı yok.'
      : earlier === 0 && prev.length === 0
        ? `Son 7 gün: ${formatDuration(recent)} (${active(last)} gün).`
        : `Son 7 gün: ${formatDuration(recent)} (${active(last)} gün). Öncesindeki 7 gün: ${formatDuration(earlier)} (${active(prev)} gün).`;
  return { recent, earlier, recentDays: active(last), earlierDays: active(prev), text };
}
