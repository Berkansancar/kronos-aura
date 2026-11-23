/**
 * Simge testi: çizilen su bardağı ve şişeleri, rutin simgesi eşleme, eski rutinleri yenileme, beslenme simgeleri.
 * Çalıştırmak için:  npm run test:icons
 */
import { createRoutine, getRoutine, getSetting, listRoutines, setRoutineStatus } from '../database/repository';
import { migrateDbIfNeeded } from '../database/schema';
import { EXERCISES } from '../services/exerciseData';
import { FOOD_GROUPS } from '../services/foodTable';
import { DRINK_PRESETS, MEAL_KINDS, WATER_PRESETS } from '../services/nutritionLogic';
import { DRINK_ICON, FOOD_GROUP_ICON, MEAL_ICON, drinkIcon, groupIcon, mealIcon } from '../services/nutritionIcons';
import { ICON_UPGRADE_KEY, upgradeRoutineIcons } from '../services/routineIconUpgrade';
import {
  CATEGORY_ICON,
  ROUTINE_ICONS,
  foldTr,
  routineIcon,
  routineIconText,
  suggestRoutineIcon,
  upgradedRoutineIcon,
} from '../services/routineLook';
import { ROUTINE_PACKS, ROUTINE_TEMPLATES } from '../services/routineTemplates';
import {
  DRAWN_ICON_TEXT,
  ROUTINE_WATER_ICONS,
  WATER_BOX,
  WATER_COLORS,
  WATER_KIND_LABEL,
  isDrawnIcon,
  waterIconRects,
  waterKindForMl,
  type WaterKind,
} from '../services/waterIcon';
import { makeTestDb } from './sqliteAdapter';

