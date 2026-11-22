/**
 * Ekipmansız güç programı: 5 hareket grubu, her birinde kolay / orta / zor basamak.
 * Amaç kas büyütmeden güçlenmek: ağır (zor) varyasyon, az tekrar (3-5), uzun dinlenme, tükenmeden bırakma.
 * Her basamağın çizimi, başlangıç ve bitiş pozu olarak ters kinematikle çizilir (exerciseFigure.ts).
 */
import { ang, type LimbSpec, type PoseSpec, type Pt, type PropSpec } from './exerciseFigure';

export type MoveId = 'legs' | 'push' | 'pull' | 'hinge' | 'core';
export type Level = 1 | 2 | 3;
export type Unit = 'rep' | 'sec';

export interface ExerciseVariant {
  level: Level;
  name: string;
  /** Tek cümlelik özet. */
  summary: string;
  /** Adım adım anlatım. */
  steps: string[];
  /** Sık yapılan hatalar. */
  mistakes: string[];
  /** Güvenlik ve ipuçları. */
  tips: string[];
  unit: Unit;
  /** Her tarafın ayrı yapıldığı hareketler (bacak gibi). */
  perSide: boolean;
  /** Hedef: set sayısı ve tekrar (ya da saniye) aralığı. Tüm setlerde üst sınıra ulaşınca bir üst basamağa geçilir. */
  sets: number;
  min: number;
  max: number;
  /** Başlangıç ve bitiş pozu (tutuş hareketlerinde tek poz). */
  poses: PoseSpec[];
  /** Çizimin altındaki kısa etiketler. */
  poseLabels: string[];
}

export interface ExerciseMove {
  id: MoveId;
  title: string;
  /** Çalışan bölge. */
  area: string;
  icon: string;
  why: string;
  variants: [ExerciseVariant, ExerciseVariant, ExerciseVariant];
}

// ---------------------------------------------------------------------------------------------
// Ortak gereçler
// ---------------------------------------------------------------------------------------------

const line = (from: Pt, to: Pt): PropSpec => ({ kind: 'line', from, to });
const rect = (x: number, y: number, w: number, h: number): PropSpec => ({ kind: 'rect', x, y, w, h });

/** Sandalye: oturak üstü `seatY`, soldaki arkalıkla. */
function chair(x: number, seatY = 46, w = 22): PropSpec[] {
  return [
    rect(x, seatY, w, 3),
    line([x + 2, seatY + 3], [x + 2, 62]),
    line([x + w - 2, seatY + 3], [x + w - 2, 62]),
    line([x + 1, seatY], [x + 1, seatY - 22]),
  ];
}

/** Masa: üst yüzey y=22, sağ ayağı x=76'da. `leftLeg` ile sol ayağı da çizilir. */
function table(leftLeg: boolean): PropSpec[] {
  const props: PropSpec[] = [rect(6, 22, 72, 3.5), line([75, 25.5], [75, 62])];
  if (leftLeg) props.push(line([9, 25.5], [9, 62]));
  return props;
}

const A = (to: Pt, bend: LimbSpec['bend'] = 'back', far = false): LimbSpec => ({ to, bend, far });
const L = (to: Pt, bend: LimbSpec['bend'] = 'fwd', far = false): LimbSpec => ({ to, bend, far });

// ---------------------------------------------------------------------------------------------
// 1) BACAK: split squat -> Bulgar split squat -> tek bacak sandalyeye otur-kalk
// ---------------------------------------------------------------------------------------------

const splitTop: PoseSpec = {
  hip: [47, 38],
  neck: [47, 20],
  arms: [A([50, 36])],
  legs: [L([62, 62]), L([32, 62], 'fwd', true)],
};
const splitBottom: PoseSpec = {
  hip: [47, 47],
  neck: [47, 29],
  arms: [A([50, 45])],
  legs: [L([62, 62]), L([27, 61], 'down', true)],
};

const bulgarTop: PoseSpec = {
  hip: [47, 38],
  neck: [47, 20],
  arms: [A([50, 36])],
  legs: [L([62, 62]), L([22, 44], 'down', true)],
  props: chair(8),
};
const bulgarBottom: PoseSpec = {
  hip: [47, 48],
  neck: [47, 30],
  arms: [A([50, 46])],
  legs: [L([61, 62]), L([22, 44], 'down', true)],
  props: chair(8),
};

