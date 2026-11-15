/**
 * Zamanlama motoru testi. Çalıştırmak için:  npm run test:scheduler
 * (Telefon, emülatör ya da veritabanı gerekmez.)
 */
import {
  buildSchedule,
  computeDurationFactors,
  reoptimize,
  type ScheduledBlock,
  type SchedulerTask,
  type SchedulerUser,
} from '../services/scheduler';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const MIN = 60_000;
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 16 + dayOffset, h, m, 0, 0);

const user: SchedulerUser = { chronotype: 'BALANCED', peakStartHour: 10, peakEndHour: 14 };

const task = (
  id: string,
  title: string,
  mins: number,
  w: SchedulerTask['cognitiveWeight'],
  status: SchedulerTask['status'] = 'PENDING'
): SchedulerTask => ({ id, title, estimatedDuration: mins, cognitiveWeight: w, status });

function print(label: string, blocks: ScheduledBlock[], titles: Map<string, string>) {
  console.log(`\n  ${label}`);
  for (const b of blocks) {
    console.log(
      `    ${hhmm(b.startTime)}-${hhmm(b.endTime)} (+${b.bufferTime}dk)  ` +
        `${(titles.get(b.taskId) ?? b.taskId).padEnd(22)} ${b.zone.padEnd(6)} ` +
        `e=${b.avgEnergy.toFixed(2)} ${b.chunkCount > 1 ? `[${b.chunkIndex + 1}/${b.chunkCount}]` : ''}` +
        `${b.locked ? ' (kilitli)' : ''}`
    );
  }
}

function assertNoOverlap(blocks: ScheduledBlock[], label: string) {
  const sorted = [...blocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const gap = (sorted[i].startTime.getTime() - prev.endTime.getTime()) / MIN;
    check(
      `${label}: bloklar çakışmıyor ve tampon korunuyor (#${i})`,
      gap >= prev.bufferTime,
      `boşluk=${gap}dk tampon=${prev.bufferTime}dk`
    );
  }
}

// ── 1) Temel yerleşim: ağır işler tepe saatlere, hafifler çukura ──
console.log('\n1) Temel günlük plan (dengeli kronotip, tepe 10-14)');
{
  const tasks = [
    task('a', 'Rapor yaz', 90, 'HIGH'),
    task('b', 'Strateji notu', 60, 'HIGH'),
    task('c', 'E-postalar', 45, 'MEDIUM'),
    task('d', 'Toplantı hazırlığı', 30, 'MEDIUM'),
    task('e', 'Fatura gir', 20, 'LOW'),
    task('f', 'Dosyaları düzenle', 15, 'LOW'),
  ];
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const res = buildSchedule({ now: at(8), user, tasks });
  print('Plan', res.blocks, titles);

  check('hepsi yerleşti', res.unscheduled.length === 0);
  check('6 görev = 6 blok', res.blocks.length === 6);
  for (const t of tasks.filter((x) => x.cognitiveWeight === 'HIGH')) {
    const b = res.blocks.find((x) => x.taskId === t.id)!;
    check(`YÜKSEK "${t.title}" tepe enerjide`, b.zone === 'PEAK' && b.avgEnergy >= 0.9);
  }
  for (const t of tasks.filter((x) => x.cognitiveWeight === 'LOW')) {
    const b = res.blocks.find((x) => x.taskId === t.id)!;
    check(`DÜŞÜK "${t.title}" tepeyi harcamıyor`, b.zone !== 'PEAK');
  }
  check(
    'her blok gün penceresinde',
    res.blocks.every((b) => b.startTime >= at(8) && b.endTime <= at(22))
  );
  assertNoOverlap(res.blocks, 'plan 1');
}

