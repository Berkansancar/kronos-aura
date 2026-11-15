/**
 * Gün sonu değerlendirmesinin saf mantığı (test edilebilir):
 *  - gününün "gerçekleri" (ne yapıldı, ne açık kaldı)
 *  - yapay zekâ olmadan çalışan kural tabanlı değerlendirme
 *  - yapay zekâ için istem ve cevabın doğrulanması
 *
 * Aura'nın dilinde yargılayıcı sözcük yoktur; model böyle bir şey yazarsa cevap atılır, kurallara dönülür.
 */
import type {
  DayReviewPayload,
  RoutineCategory,
  RoutineIdea,
} from '../database/types';
import { formatDuration } from './format';
import { ROUTINE_TEMPLATES } from './routineTemplates';

// ───────────────────────── Gerçekler ─────────────────────────

export interface DayFacts {
  /** yyyy-mm-dd */
  day: string;
  tasksDone: { title: string; minutes: number }[];
  /** Hâlâ açık (bekleyen ya da süren) görev sayısı */
  tasksOpen: number;
  /** "Zaman akıp gitti" notlarının toplamı (dk) */
  driftMinutes: number;
  routinesDone: string[];
  /** "Bugün değil" denen ya da bırakılan günler */
  routinesSkipped: string[];
  /** Cevaplanmamış, ertelenmiş ya da yapacağım denip yapılmamış */
  routinesOpen: string[];
  energy: { HIGH: number; EXHAUSTED: number; DISTRACTED: number };
  steps: number | null;
  stepsReliable: boolean;
  screenMinutes: number | null;
  sleepMinutes: number | null;
  sleepBed: string | null;
  sleepWake: string | null;
  peakStartHour: number;
  peakEndHour: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ekranda gösterilecek kısa özet satırları. */
export function factChips(f: DayFacts): string[] {
  const chips: string[] = [];
  chips.push(`${f.tasksDone.length} görev bitti`);
  const total = f.routinesDone.length + f.routinesSkipped.length + f.routinesOpen.length;
  if (total > 0) chips.push(`${f.routinesDone.length}/${total} rutin`);
  if (f.steps !== null) chips.push(`${f.steps.toLocaleString('tr-TR')} adım${f.stepsReliable ? '' : ' (eksik olabilir)'}`);
  if (f.screenMinutes !== null) chips.push(`${formatDuration(f.screenMinutes)} ekran`);
  if (f.sleepMinutes !== null) chips.push(`uyku ~${formatDuration(f.sleepMinutes)}`);
  if (f.driftMinutes > 0) chips.push(`${formatDuration(f.driftMinutes)} akıp giden`);
  return chips;
}

/** Gün hiç kayıt bırakmadıysa true. */
export function isQuietDay(f: DayFacts): boolean {
  return f.tasksDone.length === 0 && f.routinesDone.length === 0;
}

// ───────────────────────── Yargı filtresi ─────────────────────────

const BANNED = /(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin|hak etmiyorsun)/i;
export const hasBannedWords = (text: string): boolean => BANNED.test(text);

// ───────────────────────── Kural tabanlı değerlendirme ─────────────────────────

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

function ideaFromTemplate(id: string): RoutineIdea | null {
  const t = ROUTINE_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return {
    title: t.title,
    category: t.category,
    minutes: t.estimatedDuration,
    hour: t.askHour,
    minute: t.askMinute,
    why: t.why,
    templateId: t.id,
  };
}

/** Öncelik sırasıyla şablon önerileri; zaten eklenmiş olanlar atlanır, en fazla `max` döner. */
export function ruleBasedIdeas(
  f: DayFacts,
  existingTitles: string[],
  activeTemplateIds: string[],
  max = 3
): RoutineIdea[] {
  const order: string[] = [];
  const bedHour = f.sleepBed ? Number(f.sleepBed.slice(0, 2)) : null;
  const lateBed = bedHour !== null && (bedHour >= 1 && bedHour < 6);

  if (f.stepsReliable && f.steps !== null && f.steps < 4000) order.push('sabah-yuruyus', 'ogle-yuruyus');
  if (f.screenMinutes !== null && f.screenMinutes >= 240) order.push('ekransiz-saat');
  if ((f.sleepMinutes !== null && f.sleepMinutes < 360) || lateBed) order.push('uyku-hazirligi');
  if (f.energy.EXHAUSTED > 0 || f.energy.DISTRACTED > 0) order.push('nefes-meditasyon');
  if (f.routinesDone.length === 0) order.push('su-ic', 'nefes-meditasyon');
  order.push('gunu-planla', 'yarini-hazirla', 'gunluk-notu', 'kitap-oku', 'egzersiz', 'derin-calisma', 'dil-calis');

  const taken = new Set(existingTitles.map(norm));
  const active = new Set(activeTemplateIds);
  const out: RoutineIdea[] = [];
  for (const id of order) {
    if (out.length >= max) break;
    if (active.has(id) || out.some((o) => o.templateId === id)) continue;
    const idea = ideaFromTemplate(id);
    if (!idea || taken.has(norm(idea.title))) continue;
    out.push(idea);
  }
  return out;
}

export function buildRulesReview(
  f: DayFacts,
  existingTitles: string[],
  activeTemplateIds: string[]
): DayReviewPayload {
  const parts: string[] = [];
  if (isQuietDay(f)) {
    parts.push('Bugün kayıt az; sessiz günler de bir veridir ve sorun değil.');
    parts.push('Yarın tek bir küçük adım yeterli.');
  } else {
    const bits: string[] = [];
    if (f.tasksDone.length > 0) bits.push(`${f.tasksDone.length} görev`);
    if (f.routinesDone.length > 0) bits.push(`${f.routinesDone.length} rutin`);
    parts.push(`Bugün ${bits.join(' ve ')} tamamlandı.`);
    if (f.energy.EXHAUSTED > 0) parts.push('Bazı işleri yorgun bitirdin; bu bir sinyal, akşam dinlenmek hak.');
    else if (f.energy.DISTRACTED > 0) parts.push('Zihin zaman zaman dolaştı; bu olağan, yarın küçük adımlarla toparlarız.');
    else parts.push('Bu ritim kayda geçti.');
  }
  if (f.sleepMinutes !== null && f.sleepMinutes < 360) {
    parts.push('Dünkü uykun kısa görünüyor; bu gece erken kapanmak iyi gelir.');
  }
  const reflection = parts.join(' ');

  const peak = `${pad(f.peakStartHour)}:00–${pad(f.peakEndHour)}:00`;
  const open = f.routinesOpen.length;
  const tomorrow =
    open > 0
      ? `Yarın ağır işi ${peak} tepe saatine koy. Aşağıdan "yarın yapacağım" dediğin rutinleri sabah plana yerleştiririm; ${open} rutin bugün açık kaldı, istersen saatini ya da süresini ayarlayalım.`
      : `Yarın ağır işi ${peak} tepe saatine koy. Aşağıdan "yarın yapacağım" dediğin rutinleri sabah plana yerleştiririm.`;

  return {
    reflection,
    tomorrow,
    ideas: ruleBasedIdeas(f, existingTitles, activeTemplateIds),
    source: 'RULES',
  };
}

// ───────────────────────── Yapay zekâ ─────────────────────────

const CATEGORIES: RoutineCategory[] = ['SAGLIK', 'ZIHIN', 'ODAK', 'DUZEN'];

/**
 * Yapay zekâya gidecek gün özeti. Adım, ekran ve uyku yalnızca paylaşım izni varsa eklenir;
 * görev ve rutin adları her zaman gider (kullanıcı kendi yazdı, koç sohbetiyle aynı kapsam).
 */
export function buildReviewPrompt(
  f: DayFacts,
  existingTitles: string[],
  shareActivity: boolean
): string {
  const lines: string[] = ['Bugünün özeti (gün sonu değerlendirmesi için):'];
  lines.push(
    f.tasksDone.length > 0
      ? `- Biten görevler: ${f.tasksDone.slice(0, 10).map((t) => `${t.title} (${t.minutes} dk)`).join(', ')}`
      : '- Biten görev yok.'
  );
  lines.push(`- Açık kalan görev sayısı: ${f.tasksOpen}`);
  if (f.routinesDone.length > 0) lines.push(`- Yapılan rutinler: ${f.routinesDone.join(', ')}`);
  if (f.routinesSkipped.length > 0) lines.push(`- Bugün yapılmayacağı söylenen rutinler: ${f.routinesSkipped.join(', ')}`);
  if (f.routinesOpen.length > 0) lines.push(`- Açık kalan rutinler: ${f.routinesOpen.join(', ')}`);
  const e = f.energy;
  if (e.HIGH + e.EXHAUSTED + e.DISTRACTED > 0) {
    lines.push(`- Görev sonu hisleri: ${e.HIGH} enerjik, ${e.EXHAUSTED} yorgun, ${e.DISTRACTED} dağınık`);
  }
  if (f.driftMinutes > 0) lines.push(`- Not edilen akıp giden zaman: ${formatDuration(f.driftMinutes)} (yargılama, yalnızca veri)`);
  if (shareActivity) {
    if (f.steps !== null) lines.push(`- Adım: ${f.steps}${f.stepsReliable ? '' : ' (eksik olabilir)'}`);
    if (f.screenMinutes !== null) lines.push(`- Ekran süresi: ${formatDuration(f.screenMinutes)}`);
    if (f.sleepMinutes !== null) lines.push(`- Dün geceki uyku (tahmin, kesin değil): ${formatDuration(f.sleepMinutes)}`);
  }
  lines.push(`- Tepe enerji penceresi: ${pad(f.peakStartHour)}:00–${pad(f.peakEndHour)}:00`);
  lines.push(
    existingTitles.length > 0
      ? `- Zaten var olan rutinler (bunları tekrar önerme): ${existingTitles.join(', ')}`
      : '- Henüz hiç rutini yok.'
  );

  lines.push(
    '',
    'GÖREV: Günü yargılamadan değerlendir, yarın için kısa bir yaklaşım öner ve kullanıcının yapabileceği 3 FARKLI yeni rutin fikri çıkar.',
    'Kurallar:',
    '- "reflection": Aura sesiyle (sıcak, yargısız) en fazla 3 kısa cümle. Verilmeyen sayı ya da olay uydurma.',
    '- "tomorrow": Kronos sesiyle (net, stratejik) en fazla 2 kısa cümle; yarının enerji saatlerine göre tek bir somut yaklaşım.',
    '- "ideas": 3 fikir; kullanıcının mevcut hâline uygun, küçük ve uygulanabilir olsun (5-60 dakika). Birbirine benzemesin.',
    '  Her fikir: {"title": en fazla 40 karakter, "category": "SAGLIK" | "ZIHIN" | "ODAK" | "DUZEN", "minutes": 5-60, "hour": 6-21 (sorulacak saat), "minute": 0-59, "why": tek kısa cümle}',
    'Sadece şu JSON\'u döndür, başka hiçbir şey yazma:',
    '{"reflection":"...","tomorrow":"...","ideas":[{"title":"...","category":"SAGLIK","minutes":15,"hour":9,"minute":0,"why":"..."}]}'
  );
  return lines.join('\n');
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Modelin JSON cevabını doğrular ve temizler. Başlık/yorum eksikse ya da yargılayıcı sözcük içeriyorsa null döner
 * (çağıran kural tabanlı değerlendirmeye düşer). Geçersiz ya da tekrar eden fikirler tek tek atılır.
 */
export function parseReviewResponse(
  obj: Record<string, unknown> | null,
  existingTitles: string[]
): DayReviewPayload | null {
  if (!obj) return null;
  const reflection = typeof obj.reflection === 'string' ? obj.reflection.trim() : '';
  const tomorrow = typeof obj.tomorrow === 'string' ? obj.tomorrow.trim() : '';
  if (!reflection || !tomorrow) return null;
  if (hasBannedWords(reflection) || hasBannedWords(tomorrow)) return null;

  const taken = new Set(existingTitles.map(norm));
  const ideas: RoutineIdea[] = [];
  const raw = Array.isArray(obj.ideas) ? obj.ideas : [];
  for (const item of raw) {
    if (ideas.length >= 3) break;
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const why = typeof it.why === 'string' ? it.why.trim() : '';
    if (title.length < 3 || title.length > 40 || !why) continue;
    if (hasBannedWords(title) || hasBannedWords(why)) continue;
    if (taken.has(norm(title))) continue;
    taken.add(norm(title));
    ideas.push({
      title,
      category: CATEGORIES.includes(it.category as RoutineCategory) ? (it.category as RoutineCategory) : 'DUZEN',
      minutes: clampInt(it.minutes, 5, 60, 15),
      hour: clampInt(it.hour, 6, 21, 9),
      minute: clampInt(it.minute, 0, 59, 0),
      why: why.slice(0, 160),
      templateId: null,
    });
  }

  return {
    reflection: reflection.slice(0, 420),
    tomorrow: tomorrow.slice(0, 320),
    ideas,
    source: 'AI',
  };
}
