/**
 * Ana ekran düzeni testi (saf mantık + gerçek SQLite + yedek). Çalıştırmak için:  npm run test:homelayout
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateDbIfNeeded } from '../database/schema';
import { ALL_TILES, EXTRA_TILES, HOME_TILES, TILE_COLUMNS, isSpecialIcon } from '../services/homeGrid';
import {
  DEFAULT_FAVORITES,
  HOME_FAVORITE_COUNT,
  HOME_LAYOUT_KEY,
  addTile,
  availableTiles,
  defaultOrder,
  favoriteTiles,
  getHomeLayout,
  isDefaultOrder,
  moveBy,
  parseLayout,
  positionLabel,
  removeTile,
  resetHomeLayout,
  saveHomeLayout,
  selectionAfterRemove,
  serializeLayout,
  tilesFor,
} from '../services/homeLayout';
import { BACKUP_TABLES } from '../services/backupLogic';
import { homeStatCards } from '../services/homeStats';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const root = join(__dirname, '..');
const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);

console.log('Kutu kataloğu');
check('katalog = varsayılan 24 + eklenebilir ek kutular', ALL_TILES.length === HOME_TILES.length + EXTRA_TILES.length && EXTRA_TILES.length >= 4);
check('kimlikler benzersiz', new Set(ALL_TILES.map((t) => t.id)).size === ALL_TILES.length);
check('adlar benzersiz ve en çok 10 harf', new Set(ALL_TILES.map((t) => t.label)).size === ALL_TILES.length && ALL_TILES.every((t) => t.label.length > 0 && t.label.length <= 10));
check('her kutunun rotası bir ekran dosyasına gider', ALL_TILES.every((t) => existsSync(join(root, 'app', `${t.route.slice(1)}.tsx`))), ALL_TILES.filter((t) => !existsSync(join(root, 'app', `${t.route.slice(1)}.tsx`))).map((t) => t.route).join(','));
check('emojiler eski telefonlarda görünür ve birbirinden farklı', (() => {
  const e = ALL_TILES.filter((t) => !isSpecialIcon(t.icon)).map((t) => t.icon);
  return new Set(e).size === e.length && e.every((x) => !tooNew(x));
})());
check('koç dışı kutuların rotaları ya da parametreleri farklı', (() => {
  const keys = ALL_TILES.map((t) => `${t.route}|${JSON.stringify(t.params ?? {})}`);
  return new Set(keys).size === keys.length;
})());
check('ayarlar ve profil eklenebilir', EXTRA_TILES.some((t) => t.route === '/settings') && EXTRA_TILES.some((t) => t.route === '/profile'));

console.log('Varsayılan ve okuma');
check('varsayılan düzen HOME_TILES kutularının hepsini içerir, tekrar yok', defaultOrder().length === HOME_TILES.length && new Set(defaultOrder()).size === HOME_TILES.length && HOME_TILES.every((t) => defaultOrder().includes(t.id)));
check('varsayılan sık kullanılanlar: su, dil, egzersiz, günlük, rutinler', defaultOrder().slice(0, HOME_FAVORITE_COUNT).join() === 'su,dil,egzersiz,gunluk,rutin' && DEFAULT_FAVORITES.length === HOME_FAVORITE_COUNT);
check('sık kullanılanlar düzendeki ilk 5 kutudur', favoriteTiles(defaultOrder()).map((t) => t.label).join() === 'Su, yemek,Dil,Egzersiz,Günlük,Rutinler' && favoriteTiles(['kronos']).length === 1 && favoriteTiles([]).length === 0);
check('kalan kutular HOME_TILES sırasını korur', defaultOrder().slice(HOME_FAVORITE_COUNT).join() === HOME_TILES.map((t) => t.id).filter((id) => !DEFAULT_FAVORITES.includes(id)).join());
check('kutuyu başa taşımak onu sık kullanılanlara sokar, sonuncuyu dışarı iter', (() => {
  const o = moveBy(defaultOrder(), 'kilo', -30);
  const f = favoriteTiles(o).map((t) => t.id);
  return f[0] === 'kilo' && f.length === 5 && !f.includes('rutin');
})());
check('kayıt yoksa varsayılan', parseLayout(null).join() === defaultOrder().join() && parseLayout(undefined).join() === defaultOrder().join() && parseLayout('').join() === defaultOrder().join());
check('bozuk kayıt varsayılana döner', parseLayout('{').join() === defaultOrder().join() && parseLayout('{"a":1}').join() === defaultOrder().join() && parseLayout('"su"').join() === defaultOrder().join());
check('bilinmeyen ve tekrar eden kimlikler atılır', parseLayout('["su","yok","su","dil",5,null]').join() === 'su,dil');
check('boş düzen geçerlidir (hiç kutu yok)', parseLayout('[]').length === 0);
check('kaydet-oku aynı sırayı verir', parseLayout(serializeLayout(['kronos', 'su', 'sabah'])).join() === 'kronos,su,sabah');
check('tilesFor sırayı korur', tilesFor(['aura', 'su']).map((t) => t.id).join() === 'aura,su' && tilesFor(['yok']).length === 0);

console.log('Taşıma');
const o = ['a1', 'b2', 'c3', 'd4', 'e5'];
check('sağa bir', moveBy(o, 'a1', 1).join() === 'b2,a1,c3,d4,e5');
check('sola bir', moveBy(o, 'c3', -1).join() === 'a1,c3,b2,d4,e5');
check('bir satır aşağı (3)', moveBy(o, 'a1', 3).join() === 'b2,c3,d4,a1,e5');
check('bir satır yukarı (-3)', moveBy(o, 'e5', -3).join() === 'a1,e5,b2,c3,d4');
check('başa gelince durur', moveBy(o, 'b2', -3).join() === 'b2,a1,c3,d4,e5' && moveBy(o, 'a1', -1) === o);
check('sona gelince durur', moveBy(o, 'd4', 3).join() === 'a1,b2,c3,e5,d4' && moveBy(o, 'e5', 1) === o);
check('listede olmayan kimlik değişmez', moveBy(o, 'zz', 1) === o);
check('taşıma kutu sayısını ve içeriğini değiştirmez', (() => {
  let cur = defaultOrder();
  for (const [id, d] of [['su', 3], ['dil', -3], ['aura', -1], ['rutin', 3], ['kilo', 5], ['analiz', -8]] as [string, number][]) cur = moveBy(cur, id, d);
  return cur.length === 24 && [...cur].sort().join() === [...defaultOrder()].sort().join();
})());
check('kutu satır ve sütun etiketi', positionLabel(0) === '1. satır, 1. sütun' && positionLabel(4) === '2. satır, 2. sütun' && positionLabel(23) === '8. satır, 3. sütun');
check('sütun sayısı 3', TILE_COLUMNS === 3);

console.log('Kaldırma ve ekleme');
check('kaldırma', removeTile(['su', 'dil'], 'su').join() === 'dil' && removeTile(['su'], 'yok').join() === 'su');
check('ekleme sona yapılır', addTile(['su'], 'sabah').join() === 'su,sabah');
check('var olan ya da bilinmeyen kutu eklenmez', addTile(['su'], 'su').join() === 'su' && addTile(['su'], 'yok').join() === 'su');
check('eklenebilirler düzende olmayanlardır', availableTiles(defaultOrder()).map((t) => t.id).join() === EXTRA_TILES.map((t) => t.id).join());
check('bir kutu kaldırılınca eklenebilir olur', availableTiles(removeTile(defaultOrder(), 'su')).some((t) => t.id === 'su'));
check('hepsi kaldırılınca hepsi eklenebilir', availableTiles([]).length === ALL_TILES.length);
check('kaldırınca seçim aynı sıradaki kutuya geçer', selectionAfterRemove(['a', 'b', 'c'], 'b') === 'c' && selectionAfterRemove(['a', 'b', 'c'], 'c') === 'b' && selectionAfterRemove(['a'], 'a') === null && selectionAfterRemove(['a'], 'x') === null);
check('varsayılan düzen tanınır', isDefaultOrder(defaultOrder()) && !isDefaultOrder(removeTile(defaultOrder(), 'su')) && !isDefaultOrder(moveBy(defaultOrder(), 'su', 1)));

console.log('Bugünkü sayı kartları');
const full = homeStatCards({ steps: 6240, heightCm: 175, waterMl: 1600, waterGoalMl: 2500, langMinutes: 25, langGoalMin: 20, appLabel: 'Duolingo' });
check('üç kart: adım, su, dil', full.map((c) => c.key).join() === 'adim,su,dil');
check('adım: sayı ve km (boydan adım uzunluğu)', full[0].value === '6.240' && full[0].sub === '4,53 km' && full[0].ratio === null, `${full[0].value} ${full[0].sub}`);
check('su: litre, damacana ve hedefe oran', full[1].value === '1,6 L' && full[1].sub === '0,08 damacana' && full[1].ratio !== null && Math.abs(full[1].ratio - 0.64) < 1e-9, `${full[1].value} ${full[1].sub} ${full[1].ratio}`);
check('dil: dakika, uygulama adı, hedef aşılınca oran 1', full[2].value === '25 dk' && full[2].sub === 'Duolingo' && full[2].ratio === 1);
const none = homeStatCards({ steps: null, heightCm: null, waterMl: null, waterGoalMl: null, langMinutes: null, langGoalMin: null, appLabel: 'Duolingo' });
check('ölçülemeyen adım ve dil sıfır yazılmaz', none[0].value === '—' && none[0].sub === 'ölçülemedi' && none[2].value === '—' && none[2].ratio === null);
check('su kaydı yoksa 0 L ve oran hedef yoksa null', none[1].value === '0 L' && none[1].ratio === null);
check('boy yoksa adım uzunluğu varsayılan 75 cm', homeStatCards({ steps: 1000, heightCm: null, waterMl: 0, waterGoalMl: 2000, langMinutes: 0, langGoalMin: null, appLabel: 'x' })[0].sub === '0,75 km');
check('dil hedefi yoksa çubuk yok, 0 dk yazılır', (() => { const c = homeStatCards({ steps: 0, heightCm: null, waterMl: 0, waterGoalMl: 2000, langMinutes: 0, langGoalMin: null, appLabel: 'x' }); return c[2].value === '0 dk' && c[2].ratio === null && c[1].ratio === 0; })());

console.log('Veritabanı ve yedek');
async function dbTests(): Promise<void> {
  const { db, raw } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('ilk açılışta varsayılan', (await getHomeLayout(db)).join() === defaultOrder().join());
  const mine = removeTile(moveBy(addTile(defaultOrder(), 'sabah'), 'sabah', -30), 'rekor');
  await saveHomeLayout(db, mine);
  check('kaydedilen düzen aynen okunur', (await getHomeLayout(db)).join() === mine.join());
  check('düzen ayar tablosunda tek satır', (await db.getAllAsync<{ key: string }>('SELECT key FROM Setting WHERE key = ?', [HOME_LAYOUT_KEY])).length === 1);
  await saveHomeLayout(db, ['su', 'yok', 'su']);
  check('kaydederken bilinmeyen ve tekrar eden kimlik temizlenir', (await getHomeLayout(db)).join() === 'su');
  await saveHomeLayout(db, []);
  check('boş düzen kaydedilir ve boş okunur', (await getHomeLayout(db)).length === 0);
  const back = await resetHomeLayout(db);
  check('sıfırlama varsayılana döner ve kaydı siler', back.join() === defaultOrder().join() && (await getHomeLayout(db)).join() === defaultOrder().join() && (await db.getAllAsync('SELECT key FROM Setting WHERE key = ?', [HOME_LAYOUT_KEY])).length === 0);
  check('ayar tablosu yedeğe girer (düzen yedekte gelir)', BACKUP_TABLES.includes('Setting'));
  raw.close();
}

console.log('Ekran bağlantıları');
const grid = readFileSync(join(root, 'components', 'HomeGrid.tsx'), 'utf8');
const home = readFileSync(join(root, 'app', 'index.tsx'), 'utf8');
const layout = readFileSync(join(root, 'app', '_layout.tsx'), 'utf8');
check('düzenleme ana ekranın kendisinde: ayrı ekran yok', !existsSync(join(root, 'app', 'home-layout.tsx')) && !layout.includes('home-layout') && !home.includes("'/home-layout'"));
check('ızgara kutuları kullanıcı düzeninden alır, sabit listeyi kullanmaz', grid.includes('tilesFor(p.order)') && !grid.includes('chunkTiles(HOME_TILES'));
check('ızgarada Düzenle / Bitti düğmesi ve taşıma paneli var', grid.includes("'Düzenle'") && grid.includes('✓ Bitti') && grid.includes('moveBy(') && grid.includes('removeTile(') && grid.includes('addTile('));
check('düzenlerken basılı tutma ekran açmaz, dokunuş seçer', grid.includes('editing ? undefined : p.onOpen(tile)') && grid.includes('setSelected(sel === tile.id ? null : tile.id)'));
check('ana ekran düzeni yükler, her değişiklikte kaydeder, sıfırlar', home.includes('getHomeLayout(db)') && home.includes('saveHomeLayout(db, next)') && home.includes('resetHomeLayout(db)'));
check('üstte gün, tarih ve saat', grid.includes('formatClock(now)') && grid.includes('formatWeekday(now)') && grid.includes('formatFullDate(now)'));
check('ana ekran: bugünkü üç sayı, sık kullanılanlar ve Tüm menü', grid.includes('p.stats.map') && grid.includes('Sık kullanılanlar') && grid.includes('favoriteTiles(p.order)') && grid.includes('Tüm menü') && grid.includes('setMenuOpen(true)'));
check('sürgülü analiz ana ekrandan kalktı, ayrıntı bağlantısı var', !existsSync(join(root, 'components', 'HomeAnalysis.tsx')) && !grid.includes('HomeAnalysis') && grid.includes('Ayrıntılı analiz ve sürgü'));
check('düzenlerken ilk 5 kutu yıldızla işaretlenir', grid.includes('index < HOME_FAVORITE_COUNT') && grid.includes('★'));
check('menü ve düzenleme tüm kutuları gösterir, görevler yalnızca ana ekranda', grid.includes('const fullGrid = editing || menuOpen') && grid.includes('{!fullGrid && ('));
check('ana ekran bugünkü sayıları üretir', home.includes('homeStatCards(') && home.includes('activity?.steps') && home.includes('lang.summary.appMinutes'));

dbTests()
  .then(() => console.log(`\nTüm kontroller geçti (${passed}).`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