// ── 2) Uzun ağır iş odak seanslarına bölünür ──
console.log('\n2) Uzun YÜKSEK görev parçalanır');
{
  const tasks = [task('x', 'Tez bölümü', 200, 'HIGH')];
  const res = buildSchedule({ now: at(8), user, tasks });
  print('Plan', res.blocks, new Map([['x', 'Tez bölümü']]));
  check('3 odak seansı', res.blocks.length === 3);
  check(
    'hiçbir seans 90 dk üstü değil',
    res.blocks.every((b) => (b.endTime.getTime() - b.startTime.getTime()) / MIN <= 90)
  );
  check(
    'toplam süre korunuyor (200 dk)',
    res.blocks.reduce((s, b) => s + (b.endTime.getTime() - b.startTime.getTime()) / MIN, 0) === 200
  );
  const sorted = [...res.blocks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  check(
    'seanslar sıralı ve aralarında mola var',
    sorted.every(
      (b, i) =>
        i === 0 || (b.startTime.getTime() - sorted[i - 1].endTime.getTime()) / MIN >= 15 + 15
    )
  );
  assertNoOverlap(res.blocks, 'plan 2');
}

// ── 3) Taşma: sığmayanlar raporlanır, ağır işler korunur ──
console.log('\n3) Taşma: sığmayanlar raporlanır, YÜKSEK görevler önce yerleşir');
{
  const tasks = [
    task('h1', 'Büyük proje A', 150, 'HIGH'),
    task('h2', 'Büyük proje B', 120, 'HIGH'),
    task('m1', 'Orta iş 1', 120, 'MEDIUM'),
    task('m2', 'Orta iş 2', 120, 'MEDIUM'),
    task('m3', 'Orta iş 3', 120, 'MEDIUM'),
    task('l1', 'Hafif iş 1', 90, 'LOW'),
    task('l2', 'Hafif iş 2', 90, 'LOW'),
  ];
  const res = buildSchedule({ now: at(8), user, tasks });
  console.log(
    `  yerleşemeyen: ${res.unscheduled.map((u) => `${u.taskId}(${u.missingMinutes}dk)`).join(', ')}`
  );
  check('bir kısmı sığmadı', res.unscheduled.length > 0);
  check('sığmayan iş bilgisi eksik dakikayı veriyor', res.unscheduled.every((u) => u.missingMinutes > 0));
  check(
    'sığmayanlar YÜKSEK değil',
    res.unscheduled.every((u) => !u.taskId.startsWith('h'))
  );
  check('ağır iş yükü uyarısı verildi', res.warnings.some((w) => w.code === 'HIGH_LOAD'));
  assertNoOverlap(res.blocks, 'plan 3');
}

// ── 4) Gün içi yeniden optimizasyon: çalışan görev uzadı ──
console.log('\n4) Yeniden optimizasyon: görev planı aştı');
{
  const tasks = [
    task('a', 'Rapor yaz', 90, 'HIGH'),
    task('b', 'Strateji notu', 60, 'HIGH'),
    task('c', 'E-postalar', 45, 'MEDIUM'),
    task('e', 'Fatura gir', 20, 'LOW'),
  ];
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const first = buildSchedule({ now: at(8), user, tasks });
  print('Sabah planı', first.blocks, titles);

  const rapor = first.blocks.find((b) => b.taskId === 'a')!;
  // Rapor, planlanan bitişini 20 dk geçmiş ve hâlâ sürüyor.
  const now = new Date(rapor.endTime.getTime() + 20 * MIN);
  const running = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'IN_PROGRESS' as const } : t));
  const res = reoptimize({
    now,
    user,
    tasks: running,
    previousBlocks: first.blocks,
    trigger: 'OVERRUN',
  });
  print(`Yeniden plan (şimdi ${hhmm(now)})`, res.blocks, titles);

  const lockedA = res.blocks.find((b) => b.taskId === 'a')!;
  check('çalışan görev kilitli', lockedA.locked);
  check('çalışan görev uzatıldı', res.changes.extendedTaskId === 'a');
  check('uzatma şimdi + 15 dk', lockedA.endTime.getTime() >= now.getTime() + 15 * MIN);
  check(
    'diğer görevler çalışan görevin arkasında',
    res.blocks
      .filter((b) => b.taskId !== 'a')
      .every((b) => b.startTime.getTime() >= lockedA.endTime.getTime() + lockedA.bufferTime * MIN)
  );
  check(
    'bekleyen görevler şimdiden önce başlamıyor',
    res.blocks.filter((b) => b.taskId !== 'a').every((b) => b.startTime.getTime() >= now.getTime())
  );
  assertNoOverlap(res.blocks, 'plan 4');
}

