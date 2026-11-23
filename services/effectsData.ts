/**
 * "Etki" ekranının içeriği: yapılan işin gün gün, hafta hafta vücuda ve zihne ne kazandırdığı.
 * Sayılar yalnızca yayımlanmış çalışmalardan alınır (kaynaklar aşağıda). Tek bir günün sonucu için ölçülmüş
 * bir kalınlık rakamı uydurulmaz: bir günlük çalışma kası gözle ya da ultrasonla ölçülür düzeyde kalınlaştırmaz.
 * Kalınlık rakamı yalnızca şınav için ve yalnızca 8. haftada verilir (ölçülen çalışma budur).
 */
import { EXERCISES, type MoveId } from './exerciseData';

export type EffectId = MoveId | 'water' | 'language';
export type StageId = 'd1' | 'd2' | 'w1' | 'w4' | 'w8' | 'w12';

export interface StageDef {
  id: StageId;
  /** Serinin kaçıncı gününde bu aşamaya ulaşılır */
  afterDays: number;
  label: string;
}

export const STAGES: StageDef[] = [
  { id: 'd1', afterDays: 1, label: '1. gün' },
  { id: 'd2', afterDays: 2, label: '2. gün' },
  { id: 'w1', afterDays: 7, label: '1. hafta' },
  { id: 'w4', afterDays: 28, label: '4. hafta' },
  { id: 'w8', afterDays: 56, label: '8. hafta' },
  { id: 'w12', afterDays: 84, label: '12. hafta' },
];

export interface EffectProfile {
  id: EffectId;
  icon: string;
  title: string;
  /** Güç hareketi mi (kas, kalori, tekrar); değilse günlük alışkanlık */
  strength: boolean;
  /** "Çalışan kaslar" ya da "Etkilenen" listesi */
  focus: string[];
  /** Seri sürsün diye iki aktif gün arasında geçebilecek en çok gün farkı (1 = her gün) */
  maxGap: number;
  /** Aradaki dinlenme günleri aşamayı ilerletir mi (güç antrenmanında evet) */
  restCounts: boolean;
  /** Tekrar (rep) ya da saniye (sec) ya da gün (day) */
  unit: 'rep' | 'sec' | 'day';
  /** 70 kg için yaklaşık kalori (tekrar ya da saniye başına); yoksa kalori gösterilmez */
  kcalPer70?: number;
  stages: Record<StageId, string>;
  /** Kartın altındaki kısa not (isteğe bağlı) */
  note?: string;
}

// Ortak güç aşamaları: kas adı `{kas}` yerine konur
const common = (focus: string, w8: string): Record<StageId, string> => ({
  d1: `Bugün ${focus} çalıştı. Direnç çalışmasından sonra kas protein yapımı ilk 24 saatte yaklaşık iki katına çıkar, 36 saatte neredeyse normale döner. Kalınlık bugün değişmez; çalışan yerde hafif dolgunluk ve yorgunluk normaldir.`,
  d2: 'Toparlanma günü. Protein yapımı normale döndü, kaslar kendini onarıyor. Bugün dinlen; bir sonraki seans uyarıyı yeniden başlatır. Hafif ağrı normaldir, keskin ağrı normal değildir.',
  w1: 'Sinir sistemi hareketi öğrenir: aynı hareketi daha kolay ve daha dengeli yaparsın. İlk haftalardaki güç artışı büyük ölçüde sinir uyumudur; kas henüz belirgin kalınlaşmaz.',
  w4: 'Kas büyümesi ölçülebilir hale gelmeye başlar (çalışmalarda yaklaşık 4. haftadan sonra). Hareket gözle görülür biçimde kolaylaşır; bir üst basamağa geçme zamanı yaklaşır.',
  w8: w8,
  w12: 'Gelişme yavaşlar: kas büyümesi ilk 10 hafta civarında en hızlıdır. Devam ettiren şey, zor basamağa geçmektir. Kazandığın güç ve düzen artık alışkanlığa dönüşmüştür.',
});