const boxSquatTop: PoseSpec = {
  hip: [52, 34],
  neck: [52, 16],
  arms: [A([70, 24], 'down')],
  legs: [L([52, 62]), L([79, 39], 'up', true)],
  props: chair(10),
};
const boxSquatBottom: PoseSpec = {
  hip: [36, 44],
  neck: [44, 27],
  arms: [A([60, 30], 'down')],
  legs: [L([50, 62]), L([63, 44], 'up', true)],
  props: chair(10),
};

// ---------------------------------------------------------------------------------------------
// 2) İTME: yavaş şınav -> ayaklar yüksekte şınav -> pike şınav
// ---------------------------------------------------------------------------------------------

/** Tahta (plank) poz: boyundan açı ve uzunlukla kalça ve ayak noktaları çıkar. */
function plank(neck: Pt, deg: number, hand: Pt, elbow: LimbSpec['bend'] = 'back', extra: Partial<PoseSpec> = {}): PoseSpec {
  const hip = ang(neck, deg, 18);
  const foot = ang(neck, deg, 18 + 28.9);
  return { hip, neck, arms: [A(hand, elbow)], legs: [L(foot, 'down')], ...extra };
}

const pushTop = plank([70, 42.5], 203, [70, 62]);
const pushBottom = plank([67, 53], 192, [70, 62]);

const feetUpTop = plank([70, 42.5], 183, [70, 62], 'back', { props: chair(6) });
const feetUpBottom: PoseSpec = {
  hip: [51, 40],
  neck: [67, 52],
  arms: [A([70, 62])],
  legs: [L([22, 44], 'up')],
  props: chair(6),
};

const pikeTop: PoseSpec = {
  hip: [47, 28],
  neck: [60, 43],
  arms: [A([66, 62])],
  legs: [L([25, 45], 'down')],
  props: chair(6),
};
const pikeBottom: PoseSpec = {
  hip: [46, 28],
  neck: [56, 46],
  head: [60, 53],
  arms: [A([66, 62], 'back')],
  legs: [L([24, 45], 'down')],
  props: chair(6),
};

// ---------------------------------------------------------------------------------------------
// 3) ÇEKME: masa altı ters kürek (dizler bükük -> bacaklar düz -> ayaklar sandalyede)
// ---------------------------------------------------------------------------------------------

const rowKneesStart: PoseSpec = {
  hip: [44, 52],
  neck: [62, 46],
  arms: [A([62, 26], 'back')],
  legs: [L([30, 62], 'up')],
  props: table(true),
};
const rowKneesEnd: PoseSpec = {
  hip: [42, 42],
  neck: [59, 32],
  arms: [A([62, 26], 'back')],
  legs: [L([30, 62], 'up')],
  props: table(true),
};

const rowStraightStart = plankRow([62, 46], 16, 60, table(true));
const rowStraightEnd = plankRow([59, 32], 20, 60, table(true));
const rowChairStart = plankRow([62, 46], 14, 44, [...table(false), ...chair(2, 46, 22)]);
const rowChairEnd = plankRow([59, 32], 14, 44, [...table(false), ...chair(2, 46, 22)]);

/** Düz gövdeyle yatış: boyundan ayağa düz çizgi. Uzaklık fazlaysa ayak yaklaştırılır. */
function plankRow(neck: Pt, footX: number, footY: number, props: PropSpec[]): PoseSpec {
  const dx = footX - neck[0];
  const dy = footY - neck[1];
  const d = Math.hypot(dx, dy);
  const total = 18 + 28.9;
  const k = Math.min(1, total / d);
  const foot: Pt = [neck[0] + dx * k, neck[1] + dy * k];
  const hip: Pt = [neck[0] + (dx / d) * 18, neck[1] + (dy / d) * 18];
  return { hip, neck, arms: [A([62, 26], 'back')], legs: [L(foot, 'down')], props };
}

// ---------------------------------------------------------------------------------------------
// 4) ARKA ZİNCİR: kalça köprüsü -> tek bacak köprü -> Nordic curl ilerlemesi
// ---------------------------------------------------------------------------------------------

