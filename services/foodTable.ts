/**
 * Yemek tablosu ve yaklaşık kalori tahmini (saf mantık, internet gerekmez).
 *
 * Kullanıcının yazdığı yemek metni ("2 yumurta, 3 dilim ekmek, çay") taranır; tanınan her yemek için
 * porsiyon başına yaklaşık kalori kullanılır. Değerler tipik porsiyonlar içindir ve YAKLAŞIKTIR; kesin
 * ölçüm değildir. Kullanıcı sayıyı her zaman kendisi değiştirebilir. Tanınmayan yemek hesaba katılmaz;
 * hiçbir şey tanınmazsa tahmin null döner (uydurma sayı yazılmaz).
 */

export type FoodGroupId =
  | 'SEBZE'
  | 'MEYVE'
  | 'PROTEIN'
  | 'TAHIL'
  | 'SUT'
  | 'KURUYEMIS'
  | 'TATLI'
  | 'KIZARTMA'
  | 'SEKERLI_ICECEK'
  | 'KAFEIN';

export const FOOD_GROUPS: { id: FoodGroupId; label: string; hint: string }[] = [
  { id: 'SEBZE', label: 'Sebze', hint: 'salata, sebze yemeği' },
  { id: 'MEYVE', label: 'Meyve', hint: 'taze ya da kuru' },
  { id: 'PROTEIN', label: 'Protein', hint: 'et, tavuk, balık, yumurta, baklagil' },
  { id: 'TAHIL', label: 'Ekmek ve tahıl', hint: 'ekmek, pilav, makarna, yulaf' },
  { id: 'SUT', label: 'Süt ürünü', hint: 'süt, yoğurt, ayran, peynir' },
  { id: 'KURUYEMIS', label: 'Kuruyemiş', hint: 'ceviz, badem, fındık' },
  { id: 'TATLI', label: 'Tatlı', hint: 'çikolata, kek, baklava' },
  { id: 'KIZARTMA', label: 'Kızartma, fast food', hint: 'patates kızartması, hamburger' },
  { id: 'SEKERLI_ICECEK', label: 'Şekerli içecek', hint: 'kola, meyve suyu' },
  { id: 'KAFEIN', label: 'Çay, kahve', hint: 'kafeinli içecekler' },
];

export const groupLabel = (id: string): string => FOOD_GROUPS.find((g) => g.id === id)?.label ?? id;

interface Food {
  /** Ekranda gösterilen ad */
  name: string;
  /** Normalleştirilmiş (küçük harf, aksansız) anahtarlar. "=" ile başlayanın sonuna ek getirilemez. */
  keys: string[];
  /** Bir birim için yaklaşık kalori */
  kcal: number;
  /** Sayı verilmezse varsayılan miktar (birim cinsinden) */
  defaultQty?: number;
  /** "150 gr tavuk" gibi gram/ml verilirse bir birim kaç gram sayılır */
  unitGrams?: number;
  groups: FoodGroupId[];
}

const f = (
  name: string,
  keys: string[],
  kcal: number,
  groups: FoodGroupId[],
  extra: { defaultQty?: number; unitGrams?: number } = {}
): Food => ({ name, keys, kcal, groups, ...extra });

