/**
 * Uyku tahmini testi (saf mantık). Çalıştırmak için:  npm run test:sleep
 */
import type { SleepLog } from '../database/types';
import {
  analyzePattern,
  estimateSleep,
  formatClockIso,
  formatMinuteOfDay,
  sleepInsights,
  sleepWindow,
  suggestChronotype,
  summarizeSleep,
  toSleepLog,
  type ScreenSession,
} from '../services/sleepLogic';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const t = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const s = (on: number, off: number): ScreenSession => ({ on, off });

console.log('Pencere');
const w = sleepWindow(new Date(2026, 10, 16), new Date(2026, 10, 16, 20, 0));
check('pencere dünkü 18:00 ile bugünkü 16:00 arası', w.start === t(15, 18) && w.end === t(16, 16));
const early = sleepWindow(new Date(2026, 10, 16), new Date(2026, 10, 16, 9, 0));
check('pencere şimdiden ileri gitmez', early.end === t(16, 9));

console.log('Tahmin');
const normal = [
  s(t(15, 18, 30), t(15, 23, 40)),
  s(t(16, 7, 20), t(16, 7, 55)),
  s(t(16, 8, 30), t(16, 12, 0)),
];
const e1 = estimateSleep(normal);
check('yatış: son uzun kullanımın bitişi', e1?.bedtime === t(15, 23, 40));
check('kalkış: sabahki ilk uzun kullanım', e1?.wake === t(16, 7, 20));
check('süre dakika olarak', e1?.minutes === 460, String(e1?.minutes));

const withNoise = [
  s(t(15, 19, 0), t(15, 23, 30)),
  s(t(16, 3, 10), t(16, 3, 12)), // gece bildirim bakışı (2 dk)
  s(t(16, 6, 45), t(16, 8, 0)),
];
const e2 = estimateSleep(withNoise);
check('gece kısa bakışlar uykuyu bölmez', e2?.minutes === 435 && e2.wake === t(16, 6, 45), JSON.stringify(e2));

const longNight = [
  s(t(15, 19, 0), t(15, 22, 0)),
  s(t(15, 22, 40), t(16, 1, 30)), // uzun gece kullanımı
  s(t(16, 8, 0), t(16, 9, 0)),
];
const e3 = estimateSleep(longNight);
check('gece uzun kullanım yatış saatini kaydırır', e3?.bedtime === t(16, 1, 30) && e3.minutes === 390, JSON.stringify(e3));

check('çok kısa boşluk uyku sayılmaz', estimateSleep([s(t(16, 0, 0), t(16, 1, 0)), s(t(16, 3, 0), t(16, 4, 0))]) === null);
check('tek oturum: uyku yok', estimateSleep([s(t(15, 20), t(15, 23))]) === null);
check('boş liste: uyku yok', estimateSleep([]) === null);
check('bozuk veri yok sayılır', estimateSleep([s(NaN, 5), s(t(16, 1), t(15, 23))]) === null);

const daytime = [s(t(16, 8, 0), t(16, 9, 0)), s(t(16, 14, 0), t(16, 15, 0))];
check('gündüz boşta kalan telefon uyku sayılmaz', estimateSleep(daytime) === null);

const picksLongest = estimateSleep([
  s(t(15, 19, 0), t(15, 21, 0)),
  s(t(15, 21, 10), t(15, 23, 0)),
  s(t(16, 3, 0), t(16, 3, 30)), // 30 dk uyanıklık: gerçek oturum
  s(t(16, 7, 30), t(16, 8, 0)),
]);
check('en uzun boşluk seçilir', picksLongest?.minutes === 240 && picksLongest.bedtime === t(15, 23, 0), JSON.stringify(picksLongest));

const log = toSleepLog(e1!);
check('kayıt uyanılan güne yazılır', log.day === '2026-11-16' && log.durationMinutes === 460);

console.log('Biçim');
check('00:40', formatMinuteOfDay(40) === '00:40');
check('negatif dakika sarar', formatMinuteOfDay(-30) === '23:30');
check('formatClockIso yerel saat', formatClockIso(new Date(2026, 10, 16, 7, 5).toISOString()) === '07:05');