const OTHER_W8 =
  'Bu bölgede kalınlaşma ölçülebilir düzeye gelir. Rakam çalışmaya ve kişiye göre değişir. Asıl kazanç, aynı hareketi daha zor bir varyasyonla yapabilmendir.';

const PUSH_W8 =
  '8 haftalık şınav çalışmasında (haftada 2 gün, genç erkekler) ultrasonla ölçülen kalınlık: göğüs kasında yaklaşık 3,8 mm, arka kolda yaklaşık 2,7 mm arttı. Senin program güç odaklı olduğundan bu aralığın alt ucunu bekle.';

const PROGRAM_NOTE =
  'Programın amacı kalınlaşmadan güç kazanmak: 3-5 tekrar ve zor varyasyonla kas hacmi yavaş, güç ise hızlı artar.';

const move = (id: MoveId) => EXERCISES.find((m) => m.id === id)!;

export const PROFILES: EffectProfile[] = [
  {
    id: 'push',
    icon: move('push').icon,
    title: 'İtme (şınav)',
    strength: true,
    focus: ['göğüs', 'ön omuz', 'arka kol (triseps)', 'karın (gövdeyi sabit tutar)'],
    maxGap: 3,
    restCounts: true,
    unit: 'rep',
    kcalPer70: 0.4,
    stages: common('göğüs, ön omuz ve arka kolu', PUSH_W8),
    note: PROGRAM_NOTE,
  },
  {
    id: 'legs',
    icon: move('legs').icon,
    title: 'Bacak',
    strength: true,
    focus: ['kalça', 'ön uyluk (kuadriseps)', 'uyluk arkası', 'denge kasları'],
    maxGap: 3,
    restCounts: true,
    unit: 'rep',
    kcalPer70: 0.5,
    stages: common('kalça ve uyluk kaslarını', OTHER_W8),
    note: PROGRAM_NOTE,
  },
  {
    id: 'pull',
    icon: move('pull').icon,
    title: 'Çekme',
    strength: true,
    focus: ['sırt', 'arka omuz', 'ön kol ve pazı (biseps)'],
    maxGap: 3,
    restCounts: true,
    unit: 'rep',
    kcalPer70: 0.45,
    stages: common('sırt ve pazı kaslarını', OTHER_W8),
    note: PROGRAM_NOTE,
  },
  {
    id: 'hinge',
    icon: move('hinge').icon,
    title: 'Arka zincir',
    strength: true,
    focus: ['kalça', 'uyluk arkası (hamstring)', 'bel kasları'],
    maxGap: 3,
    restCounts: true,
    unit: 'rep',
    kcalPer70: 0.4,
    stages: common('kalça, uyluk arkası ve bel kaslarını', OTHER_W8),
    note: PROGRAM_NOTE,
  },
  {
    id: 'core',
    icon: move('core').icon,
    title: 'Karın',
    strength: true,
    focus: ['karın', 'yan karın', 'derin gövde kasları'],
    maxGap: 3,
    restCounts: true,
    unit: 'sec',
    kcalPer70: 0.07,
    stages: common('karın ve gövde kaslarını', OTHER_W8),
    note: PROGRAM_NOTE,
  },
  {
    id: 'water',
    icon: '💧',
    title: 'Su hedefi',
    strength: false,
    focus: ['sıvı dengesi', 'dikkat', 'böbrekler'],
    maxGap: 1,
    restCounts: false,
    unit: 'day',
    stages: {
      d1: 'Hedefe ulaştın: vücudun sıvı dengesinde. Hafif susuzluk bile dikkati ve ruh halini düşürebilir; bugün bu riski taşımıyorsun.',
      d2: 'İki gün üst üste hedef: böbrekler rahat çalışır, idrar rengi açılır, ağız kuruluğu azalır.',
      w1: 'Susama duyusuna güvenmeyi ve gün boyu birkaç yudum içmeyi öğrenirsin. Gün içi enerji daha dengeli geçmeye başlar.',
      w4: 'Su içmek planlı bir işten çıkıp otomatikleşmeye başlar. Alışkanlıklar ortalama 66 günde yerleşir; yarıya yaklaşmış olursun.',
      w8: 'Alışkanlığın büyük kısmı oturdu. Hatırlatmaya daha az ihtiyaç duyarsın.',
      w12: 'Ortalama 66 günlük yerleşme süresini geçtin: su içmek artık düşünmeden yaptığın bir şey.',
    },
  },
  {
    id: 'language',
    icon: '🗣️',
    title: 'Dil çalışması',
    strength: false,
    focus: ['kelime belleği', 'dinleme ve okuma alışkanlığı'],
    maxGap: 1,
    restCounts: false,
    unit: 'day',
    stages: {
      d1: 'Bugün öğrendiğin kelimeler kısa süreli belleğe girdi. Tekrar edilmezse bir günde çoğu silinir; uygulama bu yüzden yarın sana tekrar soracak.',
      d2: 'İlk tekrar günü: unutma yavaşlar ve kelime bir üst kutuya geçer. Her başarılı tekrar sonrakini daha geriye atar (1, 3, 7, 16, 35. gün).',
      w1: 'Kelimeler 3. ve 7. gün tekrarlarından geçer; tanıdık kelimeleri artık çabuk tanırsın.',
      w4: '16. gün tekrarı: kelimeler uzun süreli belleğe yerleşmeye başlar.',
      w8: 'Düzenli çalışırsan ilk kelimelerin "öğrenildi" kutusuna (35. gün tekrarı) ulaşır ve artık nadiren tekrar ister.',
      w12: 'Dil çalışması alışkanlığa dönüştü (ortalama 66 gün). Öğrenilmiş kelimelerinin sayısı düzenli artar.',
    },
  },
];

