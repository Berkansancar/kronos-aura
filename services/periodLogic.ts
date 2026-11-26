/**
 * "Tüm günlerin değerlendirmesi" (saf mantık, test edilebilir). Uygulamayı kullanmaya başladığın günden bugüne kadar
 * (en çok 60 gün) bütün günleri tek bir yapay zekâ komutunda toplar: dönem toplamları (uygulama hesaplar), gün gün
 * kayıtlar ve bugünün özeti. Yapay zekâdan dönem yorumu, her güne bir not, örüntüler, gelecek günler için yaklaşım ve
 * yeni rutin fikirleri istenir. Sayıları yapay zekâ değil uygulama hesaplar; böylece "şu kadar günde böyle" doğru kalır.
 *
 * Aura yargılamaz: kayıt olmayan gün "yapılmadı" diye okunmaz.
 */
import { formatSteps } from './activityLogic';
import { MANUAL_PREAMBLE, hasBannedWords, reviewFactLines, reviewTaskLines, type DayFacts } from './dayReviewLogic';
import { dayDiff } from './effectsLogic';
import { formatDuration } from './format';
import { MIN_WORK_STAY_MIN, hasLocationRecord, outMinutes, type DayLocationSummary } from './locationLogic';
import { formatMood } from './moodLogic';
import { rangeLabel, scheduledOn, totalsOf, weekdayShort, windowKeys, type WeekDay, type WeekRoutineInput } from './weeklyLogic';

export const MAX_PERIOD_DAYS = 60;
/** Bundan az günde "tüm günler" komutu anlamsızdır (bugünün komutu yeter). */
export const MIN_PERIOD_DAYS = 2;
export const PERIOD_KEY = 'period_reviews_v1';
export const MAX_STORED_REVIEWS = 6;

/** Komuta yazılan iş bilgisi: sabit bir iş yeri olmayabilir, gün boyu hareket hâlindedir. */
export const WORK_NOTE =
  'Kullanıcının işi şoförlük: gün boyu hareket hâlindedir ve sabit bir iş yeri olmayabilir.';

/** Konum dakikaları verildiğinde komuta yazılan açıklama (adres, koordinat ve yer adı yoktur). */
export const LOCATION_NOTE =
  'Konum özeti verildi (telefonun arka plan konumundan): yalnızca dakika ve saatlerdir; adres, koordinat ve yer adı yoktur. "evde", "yolda" (araçla hareket hâlinde), "durakta" (dışarıda duruş ya da yürüyüş) ve varsa "kayıtlı iş noktasında" ayrımını yalnızca yazılan dakikalardan çıkar. Evden çıkış ve eve dönüş saatleri günün çerçevesidir. Dükkana ya da kayıtlı bir iş noktasına uğranmayan gün bir kusur değildir; yargılama. Yolda geçen ekran süresi navigasyon ya da müzik olabilir; bunu kınama, tehlikeli kullanım diye yorumlama. Kaydı olmayan süreyi evde ya da yolda sayma.';

// ───────────────────────── Dönem ─────────────────────────

export interface PeriodSpan {
  days: number;
  from: string;
  /** İlk kayıttan bugüne gün sayısı 60'ı aştı, son 60 gün alındı */
  capped: boolean;
}

/** İlk veri gününden bugüne kadar olan günler (bugün dahil). Veri yoksa yalnızca bugün. */
export function periodSpan(firstDay: string | null, today: string): PeriodSpan {
  if (!firstDay || firstDay > today) return { days: 1, from: today, capped: false };
  const raw = dayDiff(firstDay, today) + 1;
  const days = Math.min(MAX_PERIOD_DAYS, raw);
  return { days, from: windowKeys(today, days)[0], capped: raw > MAX_PERIOD_DAYS };
}

