/**
 * Rutinleri belirli günlere bağlama testi (Pazar'a özel, hafta içi, seri, hatırlatma, haftalık özet, takvim, gün sonu).
 * Çalıştırmak için:  npm run test:days
 */
import { addRoutineLog, createRoutine, listRoutines, updateRoutine } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import type { Routine, RoutineLog } from '../database/types';
import { gatherDayFacts } from '../services/dayReview';
import { buildMonth } from '../services/habitCalendarLogic';
import { buildMorningBrief, type MorningFacts } from '../services/morningLogic';
import { DAYS_PRESETS, daysLabel, isRoutineDay, nextRoutineDay, parseDays, routineDaysLabel, serializeDays } from '../services/routineDaysLogic';
import { addRoutineFromTemplate, addRoutinePack } from '../services/routineFlow';
import { buildRoutineBrief, computeRoutineStats, dueBriefs, routineDayState, todayProgress } from '../services/routineLogic';
import { planReminders } from '../services/routineRemindersLogic';
import { ROUTINE_PACKS, ROUTINE_TEMPLATES } from '../services/routineTemplates';
import { loadRoutineBriefs } from '../services/routineBriefs';
import { totalsOf, type WeekDay, type WeekRoutineInput } from '../services/weeklyLogic';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// 2026-11-16 Pazartesi, 15 Pazar, 22 Pazar, 21 Cumartesi
const at = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  title: 'Haftayı planla',
  category: 'ODAK',
  estimatedDuration: 20,
  cognitiveWeight: 'MEDIUM',
  askHour: 10,
  askMinute: 0,
  status: 'ACTIVE',
  createdAt: new Date(2026, 9, 1).toISOString(),
  retiredAt: null,
  templateId: null,
  icon: null,
  color: null,
  days: null,
  ...over,
});
let seq = 0;
const done = (routineId: string, d: number): RoutineLog => ({
  id: `l${(seq += 1)}`,
  routineId,
  day: day(d),
  outcome: 'DONE',
  taskId: null,
  snoozeUntil: null,
  loggedAt: new Date(2026, 10, d, 11).toISOString(),
});

