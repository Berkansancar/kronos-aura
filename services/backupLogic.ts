/**
 * Yedek: telefondaki kayıtları tek bir metne çevirir ve aynı metinden geri yükler.
 *
 * Neden metin? Uygulama internet hesabı tutmaz; yedek metni paylaşım ekranından Gmail, Drive ya da Keep'e
 * gönderilir (kullanıcının kendi Google hesabı), geri yüklerken aynı metin kopyalanır.
 *
 * Güvenlik:
 *  - Yapay zekâ API anahtarları yedeğe GİRMEZ (yalnızca BACKUP_PREF_KEYS içindeki ayarlar girer).
 *  - Koç sohbet geçmişi (CoachChat) yedeğe girmez; büyük ve yeniden üretilebilir.
 *  - Geri yükleme tek işlemde yapılır: ya hepsi olur ya hiçbiri (hata olursa eski kayıtlar durur).
 *  - Metin bozulduysa (kısaltılmış, satırları kırılmış) sağlama kodu yakalar; sessizce yanlış veri yüklenmez.
 *
 * Bu dosya React Native'e bağlı değildir; Node testleriyle çalışır.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DATABASE_VERSION } from '../database/schema';

/** Yedeğe giren tablolar, ekleme sırasıyla (üst tablo önce). Silme bunun tersine yapılır. */
export const BACKUP_TABLES = [
  'User',
  'Routine',
  'Task',
  'TimeBlock',
  'TimeLog',
  'RoutineLog',
  'DailyStat',
  'DayMode',
  'WaterLog',
  'MealLog',
  'TaskOutcome',
  'Setting',
  'DayEvent',
  'SmokeLog',
  'DayReview',
  'SleepLog',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Telefonun güvenli deposundan yedeğe giren, gizli olmayan ayarlar. API anahtarı ASLA burada olmaz. */
export const BACKUP_PREF_KEYS = [
  'water_goal_ml',
  'kcal_target',
  'goals_v1',
  'body_profile',
  'review_reminder',
  'morning_reminder',
  'morning_hour',
] as const;

/** Özette gösterilen adlar (yalnızca kullanıcının anlayacağı tablolar). */
const TABLE_LABELS: Partial<Record<BackupTable, string>> = {
  Task: 'Görev',
  Routine: 'Rutin',
  TimeLog: 'Zaman kaydı',
  TaskOutcome: 'Görev sonucu',
  WaterLog: 'Su kaydı',
  MealLog: 'Yemek kaydı',
  SmokeLog: 'Sigara kaydı',
  DayEvent: 'Gün akışı damgası',
  SleepLog: 'Uyku kaydı',
  DayReview: 'Gün sonu değerlendirmesi',
};

export const BACKUP_START = '-----KRONOS-AURA-YEDEK-BASLA-----';
export const BACKUP_END = '-----KRONOS-AURA-YEDEK-BITIR';
const FORMAT = 1;

type Cell = string | number | null;
interface TableData {
  c: string[];
  r: Cell[][];
}
export interface BackupFile {
  app: 'kronos-aura';
  format: number;
  dbVersion: number;
  exportedAt: string;
  tables: Partial<Record<BackupTable, TableData>>;
  prefs: Record<string, string>;
}

export interface BackupSummary {
  exportedAt: string;
  dbVersion: number;
  /** "Görev: 12" gibi satırlar (yalnızca kaydı olanlar) */
  lines: string[];
  totalRows: number;
  prefCount: number;
}

export type InspectResult = { ok: true; data: BackupFile; summary: BackupSummary } | { ok: false; error: string };
export type RestoreResult =
  | { ok: true; summary: BackupSummary; prefs: Record<string, string> }
  | { ok: false; error: string };

/** 32 bit FNV-1a sağlama kodu (güvenlik için değil, metin bozulduysa yakalamak için). */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const pad = (n: number) => String(n).padStart(2, '0');
export const backupStamp = (d: Date): string =>
  `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function tableColumns(db: SQLiteDatabase, table: BackupTable): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("${table}")`);
  return rows.map((r) => r.name);
}

