/**
 * Gün rehberi testi (iş günü / Cumartesi yarım gün / Pazar boş çizelgesi, öneriler, şimdi-sıradaki).
 * Çalıştırmak için:  npm run test:guide
 */
import { addDayEvent, createTask } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { hasBannedWords } from '../services/dayReviewLogic';
import { loadGuide } from '../services/dayGuide';
import {
  buildGuide,
  guideLines,
  guideNow,
  type GuideBlock,
  type GuideInput,
  type GuideSegment,
} from '../services/dayGuideLogic';
import { hhmm } from '../services/goalsLogic';
import { addStudy } from '../services/language';
import { replanDay } from '../services/planner';
import { PERSONAL_WORK } from '../services/workLogic';
import { ensureWorkSeed } from '../services/workSettings';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// 16 Kasım 2026 Pazartesi, 21 Cumartesi, 22 Pazar
const at = (h: number, m = 0, d = 16) => new Date(2026, 10, d, h, m, 0, 0);
const base = (d: number, over: Partial<GuideInput> = {}): GuideInput => ({
  day: new Date(2026, 10, d),
  work: PERSONAL_WORK,
  wakeMin: null,
  commuteMin: null,
  bedtimeMin: null,
  blocks: [],
  language: null,
  ...over,
});
const kinds = (segs: GuideSegment[]) => segs.map((s) => s.kind);
const noOverlap = (segs: GuideSegment[]) => segs.every((s, i) => s.to > s.from && (i === 0 || segs[i - 1].to <= s.from));
const find = (segs: GuideSegment[], id: string) => segs.find((s) => s.id === id);
const lang = (done: number, goal: number | null = 20) => ({ goalMin: goal, doneMin: done, appName: 'Duolingo' });