const bridgeDown: PoseSpec = {
  hip: [42, 58],
  neck: [24, 58],
  head: [18, 58],
  arms: [A([42, 60], 'up')],
  legs: [L([64, 62], 'up')],
};
const bridgeUp: PoseSpec = {
  hip: [42, 43],
  neck: [26, 56],
  head: [20, 58],
  arms: [A([44, 60], 'up')],
  legs: [L([60, 62], 'up')],
};

const singleBridgeDown: PoseSpec = {
  hip: [42, 58],
  neck: [24, 58],
  head: [18, 58],
  arms: [A([42, 60], 'up')],
  legs: [L([64, 62], 'up'), L([64, 40], 'up', true)],
};
const singleBridgeUp: PoseSpec = {
  hip: [42, 43],
  neck: [26, 56],
  head: [20, 58],
  arms: [A([44, 60], 'up')],
  legs: [L([60, 62], 'up'), L([68, 33], 'up', true)],
};

const sofa: PropSpec[] = [rect(10, 42, 28, 14), line([13, 56], [13, 62]), line([35, 56], [35, 62])];
const nordicStart: PoseSpec = {
  hip: [46, 45],
  neck: [46, 27],
  arms: [A([52, 33], 'down')],
  legs: [L([32, 60], 'down')],
  props: sofa,
};
const nordicEnd: PoseSpec = {
  hip: [56, 48],
  neck: ang([56, 48], 50, 18),
  arms: [A([83, 46], 'down')],
  legs: [L([32, 60], 'down')],
  props: sofa,
};

// ---------------------------------------------------------------------------------------------
// 5) KARIN: hollow hold (dizler bükük) -> hollow hold (bacaklar düz) -> L-sit
// ---------------------------------------------------------------------------------------------

const hollowTuck: PoseSpec = {
  hip: [52, 58],
  neck: ang([52, 58], 163, 18),
  arms: [A([16, 50], 'up')],
  legs: [L([68, 50], 'up')],
};
const hollowLong: PoseSpec = {
  hip: [46, 58],
  neck: ang([46, 58], 163, 18),
  arms: [A([10, 49], 'up')],
  legs: [L(ang([46, 58], 27, 28.4), 'up')],
};

const blocks: PropSpec[] = [rect(40, 54, 10, 8)];
const lSit: PoseSpec = {
  hip: [44, 52],
  neck: [47, 34.5],
  arms: [A([46, 54], 'back')],
  legs: [L([72, 52], 'up')],
  props: blocks,
};

// ---------------------------------------------------------------------------------------------
// Hareketler
// ---------------------------------------------------------------------------------------------