/** Yedek metnini üretir. `prefs`: yalnızca BACKUP_PREF_KEYS içindeki, boş olmayan değerler alınır. */
export async function createBackup(
  db: SQLiteDatabase,
  prefs: Record<string, string | null | undefined>,
  now: Date
): Promise<string> {
  const tables: BackupFile['tables'] = {};
  for (const table of BACKUP_TABLES) {
    const cols = await tableColumns(db, table);
    const list = cols.map((c) => `"${c}"`).join(', ');
    const rows = await db.getAllAsync<Record<string, Cell>>(`SELECT ${list} FROM "${table}" ORDER BY rowid`);
    tables[table] = { c: cols, r: rows.map((row) => cols.map((c) => row[c] ?? null)) };
  }
  const cleanPrefs: Record<string, string> = {};
  for (const key of BACKUP_PREF_KEYS) {
    const v = prefs[key];
    if (typeof v === 'string' && v !== '') cleanPrefs[key] = v;
  }
  const file: BackupFile = {
    app: 'kronos-aura',
    format: FORMAT,
    dbVersion: DATABASE_VERSION,
    exportedAt: now.toISOString(),
    tables,
    prefs: cleanPrefs,
  };
  const json = JSON.stringify(file);
  return [
    `Kronos & Aura yedeği (${backupStamp(now)}). Bu metni değiştirme, silme. Geri yüklemek için tamamını kopyala; uygulamada Ayarlar > Verilerim > "Panodan geri yükle"ye bas.`,
    BACKUP_START,
    json,
    `${BACKUP_END} kod=${checksum(json)}-----`,
  ].join('\n');
}

function summarize(file: BackupFile): BackupSummary {
  const lines: string[] = [];
  let totalRows = 0;
  for (const table of BACKUP_TABLES) {
    const count = file.tables[table]?.r.length ?? 0;
    totalRows += count;
    const label = TABLE_LABELS[table];
    if (label && count > 0) lines.push(`${label}: ${count}`);
  }
  return {
    exportedAt: file.exportedAt,
    dbVersion: file.dbVersion,
    lines,
    totalRows,
    prefCount: Object.keys(file.prefs).length,
  };
}