export const FOODS: Food[] = [
  // Kahvaltılık
  f('yumurta', ['yumurta'], 80, ['PROTEIN'], { defaultQty: 2, unitGrams: 50 }),
  f('menemen', ['menemen'], 250, ['PROTEIN', 'SEBZE']),
  f('omlet', ['omlet'], 200, ['PROTEIN']),
  f('peynir', ['peynir', '=lor'], 80, ['SUT'], { defaultQty: 2, unitGrams: 30 }),
  f('kaşar', ['kasar'], 70, ['SUT'], { defaultQty: 2, unitGrams: 20 }),
  f('zeytin', ['zeytin'], 8, [], { defaultQty: 5 }),
  f('ekmek', ['ekmek', 'ekmeg'], 80, ['TAHIL'], { defaultQty: 2, unitGrams: 30 }),
  f('yarım ekmek', ['yarim ekmek'], 280, ['TAHIL'], { defaultQty: 1 }),
  f('simit', ['simit'], 300, ['TAHIL']),
  f('poğaça', ['pogaca'], 250, ['TAHIL']),
  f('açma', ['acma'], 250, ['TAHIL']),
  f('börek', ['borek', 'boreg'], 250, ['TAHIL'], { defaultQty: 1 }),
  f('sucuk', ['sucuk', 'sucug'], 40, ['PROTEIN'], { defaultQty: 3 }),
  f('sosis', ['sosis'], 90, ['PROTEIN'], { defaultQty: 2 }),
  f('salam', ['salam'], 25, ['PROTEIN'], { defaultQty: 3 }),
  f('bal', ['=bal'], 60, ['TATLI']),
  f('reçel', ['recel'], 50, ['TATLI']),
  f('pekmez', ['pekmez'], 50, []),
  f('tereyağı', ['tereyag'], 40, []),
  f('tahin', ['tahin'], 90, []),
  f('fıstık ezmesi', ['fistik ezmesi'], 95, ['KURUYEMIS']),
  f('fındık kreması', ['findik ezmesi', 'findik kremasi', 'nutella', 'krem cikolata'], 100, ['TATLI']),
  f('yulaf', ['yulaf'], 220, ['TAHIL'], { defaultQty: 1 }),
  f('granola, müsli', ['granola', 'musli'], 300, ['TAHIL']),
  f('gevrek', ['gevrek', 'gevreg'], 200, ['TAHIL']),

  // Süt ürünleri
  f('süt', ['sut'], 120, ['SUT']),
  f('ayran', ['ayran'], 70, ['SUT']),
  f('yoğurt', ['yogurt', 'yogurd'], 95, ['SUT'], { unitGrams: 150 }),
  f('kefir', ['kefir'], 100, ['SUT']),
  f('cacık', ['cacik'], 70, ['SUT', 'SEBZE']),
  f('sütlaç', ['sutlac'], 250, ['SUT', 'TATLI']),

  // Çorba
  f('mercimek çorbası', ['mercimek corba'], 150, ['TAHIL']),
  f('ezogelin çorbası', ['ezogelin'], 150, ['TAHIL']),
  f('domates çorbası', ['domates corba'], 120, ['SEBZE']),
  f('tavuk çorbası', ['tavuk corba'], 100, ['PROTEIN']),
  f('tarhana çorbası', ['tarhana'], 130, ['TAHIL']),
  f('çorba', ['corba'], 120, []),

  // Ana yemekler
  f('pilav', ['pilav', 'pirinc'], 200, ['TAHIL'], { unitGrams: 150 }),
  f('bulgur pilavı', ['bulgur'], 180, ['TAHIL'], { unitGrams: 150 }),
  f('makarna', ['makarna'], 300, ['TAHIL'], { unitGrams: 200 }),
  f('mantı', ['manti'], 400, ['TAHIL', 'PROTEIN']),
  f('tavuk', ['tavuk', 'tavug', 'pilic', '=hindi'], 190, ['PROTEIN'], { unitGrams: 100 }),
  f('et', ['=et', '=eti', 'etli', 'biftek', 'pirzola', 'kiyma', 'bonfile'], 250, ['PROTEIN'], { unitGrams: 100 }),
  f('köfte', ['kofte'], 70, ['PROTEIN'], { defaultQty: 4 }),
  f('kebap', ['kebap'], 450, ['PROTEIN']),
  f('döner', ['doner'], 450, ['PROTEIN', 'TAHIL']),
  f('dürüm', ['durum'], 500, ['PROTEIN', 'TAHIL']),
  f('iskender', ['iskender'], 700, ['PROTEIN', 'TAHIL']),
  f('lahmacun', ['lahmacun'], 270, ['TAHIL']),
  f('pide', ['pide'], 600, ['TAHIL']),
  f('pizza', ['pizza'], 270, ['TAHIL', 'KIZARTMA'], { defaultQty: 2 }),
  f('hamburger', ['hamburger', 'burger'], 480, ['PROTEIN', 'TAHIL', 'KIZARTMA']),
  f('tost', ['tost'], 350, ['TAHIL', 'SUT']),
  f('sandviç', ['sandvic'], 350, ['TAHIL']),
  f('balık', ['balik', 'baligi', 'somon', 'levrek', 'hamsi'], 200, ['PROTEIN'], { unitGrams: 100 }),
  f('ciğer', ['ciger'], 200, ['PROTEIN']),
  f('kuru fasulye', ['kuru fasulye'], 300, ['PROTEIN']),
  f('nohut yemeği', ['nohut'], 300, ['PROTEIN']),
  f('barbunya', ['barbunya'], 280, ['PROTEIN']),
  f('humus', ['humus'], 150, ['PROTEIN']),
  f('sebze yemeği', ['sebze', 'taze fasulye', 'bamya', 'kabak', 'ispanak', 'karniyarik', 'imam bayildi', 'zeytinyagli', 'patlican'], 150, ['SEBZE']),
  f('salata', ['salata'], 100, ['SEBZE']),
  f('yaprak sarma', ['sarma'], 55, ['SEBZE', 'TAHIL'], { defaultQty: 4 }),
  f('dolma', ['dolma'], 80, ['SEBZE', 'TAHIL'], { defaultQty: 3 }),
  f('turşu', ['tursu'], 10, ['SEBZE']),
  f('domates', ['domates'], 20, ['SEBZE'], { defaultQty: 1 }),
  f('salatalık', ['salatalik'], 15, ['SEBZE'], { defaultQty: 1 }),
  f('havuç', ['havuc'], 30, ['SEBZE']),
  f('brokoli', ['brokoli'], 55, ['SEBZE']),
  f('patates', ['patates'], 150, [], { defaultQty: 1 }),
  f('patates kızartması', ['patates kizartma', 'cips patates'], 350, ['KIZARTMA']),
  f('cips', ['cips'], 160, ['KIZARTMA']),
  f('kızartma', ['kizartma'], 300, ['KIZARTMA']),
  f('sosisli', ['sosisli'], 300, ['KIZARTMA', 'TAHIL']),
  f('mısır', ['=misir'], 130, ['TAHIL']),
  f('patlamış mısır', ['patlamis misir'], 100, ['TAHIL']),
  f('lavaş, tortilla', ['lavas', 'tortilla'], 130, ['TAHIL']),
  f('kraker', ['kraker'], 20, ['TAHIL'], { defaultQty: 4 }),

  // Meyve
  f('elma', ['elma'], 95, ['MEYVE']),
  f('muz', ['=muz', 'muzu'], 105, ['MEYVE']),
  f('portakal', ['portakal'], 70, ['MEYVE']),
  f('mandalina', ['mandalina'], 40, ['MEYVE'], { defaultQty: 2 }),
  f('armut', ['armut'], 100, ['MEYVE']),
  f('şeftali', ['seftali'], 60, ['MEYVE']),
  f('kayısı', ['kayisi'], 20, ['MEYVE'], { defaultQty: 3 }),
  f('kuru kayısı', ['kuru kayisi'], 25, ['MEYVE'], { defaultQty: 4 }),
  f('üzüm', ['uzum'], 100, ['MEYVE']),
  f('karpuz', ['karpuz'], 80, ['MEYVE']),
  f('kavun', ['kavun'], 60, ['MEYVE']),
  f('çilek', ['cilek'], 50, ['MEYVE']),
  f('kiraz, vişne', ['kiraz', 'visne'], 80, ['MEYVE']),
  f('nar', ['=nar'], 120, ['MEYVE']),
  f('incir', ['incir'], 40, ['MEYVE'], { defaultQty: 2 }),
  f('hurma', ['hurma'], 25, ['MEYVE'], { defaultQty: 3 }),
  f('kivi', ['kivi'], 45, ['MEYVE']),
  f('avokado', ['avokado'], 240, ['MEYVE']),
  f('meyve', ['meyve'], 80, ['MEYVE']),

  // Kuruyemiş
  f('ceviz', ['ceviz'], 50, ['KURUYEMIS'], { defaultQty: 3 }),
  f('badem', ['badem'], 7, ['KURUYEMIS'], { defaultQty: 15 }),
  f('fındık', ['findik', 'findig'], 9, ['KURUYEMIS'], { defaultQty: 15 }),
  f('kuruyemiş', ['kuruyemis', 'fistik', 'leblebi'], 180, ['KURUYEMIS']),

  // Tatlı
  f('çikolata', ['cikolata'], 160, ['TATLI']),
  f('gofret', ['gofret'], 120, ['TATLI']),
  f('bisküvi', ['biskuvi'], 30, ['TATLI'], { defaultQty: 3 }),
  f('kek', ['=kek', 'kekten'], 250, ['TATLI']),
  f('kurabiye', ['kurabiye'], 80, ['TATLI'], { defaultQty: 2 }),
  f('baklava', ['baklava'], 170, ['TATLI'], { defaultQty: 2 }),
  f('künefe', ['kunefe'], 500, ['TATLI']),
  f('dondurma', ['dondurma'], 130, ['TATLI'], { defaultQty: 2 }),
  f('lokum', ['lokum'], 40, ['TATLI'], { defaultQty: 2 }),
  f('helva', ['helva'], 200, ['TATLI']),
  f('puding', ['puding'], 150, ['TATLI', 'SUT']),
  f('tatlı', ['tatli'], 300, ['TATLI']),
  f('protein bar', ['protein bar'], 200, ['PROTEIN']),

  // İçecek
  f('kola, gazlı içecek', ['=kola', 'gazli icecek', 'gazoz', 'fanta', 'sprite', 'pepsi'], 140, ['SEKERLI_ICECEK']),
  f('meyve suyu', ['meyve suyu', 'limonata'], 100, ['SEKERLI_ICECEK']),
  f('soğuk çay', ['ice tea', 'soguk cay'], 90, ['SEKERLI_ICECEK']),
  f('enerji içeceği', ['enerji icecegi', 'red bull', 'monster'], 110, ['SEKERLI_ICECEK', 'KAFEIN']),
  f('türk kahvesi', ['turk kahvesi'], 15, ['KAFEIN']),
  f('filtre kahve', ['filtre kahve'], 5, ['KAFEIN']),
  f('latte', ['latte', 'flat white'], 130, ['KAFEIN', 'SUT']),
  f('cappuccino', ['cappuccino', 'kapuccino', 'kapucino'], 90, ['KAFEIN', 'SUT']),
  f('hazır kahve', ['nescafe', '3u1 arada', '3 u 1 arada'], 80, ['KAFEIN']),
  f('kahve', ['kahve'], 5, ['KAFEIN']),
  f('şekerli çay', ['sekerli cay'], 22, ['KAFEIN']),
  f('çay', ['=cay', 'caya', 'cayi', 'cayin'], 2, ['KAFEIN']),
  f('bitki çayı', ['bitki cayi', 'bitkisel cay', 'ihlamur cayi', 'ihlamur cay', 'ihlamur', 'adacayi', 'papatya cayi', 'papatya', 'kusburnu cayi', 'nane limon'], 2, []),
];