console.log('Özet ve kalıp');
const mk = (day: number, bedH: number, bedM: number, wakeH: number, wakeM: number): SleepLog => {
  const bed = new Date(2026, 10, bedH >= 18 ? day - 1 : day, bedH, bedM);
  const wake = new Date(2026, 10, day, wakeH, wakeM);
  return {
    day: `2026-11-${String(day).padStart(2, '0')}`,
    bedtime: bed.toISOString(),
    wakeTime: wake.toISOString(),
    durationMinutes: Math.round((wake.getTime() - bed.getTime()) / 60_000),
  };
};
const night = [
  mk(16, 1, 0, 9, 30),
  mk(15, 0, 30, 9, 0),
  mk(14, 1, 30, 10, 0),
  mk(13, 0, 45, 9, 15),
];
const sum = summarizeSleep(night, new Date(2026, 10, 16, 12, 0));
check('son gece bugün uyanılan gece', sum.lastMinutes === 510 && sum.nights === 4, JSON.stringify(sum));
check('ortalama en az 3 geceyle', sum.avgMinutes !== null);
check('2 gece: ortalama yok', summarizeSleep(night.slice(0, 2), new Date(2026, 10, 16)).avgMinutes === null);
check('eski veri son gece sayılmaz', summarizeSleep([mk(10, 23, 0, 7, 0)], new Date(2026, 10, 16)).lastMinutes === null);

const p = analyzePattern(night)!;
check('ortalama yatış gece yarısını doğru aşar', formatMinuteOfDay(p.avgBedMinute) >= '00:30' && formatMinuteOfDay(p.avgBedMinute) <= '01:15', formatMinuteOfDay(p.avgBedMinute));
check('ortalama kalkış ~09:26', p.avgWakeMinute >= 9 * 60 + 15 && p.avgWakeMinute <= 9 * 60 + 40, String(p.avgWakeMinute));
check('düzenli yatış: küçük sapma', p.bedSpread < 45, String(p.bedSpread));
check('geç yatıp geç kalkan: gececi', suggestChronotype(p) === 'NIGHT');
const early2 = analyzePattern([mk(16, 22, 0, 6, 0), mk(15, 22, 15, 6, 15), mk(14, 21, 45, 5, 50)])!;
check('erken yatıp kalkan: sabahçı', suggestChronotype(early2) === 'MORNING');
const mid = analyzePattern([mk(16, 23, 30, 7, 30), mk(15, 23, 15, 7, 15), mk(14, 23, 45, 7, 45)])!;
check('orta düzen: dengeli', suggestChronotype(mid) === 'BALANCED');
check('2 geceden az kalıp yok', analyzePattern(night.slice(0, 2)) === null);

const ins = sleepInsights(night, 'MORNING');
check('profille uyuşmazlık söylenir', ins.some((x) => x.includes('gececi') && x.includes('sabahçı')));
check('uyuşuyorsa söylenmez', !sleepInsights(night, 'NIGHT').some((x) => x.includes('profilinde')));
const irregular = sleepInsights([mk(16, 23, 0, 7, 0), mk(15, 1, 30, 9, 0), mk(14, 22, 0, 6, 30)], 'BALANCED');
check('düzensiz yatış belirtilir', irregular.some((x) => x.includes('oynuyor')));
const short = sleepInsights([mk(16, 1, 0, 6, 0), mk(15, 1, 30, 6, 30), mk(14, 1, 0, 6, 0)], 'NIGHT');
check('kısa uyku yargısız anlatılır', short.some((x) => x.includes('kısa')) && !short.some((x) => /(tembel|başarısız|disiplinsiz|yetersiz|boşa|kaybettin)/i.test(x)));
check('az veride bilgi mesajı', sleepInsights(night.slice(0, 1), 'NIGHT').length === 1);

console.log(`\nTüm kontroller geçti (${passed}).`);