const isCell = (v: unknown): v is Cell => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/** Metni açar ve yapısını kontrol eder; veritabanına dokunmaz. */
export function inspectBackup(text: string): InspectResult {
  const raw = String(text ?? '');
  let payload: string;
  let code: string | null = null;

  const start = raw.indexOf(BACKUP_START);
  if (start >= 0) {
    const bodyStart = start + BACKUP_START.length;
    const end = raw.indexOf(BACKUP_END, bodyStart);
    if (end < 0) {
      return { ok: false, error: 'Yedek metni eksik görünüyor: bitiş satırı yok. Metnin tamamını kopyaladığından emin ol.' };
    }
    payload = raw.slice(bodyStart, end);
    const m = /kod=([0-9a-f]{8})/.exec(raw.slice(end, end + 80));
    code = m ? m[1] : null;
  } else {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, error: 'Panodaki metin bir Kronos & Aura yedeği gibi görünmüyor.' };
    payload = raw.slice(a, b + 1);
  }
  // Bazı uygulamalar uzun satırları böler; JSON'da gerçek satır sonu olmaz, kaldırmak güvenlidir
  payload = payload.replace(/[\r\n]+/g, '').trim();
  if (code !== null && checksum(payload) !== code) {
    return {
      ok: false,
      error: 'Yedek metni bozulmuş ya da kısaltılmış (sağlama kodu tutmuyor). Metnin tamamını yeniden kopyalayıp dene.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: 'Yedek metni okunamadı. Metnin tamamını kopyaladığından emin ol.' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'Bu bir Kronos & Aura yedeği değil.' };
  const o = parsed as Record<string, unknown>;
  if (o.app !== 'kronos-aura') return { ok: false, error: 'Bu bir Kronos & Aura yedeği değil.' };
  if (o.format !== FORMAT) return { ok: false, error: 'Bu yedeğin biçimi tanınmıyor. Uygulamayı güncelleyip yeniden dene.' };
  if (typeof o.dbVersion !== 'number' || !Number.isInteger(o.dbVersion) || o.dbVersion < 1) {
    return { ok: false, error: 'Yedeğin sürüm bilgisi okunamadı.' };
  }
  if (o.dbVersion > DATABASE_VERSION) {
    return { ok: false, error: 'Bu yedek uygulamanın daha yeni bir sürümünden. Önce uygulamayı güncelle.' };
  }
  if (typeof o.tables !== 'object' || o.tables === null) return { ok: false, error: 'Yedekte veri bulunamadı.' };

  const tables: BackupFile['tables'] = {};
  let known = 0;
  for (const table of BACKUP_TABLES) {
    const t = (o.tables as Record<string, unknown>)[table];
    if (t === undefined) continue;
    if (typeof t !== 'object' || t === null) return { ok: false, error: `Yedekte "${table}" bölümü bozuk.` };
    const { c, r } = t as { c?: unknown; r?: unknown };
    if (!Array.isArray(c) || !c.every((x) => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(x))) {
      return { ok: false, error: `Yedekte "${table}" sütunları bozuk.` };
    }
    if (!Array.isArray(r)) return { ok: false, error: `Yedekte "${table}" satırları bozuk.` };
    for (const row of r) {
      if (!Array.isArray(row) || row.length !== c.length || !row.every(isCell)) {
        return { ok: false, error: `Yedekte "${table}" satırları bozuk.` };
      }
    }
    tables[table] = { c: c as string[], r: r as Cell[][] };
    known += 1;
  }
  if (known === 0) return { ok: false, error: 'Yedekte tanınan veri bulunamadı.' };

  const prefs: Record<string, string> = {};
  if (typeof o.prefs === 'object' && o.prefs !== null) {
    for (const key of BACKUP_PREF_KEYS) {
      const v = (o.prefs as Record<string, unknown>)[key];
      if (typeof v === 'string' && v !== '') prefs[key] = v;
    }
  }

  const data: BackupFile = {
    app: 'kronos-aura',
    format: FORMAT,
    dbVersion: o.dbVersion,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    tables,
    prefs,
  };
  return { ok: true, data, summary: summarize(data) };
}

/**
 * Yedekteki tabloları telefondakilerin yerine koyar (yedekte olmayan tablolara dokunulmaz).
 * Önce her şey doğrulanır; yazma tek işlemde yapılır. Hata olursa eski kayıtlar olduğu gibi kalır.
 * Dönen `prefs` çağıran tarafından güvenli depoya yazılır.
 */
export async function restoreBackup(db: SQLiteDatabase, text: string): Promise<RestoreResult> {
  const inspected = inspectBackup(text);
  if (!inspected.ok) return inspected;
  const { data, summary } = inspected;

  // Sütunlar bu uygulamadaki tabloda var mı? (yazmaya başlamadan önce)
  for (const table of BACKUP_TABLES) {
    const t = data.tables[table];
    if (!t) continue;
    const actual = new Set(await tableColumns(db, table));
    const unknown = t.c.find((c) => !actual.has(c));
    if (unknown) return { ok: false, error: `Yedek bu uygulama sürümüyle uyumsuz ("${table}.${unknown}").` };
  }

  try {
    await db.withTransactionAsync(async () => {
      // Üst-alt tablo sırası tamamlanana kadar yabancı anahtar denetimi işlem sonuna ertelenir
      await db.execAsync('PRAGMA defer_foreign_keys = ON;');
      for (const table of [...BACKUP_TABLES].reverse()) {
        if (data.tables[table]) await db.runAsync(`DELETE FROM "${table}"`);
      }
      for (const table of BACKUP_TABLES) {
        const t = data.tables[table];
        if (!t || t.c.length === 0) continue;
        const sql = `INSERT INTO "${table}" (${t.c.map((c) => `"${c}"`).join(', ')}) VALUES (${t.c.map(() => '?').join(', ')})`;
        for (const row of t.r) await db.runAsync(sql, row);
      }
    });
  } catch (e) {
    return {
      ok: false,
      error: `Geri yükleme yapılamadı, mevcut kayıtların olduğu gibi duruyor. (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  return { ok: true, summary, prefs: data.prefs };
}