export interface PeriodDay extends WeekDay {
  /** O gün planlı rutin sayısı (yapılanlar dahil) */
  routineChances: number;
  /** DONE: seans kaydı var; PLANNED: program günüydü ama seans kaydı yok; null: egzersiz günü değildi */
  exercise: 'DONE' | 'PLANNED' | null;
  mood: number | null;
  /** Sigara sayacı kullanıldıysa o günün adedi */
  smoke: number | null;
  languageMinutes: number | null;
  /** Gün akışı damgalarından yolda geçen süre (işe + eve); damga yoksa null */
  roadMinutes: number | null;
  /** Gün akışı damgalarından iş yerinde geçen süre; damga yoksa null */
  siteMinutes: number | null;
  /** Telefonun konumundan günün dakika toplamları (yalnızca dakika; koordinat ve yer adı yok). Yoksa ya da paylaşılmıyorsa boş. */
  loc?: DayLocationSummary | null;
}

export interface PeriodFacts {
  from: string;
  to: string;
  days: PeriodDay[];
  capped: boolean;
  routines: WeekRoutineInput[];
  countEndDay: boolean;
  waterGoalMl: number;
}

/** Bir günün rutin "şansı": o gün planlı olup eklenmiş olan ya da yapılmış rutinler. Bitmemiş son gün, yapılmadıysa sayılmaz. */
export function routineChancesOn(routines: WeekRoutineInput[], key: string, last: string, countEndDay: boolean): number {
  let n = 0;
  for (const r of routines) {
    const done = r.doneDays.includes(key);
    if (key < r.createdDay && !done) continue;
    if (!done && !scheduledOn(r, key)) continue;
    if (key === last && !countEndDay && !done) continue;
    n += 1;
  }
  return n;
}

// ───────────────────────── Toplamlar ─────────────────────────

export interface PeriodStats {
  days: number;
  recordedDays: number;
  tasksDone: number;
  taskMinutes: number;
  routinesDone: number;
  routineChances: number;
  exerciseDone: number;
  exercisePlanned: number;
  moodDays: number;
  moodAvg: number | null;
  lowMoodDays: number;
  hardDays: number;
  sleepAvg: number | null;
  sleepNights: number;
  stepsAvg: number | null;
  screenAvg: number | null;
  waterDays: number;
  waterGoalDays: number;
  languageDays: number;
  languageMinutes: number;
  smokeDays: number;
  smokeAvg: number | null;
  roadDays: number;
  roadAvg: number | null;
  siteDays: number;
  siteAvg: number | null;
  /** Konum kaydı (en az 30 dk bilinen süre) olan gün sayısı */
  locDays: number;
  locHomeAvg: number | null;
  /** Dışarıda: yol + durak + iş noktası */
  locOutAvg: number | null;
  locRoadAvg: number | null;
  locStopAvg: number | null;
  /** İş noktası kaydı olan günlerden kaçında en az 5 dk bulunuldu */
  locWorkDays: number;
  locWorkTracked: number;
  /** Ortalama evden çıkış ve eve dönüş (gün içi dakika) */
  locLeaveAvg: number | null;
  locBackAvg: number | null;
  locScreenHomeAvg: number | null;
  locScreenRoadAvg: number | null;
  locScreenOutAvg: number | null;
}

