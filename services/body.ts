/**
 * Kilo ve rekor ekranı için veriyi toplar ve kaydeder. Mantık services/bodyLogic.ts içindedir.
 * Kilo kayıtları yalnızca bu telefonda durur (yedeğe girer); hiçbir yapay zekâ isteğine eklenmez.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { WeightLog } from '../database/types';
import { deleteWeightLog, getSetting, listWeightLogs, setSetting, setWeightLog } from '../database/repository';
import { dayKey } from './activityLogic';
import { MAX_KG, MIN_KG, parseKg, recordRows, weightStats, type RecordRow, type WeightStats } from './bodyLogic';
import { loadExercise } from './exercise';
import { getBody, saveBody } from './goalsSettings';

export const WEIGHT_TARGET_KEY = 'weight_target_v1';

export interface BodyScreenData {
  today: string;
  logs: WeightLog[];
  stats: WeightStats;
  targetKg: number | null;
  records: RecordRow[];
}

export const parseTarget = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_KG && n <= MAX_KG ? n : null;
};

export async function loadBodyScreen(db: SQLiteDatabase, now: Date = new Date()): Promise<BodyScreenData> {
  const today = dayKey(now);
  const [logs, targetRaw, exercise] = await Promise.all([listWeightLogs(db), getSetting(db, WEIGHT_TARGET_KEY), loadExercise(db)]);
  const targetKg = parseTarget(targetRaw);
  return { today, logs, stats: weightStats(logs, today, targetKg), targetKg, records: recordRows(exercise, today) };
}

export type LogWeightResult = { ok: true; log: WeightLog } | { ok: false; message: string };

/**
 * Bugünün kilosunu yazar (aynı gün tekrar yazılırsa günceller). Bu en yeni kayıtsa ve hedef profili kuruluysa
 * (35-250 kg arasında), kalori hesabı güncel kalsın diye profildeki kilo da güncellenir.
 */
export async function logWeight(db: SQLiteDatabase, now: Date, text: string): Promise<LogWeightResult> {
  const kg = parseKg(text);
  if (kg === null) return { ok: false, message: `Kiloyu ${MIN_KG} ile ${MAX_KG} arasında, örneğin 78,4 olarak yaz.` };
  const log = await setWeightLog(db, dayKey(now), kg, now);
  const all = await listWeightLogs(db);
  const newest = all.length > 0 && all[all.length - 1].day === log.day;
  if (newest && kg >= 35 && kg <= 250) {
    try {
      const profile = await getBody();
      if (profile) await saveBody({ ...profile, weightKg: kg });
    } catch {
      // Profil güncellenemezse kilo kaydı yine de durur
    }
  }
  return { ok: true, log };
}

export async function removeWeight(db: SQLiteDatabase, day: string): Promise<void> {
  await deleteWeightLog(db, day);
}

/** Hedef kilo; boş metin hedefi kaldırır. Geçersiz değer false döndürür. */
export async function saveTarget(db: SQLiteDatabase, text: string): Promise<boolean> {
  if (text.trim() === '') {
    await setSetting(db, WEIGHT_TARGET_KEY, '');
    return true;
  }
  const kg = parseKg(text);
  if (kg === null) return false;
  await setSetting(db, WEIGHT_TARGET_KEY, String(kg));
  return true;
}
