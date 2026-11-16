/**
 * Aylık karne testi (toplamlar, seri, ruh hali, seviye, önceki ayla yumuşak karşılaştırma).
 * Çalıştırmak için:  npm run test:monthly
 */
import { createRoutine, setMoodLog } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import type { HistoryDay } from '../services/historyLogic';
import { addStudy } from '../services/language';
import { loadMonthly } from '../services/monthly';
import { buildMonthReport, compareMonths, compareSentence, dayLabel, highlights } from '../services/monthlyLogic';
import { markRoutineDoneOnDay } from '../services/routineFlow';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h, 0, 0, 0);
const dk = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const goals = { waterGoalMl: 2000, languageGoalMin: 20 };

function hd(day: string, over: Partial<HistoryDay> = {}): HistoryDay {
  return {
    day, taskMinutes: 0, tasksDone: 0, routinesDone: 0, waterMl: null, kcal: null, smoke: null, screenMinutes: null,
    steps: null, sleepMinutes: null, wakeMin: null, shopMinutes: null, commuteMinutes: null, languageMinutes: null, ...over,
  };
}

async function main(): Promise<void> {
  console.log('Toplamlar');
  const days: HistoryDay[] = [
    hd(dk(10, 31), { tasksDone: 5, routinesDone: 3 }), // önceki ay (Ekim)
    hd(dk(11, 2), { tasksDone: 2, taskMinutes: 60, routinesDone: 1, steps: 6000, sleepMinutes: 420 }),
    hd(dk(11, 3), { routinesDone: 2, languageMinutes: 25, waterMl: 2200, steps: 8000, sleepMinutes: 480 }),
    hd(dk(11, 4), { routinesDone: 1 }),
    hd(dk(11, 6), { tasksDone: 4, taskMinutes: 120, routinesDone: 4 }),
    hd(dk(11, 7), { routinesDone: 1 }),
    hd(dk(11, 20), { tasksDone: 9 }), // gelecek (bugünden sonra), sayılmamalı
  ];
  const moods = [
    { day: dk(11, 2), mood: 4, note: null, updatedAt: '' },
    { day: dk(11, 3), mood: 4, note: null, updatedAt: '' },
    { day: dk(11, 4), mood: 2, note: null, updatedAt: '' },
    { day: dk(10, 30), mood: 5, note: null, updatedAt: '' },
  ] as const;
  const NOW = at(11, 10);
  const r = buildMonthReport('2026-11', days, [...moods], goals, NOW);
  check('geçmiş ayın ilk 10 günü: Ekim 31 hariç', buildMonthReport('2026-10', days, [...moods], goals, NOW, 10).tasksDone === 0);
  check('süren ay: 10 gün sayılır, 30 günlük', r.isCurrent && r.elapsedDays === 10 && r.totalDays === 30);
  check('iş / rutin toplamı (bugünden sonrası hariç)', r.tasksDone === 6 && r.routinesDone === 9 && r.taskMinutes === 180);
  check('etkin gün 5, rutin günü 5', r.activeDays === 5 && r.routineDays === 5);
  check('en uzun rutin serisi: 2-3-4 ardışık = 3', r.bestStreak === 3);
  check('dil: 25 dk, 1 gün', r.languageMinutes === 25 && r.languageDays === 1);
  check('ruh hali: bu ay 3 kayıt, ortalama 3.33', r.moodCount === 3 && Math.abs((r.moodAvg ?? 0) - 10 / 3) < 1e-9);
  check('ruh hali dağılımı', r.moodDist.join() === '0,1,0,2,0');
  check('en sık ruh hali İyi (2 gün)', r.moodTop?.info.label === 'İyi' && r.moodTop.count === 2);
  check('uyku / adım ortalaması yalnızca verisi olan günlerden', r.sleepAvgMin === 450 && r.stepsAvg === 7000 && r.waterAvgMl === 2200);
  check('en dolu gün 6 Kasım (4 iş + 4 rutin)', r.bestDay?.day === dk(11, 6) && r.bestDay.tasks === 4 && r.bestDay.routines === 4);
  check('XP ve seviye türetilir', r.xp > 0 && r.level >= 1);
  const full = buildMonthReport('2026-11', days, [...moods], goals, NOW, 3);
  check('ilk 3 gün sınırı', full.elapsedDays === 3 && full.tasksDone === 2 && full.routinesDone === 3);
  const future = buildMonthReport('2026-12', days, [...moods], goals, NOW);
  check('gelecek ay: 0 gün, veri yok', future.elapsedDays === 0 && !future.hasData && highlights(future)[0] === 'Bu ay henüz başlamadı.');
  const oct = buildMonthReport('2026-10', days, [...moods], goals, NOW);
  check('geçmiş ay tam sayılır', !oct.isCurrent && oct.elapsedDays === 31 && oct.tasksDone === 5 && oct.moodCount === 1);
  check('seviye ay sonuna kadar birikir (Kasım ≥ Ekim)', r.level >= oct.level);

  console.log('Karşılaştırma ve cümleler');
  const rows = compareMonths(r, oct);
  check('satırlar: ikisi de sıfırsa gösterilmez', !rows.some((x) => x.cur === 0 && x.prev === 0));
  const act = rows.find((x) => x.id === 'activeDays')!;
  check('etkin gün 1 → 5 yükseliş', act.prev === 1 && act.cur === 5 && act.direction === 'UP' && act.text === '1 → 5');
  check('dil satırı süre biçiminde', rows.find((x) => x.id === 'languageMinutes')!.text === '0 dk → 25 dk');
  check('yükseliş cümlesi', (compareSentence(rows, r) ?? '').includes('arttı') && (compareSentence(rows, r) ?? '').includes('aynı günlerine'));
  const busyOct = [hd(dk(10, 3), { tasksDone: 2 }), hd(dk(10, 4), { routinesDone: 2 }), hd(dk(10, 9), { tasksDone: 1 }), hd(dk(11, 2), { tasksDone: 1 })];
  const quiet = buildMonthReport('2026-11', busyOct, [], goals, NOW);
  const down = compareMonths(quiet, buildMonthReport('2026-10', busyOct, [], goals, NOW, 10));
  check('düşüş satırı yönü DOWN', down.find((x) => x.id === 'activeDays')?.direction === 'DOWN');
  const downSentence = compareSentence(down, quiet) ?? '';
  check('düşüş yargısız ve nazik', downSentence.includes('sakin') && !/kötü|başarısız|boşa|yetersiz/i.test(downSentence));
  check('önceki ay yoksa karşılaştırma yok', compareMonths(r, null).length === 0);
  const lines = highlights(r, rows);
  check('öne çıkanlar: rutin, dil, ruh hali, en dolu gün, kıyas', lines.length === 5 && lines[0].includes('5 gün rutin') && lines[0].includes('en uzun serin 3'));
  check('ruh hali cümlesi ortalama içerir', lines.some((l) => l.includes('"İyi"') && l.includes('3,3/5')));
  check('en dolu gün cümlesi', lines.some((l) => l.includes('6 Kasım') && l.includes('4 iş, 4 rutin')));
  const low = buildMonthReport('2026-11', [hd(dk(11, 2), { routinesDone: 1 })], [{ day: dk(11, 2), mood: 1, note: null, updatedAt: '' }, { day: dk(11, 3), mood: 2, note: null, updatedAt: '' }] as never, goals, NOW);
  check('düşük ruh halinde cümle yumuşak, etiket sayılmaz', highlights(low).some((l) => l.includes('kendine bakmanın')) && !highlights(low).some((l) => l.includes('Çok zor')));
  check('veri yoksa nazik davet', highlights(buildMonthReport('2026-11', [], [], goals, NOW))[0].includes('her zaman uygun bir gün'));
  check('gün etiketi', dayLabel('2026-11-06') === '6 Kasım' && dayLabel('2026-01-15') === '15 Ocak');

  console.log('Veritabanından');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const walk = await createRoutine(db, { title: 'Yürüyüş', category: 'SAGLIK', estimatedDuration: 20, cognitiveWeight: 'LOW', askHour: 18, askMinute: 0 });
  for (const d of [3, 4, 5, 8]) await markRoutineDoneOnDay(db, walk, dk(11, d), NOW);
  for (const d of [5, 6, 28]) await markRoutineDoneOnDay(db, walk, dk(10, d), NOW);
  await setMoodLog(db, dk(11, 4), 4, at(11, 4));
  await addStudy(db, 'PAPER', 30, at(11, 5, 9));
  const data = await loadMonthly(db, '2026-11', at(11, 10), goals);
  check('Kasım: 4 rutin günü, en uzun seri 3', data.report.routineDays === 4 && data.report.bestStreak === 3, JSON.stringify(data.report));
  check('Kasım: dil 30 dk, ruh hali 1', data.report.languageMinutes === 30 && data.report.moodCount === 1);
  check('önceki ay verisi var → karşılaştırma satırları', data.prev !== null && data.rows.length > 0 && data.prev.routineDays === 2 && data.prev.elapsedDays === 10);
  check('en eski ay: Ekim', data.earliestMonth === '2026-10');
  const empty = await loadMonthly(db, '2026-09', at(11, 10), goals);
  check('veri olmayan ay: karşılaştırma yok, nazik cümle', empty.prev === null && empty.rows.length === 0 && empty.lines[0].includes('henüz kayıt yok'));

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