// ── 5) Erken biten görev: boşalan zaman yeniden kullanılır ──
console.log('\n5) Yeniden optimizasyon: görev erken bitti');
{
  const tasks = [
    task('a', 'Rapor yaz', 90, 'HIGH'),
    task('c', 'E-postalar', 45, 'MEDIUM'),
    task('e', 'Fatura gir', 20, 'LOW'),
  ];
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const first = buildSchedule({ now: at(8), user, tasks });
  const a = first.blocks.find((b) => b.taskId === 'a')!;
  const now = new Date(a.startTime.getTime() + 50 * MIN); // 90 dk'lık iş 50 dk'da bitti
  const done = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'COMPLETED' as const } : t));
  const res = reoptimize({
    now,
    user,
    tasks: done,
    previousBlocks: first.blocks,
    trigger: 'TASK_COMPLETED',
  });
  print(`Yeniden plan (şimdi ${hhmm(now)})`, res.blocks, titles);
  const history = res.blocks.find((b) => b.taskId === 'a')!;
  check('biten işin bloğu gerçek bitişe kısaltıldı', history.endTime.getTime() === now.getTime());
  check(
    'kalanlar şimdiden sonra',
    res.blocks.filter((b) => b.taskId !== 'a').every((b) => b.startTime.getTime() >= now.getTime())
  );
  assertNoOverlap(res.blocks, 'plan 5');
}

// ── 6) Gece geç saatte: plan yarına kurulur ──
console.log('\n6) Gün kapandıktan sonra planlama');
{
  const tasks = [task('a', 'Rapor yaz', 60, 'HIGH')];
  const closed = buildSchedule({ now: at(23), user, tasks });
  check('bugün için pencere kapalı', closed.warnings.some((w) => w.code === 'WINDOW_CLOSED'));
  check('görev yerleşmedi', closed.unscheduled.length === 1 && closed.blocks.length === 0);

  const tomorrow = buildSchedule({ now: at(23), day: at(9, 0, 1), user, tasks });
  const b = tomorrow.blocks[0];
  check('yarın için yerleşti', tomorrow.blocks.length === 1);
  check('yarın tepe saatinde', b.zone === 'PEAK' && b.startTime.getDate() === 17);
}

// ── 7) Öğrenen süre çarpanı ──
console.log('\n7) Süre kalibrasyonu');
{
  const slow = [60, 70, 80, 75].map((actual) => ({
    cognitiveWeight: 'HIGH' as const,
    estimatedDuration: 50,
    actualDuration: actual,
  }));
  const f = computeDurationFactors(slow);
  check('YÜKSEK görevler için çarpan > 1', f.HIGH > 1.3, `f.HIGH=${f.HIGH}`);
  check('veri olmayan ağırlıklar 1 kalıyor', f.MEDIUM === 1 && f.LOW === 1);
  check('az veriyle (2 gözlem) düzeltme yok', computeDurationFactors(slow.slice(0, 2)).HIGH === 1);

  const tasks = [task('a', 'Rapor', 60, 'HIGH')];
  const plain = buildSchedule({ now: at(8), user, tasks });
  const learned = buildSchedule({ now: at(8), user, tasks, options: { durationFactors: f } });
  const len = (r: typeof plain) =>
    r.blocks.reduce((s, b) => s + (b.endTime.getTime() - b.startTime.getTime()) / MIN, 0);
  check('öğrenilmiş plan daha uzun blok ayırıyor', len(learned) > len(plain));
}

console.log(`\nTüm kontroller geçti (${passed}).`);
