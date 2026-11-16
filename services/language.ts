/** Dil öğrenme (veritabanı katmanı). SecureStore kullanmaz; testlerde çalışır. */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addStudyLog,
  deleteStudyLog,
  getDailyStat,
  getSetting,
  listDailyStats,
  listStudyLogs,
  listStudyLogsSince,
  setSetting,
} from '../database/repository';
import type { StudyKind, StudyLog } from '../database/types';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_SETTING_KEY,
  autoAppMinutes,
  languageDay,
  parseAppNames,
  parseLanguage,
  serializeLanguage,
  type LanguageDay,
  type LanguageSettings,
} from './languageLogic';
import { nutritionDay } from './nutritionLogic';
import { stampTime } from './dayFlowLogic';

export async function getLanguageSettings(db: SQLiteDatabase): Promise<LanguageSettings> {
  return parseLanguage(await getSetting(db, LANGUAGE_SETTING_KEY).catch(() => null));
}

/** Hedef 5-240 dk ya da null (hedef yok); uygulama adları boş bırakılırsa varsayılan korunur. */
export async function saveLanguageSettings(
  db: SQLiteDatabase,
  patch: { goalMin?: number | null; apps?: string[] }
): Promise<LanguageSettings> {
  const cur = await getLanguageSettings(db);
  let goal = cur.goalMin;
  if (patch.goalMin !== undefined) {
    goal = patch.goalMin === null ? null : Math.min(240, Math.max(5, Math.round(patch.goalMin)));
  }
  let apps = cur.apps;
  if (patch.apps !== undefined) {
    const parsed = parseAppNames(patch.apps.join(','));
    apps = parsed.length > 0 ? parsed : [...DEFAULT_LANGUAGE.apps];
  }
  const next: LanguageSettings = { goalMin: goal, apps };
  await setSetting(db, LANGUAGE_SETTING_KEY, serializeLanguage(next));
  return next;
}

export interface LanguageDayState {
  day: string;
  settings: LanguageSettings;
  summary: LanguageDay;
  logs: StudyLog[];
}

/** Verilen günün dil çalışması: ekrandan otomatik uygulama süresi + elle kayıtlar. */
export async function languageForDay(
  db: SQLiteDatabase,
  day: string,
  settings?: LanguageSettings
): Promise<LanguageDayState> {
  const s = settings ?? (await getLanguageSettings(db));
  const stat = await getDailyStat(db, day);
  // Ekran süresi okunamadıysa (null) otomatik süre de bilinmiyor sayılır
  const auto = stat && stat.screenMinutes !== null ? autoAppMinutes(stat.topApps, s.apps) : null;
  const logs = await listStudyLogs(db, day);
  return { day, settings: s, summary: languageDay(auto, logs), logs };
}

/** Mantıksal bugün (gece 04:00'e kadar önceki gün). */
export const loadLanguageDay = (db: SQLiteDatabase, now: Date): Promise<LanguageDayState> =>
  languageForDay(db, nutritionDay(now));

/** Verilen günlerin (eskiden yeniye) özeti; tek seferde okunur. */
export async function languageForDays(
  db: SQLiteDatabase,
  keys: string[],
  settings?: LanguageSettings
): Promise<{ day: string; summary: LanguageDay }[]> {
  if (keys.length === 0) return [];
  const s = settings ?? (await getLanguageSettings(db));
  const stats = new Map((await listDailyStats(db, keys.length + 7)).map((x) => [x.day, x]));
  const logs = await listStudyLogsSince(db, keys[0]);
  return keys.map((day) => {
    const stat = stats.get(day);
    const auto = stat && stat.screenMinutes !== null ? autoAppMinutes(stat.topApps, s.apps) : null;
    return { day, summary: languageDay(auto, logs.filter((l) => l.day === day)) };
  });
}

/** Dil çalışması ekler. `minutesAgo` > 0 ise geriye dönük ("20 dk önce bitirdim"). */
export async function addStudy(
  db: SQLiteDatabase,
  kind: StudyKind,
  minutes: number,
  now: Date,
  minutesAgo = 0
): Promise<StudyLog> {
  const at = stampTime(now, minutesAgo);
  return addStudyLog(db, nutritionDay(at), kind, minutes, at);
}

export const removeStudy = (db: SQLiteDatabase, id: string): Promise<void> => deleteStudyLog(db, id);
