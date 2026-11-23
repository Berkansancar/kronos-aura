/**
 * Açılış sözü testi: söz listesi, tekrarsız seçim (torba), saklama, selamlama, süre, ayar ve açılış penceresi yapılandırması.
 * Çalıştırmak için:  npm run test:quotes
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateDbIfNeeded } from '../database/schema';
import { getSetting, setSetting } from '../database/repository';
import {
  ATASOZU,
  OPENING_SETTING_KEY,
  QUOTES,
  QUOTE_BAG_KEY,
  RESUME_AWAY_MS,
  displayMs,
  greetingFor,
  isOpeningEnabled,
  nextQuoteIndex,
  parseBag,
  quoteKind,
  shouldShowOnResume,
  shuffled,
  type QuoteBag,
} from '../services/quotes';
import { getOpeningEnabled, loadNextQuote, setOpeningEnabled } from '../services/quoteStore';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

/** Tekrarlanabilir sahte rastgele sayı üreteci (LCG) */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const emojiLike = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1f000);

async function main(): Promise<void> {
  console.log('Söz listesi');
  check('en az 100 söz var', QUOTES.length >= 100, String(QUOTES.length));
  check('her sözün metni ve söyleyeni dolu', QUOTES.every((q) => q.text.trim().length > 0 && q.author.trim().length > 0));
  check('sözler birbirinden farklı', new Set(QUOTES.map((q) => q.text)).size === QUOTES.length);
  check('her söz noktalama ile biter', QUOTES.every((q) => /[.!?]$/.test(q.text)));
  check('her söz ekrana sığar (en çok 100 harf)', QUOTES.every((q) => q.text.length <= 100), QUOTES.filter((q) => q.text.length > 100).map((q) => q.text).join('|'));
  check('baştaki ve sondaki boşluk yok', QUOTES.every((q) => q.text === q.text.trim() && q.author === q.author.trim()));
  check('emoji yok (eski telefonlarda kutu görünmesin)', QUOTES.every((q) => !emojiLike(q.text) && !emojiLike(q.author)));
  const kinds = { atasozu: 0, bilge: 0, kronos: 0, aura: 0 };
  for (const q of QUOTES) kinds[quoteKind(q)] += 1;
  check('dört türden de en az 10 söz: atasözü, düşünür, Kronos, Aura', Object.values(kinds).every((n) => n >= 10), JSON.stringify(kinds));
  check('atasözlerinin söyleyeni "Atasözü"', QUOTES.filter((q) => quoteKind(q) === 'atasozu').every((q) => q.author === ATASOZU));
  check('Kronos ve Aura sözleri koçların adıyla', QUOTES.filter((q) => q.author === 'Kronos').length === kinds.kronos && QUOTES.filter((q) => q.author === 'Aura').length === kinds.aura);

  console.log('Karıştırma');
  const sh = shuffled(10, seeded(1));
  check('karıştırma her sayıyı bir kez içerir', [...sh].sort((a, b) => a - b).join() === '0,1,2,3,4,5,6,7,8,9');
  check('sıra gerçekten karışır', sh.join() !== '0,1,2,3,4,5,6,7,8,9');
  check('uç rastgele değerlerde bozulmaz (0, 0.999999, NaN)', [0, 0.999999, NaN].every((r) => [...shuffled(7, () => r)].sort((a, b) => a - b).join() === '0,1,2,3,4,5,6'));
  check('tek ve sıfır elemanlı', shuffled(1, seeded(1)).join() === '0' && shuffled(0, seeded(1)).length === 0);

  console.log('Tekrarsız seçim (torba)');
  const N = QUOTES.length;
  let bag: QuoteBag | null = null;
  const rng = seeded(42);
  const picks: number[] = [];
  for (let i = 0; i < N * 3; i += 1) {
    const r = nextQuoteIndex(bag, N, rng);
    picks.push(r.index);
    bag = r.bag;
  }
  const cycle = (k: number) => picks.slice(k * N, (k + 1) * N);
  check('ilk turda her söz tam bir kez', [...cycle(0)].sort((a, b) => a - b).join() === Array.from({ length: N }, (_, i) => i).join());
  check('ikinci ve üçüncü turda da her söz tam bir kez', [1, 2].every((k) => new Set(cycle(k)).size === N));
  check('art arda aynı söz hiç gelmez (tur sınırları dahil)', picks.every((p, i) => i === 0 || p !== picks[i - 1]));
  check('turlar birbirinin aynısı değil', cycle(0).join() !== cycle(1).join() && cycle(1).join() !== cycle(2).join());
  check('1000 açılışta art arda tekrar yok ve her söz görülür', (() => {
    let b: QuoteBag | null = null; let last = -1; const seen = new Set<number>(); const r = seeded(7);
    for (let i = 0; i < 1000; i += 1) { const x = nextQuoteIndex(b, N, r); if (x.index === last) return false; last = x.index; seen.add(x.index); b = x.bag; }
    return seen.size === N;
  })());
  check('farklı tohumlarda tur sınırı tekrarı yok (200 deneme)', (() => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const r = seeded(seed); let b: QuoteBag | null = null; let last = -1;
      for (let i = 0; i < 12; i += 1) { const x = nextQuoteIndex(b, 5, r); if (x.index === last) return false; last = x.index; b = x.bag; }
    }
    return true;
  })());
  check('tek sözlü listede çalışır', nextQuoteIndex(null, 1, seeded(1)).index === 0 && nextQuoteIndex(nextQuoteIndex(null, 1, seeded(1)).bag, 1, seeded(1)).index === 0);
  check('boş listede hata verir', (() => { try { nextQuoteIndex(null, 0, seeded(1)); return false; } catch { return true; } })());
  check('liste uzunluğu değişirse torba yenilenir', (() => { const b = nextQuoteIndex(null, 10, seeded(1)).bag; const r = nextQuoteIndex(b, 12, seeded(2)); return r.bag.n === 12 && r.bag.pos === 1 && r.index >= 0 && r.index < 12; })());

  console.log('Saklanan torba');
  const good = nextQuoteIndex(null, N, seeded(3)).bag;
  check('kaydedilen torba aynen okunur', JSON.stringify(parseBag(JSON.stringify(good), N)) === JSON.stringify(good));
  check('boş, bozuk ve yanlış biçimli kayıt null', [null, '', 'xx', '{}', '[]', '{"v":2}'].every((raw) => parseBag(raw, N) === null));
  check('yanlış sayıda ya da tekrarlı sıra reddedilir', parseBag(JSON.stringify({ ...good, n: N + 1 }), N) === null && parseBag(JSON.stringify({ ...good, order: good.order.map(() => 0) }), N) === null && parseBag(JSON.stringify({ ...good, order: good.order.slice(1) }), N) === null);
  check('sıra dışı sayı reddedilir', parseBag(JSON.stringify({ ...good, order: [...good.order.slice(1), N + 5] }), N) === null && parseBag(JSON.stringify({ ...good, pos: -1 }), N) === null && parseBag(JSON.stringify({ ...good, pos: 1.5 }), N) === null);
  check('geçersiz "last" boşa düşer, torba geçerli kalır', parseBag(JSON.stringify({ ...good, last: 9999 }), N)?.last === null);

  console.log('Veritabanı');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  check('ayar varsayılan olarak açık', (await getOpeningEnabled(db)) === true);
  const first = await loadNextQuote(db, seeded(5));
  const stored = await getSetting(db, QUOTE_BAG_KEY);
  check('seçilen söz listeden ve torba kaydedilir', QUOTES.some((q) => q.text === first.text) && parseBag(stored, N)?.pos === 1);
  const seen: string[] = [first.text];
  for (let i = 1; i < N * 2; i += 1) seen.push((await loadNextQuote(db, seeded(i + 100))).text);
  check('veritabanıyla da art arda tekrar yok', seen.every((t, i) => i === 0 || t !== seen[i - 1]));
  check('iki tam turda her söz iki kez', new Set(seen.slice(1, N + 1).concat(seen[0])).size >= N - 1 && new Set(seen).size === N);
  await setSetting(db, QUOTE_BAG_KEY, 'bozuk{');
  const recovered = await loadNextQuote(db, seeded(9));
  check('bozuk kayıttan sonra yeniden başlar', QUOTES.some((q) => q.text === recovered.text) && parseBag(await getSetting(db, QUOTE_BAG_KEY), N)?.pos === 1);
  await setOpeningEnabled(db, false);
  check('kapatılınca ayar kapalı', (await getOpeningEnabled(db)) === false && (await getSetting(db, OPENING_SETTING_KEY)) === '0');
  await setOpeningEnabled(db, true);
  check('açılınca ayar açık', (await getOpeningEnabled(db)) === true);

  console.log('Selamlama ve süre');
  check('selamlama: sabah, gün, akşam, gece', greetingFor(5) === 'Günaydın' && greetingFor(11) === 'Günaydın' && greetingFor(12) === 'İyi günler' && greetingFor(17) === 'İyi günler' && greetingFor(18) === 'İyi akşamlar' && greetingFor(21) === 'İyi akşamlar' && greetingFor(22) === 'İyi geceler' && greetingFor(2) === 'İyi geceler' && greetingFor(4) === 'İyi geceler');
  check('her saat için selamlama var', Array.from({ length: 24 }, (_, h) => greetingFor(h)).every((g) => g.length > 0));
  check('süre en az 3,2 en çok 5,5 saniye', QUOTES.every((q) => displayMs(q.text) >= 3200 && displayMs(q.text) <= 5500) && displayMs('') === 3200 && displayMs('x'.repeat(500)) === 5500);
  check('uzun söz daha uzun kalır', displayMs('x'.repeat(80)) > displayMs('x'.repeat(30)));
  check('arka plandan dönüşte: 20 dakikadan az gösterme, çok ise göster', !shouldShowOnResume(5 * 60_000) && !shouldShowOnResume(RESUME_AWAY_MS - 1) && shouldShowOnResume(RESUME_AWAY_MS) && shouldShowOnResume(3 * 3600_000) && !shouldShowOnResume(NaN));
  check('ayar: yalnızca "0" kapatır', isOpeningEnabled(null) && isOpeningEnabled('1') && isOpeningEnabled('') && !isOpeningEnabled('0'));

  console.log('Açılış penceresi yapılandırması');
  const appJson = JSON.parse(read('app.json')) as { expo: { backgroundColor: string; plugins: unknown[] } };
  const splash = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, { backgroundColor: string; image: string; imageWidth: number }] | undefined;
  check('telefonun açılış penceresi koyu: beyaz (#FFFFFF) kalmamış', !!splash && splash[1].backgroundColor.toUpperCase() === appJson.expo.backgroundColor.toUpperCase() && splash[1].backgroundColor.toUpperCase() !== '#FFFFFF');
  check('açılış penceresinin görseli var', !!splash && splash[1].image.endsWith('.png') && splash[1].imageWidth >= 100);
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  check('expo-splash-screen bağımlılığı eklenmiş', typeof pkg.dependencies['expo-splash-screen'] === 'string');
  const layout = read('app/_layout.tsx');
  check('açılış sözü kök düzende, veritabanı hazır olduktan sonra çizilir', layout.includes('<OpeningQuote />') && layout.indexOf('<OpeningQuote />') > layout.indexOf('<SQLiteProvider'));
  check('açılış penceresi söz çizilene kadar tutulur ve takılırsa bırakılır', layout.includes('preventAutoHideAsync') && layout.includes('hideAsync'));
  const comp = read('components/OpeningQuote.tsx');
  check('bileşen: dokununca geçer, geri tuşu geçer, arka plandan dönüşü dinler', comp.includes('onPress={finish}') && comp.includes('hardwareBackPress') && comp.includes('shouldShowOnResume'));
  check('bileşen: ayar kapalıysa gösterilmez', comp.includes('getOpeningEnabled'));
  check('ayarlar ekranında açma kapama anahtarı var', read('app/settings.tsx').includes('Açılış sözü') && read('app/settings.tsx').includes('setOpeningEnabled'));

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