// ───────────────────────── Metin normalleştirme ─────────────────────────

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir; harf ve rakam dışını boşluğa çevirir. */
export function normalizeText(s: string): string {
  const mapped = s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
  return mapped
    .replace(/[^a-z0-9.,/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isLetter = (c: string | undefined): boolean => c !== undefined && c >= 'a' && c <= 'z';
const isAlnum = (c: string | undefined): boolean => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'));

const NUMBER_WORDS: Record<string, number> = {
  yarim: 0.5,
  ceyrek: 0.25,
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};

const UNIT_WORDS =
  'adet|tane|dilim|kase|tabak|porsiyon|bardak|kasik|yemek kasigi|cay kasigi|avuc|kutu|sise|kare|top|kulah|paket|fincan|tas|su bardagi';

const BEFORE_RE = new RegExp(
  `(?:^|[\\s,])(bir bucuk|\\d+(?:[.,]\\d+)?|\\d/\\d|yarim|ceyrek|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\\s*(${UNIT_WORDS}|gr|gram|g|ml)?\\s*(?:[a-z]+\\s+)?$`
);
const AFTER_RE = new RegExp(`^\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_WORDS}|gr|gram|g|ml)(?![a-z])`);

function parseNumber(token: string): number | null {
  if (token === 'bir bucuk') return 1.5;
  if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
  if (/^\d\/\d$/.test(token)) {
    const [a, b] = token.split('/').map(Number);
    return b === 0 ? null : a / b;
  }
  const n = Number(token.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ───────────────────────── Tarama ─────────────────────────

interface Hit {
  food: Food;
  start: number;
  end: number;
}

interface FlatKey {
  key: string;
  exact: boolean;
  food: Food;
}

const FLAT_KEYS: FlatKey[] = FOODS.flatMap((food) =>
  food.keys.map((raw) => {
    const exact = raw.startsWith('=');
    const key = normalizeText(exact ? raw.slice(1) : raw);
    return { key, exact, food };
  })
).sort((a, b) => b.key.length - a.key.length);

function scan(text: string): Hit[] {
  const consumed = new Array<boolean>(text.length).fill(false);
  const hits: Hit[] = [];
  for (const { key, exact, food } of FLAT_KEYS) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(key, from);
      if (i < 0) break;
      from = i + 1;
      if (isAlnum(text[i - 1])) continue;
      let k = i + key.length;
      const maxSuffix = exact ? 0 : key.length <= 3 ? 2 : 6;
      let suffix = 0;
      while (isLetter(text[k]) && suffix < maxSuffix) {
        k += 1;
        suffix += 1;
      }
      if (isLetter(text[k])) continue; // ek çok uzun: başka bir sözcük
      let clash = false;
      for (let p = i; p < k; p += 1) if (consumed[p]) clash = true;
      if (clash) continue;
      for (let p = i; p < k; p += 1) consumed[p] = true;
      hits.push({ food, start: i, end: k });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export interface EstimateItem {
  name: string;
  qty: number;
  kcal: number;
  /** Miktar yazılmadığı için varsayılan porsiyon alındı */
  assumed: boolean;
}

export interface MealEstimate {
  /** Tanınan yemek yoksa null */
  kcal: number | null;
  groups: FoodGroupId[];
  items: EstimateItem[];
}

export function estimateMeal(note: string): MealEstimate {
  const text = normalizeText(note);
  if (!text) return { kcal: null, groups: [], items: [] };
  const hits = scan(text);
  const usedNumbers = new Set<number>();
  const items: EstimateItem[] = [];
  const groups: FoodGroupId[] = [];
  let prevEnd = 0;

  for (const h of hits) {
    for (const g of h.food.groups) if (!groups.includes(g)) groups.push(g);

    const segStart = Math.max(prevEnd, h.start - 32);
    const before = text.slice(segStart, h.start);
    let qty: number | null = null;
    let assumed = true;

    const m = BEFORE_RE.exec(before);
    if (m) {
      const numStart = segStart + m.index + m[0].indexOf(m[1]);
      const n = parseNumber(m[1]);
      const unit = m[2];
      if (n !== null && !usedNumbers.has(numStart)) {
        usedNumbers.add(numStart);
        qty = quantityFrom(n, unit, h.food);
      }
    }
    if (qty === null) {
      const after = AFTER_RE.exec(text.slice(h.end, h.end + 24));
      if (after) {
        const n = parseNumber(after[1]);
        if (n !== null) qty = quantityFrom(n, after[2], h.food);
      }
    }
    if (qty !== null) assumed = false;
    else qty = h.food.defaultQty ?? 1;

    const kcal = Math.round(h.food.kcal * qty);
    items.push({ name: h.food.name, qty, kcal, assumed });
    prevEnd = h.end;
  }

  const total = items.reduce((a, i) => a + i.kcal, 0);
  return { kcal: items.length > 0 ? Math.min(total, 6000) : null, groups, items };
}

/** Sayı + birimden miktar çıkarır. Gram/ml verildiyse porsiyon gramına bölünür. */
function quantityFrom(n: number, unit: string | undefined, food: Food): number {
  if (unit === 'gr' || unit === 'gram' || unit === 'g' || unit === 'ml') {
    return food.unitGrams ? Math.min(10, Math.max(0.1, n / food.unitGrams)) : 1;
  }
  if (n > 10 || n <= 0) return 1; // makul olmayan sayı: yok say
  return n;
}

/** Yalnızca besin grupları (yazarken kutucukları önceden işaretlemek için). */
export function detectGroups(note: string): FoodGroupId[] {
  return estimateMeal(note).groups;
}