async function main(): Promise<void> {
  console.log('İş günü (Pzt 07:40–18:00)');
  const w = buildGuide(base(16));
  check('tür ve başlık', w.kind === 'WORK' && w.headline === 'İş günü · 07:40–18:00 · eve ≈ 18:25', w.headline);
  check('sıra: hazırlık, yol, iş, yol, yemek, değerlendirme, kapanış', JSON.stringify(kinds(w.segments.filter((s) => s.fixed))) === JSON.stringify(['PREP', 'COMMUTE', 'WORK', 'COMMUTE', 'MEAL', 'REVIEW', 'WINDDOWN']));
  check('saatler: hazırlık 06:15, yol 07:15, iş 07:40–18:00, eve 18:25', find(w.segments, 'prep')!.from === 375 && find(w.segments, 'to-work')!.from === 435 && find(w.segments, 'work')!.from === 460 && find(w.segments, 'work')!.to === 1080 && find(w.segments, 'to-home')!.to === 1105);
  check('çakışma yok, sıralı', noOverlap(w.segments), JSON.stringify(w.segments.map((s) => [hhmm(s.from), hhmm(s.to)])));
  check('akşam yemeği eve varınca, gün sonu 21:30, kapanış 22:30–23:00', find(w.segments, 'dinner')!.from === 1105 && find(w.segments, 'review')!.from === 1290 && find(w.segments, 'winddown')!.from === 1350 && find(w.segments, 'winddown')!.to === 1380);
  check('yol parçalarında dil/yolda yapılabilir önerisi', /[Yy]olda yapılabilir/.test(find(w.segments, 'to-work')!.note ?? '') && /Dil öğrenme \(Duolingo\)/.test(buildGuide(base(16, { language: lang(0) })).segments.find((s) => s.id === 'to-home')!.note ?? ''));
  const typical = buildGuide(base(16, { wakeMin: 6 * 60 + 30, commuteMin: 40 }));
  check('tipik uyanış ve yol süresi kullanılır (06:30, çıkış 07:00, eve 18:40)', find(typical.segments, 'prep')!.from === 390 && find(typical.segments, 'to-work')!.from === 420 && find(typical.segments, 'to-home')!.to === 1120);
  check('tutarsız uyanış (çıkıştan hemen önce) yok sayılır', find(buildGuide(base(16, { wakeMin: 7 * 60 + 10 })).segments, 'prep')!.from === 375);
  check('iş saatleri kapalıysa iş günü yok', buildGuide(base(16, { work: { ...PERSONAL_WORK, enabled: false } })).kind === 'FREE');

  console.log('Cumartesi (08:30–13:30) ve Pazar');
  const sat = buildGuide(base(21));
  check('Cumartesi yarım gün: öğle yemeği eve varınca, akşam 19:30', sat.kind === 'HALF' && /Yarım gün · 08:30–13:30/.test(sat.headline) && find(sat.segments, 'lunch')!.from === 13 * 60 + 55 && find(sat.segments, 'dinner')!.from === 19 * 60 + 30 && noOverlap(sat.segments));
  const sun = buildGuide(base(22));
  check('Pazar boş gün: 08:00 yavaş başlangıç, öğle 13:00, akşam 19:30', sun.kind === 'FREE' && sun.headline === 'Boş gün · iş yok, acele yok' && find(sun.segments, 'prep')!.from === 480 && find(sun.segments, 'lunch')!.from === 780 && find(sun.segments, 'dinner')!.from === 1170 && !sun.segments.some((s) => s.kind === 'WORK' || s.kind === 'COMMUTE') && noOverlap(sun.segments));
  check('"Haftaya bakış" yalnızca Pazar günü', !!find(sun.segments, 'week') && !find(sat.segments, 'week') && !find(w.segments, 'week'));
  check('Pazar yürüyüşü daha uzun (45 dk)', (() => { const m = find(sun.segments, 'move'); return !!m && m.to - m.from === 45; })());

  console.log('İşler');
  const blocks: GuideBlock[] = [
    { taskId: 'a', title: 'Rapor', from: 19 * 60 + 30, to: 20 * 60 + 30 },
    { taskId: 'b', title: 'Mail', from: 10 * 60, to: 10 * 60 + 30 },
  ];
  const wb = buildGuide(base(16, { blocks }));
  check('iş vaktine düşen iş İş parçasının notunda, ayrı parça değil', /iş vaktinde yapılabilenler: Mail/.test(find(wb.segments, 'work')!.note ?? '') && !wb.segments.some((s) => s.title === 'Mail'));
  check('akşam işi planlandığı saatte', (() => { const r = find(wb.segments, 'task-a'); return !!r && r.from === 19 * 60 + 30 && r.to === 20 * 60 + 30 && r.kind === 'TASK' && !r.fixed; })());
  const sb = buildGuide(base(22, { blocks }));
  check('Pazar: Mail 10:00\'da ayrı parça', (() => { const r = find(sb.segments, 'task-b'); return !!r && r.from === 600 && r.to === 630; })());
  const clash = buildGuide(base(16, { blocks: [{ taskId: 'c', title: 'Çakışan', from: 18 * 60 + 10, to: 19 * 60 }] }));
  check('yemekle çakışan iş yemekten sonraya kayar', (() => { const r = find(clash.segments, 'task-c'); return !!r && r.from >= 1150 && noOverlap(clash.segments); })(), JSON.stringify(clash.segments.map((s) => [s.title, hhmm(s.from)])));
  const many = buildGuide(base(16, { blocks: Array.from({ length: 6 }, (_, i) => ({ taskId: `m${i}`, title: `Büyük ${i}`, from: 19 * 60, to: 21 * 60 })) }));
  check('sığmayan işler "overflow"da ve çakışma olmaz', many.overflow.length >= 1 && noOverlap(many.segments), many.overflow.join());

  console.log('Öneriler');
  check('dil çalışması: kalan 20 dk, ilk uygun aralığa', (() => { const l = find(buildGuide(base(16, { language: lang(0) })).segments, 'language'); return !!l && l.to - l.from === 20 && /Duolingo\) · 20 dk/.test(l.title) && l.note === 'Bugün 0 / 20 dk'; })());
  check('dil hedefi tamamsa öneri yok; dil bilgisi yoksa da yok', !find(buildGuide(base(16, { language: lang(25) })).segments, 'language') && !find(buildGuide(base(16)).segments, 'language'));
  check('kalan az olsa da en az 10 dk', (() => { const l = find(buildGuide(base(16, { language: lang(15) })).segments, 'language'); return !!l && l.to - l.from === 10; })());
  check('hedef yoksa 15 dk varsayılır', (() => { const l = find(buildGuide(base(16, { language: lang(0, null) })).segments, 'language'); return !!l && l.to - l.from === 15; })());
  check('çok uzun kalan: iş gününde 30, boş günde 45 dk ile sınırlı', (() => { const a = find(buildGuide(base(16, { language: lang(0, 200) })).segments, 'language'); const b = find(buildGuide(base(22, { language: lang(0, 200) })).segments, 'language'); return !!a && !!b && a.to - a.from === 30 && b.to - b.from === 45; })());
  check('kısa yürüyüş akşam yemeğinden sonra', (() => { const m = find(w.segments, 'move'); return !!m && m.from >= 1150 && m.to - m.from === 25; })());
  check('boş aralıklar "Serbest zaman" olur', w.segments.some((s) => s.kind === 'FREE' && /Dinlen/.test(s.note ?? '')));

  console.log('Yatış saati');
  const late = buildGuide(base(16, { bedtimeMin: 24 * 60 + 30 }));
  check('gece yarısından sonra yatış gün sonuna (24:00) kısaltılır', find(late.segments, 'winddown')!.to === 1440 && noOverlap(late.segments));
  const early = buildGuide(base(16, { bedtimeMin: 22 * 60 }));
  check('erken yatışta gün sonu değerlendirmesi öne alınır, çakışma yok', find(early.segments, 'review')!.from === 22 * 60 - 30 - 20 && find(early.segments, 'winddown')!.to === 1320 && noOverlap(early.segments));

  console.log('Şimdi ve sıradaki');
  const g10 = guideNow(w.segments, 10 * 60);
  check('10:00: İş, 8 saat kaldı, sıradaki yol', g10.current?.id === 'work' && g10.leftMin === 480 && g10.next?.id === 'to-home');
  check('metin: "İş · 18:00\'e kadar" / "18:00 Yolda · eve"', guideLines(g10).now === "İş · 18:00'e kadar" && guideLines(g10).next === '18:00 Yolda · eve');
  const g23 = guideNow(w.segments, 23 * 60 + 30);
  check('gün bittiyse şimdi/sıradaki yok', g23.current === null && g23.next === null && guideLines(g23).now === 'Şu an plan dışı, serbestsin' && guideLines(g23).next === null);
  check('sabah erken: plan başlamadan sıradaki hazırlık', guideNow(w.segments, 5 * 60).next?.id === 'prep' && guideNow(w.segments, 5 * 60).current === null);

  console.log('Metinlerde yargı yok');
  const all = [...w.segments, ...sat.segments, ...sun.segments, ...buildGuide(base(16, { language: lang(0) })).segments];
  check('başlık, not ve başlıklar', all.every((s) => !hasBannedWords(s.title) && !hasBannedWords(s.note ?? '')) && !hasBannedWords(w.headline) && !hasBannedWords(sun.headline));

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  await ensureWorkSeed(db);
  await createTask(db, { title: 'Fatura öde', estimatedDuration: 30, cognitiveWeight: 'LOW' });
  await createTask(db, { title: 'Rapor yaz', estimatedDuration: 60, cognitiveWeight: 'HIGH' });
  await replanDay(db, at(6, 0), 'MANUAL');
  let g = await loadGuide(db, at(20, 0), { bedtimeMin: null });
  const tasksSeg = g.result.segments.filter((s) => s.kind === 'TASK');
  check('planlayıcı işleri akşam aralıklarında görünür, çakışma yok', tasksSeg.length >= 1 && g.result.kind === 'WORK' && noOverlap(g.result.segments) && tasksSeg.every((s) => s.from >= 1105), JSON.stringify(g.result.segments.map((s) => [s.title, hhmm(s.from), hhmm(s.to)])));
  check('şimdi dakikası gün başından', g.nowMin === 20 * 60);
  await addStudy(db, 'PAPER', 20, at(20, 5));
  g = await loadGuide(db, at(20, 10), { bedtimeMin: null });
  check('dil hedefi tamamsa öneri çıkmaz (elle kayıt sayılır)', !g.result.segments.some((s) => s.kind === 'LANGUAGE'));
  for (const [day, h, m] of [[10, 6, 30], [11, 6, 30], [12, 6, 40]] as const) await addDayEvent(db, `2026-11-${day}`, 'WAKE', at(h, m, day));
  g = await loadGuide(db, at(20, 0), { bedtimeMin: null });
  check('tipik uyanış damgalardan okunur (06:30)', g.result.segments.find((s) => s.id === 'prep')!.from === 6 * 60 + 30, String(g.result.segments.find((s) => s.id === 'prep')?.from));
  const sunG = await loadGuide(db, at(9, 0, 22), { bedtimeMin: null });
  check('Pazar: boş gün çizelgesi, iş hafta içi uyanışından etkilenmez (08:00)', sunG.result.kind === 'FREE' && sunG.result.segments.find((s) => s.id === 'prep')!.from === 480);
  const satG = await loadGuide(db, at(12, 0, 21), { bedtimeMin: null });
  check('Cumartesi 12:00: şimdi İş (13:30\'a kadar)', guideNow(satG.result.segments, satG.nowMin).current?.id === 'work' && guideNow(satG.result.segments, satG.nowMin).leftMin === 90);
}

main()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.stack : e));
    process.exit(1);
  });