const clockMinutes = (hhmm: string | null): number | null => {
  const m = hhmm ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const clockText = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const avgOf = (xs: number[], minCount = 1): number | null => (xs.length >= minCount ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export const hasRecord = (d: PeriodDay): boolean =>
  d.tasksDone > 0 ||
  d.routinesDone > 0 ||
  d.exercise === 'DONE' ||
  d.steps !== null ||
  d.screenMinutes !== null ||
  d.sleepMinutes !== null ||
  (d.waterMl ?? 0) > 0 ||
  d.mood !== null ||
  (d.smoke ?? 0) > 0 ||
  (d.languageMinutes ?? 0) > 0 ||
  d.roadMinutes !== null ||
  d.siteMinutes !== null ||
  hasLocationRecord(d.loc);

export function periodStats(f: PeriodFacts): PeriodStats {
  const t = totalsOf(f.days, f.routines, f.countEndDay, f.waterGoalMl);
  const moods = f.days.map((d) => d.mood).filter((x): x is number => x !== null);
  const smokes = f.days.map((d) => d.smoke).filter((x): x is number => x !== null && x > 0);
  const lang = f.days.map((d) => d.languageMinutes).filter((x): x is number => x !== null && x > 0);
  const roads = f.days.map((d) => d.roadMinutes).filter((x): x is number => x !== null);
  const sites = f.days.map((d) => d.siteMinutes).filter((x): x is number => x !== null);
  const locs = f.days.map((d) => d.loc).filter(hasLocationRecord);
  const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
  const workTracked = locs.filter((l) => l.workMin !== null);
  return {
    days: f.days.length,
    recordedDays: f.days.filter(hasRecord).length,
    tasksDone: t.tasksDone,
    taskMinutes: t.taskMinutes,
    routinesDone: t.routinesDone,
    routineChances: t.routineChances,
    exerciseDone: f.days.filter((d) => d.exercise === 'DONE').length,
    exercisePlanned: f.days.filter((d) => d.exercise !== null).length,
    moodDays: moods.length,
    moodAvg: moods.length > 0 ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null,
    lowMoodDays: moods.filter((m) => m <= 2).length,
    hardDays: t.hardDays,
    sleepAvg: t.sleepAvg,
    sleepNights: t.sleepNights,
    stepsAvg: t.stepsAvg,
    screenAvg: t.screenAvg,
    waterDays: t.waterDays,
    waterGoalDays: t.waterGoalDays,
    languageDays: lang.length,
    languageMinutes: lang.reduce((a, b) => a + b, 0),
    smokeDays: smokes.length,
    smokeAvg: avgOf(smokes, 3),
    roadDays: roads.length,
    roadAvg: avgOf(roads, 3),
    siteDays: sites.length,
    siteAvg: avgOf(sites, 3),
    locDays: locs.length,
    locHomeAvg: avgOf(locs.map((l) => l.homeMin), 2),
    locOutAvg: avgOf(locs.map(outMinutes), 2),
    locRoadAvg: avgOf(locs.map((l) => l.roadMin), 2),
    locStopAvg: avgOf(locs.map((l) => l.stopMin), 2),
    locWorkDays: workTracked.filter((l) => (l.workMin as number) >= MIN_WORK_STAY_MIN).length,
    locWorkTracked: workTracked.length,
    locLeaveAvg: avgOf(nums(locs.map((l) => clockMinutes(l.leftHome))), 3),
    locBackAvg: avgOf(nums(locs.map((l) => clockMinutes(l.backHome))), 3),
    locScreenHomeAvg: avgOf(nums(locs.map((l) => l.screenHomeMin)), 2),
    locScreenRoadAvg: avgOf(nums(locs.map((l) => l.screenRoadMin)), 2),
    locScreenOutAvg: avgOf(nums(locs.map((l) => l.screenOutMin)), 2),
  };
}

/** "Şu kadar günde böyle" satırları: hem komuta hem ekrandaki özete gider. Kayıt olmayan konu yazılmaz. */
export function statLines(s: PeriodStats): string[] {
  const out: string[] = [`Kayıt olan gün: ${s.recordedDays} / ${s.days}`];
  if (s.routineChances > 0) {
    out.push(`Rutin: ${s.routinesDone} / ${s.routineChances} (%${Math.round((100 * s.routinesDone) / s.routineChances)})`);
  }
  if (s.exercisePlanned > 0) out.push(`Egzersiz: ${s.exerciseDone} / ${s.exercisePlanned} program günü`);
  else if (s.exerciseDone > 0) out.push(`Egzersiz: ${s.exerciseDone} gün`);
  if (s.tasksDone > 0) out.push(`Biten görev: ${s.tasksDone} (${formatDuration(s.taskMinutes)})`);
  if (s.moodDays > 0 && s.moodAvg !== null) {
    out.push(`Ruh hali: ortalama ${formatMood(s.moodAvg)} / 5 (${s.moodDays} gün kayıt${s.lowMoodDays > 0 ? `, ${s.lowMoodDays} gün düşük` : ''})`);
  }
  if (s.sleepAvg !== null) out.push(`Uyku: ortalama ${formatDuration(s.sleepAvg)} (${s.sleepNights} gece, tahmin)`);
  if (s.stepsAvg !== null) out.push(`Adım: günlük ortalama ${formatSteps(s.stepsAvg)}`);
  if (s.screenAvg !== null) out.push(`Ekran: günlük ortalama ${formatDuration(s.screenAvg)}`);
  if (s.waterDays > 0) out.push(`Su: ${s.waterGoalDays} / ${s.waterDays} kayıtlı günde hedefe ulaşıldı`);
  if (s.languageDays > 0) out.push(`Dil: ${s.languageDays} gün, toplam ${formatDuration(s.languageMinutes)}`);
  if (s.roadAvg !== null) out.push(`Yolda: günlük ortalama ${formatDuration(s.roadAvg)} (${s.roadDays} gün damga)`);
  if (s.siteAvg !== null) out.push(`İş yerinde (damgayla): günlük ortalama ${formatDuration(s.siteAvg)} (${s.siteDays} gün)`);
  if (s.locDays > 0) {
    out.push(`Konum kaydı olan gün: ${s.locDays}`);
    if (s.locHomeAvg !== null) out.push(`Evde (konumdan): günlük ortalama ${formatDuration(s.locHomeAvg)}`);
    if (s.locOutAvg !== null) {
      const road = s.locRoadAvg !== null ? `, bunun yolda ${formatDuration(s.locRoadAvg)}` : '';
      const stop = s.locStopAvg !== null ? `, durakta ${formatDuration(s.locStopAvg)}` : '';
      out.push(`Dışarıda (konumdan): günlük ortalama ${formatDuration(s.locOutAvg)}${road}${stop}`);
    }
    if (s.locWorkTracked > 0) out.push(`Kayıtlı iş noktasında bulunulan gün: ${s.locWorkDays} / ${s.locWorkTracked}`);
    if (s.locLeaveAvg !== null) out.push(`Evden çıkış: ortalama ${clockText(s.locLeaveAvg)}`);
    if (s.locBackAvg !== null) out.push(`Eve dönüş: ortalama ${clockText(s.locBackAvg)}`);
    if (s.locScreenHomeAvg !== null && s.locScreenRoadAvg !== null && s.locScreenOutAvg !== null) {
      out.push(
        `Ekran açık (konuma göre, günlük ortalama): evde ${formatDuration(s.locScreenHomeAvg)}, yolda ${formatDuration(s.locScreenRoadAvg)}, duraklarda ${formatDuration(s.locScreenOutAvg)}`
      );
    }
  }
  if (s.smokeAvg !== null) out.push(`Sigara sayacı: günlük ortalama ${s.smokeAvg} (${s.smokeDays} gün, yalnızca veri)`);
  if (s.hardDays > 0) out.push(`Zor gün modu: ${s.hardDays} gün`);
  return out;
}

// ───────────────────────── Komut ─────────────────────────

/** Günün konum parçası: yalnızca dakikalar ve saatler (yer adı, koordinat yok). */
export function locationPart(l: DayLocationSummary): string {
  const parts = [`evde ${formatDuration(l.homeMin)}`, `yolda ${formatDuration(l.roadMin)}`, `durakta ${formatDuration(l.stopMin)}`];
  if (l.workMin !== null) parts.push(`kayıtlı iş noktasında ${formatDuration(l.workMin)}`);
  if (l.leftHome) parts.push(`evden çıkış ${l.leftHome}`);
  if (l.backHome) parts.push(`eve dönüş ${l.backHome}`);
  if (l.screenHomeMin !== null && l.screenRoadMin !== null && l.screenOutMin !== null) {
    parts.push(`ekran açık evde ${formatDuration(l.screenHomeMin)}, yolda ${formatDuration(l.screenRoadMin)}, duraklarda ${formatDuration(l.screenOutMin)}`);
  }
  return parts.join(', ');
}

/** Gün gün tek satır; yazılmayan alan o gün kayıt yok demektir. */
export function dayLine(d: PeriodDay): string {
  const parts: string[] = [];
  if (d.tasksDone > 0) parts.push(`${d.tasksDone} görev (${formatDuration(d.taskMinutes)})`);
  if (d.routineChances > 0) parts.push(`rutin ${Math.min(d.routinesDone, d.routineChances)}/${d.routineChances}`);
  if (d.exercise === 'DONE') parts.push('egzersiz yapıldı');
  else if (d.exercise === 'PLANNED') parts.push('egzersiz günüydü, seans kaydı yok');
  if (d.steps !== null && d.steps > 0) parts.push(`${formatSteps(d.steps)} adım`);
  if (d.screenMinutes !== null) parts.push(`ekran ${formatDuration(d.screenMinutes)}`);
  if (d.sleepMinutes !== null && d.sleepMinutes > 0) parts.push(`uyku ~${formatDuration(d.sleepMinutes)}`);
  if ((d.waterMl ?? 0) > 0) parts.push(`su ${d.waterMl} ml`);
  if (d.mood !== null) parts.push(`ruh hali ${d.mood}/5`);
  if ((d.languageMinutes ?? 0) > 0) parts.push(`dil ${formatDuration(d.languageMinutes as number)}`);
  if (d.roadMinutes !== null) parts.push(`yolda ${formatDuration(d.roadMinutes)}`);
  if (d.siteMinutes !== null) parts.push(`iş yerinde ${formatDuration(d.siteMinutes)}`);
  if (hasLocationRecord(d.loc)) parts.push(`konum: ${locationPart(d.loc)}`);
  if ((d.smoke ?? 0) > 0) parts.push(`sigara ${d.smoke}`);
  if (d.hardDay) parts.push('zor gün modu');
  return `- ${d.day} ${weekdayShort(d.day)}: ${parts.length > 0 ? parts.join(', ') : 'kayıt yok'}`;
}

/** Günlük komutun dönem kuralları; "ideas", "timeUse" gibi günlük kurallar aynen kalır. */
function periodRuleLines(n: number): string[] {
  return [
    `- "periodSummary": Aura sesiyle en fazla 4 kısa cümle. İlk cümle "Son ${n} günde" diye başlasın ve kaç günde ne olduğunu sayılarla söylesin. Yalnızca yukarıdaki sayıları kullan; sayı ya da olay uydurma.`,
    '- "patterns": en çok 3 kısa gözlem; gün gün kayıtlarda görünen örüntüler (hafta içi ve hafta sonu farkı, egzersiz yapılan günlerde ruh hali ya da uyku, ekranı yüksek günler, yolda geçen süre, evden çıkış ve dönüş saatleri, ekranın evde ve yolda dağılımı). "Sebep" iddiası kurma, "birlikte görünüyor" de. Kayıt olan gün sayısı 5\'ten azsa boş liste ver.',
    '- "dayNotes": yukarıda listelenen HER gün için bir kayıt: {"day": "yyyy-mm-dd", "note": en fazla 90 karakter, yargısız tek kısa cümle}. Kaydı olmayan gün için "Bu gün için kayıt yok." yaz.',
    `- "nextPeriod": Kronos sesiyle en fazla 3 kısa cümle: önümüzdeki günler için tek bir somut yaklaşım (tepe enerji saatleri, yol ve iş yoğunluğu gözetilerek).`,
    '- "ideas" için ek kural: her fikir yukarıdaki bir bulguya dayansın ve "why" içinde o bulguyu kısa söylesin. Sürüş sırasında telefon kullanımı gerektiren fikir verme; ses ya da durak ve mola gibi güvenli anlara uygun olsun.',
  ];
}

const PERIOD_JSON =
  '{"periodSummary":"...","patterns":["..."],"dayNotes":[{"day":"yyyy-mm-dd","note":"..."}],"nextPeriod":"...","reflection":"...","tomorrow":"...","ideas":[{"title":"...","category":"SAGLIK","minutes":15,"hour":9,"minute":0,"why":"..."}],"timeUse":"...","screenAlternatives":[{"title":"...","minutes":15,"why":"..."}]}';

export function buildPeriodPrompt(f: PeriodFacts, stats: PeriodStats, today: DayFacts, existingTitles: string[]): string {
  const n = f.days.length;
  const task = reviewTaskLines(today, true);
  // Günlük görev satırını dönem görevine çevir, dönem kurallarını JSON satırından önce ekle
  const jsonAt = task.findIndex((l) => l.startsWith('Sadece şu JSON'));
  const head = task.slice(0, jsonAt >= 0 ? jsonAt : task.length - 2);
  const goalAt = head.findIndex((l) => l.startsWith('GÖREV:'));
  if (goalAt >= 0) {
    head[goalAt] = `GÖREV: Önce bu ${n} günü bir bütün olarak, sonra bugünü yargılamadan değerlendir. Her gün için kısa bir not yaz, önümüzdeki günler için bir yaklaşım öner ve kullanıcının yapabileceği 3 FARKLI yeni rutin fikri çıkar.`;
  }
  return [
    MANUAL_PREAMBLE.trimEnd(),
    '',
    `TÜM GÜNLERİN ÖZETİ: ${n} gün (${f.from} – ${f.to})${f.capped ? ', uygulamadaki en son 60 gün' : ', uygulamayı kullanmaya başladığın günden bugüne'}.`,
    stats.locDays > 0 ? `- ${WORK_NOTE} ${LOCATION_NOTE}` : `- ${WORK_NOTE} Konum verisi verilmedi: "yolda", "işte" ve "evde" ayrımını yalnızca aşağıda yazan "yolda" ve "iş yerinde" sürelerinden çıkar; yazılmayan şeyi uydurma.`,
    '- Bir alan yazılmadıysa o gün o konuda kayıt yok demektir (sıfır demek değildir). Kaydı olmayan günü "yapılmadı" diye yorumlama.',
    '',
    'Uygulamanın hesapladığı toplamlar (sayıları buradan al):',
    ...statLines(stats).map((l) => `- ${l}`),
    '',
    'Gün gün kayıtlar (eskiden yeniye):',
    ...f.days.map(dayLine),
    '',
    ...reviewFactLines(today, existingTitles, true),
    ...head,
    ...periodRuleLines(n),
    "Sadece şu JSON'u döndür, başka hiçbir şey yazma:",
    PERIOD_JSON,
    '',
    'JSON cevabını tek bir kod bloğu (```json) içine koy; böylece kopyalaması kolay olur. Kod bloğunun dışına açıklama yazma.',
  ].join('\n');
}

// ───────────────────────── Cevap ─────────────────────────

export interface PeriodExtras {
  summary: string;
  patterns: string[];
  dayNotes: { day: string; note: string }[];
  next: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Cevaptaki dönem alanlarını doğrular. "periodSummary" yoksa ya da yargılayıcı sözcük içeriyorsa null (günlük kısım
 * etkilenmez). Örüntüler ve gün notları tek tek elenir; başka bir döneme ait gün notları atılır.
 */
export function parsePeriodExtras(obj: Record<string, unknown> | null, validDays: string[]): PeriodExtras | null {
  if (!obj) return null;
  const summary = str(obj.periodSummary);
  if (summary.length < 10 || hasBannedWords(summary)) return null;

  const patterns: string[] = [];
  for (const p of Array.isArray(obj.patterns) ? obj.patterns : []) {
    const t = str(p);
    if (patterns.length >= 3) break;
    if (t.length < 8 || t.length > 220 || hasBannedWords(t) || patterns.includes(t)) continue;
    patterns.push(t);
  }

  const valid = new Set(validDays);
  const seen = new Set<string>();
  const dayNotes: { day: string; note: string }[] = [];
  for (const item of Array.isArray(obj.dayNotes) ? obj.dayNotes : []) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const day = str(it.day);
    const note = str(it.note);
    if (!valid.has(day) || seen.has(day)) continue;
    if (note.length < 3 || hasBannedWords(note)) continue;
    seen.add(day);
    dayNotes.push({ day, note: note.slice(0, 140) });
  }
  dayNotes.sort((a, b) => (a.day < b.day ? -1 : 1));

  const nextRaw = str(obj.nextPeriod);
  const next = nextRaw.length >= 10 && !hasBannedWords(nextRaw) ? nextRaw.slice(0, 420) : '';
  return { summary: summary.slice(0, 640), patterns, dayNotes, next };
}

// ───────────────────────── Saklama ─────────────────────────

export interface StoredPeriodReview extends PeriodExtras {
  from: string;
  to: string;
  days: number;
  savedAt: string;
  /** Uygulamanın o gün hesapladığı "şu kadar günde böyle" satırları */
  stats: string[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseStored(raw: string | null): StoredPeriodReview[] {
  if (!raw) return [];
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(o)) return [];
  const out: StoredPeriodReview[] = [];
  for (const x of o) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !DAY_RE.test(r.from) || !DAY_RE.test(r.to)) continue;
    if (typeof r.summary !== 'string' || !r.summary) continue;
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
    const notes = (Array.isArray(r.dayNotes) ? r.dayNotes : [])
      .filter((n): n is { day: string; note: string } => !!n && typeof n === 'object' && typeof (n as { day?: unknown }).day === 'string' && typeof (n as { note?: unknown }).note === 'string' && DAY_RE.test((n as { day: string }).day))
      .map((n) => ({ day: n.day, note: n.note }));
    out.push({
      from: r.from,
      to: r.to,
      days: typeof r.days === 'number' && Number.isFinite(r.days) ? Math.round(r.days) : dayDiff(r.from, r.to) + 1,
      savedAt: typeof r.savedAt === 'string' ? r.savedAt : '',
      stats: strs(r.stats),
      summary: r.summary,
      patterns: strs(r.patterns),
      dayNotes: notes,
      next: typeof r.next === 'string' ? r.next : '',
    });
  }
  return out.slice(0, MAX_STORED_REVIEWS);
}

/** Yeni kaydı başa ekler; aynı son güne ait eski kayıt değişir; en çok 6 kayıt kalır. */
export function addStored(list: StoredPeriodReview[], item: StoredPeriodReview): StoredPeriodReview[] {
  return [item, ...list.filter((x) => x.to !== item.to)].slice(0, MAX_STORED_REVIEWS);
}

export const serializeStored = (list: StoredPeriodReview[]): string => JSON.stringify(list.slice(0, MAX_STORED_REVIEWS));

const SHORT_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "12 Kas Per" */
export const dayShortLabel = (day: string): string => `${Number(day.slice(8, 10))} ${SHORT_MONTHS[Number(day.slice(5, 7)) - 1] ?? ''} ${weekdayShort(day)}`;

export const periodRangeLabel = (from: string, to: string): string => rangeLabel(windowKeys(to, Math.max(1, dayDiff(from, to) + 1)));