export const EXERCISES: ExerciseMove[] = [
  {
    id: 'legs',
    title: 'Bacak',
    area: 'Kalça ve uyluk',
    icon: '🦵',
    why: 'Tek bacak üzerinde çalışmak, iki bacaklı squat\'a göre çok daha ağır bir yük verir. Ağırlık olmadan güç kazanmanın yolu budur.',
    variants: [
      {
        level: 1,
        name: 'Split squat',
        summary: 'Bir ayak önde, bir ayak arkada; yavaşça in, güçlü şekilde kalk.',
        steps: [
          'Ayaklarını bir adım uzunluğunda öne ve arkaya aç. Arka ayağın topuğu havada, parmak ucu yerde olsun.',
          'Gövdeni dik tut, ellerini beline koy.',
          '3 saniyede arka dizin yere yaklaşana kadar in. Ön dizin ayak ucunu çok geçmesin.',
          'Ön ayağınla yeri iterek hızlıca kalk.',
          'Tekrarları bitirince ayak değiştir.',
        ],
        mistakes: ['Ön dizin içeri çökmesin; diz ayağın yönüne baksın.', 'Gövde öne eğilmesin.', 'Zıplayarak ya da hızla düşerek inme.'],
        tips: ['Dengen zayıfsa bir duvara ya da sandalyeye parmak ucuyla dokun.', 'Kolaylaşınca (5 tekrar x 4 set) bir üst basamağa geç.'],
        unit: 'rep',
        perSide: true,
        sets: 4,
        min: 3,
        max: 5,
        poses: [splitTop, splitBottom],
        poseLabels: ['Başlangıç', 'En alt'],
      },
      {
        level: 2,
        name: 'Bulgar split squat',
        summary: 'Arka ayağın sandalyede; ön bacak çok daha fazla yük alır.',
        steps: [
          'Sandalyeye sırtını dön. Arka ayağının üstünü oturağın üzerine koy.',
          'Ön ayağını yaklaşık bir buçuk adım öne at.',
          'Gövdeni dik tutarak 3 saniyede in; ön uyluk yere neredeyse paralel olsun.',
          'Ön topuğunu itip kalk.',
          'Tekrarları bitirince ayak değiştir.',
        ],
        mistakes: ['Ön ayak sandalyeye çok yakın olursa diz zorlanır; mesafeyi aç.', 'Ağırlığı arka ayağa verme; iş ön bacakta.'],
        tips: ['Sandalye kaymasın: duvara dayalı ya da halıya basmayan bir sandalye seç.', 'Dengen sallanırsa elini duvara hafifçe değdir.'],
        unit: 'rep',
        perSide: true,
        sets: 4,
        min: 3,
        max: 5,
        poses: [bulgarTop, bulgarBottom],
        poseLabels: ['Başlangıç', 'En alt'],
      },
      {
        level: 3,
        name: 'Tek bacak sandalyeye otur-kalk',
        summary: 'Pistol squat\'a giden yol: tek bacakla sandalyeye yavaşça otur, tek bacakla kalk.',
        steps: [
          'Sandalyeye sırtını dön, tek ayak üzerinde dur. Serbest bacağını öne uzat.',
          'Kollarını öne uzat, dengen için karşılık ver.',
          '3-4 saniyede sandalyeye kontrollü otur; serbest ayak yere değmesin.',
          'Hemen kalkma: oturağa hafifçe dokun, sonra tek bacağınla ayağa kalk.',
          'Tekrarları bitirince bacak değiştir.',
        ],
        mistakes: ['Kendini sandalyeye bırakma; iniş yavaş ve kontrollü olsun.', 'Dizin içeri çökmesin.'],
        tips: [
          'Çok zorsa sandalyenin üstüne yastık koy (daha yüksek oturak = daha kolay).',
          'Bu basamağı rahat yapınca, oturağı alçaltarak pistol squat\'a yaklaşırsın.',
        ],
        unit: 'rep',
        perSide: true,
        sets: 4,
        min: 3,
        max: 5,
        poses: [boxSquatTop, boxSquatBottom],
        poseLabels: ['Başlangıç', 'Oturuş'],
      },
    ],
  },
  {
    id: 'push',
    title: 'İtme',
    area: 'Göğüs, omuz, arka kol',
    icon: '💪',
    why: 'Şınavı daha zor bir açıya getirerek yük ekleriz; tekrar sayısını artırmak yerine hareketi zorlaştırırız.',
    variants: [
      {
        level: 1,
        name: 'Yavaş inişli şınav',
        summary: 'Normal şınav, ama 3 saniyede in. Yavaş iniş güç kazandırır.',
        steps: [
          'Ellerini omuz genişliğinde yere koy. Vücudun baştan ayağa düz bir çizgi olsun.',
          'Dirseklerini vücuda yaklaşık 45 derece açıyla bük.',
          '3 saniyede göğsün yere yaklaşana kadar in.',
          'Yeri hızlıca iterek kalk.',
        ],
        mistakes: ['Kalçan sarkmasın ya da yukarı kalkmasın.', 'Dirsekler yana tam açılmasın.', 'Başını öne düşürme; boynun gövdeyle aynı hizada olsun.'],
        tips: ['Çok zorsa dizlerini yere koyarak başla.', 'Her sette bir tekrar daha yapabilecekken bırak.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [pushTop, pushBottom],
        poseLabels: ['Başlangıç', 'En alt'],
      },
      {
        level: 2,
        name: 'Ayaklar yüksekte şınav',
        summary: 'Ayaklarını sandalyeye koy; yük göğse ve omuza daha çok biner.',
        steps: [
          'Ayak uçlarını sandalyenin oturağına koy. Ellerin yerde, omuz genişliğinde.',
          'Vücudunu düz tut. Karnını ve kalçanı sık.',
          '3 saniyede in; başın ellerinin biraz önüne gelsin.',
          'Yeri iterek kalk.',
        ],
        mistakes: ['Kalça yukarı kalkıp "V" olmasın.', 'Sandalye kayarsa güvenlik riski: duvara dayalı ve sabit bir sandalye kullan.'],
        tips: ['Ayaklar ne kadar yüksekteyse hareket o kadar zor olur; sandalyeyi gerekirse kitaplarla yükselt.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [feetUpTop, feetUpBottom],
        poseLabels: ['Başlangıç', 'En alt'],
      },
      {
        level: 3,
        name: 'Pike şınav (omuz)',
        summary: 'Kalçan yukarıda, baş yere doğru iner. Omuz için baş aşağı şınava giden yol.',
        steps: [
          'Ellerin yerde, ayakların sandalyede. Kalçanı yukarı kaldırıp ters "V" şeklini al.',
          'Başın iki elin arasında, kolların düz olsun.',
          '3 saniyede başını ellerinin önüne doğru indir; dirsekler yana açılsın.',
          'Omuzlarla iterek başlangıca dön.',
        ],
        mistakes: ['Kalçanı indirip normal şınava çevirme.', 'Başının tepesini sert yere vurma; ilk denemelerde yere yastık koy.'],
        tips: ['Boyun ve omuzda keskin ağrı hissedersen dur.', 'Kolaylaşınca ayakları yükselttikçe baş aşağı şınava yaklaşırsın.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [pikeTop, pikeBottom],
        poseLabels: ['Başlangıç', 'En alt'],
      },
    ],
  },
  {
    id: 'pull',
    title: 'Çekme',
    area: 'Sırt ve kol',
    icon: '🧗',
    why: 'Evde çekme hareketi zordur; sağlam bir masanın altına yatıp kendini çekerek bunu yaparız.',
    variants: [
      {
        level: 1,
        name: 'Masa altı ters kürek (dizler bükük)',
        summary: 'Masanın altına yat, kenarından tut, göğsünü masaya çek. Dizler bükük olduğu için daha kolay.',
        steps: [
          'Çok sağlam, ağır bir masanın altına sırtüstü yat. Gövden masanın kenarından hafif taşsın.',
          'Masanın kenarını omuz genişliğinden biraz geniş tut. Dizlerin bükük, ayakların yerde.',
          'Kalçanı yukarı kaldır, vücut düz çizgi olsun.',
          'Dirseklerini geriye çekerek göğsünü masa kenarına yaklaştır (2 saniye).',
          '3 saniyede yavaşça aşağı in.',
        ],
        mistakes: ['Kalçan sarkmasın.', 'Omuzlarını kulaklarına doğru kaldırma; kürek kemiklerini birbirine yaklaştır.'],
        tips: [
          'ÖNEMLİ: Masa hafifse devrilir ya da kayar. Sadece çok sağlam ve ağır bir masa kullan; duvara dayalı olsun.',
          'Masa kenarı sert geliyorsa ince bir havlu sar.',
          'Güvenli masa yoksa bir kapı barfiks barı ileride en iyi çözüm.',
        ],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [rowKneesStart, rowKneesEnd],
        poseLabels: ['Başlangıç', 'Çekilmiş'],
      },
      {
        level: 2,
        name: 'Masa altı ters kürek (bacaklar düz)',
        summary: 'Aynı hareket; bacaklar düz, vücut tahta gibi. Daha çok ağırlık sana biner.',
        steps: [
          'Masanın altına yat, kenarından tut. Bacaklarını düz uzat; topuklar yerde.',
          'Vücudunu baştan topuğa düz tut.',
          'Göğsünü masa kenarına çek, 2 saniye bekle.',
          '3 saniyede yavaşça in.',
        ],
        mistakes: ['Kalça sarkmasın.', 'Hızlı çekip hızlı düşme.'],
        tips: ['Masanın sağlam olduğundan emin ol.', 'Kolaylaşınca ayakları yükseltmeye geç.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [rowStraightStart, rowStraightEnd],
        poseLabels: ['Başlangıç', 'Çekilmiş'],
      },
      {
        level: 3,
        name: 'Masa altı ters kürek (ayaklar sandalyede)',
        summary: 'Ayaklar yüksekte olunca yük sırta çok daha fazla biner.',
        steps: [
          'Masanın altına yat; topuklarını sandalyenin oturağına koy.',
          'Vücudunu düz tut. Masanın kenarını tut.',
          'Göğsünü masa kenarına çek, 2 saniye bekle.',
          '3 saniyede yavaşça in.',
        ],
        mistakes: ['Kalçanı düşürme.', 'Sandalyenin kaymasına izin verme.'],
        tips: ['Sandalye ve masa kesinlikle sağlam olmalı; ilk denemede birini yanına al.', 'Zorsa dizlerini hafif bük.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [rowChairStart, rowChairEnd],
        poseLabels: ['Başlangıç', 'Çekilmiş'],
      },
    ],
  },
  {
    id: 'hinge',
    title: 'Arka zincir',
    area: 'Kalça ve uyluk arkası',
    icon: '🍑',
    why: 'Kalça ve uyluk arkası vücudun en güçlü bölgesidir. Tek bacak ve yavaş iniş bunu ağırlıksız çalıştırır.',
    variants: [
      {
        level: 1,
        name: 'Kalça köprüsü',
        summary: 'Sırtüstü yat, kalçanı yukarı it, üstte 2 saniye tut.',
        steps: [
          'Sırtüstü yat, dizlerini bük, ayaklarını yere bas. Kollar yanda.',
          'Topuklarınla yeri iterek kalçanı yukarı kaldır.',
          'Üstte kalçanı sık, 2 saniye tut.',
          '3 saniyede yavaşça in.',
        ],
        mistakes: ['Belini fazla kavislendirme; kalçayla it, bel zorlanmasın.', 'Ayaklarını kalçaya çok uzak ya da çok yakın koyma.'],
        tips: ['Kolaylaşınca (5 tekrar x 4 set) tek bacağa geç.'],
        unit: 'rep',
        perSide: false,
        sets: 4,
        min: 3,
        max: 5,
        poses: [bridgeDown, bridgeUp],
        poseLabels: ['Başlangıç', 'Üstte'],
      },
      {
        level: 2,
        name: 'Tek bacak kalça köprüsü',
        summary: 'Bir bacak havada, tek bacakla it. Yük iki kat olur.',
        steps: [
          'Sırtüstü yat. Bir bacağını düz yukarı kaldır.',
          'Yerdeki ayağının topuğuyla iterek kalçanı kaldır.',
          'Üstte 2 saniye sık ve tut.',
          '3 saniyede yavaşça in.',
          'Tekrarları bitirince bacak değiştir.',
        ],
        mistakes: ['Kalçanın bir yanı düşmesin; kalçanı yatay tut.', 'Belinle zorlama.'],
        tips: ['Kramp girerse bir dakika dinlen, esne.'],
        unit: 'rep',
        perSide: true,
        sets: 4,
        min: 3,
        max: 5,
        poses: [singleBridgeDown, singleBridgeUp],
        poseLabels: ['Başlangıç', 'Üstte'],
      },
      {
        level: 3,
        name: 'Nordic curl ilerlemesi',
        summary: 'Uyluk arkası için en güçlü hareketlerden: ayaklar sabit, yavaşça öne düş.',
        steps: [
          'Dizlerinin altına yastık koy. Ayak bileklerini kanepenin altına sıkıştır (ya da biri tutsun).',
          'Dik diz üstünde dur. Gövdeni diz çizgisinden ileri doğru tek parça gibi eğ.',
          'Uyluk arkanla yavaşça düş; mümkün olduğu kadar (5 saniye kadar) frenle.',
          'Yere inince elinle kendini yakala ve ellerini kullanarak başa dön.',
        ],
        mistakes: ['Belini ya da kalçanı kırarak düşme; gövde düz kalsın.', 'Çok hızlı düşme.'],
        tips: [
          'Çok zor bir harekettir; 3 tekrarı bile yavaş yapmak bir başarıdır.',
          'Uyluk arkasında çekme hissi normal; keskin ağrıda dur.',
          'Kanepenin ağır ve sağlam olduğundan emin ol.',
        ],
        unit: 'rep',
        perSide: false,
        sets: 3,
        min: 3,
        max: 5,
        poses: [nordicStart, nordicEnd],
        poseLabels: ['Başlangıç', 'Düşerken'],
      },
    ],
  },
  {
    id: 'core',
    title: 'Karın',
    area: 'Karın ve gövde',
    icon: '🔥',
    why: 'Güçlü gövde, tüm hareketlerde gücü aktarır. Burada tekrar değil, tutuş süresini uzatırız.',
    variants: [
      {
        level: 1,
        name: 'Hollow hold (dizler bükük)',
        summary: 'Sırtüstü, omuzlar ve bacaklar yerden kalkık; bel yere yapışık.',
        steps: [
          'Sırtüstü yat. Belini yere yapıştır.',
          'Kollarını başının arkasına, kulaklarının yanına uzat.',
          'Dizlerini karnına çek; omuzlarını ve başını yerden kaldır.',
          'Bu pozisyonu sabit tut.',
        ],
        mistakes: ['Belinin yerden ayrılmasına izin verme; ayrılırsa bacaklarını yaklaştır.', 'Nefesini tutma.'],
        tips: ['Hedef: tüm setlerde 20 saniye.', 'Zorsa kollarını yanına al.'],
        unit: 'sec',
        perSide: false,
        sets: 3,
        min: 10,
        max: 20,
        poses: [hollowTuck],
        poseLabels: ['Tutuş'],
      },
      {
        level: 2,
        name: 'Hollow hold (bacaklar düz)',
        summary: 'Bacaklar düz ve yerden yüksekte; bel hâlâ yerde.',
        steps: [
          'Sırtüstü yat. Belini yere yapıştır.',
          'Kollarını kulaklarının yanına uzat.',
          'Bacaklarını düz uzat, omuzlarını ve bacaklarını yerden kaldır.',
          'Vücut hafif kavisli bir "kayık" şeklinde, bel yerde kalsın.',
        ],
        mistakes: ['Bacaklar çok alçalınca bel yerden kalkar; bacakları yükselt.', 'Boynu zorlama.'],
        tips: ['Bacaklar ne kadar yere yakınsa o kadar zor.', 'Hedef: tüm setlerde 20 saniye.'],
        unit: 'sec',
        perSide: false,
        sets: 3,
        min: 10,
        max: 20,
        poses: [hollowLong],
        poseLabels: ['Tutuş'],
      },
      {
        level: 3,
        name: 'L-sit (iki yığın üzerinde)',
        summary: 'Ellerin iki sağlam yığının üstünde, bacaklar düz ve yerden yüksekte.',
        steps: [
          'Yere oturup bacaklarını öne uzat. Ellerini kalçanın yanına, yerde duran kalın iki kitap yığınının (ya da sağlam bloğun) üstüne koy.',
          'Kollarını düzleştir, omuzlarını aşağı it ve kalçanı yerden kaldır.',
          'Bacaklarını düz ve yerden yüksekte tut.',
          'Bu pozisyonu sabit tut.',
        ],
        mistakes: ['Omuzlar kulağa çıkmasın; omuzları aşağı it.', 'Dizler bükülmesin.'],
        tips: [
          'Bu basamağa geçmeden önce 20 saniye hollow hold yapabilmelisin.',
          'Güçlü bir hareket; ilk günlerde 3-5 saniye de yeter.',
          'Yığınlar kaymasın: sağlam, düz yüzeyli şeyler kullan.',
        ],
        unit: 'sec',
        perSide: false,
        sets: 3,
        min: 5,
        max: 20,
        poses: [lSit],
        poseLabels: ['Tutuş'],
      },
    ],
  },
];

export const EXERCISE_BY_ID: Record<MoveId, ExerciseMove> = Object.fromEntries(
  EXERCISES.map((m) => [m.id, m])
) as Record<MoveId, ExerciseMove>;

export const LEVEL_NAMES: Record<Level, string> = { 1: 'Kolay', 2: 'Orta', 3: 'Zor' };

/** Programın temel kuralları (egzersiz ekranında gösterilir). */
export const PRINCIPLES: { title: string; text: string }[] = [
  { title: 'Az tekrar, zor hareket', text: 'Her sette 3-5 tekrar. 6-8 tekrar kolay geliyorsa bir üst basamağa geç; tekrar artırma.' },
  { title: 'Uzun dinlen', text: 'Setler arası 3 dakika. Kısa dinlenme kas büyütür; uzun dinlenme gücü artırır.' },
  { title: 'Tükenme', text: 'Bitmeden 1-3 tekrar önce bırak. Hata yapana kadar zorlama.' },
  { title: 'Yavaş in, güçlü kalk', text: 'İnişi 3 saniyede kontrollü yap, kalkışı hızlı ve güçlü.' },
  { title: 'Haftada 3 gün', text: 'Araya en az bir gün dinlenme koy: Salı, Perşembe, Pazar gibi.' },
];

export const SESSIONS_PER_WEEK = 3;
export const REST_SECONDS = 180;
