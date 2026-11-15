/**
 * Gün sonu "zaman nereye gitti" analizi ve ekran süresi yerine yapılabilecekler (saf mantık, test edilebilir).
 *
 * Yalnızca ölçülen sayılar kullanılır; tahmin uydurulmaz. Aura yargılamaz: "kayıt dışı kalan zaman" bir veridir,
 * yemek, dinlenme, sohbet, oyalanma hepsi burada durur.
 */
import type { ScreenAlternative, TaskOutcomeReason } from '../database/types';
import { formatDuration } from './format';

// ───────────────────────── Zaman dökümü ─────────────────────────

export interface TimeUseInput {
  /** Uyanıştan değerlendirme anına kadar bilinmiyorsa null: uyanış saati (gün başından dakika) */
  wakeMin: number | null;
  /** Uyanış saatinin kaynağı: kullanıcının damgası mı, telefonun uyku tahmini mi */
  wakeSource: 'STAMP' | 'SLEEP' | null;
  /** Değerlendirme anı (gün başından dakika; gece yarısından sonra 1440+) */
  endMin: number;
  /** İş penceresi (gün başından dakika) ve kaynağı: dükkana geliş/çıkış damgaları ya da iş saati ayarı */
  work: { startMin: number; endMin: number; source: 'STAMP' | 'SETTING' } | null;
  commuteMinutes: number;
  prepMinutes: number;
  /** Bitirilen işlerin toplamı ve bunun iş penceresine düşen kısmı */
  doneMinutes: number;
  doneInWorkMinutes: number;
  driftMinutes: number;
  screenMinutes: number | null;
}

export interface TimeUse {
  awakeMinutes: number | null;
  wakeSource: 'STAMP' | 'SLEEP' | null;
  workMinutes: number;
  workSource: 'STAMP' | 'SETTING' | null;
  commuteMinutes: number;
  prepMinutes: number;
  /** İş, yol ve hazırlık dışında uyanık kalınan süre */
  freeMinutes: number | null;
  doneOutsideWorkMinutes: number;
  driftMinutes: number;
  /** İş dışı serbest zamandan işlere giden çıkınca kalan: kayıt dışı kalan zaman (akıp giden dahil) */
  unaccountedMinutes: number | null;
  screenMinutes: number | null;
  /** Kayıt dışı zamanın ekranla örtüşme oranı (0-1+); ikisi de varsa */
  screenVsUnaccounted: number | null;
  chips: string[];
  /** Aura'nın yargısız özeti */
  text: string;
}

const clamp0 = (n: number) => Math.max(0, n);

