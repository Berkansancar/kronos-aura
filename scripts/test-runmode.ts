/**
 * Rutin modu testi (sıra, bölümler, Yaptım/Atla/Sonra akışı, sayaç, kayıtlar).
 * Çalıştırmak için:  npm run test:runmode
 */
import { createRoutine, listRoutineLogsSince } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { acceptRoutine } from '../services/routineFlow';
import { applyRunAnswer, finishRun, loadRunBriefs } from '../services/routineMode';
import {
  availableSegments,
  buildRun,
  defaultSegment,
  formatTimer,
  newTimer,
  remainingMinutes,
  runAnswer,
  runCurrent,
  runFinished,
  runProgress,
  runSummary,
  startRun,
  timerElapsedMs,
  timerRemainingSec,
  timerToggle,
} from '../services/routineModeLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const at = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

async function main(): Promise<void> {
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const mk = (title: string, hour: number, minute = 0, days: string | null = null, dur = 10) =>
    createRoutine(db, { title, category: 'SAGLIK', estimatedDuration: dur, cognitiveWeight: 'LOW', askHour: hour, askMinute: minute, days });
  const water = await mk('Su iç', 7, 45, null, 5);
  const stretch = await mk('Esneme', 7, 50, null, 8);
  const read = await mk('Kitap', 21, 0, null, 20);
  const walk = await mk('Yürüyüş', 18, 30, null, 15);
  const sunday = await mk('Pazar planı', 10, 0, '0', 15);
  const noon = await mk('Öğle molası', 13, 0, null, 5);

  const MON = at(16, 7, 30); // Pazartesi sabahı

  console.log('Çalıştırma sırası ve bölümler');
  let briefs = await loadRunBriefs(db, MON);
  const all = buildRun(briefs, 'ALL');
  check('Pazar rutini Pazartesi listede yok', !all.some((s) => s.routineId === sunday.id));
  check('sorulma saatine göre sıralı', all.map((s) => s.title).join() === 'Su iç,Esneme,Öğle molası,Yürüyüş,Kitap');
  check('sabah bölümü: öğleden önceki', buildRun(briefs, 'MORNING').map((s) => s.title).join() === 'Su iç,Esneme');
  check('akşam bölümü: 17:00 ve sonrası', buildRun(briefs, 'EVENING').map((s) => s.title).join() === 'Yürüyüş,Kitap');
  const segs = availableSegments(briefs);
  check('seçilebilir bölümler: sabah, akşam, hepsi', segs.map((s) => s.segment).join() === 'MORNING,EVENING,ALL');
  check('bölüm süresi toplanır (sabah 5+8)', segs.find((s) => s.segment === 'MORNING')!.minutes === 13);
  check('varsayılan bölüm sabahta Sabah', defaultSegment(briefs, at(16, 7, 30)) === 'MORNING');
  check('varsayılan bölüm akşamda Akşam', defaultSegment(briefs, at(16, 19, 0)) === 'EVENING');
  check('varsayılan bölüm öğlen Hepsi', defaultSegment(briefs, at(16, 13, 0)) === 'ALL');
  const sunBriefs = await loadRunBriefs(db, at(15, 9));
  check('Pazar günü Pazar rutini listede', buildRun(sunBriefs, 'ALL').some((s) => s.routineId === sunday.id));

  console.log('Akış: Yaptım / Atla / Sonra');
  let run = startRun(buildRun(briefs, 'MORNING'));
  check('ilk adım Su iç', runCurrent(run)?.title === 'Su iç' && runProgress(run).position === 1 && runProgress(run).total === 2);
  check('kalan süre 13 dk', remainingMinutes(run) === 13);
  run = runAnswer(run, 'LATER');
  check('"Sonra" adımı sona alır', run.queue.length === 3 && runCurrent(run)?.title === 'Esneme' && run.deferred.length === 1);
  run = runAnswer(run, 'DONE');
  check('Yaptım kaydı', run.done.join() === stretch.id);
  run = runAnswer(run, 'LATER');
  check('ikinci "Sonra" açık bırakır (tur uzamaz)', runFinished(run) && run.left.join() === water.id && run.queue.length === 3);
  check('bitmiş turda cevap etkisiz', runAnswer(run, 'DONE') === run);
  check('özet cümlesi', runSummary(run) === '1 rutini tamamladın, 1 rutin açık kaldı. Küçük adımlar birikiyor.');
  check('hiç dokunulmadıysa nazik özet', runSummary(startRun([])).includes('sorun değil'));
  check('sadece atlandıysa suçlayıcı değil', runSummary(runAnswer(startRun(buildRun(briefs, 'MORNING')), 'SKIP')).includes('yarın yeniden sorulur'));
  check('ilerleme oranı', runProgress(runAnswer(startRun(buildRun(briefs, 'MORNING')), 'DONE')).ratio === 0.5);

  console.log('Kayıtlar');
  check('Yaptım DONE yazar', (await applyRunAnswer(db, stretch.id, 'DONE', MON)) === true);
  check('Atla SKIPPED yazar', (await applyRunAnswer(db, water.id, 'SKIP', MON)) === true);
  check('Sonra hiçbir şey yazmaz', (await applyRunAnswer(db, walk.id, 'LATER', MON)) === true && !(await listRoutineLogsSince(db, day(16))).some((l) => l.routineId === walk.id));
  const logs = await listRoutineLogsSince(db, day(16));
  check('kayıtlar doğru', logs.some((l) => l.routineId === stretch.id && l.outcome === 'DONE') && logs.some((l) => l.routineId === water.id && l.outcome === 'SKIPPED'));
  check('bilinmeyen rutin: false', (await applyRunAnswer(db, 'yok', 'DONE', MON)) === false);
  briefs = await loadRunBriefs(db, MON);
  check('yapılan ve atlanan sonraki turda yok', buildRun(briefs, 'ALL').map((s) => s.title).join() === 'Öğle molası,Yürüyüş,Kitap');
  check('bölüm yoksa gizlenir (sabah bitti)', !availableSegments(briefs).some((s) => s.segment === 'MORNING'));

  console.log('"Yapacağım" demiş rutin');
  await acceptRoutine(db, walk, at(16, 8));
  check('kabul edilmiş ama bitmemiş rutin da turda', buildRun(await loadRunBriefs(db, at(16, 9)), 'ALL').some((s) => s.routineId === walk.id));
  await applyRunAnswer(db, walk.id, 'DONE', at(16, 19));
  const after = await listRoutineLogsSince(db, day(16));
  check('rutin modundan Yaptım: görevi de kapatır', after.some((l) => l.routineId === walk.id && l.outcome === 'DONE' && l.taskId));

  console.log('Tur özeti');
  const out = await finishRun(db, [stretch.id, walk.id], at(16, 19, 5));
  check('bugün biten 2, planlı 5', out.done === 2 && out.planned === 5, JSON.stringify(out));
  check('seri en az 1', out.bestStreak >= 1);

  console.log('Sayaç');
  let t = newTimer();
  check('başlangıçta kalan tam süre', timerRemainingSec(t, 1_000_000, 8) === 480 && timerElapsedMs(t, 5) === 0);
  t = timerToggle(t, 1_000_000);
  check('çalışırken süre akar', timerElapsedMs(t, 1_030_000) === 30_000 && timerRemainingSec(t, 1_030_000, 8) === 450);
  t = timerToggle(t, 1_060_000);
  check('durdurunca birikir ve dondurulur', !t.running && timerElapsedMs(t, 9_999_999) === 60_000);
  t = timerToggle(t, 2_000_000);
  check('yeniden başlatınca kaldığı yerden', timerElapsedMs(t, 2_010_000) === 70_000);
  check('süre dolunca eksiye geçer, "+" ile gösterilir', formatTimer(timerRemainingSec(t, 2_000_000 + 8 * 60_000, 8)) === '+01:00');
  check('biçim: 04:07', formatTimer(247) === '04:07' && formatTimer(0) === '00:00' && formatTimer(-90) === '+01:30');

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