export const PROFILE_BY_ID: Record<EffectId, EffectProfile> = Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<
  EffectId,
  EffectProfile
>;

export const MOVE_EFFECT_IDS: MoveId[] = ['push', 'legs', 'pull', 'hinge', 'core'];

/** Ekranın altındaki kaynaklar (internet gerekmez; düz yazı). */
export const SOURCES: string[] = [
  'Kikuchi N, Nakazato K. Low-load bench press and push-up induce similar muscle hypertrophy and strength gain. J Exerc Sci Fit 2017;15(1):37-42. (8 hafta, haftada 2 gün; göğüs 17,0 → 20,8 mm, arka kol 27,7 → 30,4 mm)',
  'MacDougall JD ve ark. The time course for elevated muscle protein synthesis following heavy resistance exercise. Can J Appl Physiol 1995;20(4):480-486. (24 saatte yaklaşık 2 kat, 36 saatte neredeyse normal)',
  'Damas F ve ark. Resistance training-induced changes in integrated myofibrillar protein synthesis are related to hypertrophy only after attenuation of muscle damage. J Physiol 2016;594(18):5209-5222. (ilk haftalarda yapım hasar onarımına gider)',
  'Time course for arm and chest muscle thickness changes following bench press training. Interv Med Appl Sci 2012;4(4):217-220. (kas büyümesi ilk ~10 haftada en hızlı; anlamlı artış yaklaşık 4. haftadan sonra)',
  'Lally P ve ark. How are habits formed: modelling habit formation in the real world. Eur J Soc Psychol 2010;40:998-1009. (alışkanlığın yerleşmesi ortalama 66 gün)',
];

/** Ekranın üstündeki dürüstlük notu. */
export const HONESTY_NOTE =
  'Rakamlar araştırma ortalamalarıdır; kişiden kişiye değişir. Bir günün etkisi gözle görünmez, etkiyi düzenli seri getirir. Kalori değerleri kabadır.';