export function analyzeTimeUse(i: TimeUseInput): TimeUse {
  const awake = i.wakeMin !== null && i.endMin > i.wakeMin ? i.endMin - i.wakeMin : null;

  // İş penceresi uyanık aralığıyla kesişen kısmı kadar sayılır
  let workMinutes = 0;
  if (i.work) {
    const from = Math.max(i.work.startMin, i.wakeMin ?? 0);
    const to = Math.min(i.work.endMin, i.endMin);
    workMinutes = clamp0(to - from);
  }

  const free = awake !== null ? clamp0(awake - workMinutes - i.commuteMinutes - i.prepMinutes) : null;
  const doneOutside = clamp0(i.doneMinutes - i.doneInWorkMinutes);
  const unaccounted = free !== null ? clamp0(free - doneOutside) : null;
  const vs = unaccounted !== null && unaccounted > 0 && i.screenMinutes !== null ? i.screenMinutes / unaccounted : null;

  const chips: string[] = [];
  if (free !== null) chips.push(`İş dışı uyanık: ${formatDuration(free)}`);
  if (i.doneMinutes > 0) chips.push(`İşlere giden: ${formatDuration(i.doneMinutes)}`);
  if (unaccounted !== null) chips.push(`Kayıt dışı kalan: ${formatDuration(unaccounted)}`);
  if (i.screenMinutes !== null) chips.push(`Ekran: ${formatDuration(i.screenMinutes)}`);

  const parts: string[] = [];
  if (free === null) {
    parts.push('Uyanış saatini bilmediğim için günün tamamını hesaplayamadım; Gün akışı ekranında "Uyandım" dersen hesaplarım.');
    if (i.doneMinutes > 0) parts.push(`Bildiklerim: işlere ${formatDuration(i.doneMinutes)} gitti.`);
    if (i.driftMinutes > 0) parts.push(`${formatDuration(i.driftMinutes)} akıp giden olarak not edildi.`);
  } else {
    const head = i.work ? 'Bugün iş, yol ve hazırlık dışında' : 'Bugün';
    parts.push(`${head} yaklaşık ${formatDuration(free)} uyanık kaldın.`);
    const inner: string[] = [];
    if (i.doneMinutes > 0) inner.push(`${formatDuration(doneOutside)} işlere gitti`);
    if (i.driftMinutes > 0) inner.push(`${formatDuration(i.driftMinutes)}'sını akıp giden diye not ettin`);
    if (inner.length > 0) parts.push(`${inner.join('; ')}.`);
    if (unaccounted !== null && unaccounted > 0) {
      parts.push(`Kalan yaklaşık ${formatDuration(unaccounted)} kayıt dışı kaldı; yemek, dinlenme, sohbet ve oyalanma gibi şeyler burada durur.`);
    }
    parts.push('Bu bir hata değil, sadece veri.');
  }
  if (i.screenMinutes !== null && i.screenMinutes > 0) {
    if (vs !== null && vs >= 0.5 && unaccounted !== null && unaccounted >= 60) {
      parts.push(`Ekran süren ${formatDuration(i.screenMinutes)}; kayıt dışı zamanın önemli bir bölümüyle örtüşüyor olabilir. Küçük bir kısmını başka bir şeye ayırmak yeter.`);
    } else {
      parts.push(`Ekran süren ${formatDuration(i.screenMinutes)}; bir kısmı iş saatine denk gelmiş olabilir.`);
    }
  }

  return {
    awakeMinutes: awake,
    wakeSource: i.wakeSource,
    workMinutes,
    workSource: i.work ? i.work.source : null,
    commuteMinutes: i.commuteMinutes,
    prepMinutes: i.prepMinutes,
    freeMinutes: free,
    doneOutsideWorkMinutes: doneOutside,
    driftMinutes: i.driftMinutes,
    unaccountedMinutes: unaccounted,
    screenMinutes: i.screenMinutes,
    screenVsUnaccounted: vs,
    chips,
    text: parts.join(' '),
  };
}

/** Yapay zekâya gidecek sayısal zaman dökümü satırları (yalnızca ölçülenler). */
export function timeUsePromptLines(t: TimeUse, includeScreen: boolean): string[] {
  const lines: string[] = [];
  if (t.freeMinutes !== null) {
    const bits = [`iş dışı uyanık ${formatDuration(t.freeMinutes)}`];
    if (t.workMinutes > 0) bits.push(`iş ${formatDuration(t.workMinutes)}`);
    if (t.commuteMinutes > 0) bits.push(`yol ${formatDuration(t.commuteMinutes)}`);
    if (t.prepMinutes > 0) bits.push(`sabah hazırlık ${formatDuration(t.prepMinutes)}`);
    bits.push(`işlere giden ${formatDuration(t.doneOutsideWorkMinutes)}`);
    if (t.driftMinutes > 0) bits.push(`not edilen akıp giden ${formatDuration(t.driftMinutes)}`);
    if (t.unaccountedMinutes !== null) bits.push(`kayıt dışı kalan ${formatDuration(t.unaccountedMinutes)}`);
    lines.push(`- Zaman dökümü (ölçülen, tahmin değil): ${bits.join(', ')}`);
  }
  if (includeScreen && t.screenMinutes !== null) lines.push(`- Ekran süresi (iş saatini de içerebilir): ${formatDuration(t.screenMinutes)}`);
  return lines;
}

// ───────────────────────── Ekran yerine yapılabilecekler ─────────────────────────

export interface OpenTaskInfo {
  title: string;
  minutes: number;
  /** İş vaktinde de yapılabilir mi */
  workOk: boolean;
  /** Bugün "yapamadım" / "yapmadım" denmişse */
  missed: 'COULD_NOT' | 'NOT_DONE' | null;
  reason: TaskOutcomeReason | null;
}