async function main(): Promise<void> {
  console.log('Gün metni');
  check('ayrıştırma: sıralı, tekrarsız', JSON.stringify(parseDays('5, 1,1,3')) === '[1,3,5]');
  check('boş, bozuk ya da null: her gün', parseDays(null) === null && parseDays('') === null && parseDays('x,y') === null && parseDays('9,-1') === null);
  check('yedi günün hepsi: her gün', parseDays('0,1,2,3,4,5,6') === null && serializeDays([0, 1, 2, 3, 4, 5, 6]) === null);
  check('geçersiz günler atılır', JSON.stringify(parseDays('1,9,2')) === '[1,2]');
  check('serileştirme sıralar', serializeDays([5, 1]) === '1,5' && serializeDays([]) === null && serializeDays(null) === null);
  check('etiketler', daysLabel(null) === 'Her gün' && daysLabel([1, 2, 3, 4, 5]) === 'Hafta içi' && daysLabel([0]) === 'Pazar' && daysLabel([6, 0]) === 'Hafta sonu' && daysLabel([1, 2, 3, 4, 5, 6]) === 'İş günleri (Pzt–Cmt)');
  check('özel günler Pzt\'den başlayıp Paz\'a doğru yazılır', daysLabel([0, 3, 1]) === 'Pzt, Çar, Paz');
  check('hazır seçimlerin etiketi kendini bulur', DAYS_PRESETS.every((p) => daysLabel(p.days).length > 0));
  check('rutin etiketi', routineDaysLabel(routine({ days: '0' })) === 'Pazar' && routineDaysLabel(routine()) === 'Her gün');
  check('isRoutineDay: Pazar rutini Pazartesi yapılmaz', !isRoutineDay(routine({ days: '0' }), at(16)) && isRoutineDay(routine({ days: '0' }), at(15)) && isRoutineDay(routine(), at(16)));
  check('sonraki gün: Pazar rutini Pazartesi\'den bakınca 22 Kasım', nextRoutineDay(routine({ days: '0' }), at(16))?.getDate() === 22 && nextRoutineDay(routine(), at(16))?.getDate() === 17);

  console.log('Bugünkü durum');
  const sunday = routine({ days: '0' });
  check('planlı olmayan günde durum OFF', routineDayState(sunday, [], () => null, at(16, 12)).state === 'OFF');
  check('planlı günde saatten önce WAITING, sonra DUE', routineDayState(sunday, [], () => null, at(15, 8)).state === 'WAITING' && routineDayState(sunday, [], () => null, at(15, 11)).state === 'DUE');
  check('planlı olmayan günde yapıldıysa DONE kalır', routineDayState(sunday, [done('r1', 16)], () => null, at(16, 12)).state === 'DONE');
  const every = buildRoutineBrief(routine({ id: 'e' }), [], () => null, at(16, 12));
  const sun = buildRoutineBrief(sunday, [], () => null, at(16, 12));
  check('özet: OFF olan sayıma girmez', todayProgress([every, sun]).open === 1 && todayProgress([every, sun]).done === 0);
  check('sorulacaklar listesine girmez', dueBriefs([every, sun]).length === 1 && dueBriefs([every, sun])[0].routine.id === 'e');
  check('Pazar günü Pazar rutini sorulur', dueBriefs([buildRoutineBrief(sunday, [], () => null, at(15, 12))]).length === 1);

  console.log('Seri');
  const weekly = routine({ days: '0' });
  const logsSun = [done('r1', 1), done('r1', 8), done('r1', 15)];
  check('haftalık rutin: üst üste 3 Pazar = seri 3', computeRoutineStats(weekly, logsSun, at(16, 12), 14).streak === 3);
  check('bir Pazar atlanırsa seri o Pazar\'da kesilir', computeRoutineStats(weekly, [done('r1', 1), done('r1', 15)], at(16, 12), 14).streak === 1);
  check('Pazar günü henüz yapılmadıysa seri bozulmaz', computeRoutineStats(weekly, [done('r1', 1), done('r1', 8)], at(15, 9), 14).streak === 2);
  const wk = routine({ days: '1,2,3,4,5' });
  const weekdayLogs = [9, 10, 11, 12, 13].map((d) => done('r1', d));
  check('hafta içi rutin: hafta sonu seriyi bozmaz', computeRoutineStats(wk, weekdayLogs, at(16, 9), 14).streak === 5);
  check('hafta içi rutin: ortada kaçan gün seriyi keser', computeRoutineStats(wk, [done('r1', 9), done('r1', 10), done('r1', 12), done('r1', 13)], at(16, 9), 14).streak === 2);
  check('her gün rutini: hafta sonu kaçırıldıysa seri kesilir', computeRoutineStats(routine(), weekdayLogs, at(16, 9), 14).streak === 0);
  check('planlı olmayan günde yapılan da seriye eklenir', computeRoutineStats(wk, [done('r1', 14), done('r1', 13), done('r1', 12)], at(16, 9), 14).streak === 3);

  console.log('Hatırlatma');
  // Gün sonu ve su gibi rutin dışı hatırlatmalar süzülür; yalnızca rutinin kendi bildirimleri sayılır
  const own = (list: ReturnType<typeof planReminders>, id: string) => list.filter((r) => r.id.startsWith(`rtn-${id}-`));
  const sunBrief = buildRoutineBrief(sunday, [], () => null, at(19, 8));
  const rem = own(planReminders([sunBrief], at(19, 8), 5), 'r1');
  check('Pazar rutini için 5 günde yalnızca Pazar bildirimi', rem.length === 1 && rem[0].at.getDate() === 22 && rem[0].at.getDay() === 0);
  const dailyBrief = buildRoutineBrief(routine({ id: 'd' }), [], () => null, at(19, 8));
  check('her gün rutini için beş bildirim', own(planReminders([dailyBrief], at(19, 8), 5), 'd').length === 5);
  const noRem = own(planReminders([buildRoutineBrief(sunday, [], () => null, at(16, 8))], at(16, 8), 5), 'r1');
  check('Pazartesi\'den 5 gün bakınca hiç bildirim yok', noRem.length === 0);
  const wkRem = own(planReminders([buildRoutineBrief(wk, [], () => null, at(20, 6))], at(20, 6), 5), 'r1');
  check('Pazartesi-Cuma rutini hafta sonu bildirim almaz', wkRem.length === 3 && wkRem.every((r) => r.at.getDay() >= 1 && r.at.getDay() <= 5));

  console.log('Haftalık özet');
  const week = (from: number): WeekDay[] =>
    Array.from({ length: 7 }, (_, i) => ({
      day: day(from + i), tasksDone: 0, taskMinutes: 0, routinesDone: 0, steps: null, screenMinutes: null, sleepMinutes: null, hardDay: false,
    }));
  const mk = (days: number[] | null, doneDays: string[]): WeekRoutineInput => ({ title: 'R', createdDay: '2026-10-01', doneDays, days });
  const tw = totalsOf(week(9), [mk([0], [day(15)])], true);
  check('Pazar rutini bir haftada tek şans', tw.routineChances === 1 && tw.routinesDone === 1);
  const tw2 = totalsOf(week(9), [mk([0], [])], true);
  check('yapılmadıysa 0/1 (6 gün şansa girmez)', tw2.routineChances === 1 && tw2.routinesDone === 0);
  const tw3 = totalsOf(week(9), [mk(null, [])], true);
  check('her gün rutini yedi şans', tw3.routineChances === 7);
  const tw4 = totalsOf(week(9), [mk([1, 2, 3, 4, 5], [day(14)])], true);
  check('planlı olmayan günde yapılırsa şansa da katılır', tw4.routineChances === 6 && tw4.routinesDone === 1);

  console.log('Takvim');
  const rs = [routine({ id: 'd', title: 'Her gün' }), routine({ id: 's', title: 'Pazar', days: '0' })];
  const m = buildMonth('2026-11', rs, [done('d', 16), done('d', 15), done('s', 15)], [], at(17, 9));
  const cells = m.weeks.flat().filter(Boolean) as NonNullable<(typeof m.weeks)[number][number]>[];
  const mon = cells.find((c) => c.day === day(16))!;
  const sundayCell = cells.find((c) => c.day === day(15))!;
  check('Pazartesi: toplam 1, bir yapıldı, tam koyu', mon.total === 1 && mon.done === 1 && mon.level === 4);
  check('Pazar: toplam 2, ikisi de yapıldı, tam koyu', sundayCell.total === 2 && sundayCell.done === 2 && sundayCell.level === 4);
  check('Pazar rutini yapılmadıysa Pazar yarım koyu', buildMonth('2026-11', rs, [done('d', 22)], [], at(25, 9)).weeks.flat().find((c) => c?.day === day(22))!.level === 2);
  const offDay = buildMonth('2026-11', [routine({ id: 's', days: '0' })], [done('s', 16)], [], at(17, 9)).weeks.flat().find((c) => c?.day === day(16))!;
  check('planlı olmayan günde yapılan en az bir kez sayılır', offDay.done === 1 && offDay.total === 1 && offDay.level === 4);

  console.log('Sabah brifingi');
  const mf: MorningFacts = { day: day(16), hour: 8, tasks: [], doneTaskCount: 0, peakStartHour: 9, peakEndHour: 12, routines: [{ title: 'A', time: '09:00', state: 'DUE' }, { title: 'Pazar', time: '10:00', state: 'OFF' }], note: null, sleepMinutes: null, hardDay: false };
  const mb = buildMorningBrief(mf);
  check('sabah brifingi: planlı olmayan rutin listelenmez', mb.routinesOpen.length === 1 && mb.routinesOpen[0].title === 'A');

  console.log('Veritabanı');
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('Routine tablosunda days sütunu var', (raw.prepare('PRAGMA table_info(Routine)').all() as { name: string }[]).some((c) => c.name === 'days'));
  const a = await createRoutine(db, { title: 'Pazar işi', category: 'DUZEN', estimatedDuration: 30, cognitiveWeight: 'LOW', askHour: 11, days: '5,0' });
  check('günler sıralanıp kaydedilir', a.days === '0,5');
  const b = await createRoutine(db, { title: 'Her gün', category: 'DUZEN', estimatedDuration: 30, cognitiveWeight: 'LOW', askHour: 11, days: '0,1,2,3,4,5,6' });
  const c = await createRoutine(db, { title: 'Bozuk', category: 'DUZEN', estimatedDuration: 30, cognitiveWeight: 'LOW', askHour: 11, days: 'abc' });
  check('yedi gün ve bozuk metin her güne döner', b.days === null && c.days === null);
  await updateRoutine(db, b.id, { days: '6,0' });
  check('düzenleme günleri günceller', (await listRoutines(db, 'ACTIVE')).find((r) => r.id === b.id)?.days === '0,6');
  await updateRoutine(db, b.id, { title: 'Her gün!' });
  check('başka alan düzenlenirse günler korunur', (await listRoutines(db, 'ACTIVE')).find((r) => r.id === b.id)?.days === '0,6');
  await updateRoutine(db, b.id, { days: null });
  check('günler temizlenebilir', (await listRoutines(db, 'ACTIVE')).find((r) => r.id === b.id)?.days === null);

  console.log('Şablon ve paketler');
  const sundayTemplates = ROUTINE_TEMPLATES.filter((t) => t.days?.length === 1 && t.days[0] === 0);
  check('dört Pazar şablonu', sundayTemplates.length === 4);
  check('yolda şablonları Pzt–Cmt', ROUTINE_TEMPLATES.filter((t) => t.id.startsWith('yolda-')).every((t) => t.days?.join() === '1,2,3,4,5,6'));
  check('şablon günleri geçerli', ROUTINE_TEMPLATES.every((t) => !t.days || (t.days.length > 0 && t.days.every((d) => d >= 0 && d <= 6))));
  const added = await addRoutineFromTemplate(db, 'pazar-plan');
  check('şablondan eklenince günler gelir', added.days === '0');
  const pack = await addRoutinePack(db, 'pazar');
  const all = await listRoutines(db, 'ACTIVE');
  check('Pazar paketi 3 yeni rutin ekler (biri zaten vardı)', pack.added === 3 && pack.skipped === 1);
  check('Pazar paketindeki hepsi yalnız Pazar', all.filter((r) => r.templateId?.startsWith('pazar-')).length === 4 && all.filter((r) => r.templateId?.startsWith('pazar-')).every((r) => r.days === '0'));
  const yolda = await addRoutinePack(db, 'yolda');
  check('yolda paketinde yolculuk rutinleri Pzt–Cmt, diğerleri her gün', yolda.added === 4 && (await listRoutines(db, 'ACTIVE')).find((r) => r.templateId === 'yolda-dil')?.days === '1,2,3,4,5,6' && (await listRoutines(db, 'ACTIVE')).find((r) => r.templateId === 'egzersiz')?.days === null);
  check('altı paket, Pazar paketi var', ROUTINE_PACKS.length === 6 && ROUTINE_PACKS.some((p) => p.id === 'pazar'));

  console.log('Canlı özet ve gün sonu');
  const briefsMon = await loadRoutineBriefs(db, at(16, 12));
  check('Pazartesi: Pazar rutinleri OFF', briefsMon.filter((x) => x.routine.templateId?.startsWith('pazar-')).every((x) => x.state === 'OFF'));
  check('Pazartesi: her gün rutinleri OFF değil', briefsMon.filter((x) => x.routine.id === a.id).length === 1 && briefsMon.find((x) => x.routine.id === a.id)!.state === 'OFF' && briefsMon.find((x) => x.routine.templateId === 'egzersiz')!.state !== 'OFF');
  const briefsSun = await loadRoutineBriefs(db, at(22, 12));
  check('Pazar: Pazar rutinleri sorulabilir', briefsSun.filter((x) => x.routine.templateId === 'pazar-plan')[0].state === 'DUE');
  await addRoutineLog(db, { routineId: added.id, day: day(15), outcome: 'DONE', loggedAt: at(15, 11) });
  const factsSun = await gatherDayFacts(db, at(15, 22));
  check('gün sonu (Pazar): yapılan Pazar rutini listelenir', factsSun.routinesDone.includes('Pazar: haftayı planla'));
  const factsMon = await gatherDayFacts(db, at(16, 22));
  check('gün sonu (Pazartesi): Pazar rutinleri açık kalan sayılmaz', !factsMon.routinesOpen.some((t) => t.startsWith('Pazar')) && factsMon.routinesOpen.length > 0);
  check('günler bir yedeğe girer (Routine sütunu)', (raw.prepare("SELECT days FROM Routine WHERE id = ?").get(added.id) as { days: string }).days === '0');

  console.log(`\nTüm kontroller geçti (${passed}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