let passed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) throw new Error(`BAŞARISIZ: ${name} ${detail}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const KINDS: WaterKind[] = ['glass', 'bottle-s', 'bottle', 'bottle-l'];
/** Emoji 12 ve sonrası (U+1FA70 üstü) eski Android ve Samsung telefonlarda kutucuk olarak görünebilir. */
const tooNew = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1fa70);
const isEmojiLike = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x2000);

async function main(): Promise<void> {
  console.log('Çizilen su bardağı ve şişeler');
  for (const k of KINDS) {
    const rects = waterIconRects(k);
    check(`${k}: şekiller var ve kutunun içinde`, rects.length >= 4 && rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= WATER_BOX.w && r.y + r.h <= WATER_BOX.h), JSON.stringify(rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > WATER_BOX.w || r.y + r.h > WATER_BOX.h)));
    check(`${k}: boyutlar pozitif, yarıçaplar negatif değil`, rects.every((r) => r.w > 0 && r.h > 0 && (r.r ?? [0, 0, 0, 0]).every((v) => v >= 0)));
    check(`${k}: her şeklin dolgusu ya da çerçevesi var`, rects.every((r) => r.fill !== undefined || r.border !== undefined));
    check(`${k}: suyun rengi kullanılıyor`, rects.some((r) => r.fill === WATER_COLORS.water));
  }
  const top = (k: WaterKind) => Math.min(...waterIconRects(k).map((r) => r.y));
  check('şişeler büyüdükçe daha yükseğe uzanır (küçük < orta < büyük)', top('bottle-s') > top('bottle') && top('bottle') > top('bottle-l'), `${top('bottle-s')} ${top('bottle')} ${top('bottle-l')}`);
  check('şişelerin kapağı ve boynu var, bardağın yok', waterIconRects('bottle').some((r) => r.fill === WATER_COLORS.cap) && !waterIconRects('glass').some((r) => r.fill === WATER_COLORS.cap));
  check('bardağın ağzı açık (üst çerçeve yok)', waterIconRects('glass').some((r) => r.openTop === true));
  const bodyOf = (k: WaterKind) => waterIconRects(k).find((r) => r.border && r.bw && r.bw > 2 && !r.openTop && (r.r?.[0] ?? 0) >= 8);
  const bw = (k: WaterKind) => bodyOf(k)?.w ?? 0;
  check('şişe gövdesi küçükten büyüğe genişler', bw('bottle-s') < bw('bottle') && bw('bottle') < bw('bottle-l'));
  for (const k of ['bottle-s', 'bottle', 'bottle-l'] as WaterKind[]) {
    const body = bodyOf(k);
    const water = waterIconRects(k).filter((r) => r.fill === WATER_COLORS.water);
    check(`${k}: su gövdenin içinde`, !!body && water.every((r) => r.x >= body.x && r.x + r.w <= body.x + body.w && r.y >= body.y && r.y + r.h <= body.y + body.h));
  }
  const gl = waterIconRects('glass');
  const gBody = gl[0];
  check('bardak: su bardağın içinde', gl.filter((r) => r.fill === WATER_COLORS.water).every((r) => r.x >= gBody.x && r.x + r.w <= gBody.x + gBody.w && r.y >= gBody.y && r.y + r.h <= gBody.y + gBody.h));

  console.log('Su miktarına göre simge');
  check('200 ml bardak', waterKindForMl(200) === 'glass' && waterKindForMl(250) === 'glass' && waterKindForMl(260) === 'glass');
  check('330 ml küçük şişe', waterKindForMl(261) === 'bottle-s' && waterKindForMl(330) === 'bottle-s' && waterKindForMl(420) === 'bottle-s');
  check('500 ml şişe', waterKindForMl(421) === 'bottle' && waterKindForMl(500) === 'bottle' && waterKindForMl(620) === 'bottle');
  check('750 ml ve üzeri büyük şişe', waterKindForMl(621) === 'bottle-l' && waterKindForMl(750) === 'bottle-l' && waterKindForMl(1500) === 'bottle-l');
  check('hazır su miktarlarının her birine ayrı simge düşer', new Set(WATER_PRESETS.map((p) => waterKindForMl(p.ml))).size === WATER_PRESETS.length);
  check('bardak 200, küçük şişe 330, şişe 500, büyük şişe 750 ile eşleşir', WATER_PRESETS.map((p) => WATER_KIND_LABEL[waterKindForMl(p.ml)]).join() === 'Bardak,Küçük şişe,Şişe,Büyük şişe', WATER_PRESETS.map((p) => WATER_KIND_LABEL[waterKindForMl(p.ml)]).join());

  console.log('Çizilen rutin simgeleri');
  check('iki çizilen simge: bardak ve şişe', ROUTINE_WATER_ICONS['ico:glass'] === 'glass' && ROUTINE_WATER_ICONS['ico:bottle'] === 'bottle');
  check('çizilen simgenin yazı karşılığı emoji', Object.keys(ROUTINE_WATER_ICONS).every((k) => (DRAWN_ICON_TEXT[k] ?? '').length > 0 && !k.startsWith(DRAWN_ICON_TEXT[k])));
  check('isDrawnIcon', isDrawnIcon('ico:glass') && isDrawnIcon('ico:bottle') && !isDrawnIcon('💧') && !isDrawnIcon(null) && !isDrawnIcon('ico:bilinmeyen'));

  console.log('Simge listesi ve eski telefon uyumu');
  check('seçilebilir simgeler benzersiz', new Set(ROUTINE_ICONS).size === ROUTINE_ICONS.length);
  check('bardak ve şişe seçilebilir, başta', ROUTINE_ICONS[0] === 'ico:glass' && ROUTINE_ICONS[1] === 'ico:bottle');
  check('"ico:" ile başlayan her simge tanımlı', ROUTINE_ICONS.filter((i) => i.startsWith('ico:')).every(isDrawnIcon));
  const emojiIcons = [
    ...ROUTINE_ICONS.filter((i) => !i.startsWith('ico:')),
    ...Object.values(CATEGORY_ICON),
    ...ROUTINE_TEMPLATES.map((t) => t.icon).filter((i) => !i.startsWith('ico:')),
    ...ROUTINE_PACKS.map((p) => p.icon),
    ...Object.values(MEAL_ICON),
    ...Object.values(DRINK_ICON),
    ...Object.values(FOOD_GROUP_ICON),
    ...Object.values(DRAWN_ICON_TEXT),
    ...EXERCISES.map((m) => m.icon),
  ];
  const tooNewOnes = emojiIcons.filter(tooNew);
  check('hiçbir simge Emoji 12+ değil (eski telefonlarda kutucuk çıkmaz)', tooNewOnes.length === 0, tooNewOnes.join(' '));
  check('tüm emoji simgeler gerçekten emoji', emojiIcons.every(isEmojiLike));
  check('diş fırçası emojisi (🪥) hiçbir yerde kullanılmıyor', !emojiIcons.includes('🪥'));

  console.log('Ada göre simge önerisi');
  const cases: [string, string | null][] = [
    ['Bir bardak su iç', 'ico:glass'],
    ['Su iç', 'ico:glass'],
    ['Öğle arası su şişesi doldurma', 'ico:bottle'],
    ['Matarayı doldur', 'ico:bottle'],
    ['Çalışma masası yüzey düzeni', '🧹'],
    ['Ekransız son saat', '📵'],
    ['Uyku hazırlığı (ışıkları kıs, telefonu bırak)', '🌙'],
    ['Oda Havalandırma ve Nefes', '🌬️'],
    ['Zihinsel Odaklanma Seansı', '🧠'],
    ['Nefes ve meditasyon', '🧘'],
    ['Yolda 5 dakika nefes egzersizi', '🌬️'],
    ['Sabah yürüyüşü', '🚶'],
    ['Pazar: uzun yürüyüş', '🚶'],
    ['Dil çalışması', '🗣️'],
    ['Yolda dil çalış (Duolingo)', '🗣️'],
    ['Egzersiz', '🏃'],
    ['Boyun ve sırt esnemesi', '🤸'],
    ['Yatağını topla', '🛏️'],
    ['Diş fırçala, yüzünü yıka', '🦷'],
    ['Duş al, rahatla', '🚿'],
    ['Cilt bakımı', '🧴'],
    ['Kitap oku', '📖'],
    ['Gün sonu notu (3 cümle)', '✍️'],
    ['Günün 3 önceliğini belirle', '🎯'],
    ['Pazar: haftayı planla', '🗓️'],
    ['Bugünün 3 güzel şeyini yaz', '🌟'],
    ['Kahvaltı yap', '🍳'],
    ['Pazar: ev işleri ve çamaşır', '🧺'],
    ['Sevdiğin birine mesaj at ya da ara', '📞'],
    ['Hobine zaman ayır', '🎨'],
    ['Pazar: sevdiklerinle bir kahve', '☕'],
    ['Yarını hazırla', '🎒'],
    ['Derin çalışma bloğu', '🧠'],
    ['Evi 10 dakika toparla', '🧹'],
    ['Vitamin al', '💊'],
    ['Tamamen bilinmeyen bir şey', null],
    ['', null],
    ['   ', null],
  ];
  for (const [title, want] of cases) {
    const got = suggestRoutineIcon(title);
    check(`"${title}" → ${want ?? 'öneri yok'}`, got === want, `veren: ${got}`);
  }
  check('her şablon için bir öneri var', ROUTINE_TEMPLATES.every((t) => suggestRoutineIcon(t.title) !== null), ROUTINE_TEMPLATES.filter((t) => suggestRoutineIcon(t.title) === null).map((t) => t.title).join());
  check('şablonların çoğunda öneri şablonun kendi simgesiyle aynı', ROUTINE_TEMPLATES.filter((t) => suggestRoutineIcon(t.title) === t.icon).length >= ROUTINE_TEMPLATES.length - 4);
  check('foldTr: Türkçe harfler ve noktalama sadeleşir', foldTr('  Öğle ARASI Su-Şişesi, (doldur)! ') === 'ogle arasi su sisesi doldur' && foldTr('İĞNE') === 'igne' && foldTr('ışık') === 'isik');

  console.log('Saklanan simge, öneri ve kategori');
  check('saklanan simge önceliklidir', routineIcon({ icon: '🎧', category: 'SAGLIK', title: 'Bir bardak su iç' }) === '🎧');
  check('simge boşsa ada uyan öneri', routineIcon({ icon: null, category: 'SAGLIK', title: 'Bir bardak su iç' }) === 'ico:glass' && routineIcon({ icon: '  ', category: 'SAGLIK', title: 'Su şişesi doldur' }) === 'ico:bottle');
  check('ad yoksa ya da eşleşmezse kategorinin simgesi', routineIcon({ icon: null, category: 'ZIHIN' }) === CATEGORY_ICON.ZIHIN && routineIcon({ icon: null, category: 'ODAK', title: 'Bilinmeyen' }) === CATEGORY_ICON.ODAK);
  check('yazı içinde çizilen simge emojiye çevrilir', routineIconText({ icon: 'ico:glass', category: 'SAGLIK' }) === DRAWN_ICON_TEXT['ico:glass'] && routineIconText({ icon: 'ico:bottle', category: 'SAGLIK' }) === DRAWN_ICON_TEXT['ico:bottle'] && routineIconText({ icon: '🚶', category: 'SAGLIK' }) === '🚶');
  check('tanınmayan "ico:" anahtarı ham yazı olarak görünmez: ada uyan ya da kategori simgesi gelir', routineIcon({ icon: 'ico:yok', category: 'SAGLIK' }) === CATEGORY_ICON.SAGLIK && routineIcon({ icon: 'ico:yok', category: 'SAGLIK', title: 'Su şişesi doldur' }) === 'ico:bottle' && !routineIconText({ icon: 'ico:yok', category: 'ZIHIN' }).startsWith('ico:'));

  console.log('Eski rutinleri yenileme kuralı');
  const up = (icon: string | null, title: string, category: 'SAGLIK' | 'ZIHIN' | 'ODAK' | 'DUZEN' = 'SAGLIK') => upgradedRoutineIcon({ icon, category, title });
  check('kategori simgesi taşıyan su rutini bardak olur', up('💧', 'Bir bardak su iç') === 'ico:glass');
  check('boş simgeli su şişesi rutini şişe olur', up(null, 'Öğle arası su şişesi doldurma') === 'ico:bottle' && up('', 'Öğle arası su şişesi doldurma') === 'ico:bottle');
  check('ZIHIN kategorisinin varsayılanı da yenilenir', up('🧘', 'Oda Havalandırma ve Nefes', 'ZIHIN') === '🌬️');
  check('kullanıcının seçtiği simge değişmez', up('🏃', 'Bir bardak su iç') === null && up('🎧', 'Su şişesi doldur') === null);
  check('eşleşme yoksa değişmez', up('💧', 'Tamamen bilinmeyen bir şey') === null);
  check('zaten doğruysa değişmez', up('ico:glass', 'Bir bardak su iç') === null);
  check('diş fırçası emojisi (🪥) diş simgesine çevrilir', up('🪥', 'Dişlerimi temizle') === '🦷' && up('🪥', 'Sabah yürüyüşü') === '🦷');

  console.log('Veritabanı: eski rutinler bir kez yenilenir');
  const { db } = makeTestDb();
  await migrateDbIfNeeded(db);
  const mk = (title: string, icon: string | null, category: 'SAGLIK' | 'ZIHIN' | 'ODAK' | 'DUZEN' = 'SAGLIK') =>
    createRoutine(db, { title, category, estimatedDuration: 5, cognitiveWeight: 'LOW', askHour: 9, icon });
  const a = await mk('Bir bardak su iç', '💧');
  const b = await mk('Öğle arası su şişesi doldurma', '💧');
  const c = await mk('Sabah yürüyüşü', '🏃');
  const d = await mk('Dişlerimi temizle', '🪥');
  const e = await mk('Çalışma masası yüzey düzeni', '🌙', 'DUZEN');
  const f = await mk('Tamamen bilinmeyen bir şey', null);
  const g = await mk('Eski su rutini', '💧');
  await setRoutineStatus(db, g.id, 'RETIRED');
  check('başlangıçta işaret yok', (await getSetting(db, ICON_UPGRADE_KEY)) === null);
  const n = await upgradeRoutineIcons(db);
  check('beş rutin yenilendi (bırakılmış olan dahil)', n === 5, String(n));
  check('bardak', (await getRoutine(db, a.id))?.icon === 'ico:glass');
  check('şişe', (await getRoutine(db, b.id))?.icon === 'ico:bottle');
  check('kullanıcının seçimi korundu', (await getRoutine(db, c.id))?.icon === '🏃');
  check('diş simgesi', (await getRoutine(db, d.id))?.icon === '🦷');
  check('düzen kategorisinin varsayılanı ada göre yenilendi', (await getRoutine(db, e.id))?.icon === '🧹');
  check('eşleşmeyen rutin olduğu gibi', (await getRoutine(db, f.id))?.icon === null);
  check('bırakılmış rutin de yenilendi', (await listRoutines(db, 'RETIRED')).find((r) => r.id === g.id)?.icon === 'ico:glass');
  check('işaret konuldu', (await getSetting(db, ICON_UPGRADE_KEY)) === '1');
  const later = await mk('Su iç akşam', '💧');
  check('ikinci çalıştırma hiçbir şey yapmaz (kullanıcı sonradan geri aldığı simge bozulmaz)', (await upgradeRoutineIcons(db)) === 0 && (await getRoutine(db, later.id))?.icon === '💧');
  check('şablondan eklenen su rutini bardak simgesiyle gelir', ROUTINE_TEMPLATES.find((t) => t.id === 'su-ic')?.icon === 'ico:glass');

  console.log('Beslenme simgeleri');
  check('her öğün türünün simgesi var', MEAL_KINDS.every((m) => mealIcon(m.id).length > 0) && mealIcon('ICECEK').length > 0);
  check('öğün simgeleri birbirinden farklı', new Set(Object.values(MEAL_ICON)).size === Object.values(MEAL_ICON).length);
  check('her hazır içeceğin simgesi var', DRINK_PRESETS.every((p) => p.id in DRINK_ICON && drinkIcon(p.id) === DRINK_ICON[p.id]));
  check('çay ve kahve ayrı simge', drinkIcon('cay') !== drinkIcon('kahve'));
  check('her yiyecek grubunun simgesi var', FOOD_GROUPS.every((g) => g.id in FOOD_GROUP_ICON && groupIcon(g.id) === FOOD_GROUP_ICON[g.id]));
  const gi = FOOD_GROUPS.map((g) => FOOD_GROUP_ICON[g.id]).filter((i) => i !== FOOD_GROUP_ICON.SEKERLI_ICECEK && i !== FOOD_GROUP_ICON.KAFEIN);
  check('yiyecek grubu simgeleri birbirinden farklı', new Set(gi).size === gi.length);
  check('bilinmeyen grup ya da içecek için yedek simge', groupIcon('YOK').length > 0 && drinkIcon('yok').length > 0);

  console.log(`\nTüm kontroller geçti: ${passed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
