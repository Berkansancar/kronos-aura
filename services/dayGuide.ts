/** Gün rehberi: veriyi okur. Mantık: services/dayGuideLogic.ts (SecureStore yok; yatış saatini çağıran verir). */
import type { SQLiteDatabase } from 'expo-sqlite';
import { listDayBlocks, listDayEventsSince, listVisibleTasks } from '../database/repository';
import { dayKey } from './activityLogic';
import { loadTypicalCommute } from './commute';
import { buildGuide, type GuideBlock, type GuideResult } from './dayGuideLogic';
import { typicalWakeMinute } from './dayFlowLogic';
import { loadLanguageDay } from './language';
import { dayBounds, planningDay } from './planner';
import { getWork } from './workSettings';

export interface GuideData {
  result: GuideResult;
  /** Planlama gününün gece yarısından beri geçen dakika (yükleme anında) */
  nowMin: number;
  /** Planlama gününün gece yarısı (ms); ekran açıkken "şimdi" bundan hesaplanır */
  midnightMs: number;
}

export async function loadGuide(db: SQLiteDatabase, now: Date, opts: { bedtimeMin: number | null }): Promise<GuideData> {
  const day = planningDay(now);
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const minutesOf = (iso: string) => Math.round((new Date(iso).getTime() - midnight.getTime()) / 60_000);
  const { start, end } = dayBounds(day);

  const work = await getWork(db);
  // Tipik uyanış yalnızca aynı tür günlerden (iş günü / boş gün) alınır; Pazar uyanışı hafta içini bozmasın
  const since = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14));
  const todayIsWork = work.enabled && work.days.includes(day.getDay());
  const wakes = (await listDayEventsSince(db, since))
    .filter((e) => e.kind === 'WAKE')
    .filter((e) => {
      const [y, m, d] = e.day.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return todayIsWork === (work.enabled && work.days.includes(dow));
    })
    .map((e) => new Date(e.at));
  const tasks = new Map((await listVisibleTasks(db, start.toISOString())).filter((t) => t.status !== 'COMPLETED').map((t) => [t.id, t]));
  const blocks: GuideBlock[] = [];
  for (const b of await listDayBlocks(db, start, end)) {
    const t = tasks.get(b.taskId);
    if (!t) continue;
    blocks.push({ taskId: t.id, title: t.title, from: minutesOf(b.startTime), to: minutesOf(b.endTime) });
  }
  const lang = await loadLanguageDay(db, now).catch(() => null);
  const result = buildGuide({
    day,
    work,
    wakeMin: typicalWakeMinute(wakes),
    commuteMin: await loadTypicalCommute(db, now).catch(() => null),
    bedtimeMin: opts.bedtimeMin,
    blocks,
    language: lang ? { goalMin: lang.settings.goalMin, doneMin: lang.summary.total, appName: lang.settings.apps[0] } : null,
  });
  return { result, nowMin: Math.floor((now.getTime() - midnight.getTime()) / 60_000), midnightMs: midnight.getTime() };
}
