/**
 * Ana ekran ızgarası testi: kutuların listesi, rotalar, sayfa hesabı, ipucu metinleri ve eski ekranın korunması.
 * Çalıştırmak için:  npm run test:homegrid
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOME_PAGES,
  HOME_TILES,
  ICON_AURA,
  ICON_DAMACANA,
  ICON_KRONOS,
  LONG_PRESS_MS,
  QUICK_WATER_ML,
  TILE_COLUMNS,
  chunkTiles,
  isSpecialIcon,
  pageFromOffset,
  quickWaterMessage,
  taskPeek,
  tapHint,
} from '../services/homeGrid';
import { WATER_PRESETS } from '../services/nutritionLogic';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const homeSource = readFileSync(join(root, 'app', 'index.tsx'), 'utf8');
const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);

console.log('Kutular');
check('18 kutu, 6 tam satır', HOME_TILES.length === 18 && HOME_TILES.length % TILE_COLUMNS === 0);
check('kimlikler benzersiz', new Set(HOME_TILES.map((t) => t.id)).size === HOME_TILES.length);
check('adlar benzersiz ve en çok 10 harf', new Set(HOME_TILES.map((t) => t.label)).size === HOME_TILES.length && HOME_TILES.every((t) => t.label.length > 0 && t.label.length <= 10));
check('her kutunun grubu geçerli', HOME_TILES.every((t) => ['health', 'plan', 'coach'].includes(t.group)));
check('her kutunun rotası eksiksiz bir ekran dosyasına gider', HOME_TILES.every((t) => t.route.startsWith('/') && existsSync(join(root, 'app', `${t.route.slice(1)}.tsx`))), HOME_TILES.filter((t) => !existsSync(join(root, 'app', `${t.route.slice(1)}.tsx`))).map((t) => t.route).join(','));
check('emoji simgeler eski telefonlarda görünür (Emoji 11 ve öncesi)', HOME_TILES.filter((t) => !isSpecialIcon(t.icon)).every((t) => t.icon.length > 0 && !tooNew(t.icon)));
check('emoji simgeler birbirinden farklı', (() => { const e = HOME_TILES.filter((t) => !isSpecialIcon(t.icon)).map((t) => t.icon); return new Set(e).size === e.length; })());
check('özel simgeler: damacana su kutusunda, Kronos ve Aura koçlarda', HOME_TILES.find((t) => t.icon === ICON_DAMACANA)?.id === 'su' && HOME_TILES.find((t) => t.icon === ICON_KRONOS)?.id === 'kronos' && HOME_TILES.find((t) => t.icon === ICON_AURA)?.id === 'aura');
check('özel simgeler yalnızca birer kez', [ICON_DAMACANA, ICON_KRONOS, ICON_AURA].every((k) => HOME_TILES.filter((t) => t.icon === k).length === 1));
check('su kutusu beslenme ekranını açar', HOME_TILES.find((t) => t.id === 'su')?.route === '/nutrition');
check('koç kutuları sohbeti doğru koçla açar', HOME_TILES.find((t) => t.id === 'kronos')?.params?.coach === 'KRONOS' && HOME_TILES.find((t) => t.id === 'aura')?.params?.coach === 'AURA');
check('parametresi olan yalnızca koç kutuları', HOME_TILES.filter((t) => t.params).map((t) => t.id).sort().join() === 'aura,kronos');
check('gruplar sırayla: sağlık, plan, koç', (() => { const order = ['health', 'plan', 'coach']; let last = 0; for (const t of HOME_TILES) { const i = order.indexOf(t.group); if (i < last) return false; last = i; } return true; })());
check('koç dışındaki kutuların rotaları birbirinden farklı', new Set(HOME_TILES.filter((t) => !t.params).map((t) => t.route)).size === HOME_TILES.filter((t) => !t.params).length);

console.log('Satırlar ve sayfalar');
const rows = chunkTiles(HOME_TILES);
check('6 satır, her biri 3 kutu', rows.length === 6 && rows.every((r) => r.length === 3));
check('kutu sırası bozulmaz', rows.flat().map((t) => t.id).join() === HOME_TILES.map((t) => t.id).join());
check('eksik son satır korunur', chunkTiles([1, 2, 3, 4, 5], 3).length === 2 && chunkTiles([1, 2, 3, 4, 5], 3)[1].length === 2);
check('boş liste ve geçersiz sütun sayısı', chunkTiles([], 3).length === 0 && chunkTiles([1, 2], 0).length === 2);
check('iki sayfa var', HOME_PAGES === 2);
check('sayfa: ilk sayfanın yarısına kadar 0', pageFromOffset(0, 360) === 0 && pageFromOffset(179, 360) === 0);
check('sayfa: yarıyı geçince 1', pageFromOffset(181, 360) === 1 && pageFromOffset(360, 360) === 1);
check('sayfa: sınırların dışı kıstırılır', pageFromOffset(5000, 360) === 1 && pageFromOffset(-80, 360) === 0);
check('sayfa: bozuk değerler 0', pageFromOffset(NaN, 360) === 0 && pageFromOffset(100, 0) === 0 && pageFromOffset(100, NaN) === 0);

console.log('Dokunma ve basılı tutma');
check('basılı tutma süresi makul (300-600 ms)', LONG_PRESS_MS >= 300 && LONG_PRESS_MS <= 600);
check('ipucu kutunun adını söyler', HOME_TILES.every((t) => tapHint(t).includes(t.label) && tapHint(t).includes('Basılı tut')));
check('hızlı su: 200 ml ve "Bardak" ön ayarıyla aynı', QUICK_WATER_ML === 200 && WATER_PRESETS[0].ml === QUICK_WATER_ML);
check('hızlı su mesajı miktarı söyler', quickWaterMessage() === '+200 ml su eklendi' && quickWaterMessage(500) === '+500 ml su eklendi');

console.log('Görev özeti');
check('en çok 3 görev gösterilir, kalan sayılır', (() => { const r = taskPeek(['a', 'b', 'c', 'd', 'e']); return r.shown.length === 3 && r.more === 2; })());
check('boşluklar kırpılır, boş adlar atılır', (() => { const r = taskPeek(['  a ', '', '   ', 'b']); return r.shown.join() === 'a,b' && r.more === 0; })());
check('görev yoksa boş', (() => { const r = taskPeek([]); return r.shown.length === 0 && r.more === 0; })());
check('en çok sayısı değiştirilebilir', taskPeek(['a', 'b', 'c'], 1).shown.length === 1 && taskPeek(['a', 'b', 'c'], 1).more === 2 && taskPeek(['a'], 0).more === 1);

console.log('Ana ekran: eski ekran korunuyor');
check('ana ekran yatay sayfalı ve ızgarayı kullanır', homeSource.includes('pagingEnabled') && homeSource.includes('<HomeGrid') && homeSource.includes('horizontal'));
const oldOnly = ['/monthly', '/weekly', '/morning', '/activity', '/day', '/mark', '/routines', '/routine-run', '/nutrition', '/guide', '/week', '/hero', '/language', '/habits', '/goals', '/history'];
check('eski ana ekrandaki tüm kutular ikinci sayfada durur', oldOnly.every((r) => homeSource.includes(`router.push('${r}')`)), oldOnly.filter((r) => !homeSource.includes(`router.push('${r}')`)).join(','));
check('eski ekranın başlıkları ikinci sayfada: koç konsolu, ruh hali, görevler', homeSource.includes('<CoachConsole') && homeSource.includes('<MoodCard') && homeSource.includes('Görevler</Text>'));
check('ızgara iki yoldan gün rehberine ve ayarlara ulaşır', homeSource.includes("onNow={() => router.push('/guide')}") && homeSource.includes("onSettings={() => router.push('/settings')}"));
check('su kutusuna dokunmak 200 ml ekler', homeSource.includes('QUICK_WATER_ML') && homeSource.includes("tile.id === 'su'"));

console.log(`\nTüm kontroller geçti: ${passed}`);
