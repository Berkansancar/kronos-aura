/**
 * Kilo ve rekor testi: kilo girişi, haftalık eğilim, hedefe kalan, grafik geometrisi, egzersiz rekorları
 * (60 seanstan sonra da korunur), veritabanı ve ekran bağlantıları. Çalıştırmak için:  npm run test:body
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteWeightLog, listWeightLogs, setWeightLog } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import type { WeightLog } from '../database/types';
import { createBackup, restoreBackup } from '../services/backupLogic';
import { chartGeometry, formatKg, formatSigned, parseKg, recordRows, trendPerWeek, weightNote, weightStats } from '../services/bodyLogic';
import { defaultState, deriveRecords, parseState, recordKey, recordSession, serializeState } from '../services/exerciseLogic';
import { HOME_TILES } from '../services/homeGrid';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const BAD_WORDS = ['tembel', 'başarısız', 'disiplinsiz', 'yetersiz', 'boşa', 'kaybettin', 'şişman', 'zayıf', 'obez', 'diyet yap'];
const dk = (i: number): string => {
  const d = new Date(2026, 9, 1 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const log = (i: number, kg: number): WeightLog => ({ day: dk(i), kg, updatedAt: `${dk(i)}T07:00:00.000Z` });
const TODAY = dk(27);

async function main(): Promise<void> {
  console.log('Kilo girişi');
  check('virgül ve nokta kabul edilir', parseKg('78,4') === 78.4 && parseKg('78.4') === 78.4 && parseKg(' 78 ') === 78);
  check('iki ondalık tek ondalığa yuvarlanır', parseKg('78,46') === 78.5 && parseKg('78,44') === 78.4);
  check('aralık dışı ve bozuk girdi reddedilir', parseKg('29') === null && parseKg('301') === null && parseKg('') === null && parseKg('abc') === null && parseKg('7') === null && parseKg('78,') === null && parseKg('-80') === null && parseKg('1e2') === null);
  check('sınırlar: 30 ve 300 geçerli', parseKg('30') === 30 && parseKg('300') === 300);
  check('gösterim: virgüllü, tek ondalık', formatKg(78.4) === '78,4 kg' && formatKg(80) === '80,0 kg');
  check('işaretli gösterim', formatSigned(-0.4) === '−0,4' && formatSigned(1.25) === '+1,3' && formatSigned(0) === '0,0');

  console.log('Haftalık eğilim');
  const down = Array.from({ length: 28 }, (_, i) => log(i, Math.round((84 - i * 0.1) * 10) / 10));
  const slope = trendPerWeek(down, TODAY);
  check('günde 0,1 kg düşüş = haftada −0,7', slope === -0.7, String(slope));
  check('az kayıtta eğim yok (3 kayıttan az)', trendPerWeek([log(20, 80), log(27, 79)], TODAY) === null);
  check('kayıtlar 7 günden dar aralıktaysa eğim yok', trendPerWeek([log(22, 80), log(24, 79.5), log(27, 79)], TODAY) === null);
  check('28 günden eski kayıtlar eğimi bozmaz', trendPerWeek([log(-3, 120), log(-2, 119), log(20, 80), log(24, 80), log(27, 80)], TODAY) === 0);
  check('bugünden sonraki kayıt sayılmaz', trendPerWeek([log(10, 80), log(15, 80), log(20, 80), log(30, 70)], TODAY) === 0);

  console.log('İstatistik ve not');
  const st = weightStats(down, TODAY, 76);
  check('şimdi, ilk, değişim', st.latest?.kg === 81.3 && st.first?.kg === 84 && st.changeSinceFirst === -2.7 && st.count === 28);
  check('hedefe kalan işaretlidir', st.toTarget === -5.3 && st.targetKg === 76);
  check('geçersiz hedef yok sayılır', weightStats(down, TODAY, 5).targetKg === null && weightStats(down, TODAY, null).toTarget === null);
  check('tek kayıtta değişim yok', weightStats([log(27, 80)], TODAY, null).changeSinceFirst === null);
  check('hiç kayıt yok', weightStats([], TODAY, null).latest === null && weightStats([], TODAY, 70).toTarget === null);
  const notes = [weightNote(weightStats([], TODAY, null)), weightNote(weightStats([log(27, 80)], TODAY, null)), weightNote(st), weightNote(weightStats(Array.from({ length: 10 }, (_, i) => log(i + 17, 80)), TODAY, null))];
  check('notlar yargısız ve dalgalanmayı normal sayar', notes.every((n) => BAD_WORDS.every((w) => !n.toLowerCase().includes(w))) && notes[2].includes('normaldir') && notes[3].includes('sabit'), notes.join(' | '));
  check('tıbbi tavsiye ya da kalori hedefi vermez', notes.every((n) => !/doktor|kalori|diyet|tehlik|sağlıksız/i.test(n)));

  console.log('Grafik geometrisi');
  const g = chartGeometry(down, TODAY, 300, 180, 20, 76);
  check('her kayıt için bir nokta, arası için bir çizgi', g.points.length === 28 && g.segments.length === 27);
  check('noktalar çerçevenin içinde', g.points.every((p) => p.x >= 20 && p.x <= 280 && p.y >= 20 && p.y <= 160));
  check('x tarihe göre artar, ilk sol uçta son sağ uçta', g.points[0].x === 20 && g.points[27].x === 280 && g.points.every((p, i) => i === 0 || p.x > g.points[i - 1].x));
  check('ağır olan aşağıda değil yukarıda (y ters)', g.points[0].y < g.points[27].y);
  check('hedef çizgisi eksene dahil ve çerçevede', g.targetY !== null && g.targetY >= 20 && g.targetY <= 160 && g.minKg <= 76);
  check('hedef yoksa çizgi yok', chartGeometry(down, TODAY, 300, 180, 20, null).targetY === null);
  const sumLen = g.segments.reduce((a, s) => a + s.length, 0);
  check('çizgi parçaları sonlu sayılardır', g.segments.every((s) => Number.isFinite(s.cx) && Number.isFinite(s.cy) && Number.isFinite(s.length) && Number.isFinite(s.angle)) && sumLen > 0);
  const e0 = chartGeometry([], TODAY, 300, 180, 20, null);
  const e1 = chartGeometry([log(27, 80)], TODAY, 300, 180, 20, null);
  check('boş ve tek kayıt güvenle işlenir', e0.points.length === 0 && e1.points.length === 1 && e1.segments.length === 0 && Number.isFinite(e1.points[0].y));
  const flat = chartGeometry([log(25, 80), log(27, 80)], TODAY, 300, 180, 20, null);
  check('sabit kilo çizgisi sıfıra bölmez', flat.points.every((p) => Number.isFinite(p.y)) && flat.maxKg - flat.minKg >= 2);
  check('90 günden eski kayıt çizilmez', chartGeometry([log(0, 90), log(27, 80)], '2027-02-10', 300, 180, 20, null, 90).points.length === 0);

  console.log('Egzersiz rekorları');
  let state = defaultState();
  state = recordSession(state, '2026-10-01', [{ move: 'push', level: 1, sets: [8, 7, 6] }]).state;
  state = recordSession(state, '2026-10-05', [{ move: 'push', level: 1, sets: [12, 10] }]).state;
  state = recordSession(state, '2026-10-09', [{ move: 'push', level: 1, sets: [9] }]).state;
  const rec = state.records[recordKey('push', 1)];
  check('en iyi tek set, ilk kayıt ve günleri', rec.best === 12 && rec.bestDay === '2026-10-05' && rec.first === 8 && rec.firstDay === '2026-10-01');
  check('daha düşük set rekoru bozmaz', state.records[recordKey('push', 1)].best === 12);
  check('sıfır set rekor sayılmaz', Object.keys(recordSession(defaultState(), '2026-10-01', [{ move: 'pull', level: 1, sets: [0] }]).state.records).length === 0);
  check('farklı basamak ayrı rekor tutar', (() => { const s = recordSession(state, '2026-10-12', [{ move: 'push', level: 2, sets: [5] }]).state; return s.records['push:1'].best === 12 && s.records['push:2'].best === 5; })());
  let big = defaultState();
  for (let i = 0; i < 70; i += 1) big = recordSession(big, `2026-${i < 35 ? '08' : '09'}-${String((i % 28) + 1).padStart(2, '0')}`, [{ move: 'core', level: 1, sets: [i + 1] }]).state;
  check('60 seanstan sonra da ilk kayıt silinmez', big.sessions.length <= 60 && big.records['core:1'].first === 1 && big.records['core:1'].best === 70);
  const round = parseState(serializeState(big));
  check('kaydedip okuyunca rekorlar aynı', JSON.stringify(round.records) === JSON.stringify(big.records));
  const legacy = JSON.parse(serializeState(state));
  delete legacy.records;
  check('rekor alanı olmayan eski kayıt seanslardan kurulur', parseState(JSON.stringify(legacy)).records['push:1'].best === 12 && JSON.stringify(deriveRecords(state.sessions)) === JSON.stringify(state.records));
  const broken = JSON.parse(serializeState(state));
  broken.records = { 'push:1': { best: 'x' }, 'zzz:1': { best: 5, bestDay: '2026-10-01', first: 5, firstDay: '2026-10-01' }, 'push:9': {} };
  check('bozuk rekor kayıtları atlanır', Object.keys(parseState(JSON.stringify(broken)).records).length === 0);

  const rows = recordRows(recordSession(state, '2026-10-12', [{ move: 'push', level: 2, sets: [5, 4] }]).state, '2026-10-13');
  check('hareket başına en yüksek basamak satırı', rows.length === 1 && rows[0].move === 'push' && rows[0].level === 2 && rows[0].best === 5);
  const r1 = recordRows(state, '2026-10-08');
  check('kazanç ve "yeni" etiketi (7 gün içinde, ilkinden yüksek)', r1[0].gain === 4 && r1[0].recent === true && recordRows(state, '2026-10-20')[0].recent === false);
  check('süreli hareket "sn" der', recordRows(recordSession(defaultState(), '2026-10-01', [{ move: 'core', level: 1, sets: [30] }]).state, '2026-10-02')[0].unitWord === 'sn');
  check('kayıt yoksa satır yok', recordRows(defaultState(), TODAY).length === 0);

  console.log('Veritabanı');
  const t = makeTestDb();
  await migrateDbIfNeeded(t.db);
  const at = new Date(2026, 9, 27, 7, 0);
  await setWeightLog(t.db, '2026-10-27', 78.44, at);
  await setWeightLog(t.db, '2026-10-27', 78.1, at);
  await setWeightLog(t.db, '2026-10-20', 79, at);
  const all = await listWeightLogs(t.db);
  check('aynı gün güncellenir, tarihe göre sıralı, tek ondalık', all.length === 2 && all[0].day === '2026-10-20' && all[1].kg === 78.1);
  check('aralık dışı kilo veritabanında reddedilir', await setWeightLog(t.db, '2026-10-21', 10, at).then(() => false, () => true));
  await deleteWeightLog(t.db, '2026-10-20');
  check('silinen kayıt gelmez', (await listWeightLogs(t.db)).length === 1);

  console.log('Yedek');
  const text = await createBackup(t.db, {}, at);
  const b = makeTestDb();
  await migrateDbIfNeeded(b.db);
  check('geri yüklenir ve kilo kaydı gelir', (await restoreBackup(b.db, text)).ok === true && (await listWeightLogs(b.db))[0]?.kg === 78.1);

  console.log('Ekran ve bağlantılar');
  check('ekran ve grafik dosyaları, rota kaydı', existsSync(join(root, 'app/body.tsx')) && existsSync(join(root, 'components/WeightChart.tsx')) && readFileSync(join(root, 'app/_layout.tsx'), 'utf8').includes('name="body"'));
  check('ana ekranda kilo ve rekor kutuları', HOME_TILES.some((x) => x.id === 'kilo' && x.route === '/body') && HOME_TILES.some((x) => x.id === 'rekor' && x.params?.tab === 'rekor'));
  const screen = readFileSync(join(root, 'app/body.tsx'), 'utf8');
  check('rekor sekmesi tab=rekor parametresiyle açılır', screen.includes("params.tab === 'rekor'"));
  const svc = readFileSync(join(root, 'services/body.ts'), 'utf8');
  check('kilo yapay zekâya gönderilmez', !svc.includes("from './ai") && !screen.includes('askCoach') && !screen.includes('fetch('));
  const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);
  check('metinlerde yeni emoji yok', !tooNew(screen) && !tooNew(svc) && !tooNew(readFileSync(join(root, 'services/bodyLogic.ts'), 'utf8')));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