export const SCREEN_MIN_FOR_ALTERNATIVES = 60;

/** Ekran süresinin ne kadarını başka işe ayırmayı önerelim: dörtte biri, 30-120 dk arası, 5'e yuvarlı. */
export function screenBudget(screenMinutes: number): number {
  const raw = Math.round((screenMinutes * 0.25) / 5) * 5;
  return Math.min(120, Math.max(30, raw));
}

const IDEAS: { title: string; minutes: number; why: string }[] = [
  { title: 'Kısa yürüyüş', minutes: 15, why: 'Hareket zihni açar ve ekrandan en kolay kopuş yoludur.' },
  { title: 'Kitaptan 15 sayfa', minutes: 20, why: 'Odağı toplar; telefon yerine elinde bir şey olur.' },
  { title: 'Nefes ve esneme', minutes: 10, why: 'Kısa bir mola, hem beden hem zihin için.' },
  { title: 'Yarının işlerini yaz', minutes: 10, why: 'Yarın ne yapacağını bilmek yükü hafifletir.' },
  { title: 'Bir arkadaşı ya da aileyi ara', minutes: 15, why: 'İnsan sesi, ekran kaydırmaktan farklı bir iyi gelir.' },
  { title: 'Küçük bir ev düzeni işi', minutes: 15, why: 'Bitirdiğin küçük bir iş tatmin verir.' },
  { title: '10 yeni kelime çalış', minutes: 15, why: 'Dil için kısa ve düzenli süre yeter.' },
];

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/**
 * Ekran süresi yerine yapılabilecekler: önce kullanıcının yapamadığı/yapmadığı açık işler (süreleri bütçeye
 * sığdığı kadar), kalan bütçe için kısa fikirler. Ekran süresi yoksa ya da çok azsa liste boş döner.
 * `seed` aynı fikirlerin her gün tekrar etmemesi için listeyi döndürür (ör. ayın günü).
 */
export function screenAlternatives(
  screenMinutes: number | null,
  openTasks: OpenTaskInfo[],
  seed = 0,
  max = 4
): { note: string | null; items: ScreenAlternative[] } {
  if (screenMinutes === null || screenMinutes < SCREEN_MIN_FOR_ALTERNATIVES) return { note: null, items: [] };
  const budget = screenBudget(screenMinutes);
  const items: ScreenAlternative[] = [];
  let left = budget;

  const rank = (t: OpenTaskInfo) => (t.missed === 'COULD_NOT' ? 0 : t.missed === 'NOT_DONE' ? 1 : 2);
  const tasks = [...openTasks].sort((a, b) => rank(a) - rank(b) || a.minutes - b.minutes);
  for (const t of tasks) {
    if (items.length >= Math.min(3, max)) break;
    if (t.minutes > left) continue;
    items.push({
      title: t.title,
      minutes: t.minutes,
      why:
        t.missed === 'COULD_NOT'
          ? 'Bugün olmayan bir işti; ekrandan ayıracağın kısa süre yeter.'
          : t.missed === 'NOT_DONE'
            ? 'Bugün atladığın bir iş; ekran süresinin küçük bir kısmına sığar.'
            : 'Hâlâ açık bir iş; ekran süresinin küçük bir kısmı yeter.',
      kind: 'TASK',
    });
    left -= t.minutes;
  }

  const taken = new Set(openTasks.map((t) => norm(t.title)));
  const start = ((seed % IDEAS.length) + IDEAS.length) % IDEAS.length;
  for (let k = 0; k < IDEAS.length && items.length < max && left >= 10; k += 1) {
    const idea = IDEAS[(start + k) % IDEAS.length];
    if (idea.minutes > left || taken.has(norm(idea.title))) continue;
    items.push({ ...idea, kind: 'IDEA' });
    left -= idea.minutes;
  }

  const note = `Ekran süren ${formatDuration(screenMinutes)}. Bunun yalnızca ${formatDuration(budget)} kadarını ayırsan şunlar sığar:`;
  return { note, items };
}
