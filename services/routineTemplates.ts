/**
 * Hazır rutin örnekleri. Kullanıcı bunlardan istediğini tek dokunuşla ekler; saat, süre ve ad sonradan
 * değiştirilebilir. `askHour:askMinute`, uygulamanın "bugün yapacak mısın?" diye sorduğu saattir.
 */
import type { CognitiveWeight, RoutineCategory } from '../database/types';

export interface RoutineTemplate {
  id: string;
  title: string;
  category: RoutineCategory;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  askHour: number;
  askMinute: number;
  /** Tek cümlelik fayda */
  why: string;
  /** Varsayılan simge (emoji) */
  icon: string;
  /** Yalnızca bu günlerde yapılır (0 = Pazar); yoksa her gün */
  days?: number[];
}

export const CATEGORY_LABEL: Record<RoutineCategory, string> = {
  SAGLIK: 'Sağlık ve hareket',
  ZIHIN: 'Zihin ve denge',
  ODAK: 'Odak ve üretim',
  DUZEN: 'Düzen ve uyku',
};

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  // Sağlık ve hareket
  {
    id: 'su-ic',
    icon: '💧',
    title: 'Bir bardak su iç',
    category: 'SAGLIK',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 8,
    askMinute: 0,
    why: 'Güne küçük bir kazanımla başla.',
  },
  {
    id: 'sabah-yuruyus',
    icon: '🚶',
    title: 'Sabah yürüyüşü',
    category: 'SAGLIK',
    estimatedDuration: 20,
    cognitiveWeight: 'LOW',
    askHour: 8,
    askMinute: 30,
    why: 'Gün ışığı ve hareket, enerjiyi ve uyku düzenini destekler.',
  },
  {
    id: 'egzersiz',
    icon: '🏃',
    title: 'Egzersiz',
    category: 'SAGLIK',
    estimatedDuration: 45,
    cognitiveWeight: 'MEDIUM',
    askHour: 18,
    askMinute: 30,
    why: 'Düzenli hareket, odak ve ruh hali için en güvenilir yatırım.',
  },
  {
    id: 'ogle-yuruyus',
    icon: '🚶',
    title: 'Öğle arası yürüyüşü',
    category: 'SAGLIK',
    estimatedDuration: 15,
    cognitiveWeight: 'LOW',
    askHour: 13,
    askMinute: 0,
    why: 'Öğleden sonra enerji çukuruna karşı kısa bir sıfırlama.',
  },
  // Zihin ve denge
  {
    id: 'nefes-meditasyon',
    icon: '🧘',
    title: 'Nefes ve meditasyon',
    category: 'ZIHIN',
    estimatedDuration: 10,
    cognitiveWeight: 'LOW',
    askHour: 12,
    askMinute: 30,
    why: 'Zihni sakinleştirir, dağınıklığı azaltır.',
  },
  {
    id: 'gunluk-notu',
    icon: '✍️',
    title: 'Gün sonu notu (3 cümle)',
    category: 'ZIHIN',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 0,
    why: 'Günü kapatmak, zihni yarına hazırlar.',
  },
  {
    id: 'kitap-oku',
    icon: '📖',
    title: 'Kitap oku',
    category: 'ZIHIN',
    estimatedDuration: 30,
    cognitiveWeight: 'LOW',
    askHour: 20,
    askMinute: 30,
    why: 'Ekransız, yavaş bir öğrenme alanı.',
  },
  // Odak ve üretim
  {
    id: 'gunu-planla',
    icon: '🎯',
    title: 'Günün 3 önceliğini belirle',
    category: 'ODAK',
    estimatedDuration: 10,
    cognitiveWeight: 'MEDIUM',
    askHour: 8,
    askMinute: 15,
    why: 'Neyin önemli olduğunu baştan seçmek, günü kurtarır.',
  },
  {
    id: 'derin-calisma',
    icon: '🧠',
    title: 'Derin çalışma bloğu',
    category: 'ODAK',
    estimatedDuration: 90,
    cognitiveWeight: 'HIGH',
    askHour: 10,
    askMinute: 0,
    why: 'En zor işi tepe enerji saatine koy.',
  },
  {
    id: 'dil-calis',
    icon: '🗣️',
    title: 'Dil çalışması',
    category: 'ODAK',
    estimatedDuration: 20,
    cognitiveWeight: 'MEDIUM',
    askHour: 19,
    askMinute: 0,
    why: 'Her gün küçük bir adım, haftalık büyük farktır.',
  },
  // Düzen ve uyku
  {
    id: 'yarini-hazirla',
    icon: '🎒',
    title: 'Yarını hazırla',
    category: 'DUZEN',
    estimatedDuration: 10,
    cognitiveWeight: 'LOW',
    askHour: 20,
    askMinute: 45,
    why: 'Sabaha hazır başlamak, karar yorgunluğunu azaltır.',
  },
  {
    id: 'ekransiz-saat',
    icon: '📵',
    title: 'Ekransız son saat',
    category: 'DUZEN',
    estimatedDuration: 60,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 30,
    why: 'Yatmadan önce ekranı bırakmak uykuyu kolaylaştırır.',
  },
  {
    id: 'uyku-hazirligi',
    icon: '🌙',
    title: 'Uyku hazırlığı (ışıkları kıs, telefonu bırak)',
    category: 'DUZEN',
    estimatedDuration: 20,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 45,
    why: 'Düzenli yatış saati, ertesi günün enerjisini belirler.',
  },
  // Güne başlarken
  {
    id: 'yatagi-topla',
    icon: '🛏️',
    title: 'Yatağını topla',
    category: 'DUZEN',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 6,
    askMinute: 35,
    why: 'Güne yapılmış küçük bir işle başlamak, gerisini kolaylaştırır.',
  },
  {
    id: 'dis-yuz',
    icon: '🪥',
    title: 'Diş fırçala, yüzünü yıka',
    category: 'SAGLIK',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 6,
    askMinute: 40,
    why: 'Her sabah aynı küçük adım, günün ritmini kurar.',
  },
  {
    id: 'kahvalti',
    icon: '🍳',
    title: 'Kahvaltı yap',
    category: 'SAGLIK',
    estimatedDuration: 15,
    cognitiveWeight: 'LOW',
    askHour: 6,
    askMinute: 50,
    why: 'Aç karnına başlayan gün, öğleye doğru enerjiyi düşürür.',
  },
  {
    id: 'esneme',
    icon: '🤸',
    title: 'Boyun ve sırt esnemesi',
    category: 'SAGLIK',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 18,
    askMinute: 20,
    why: 'Gün boyu ayakta ya da eğik kalan bedene kısa bir teşekkür.',
  },
  // Akşam ve kendine bakım
  {
    id: 'dus',
    icon: '🚿',
    title: 'Duş al, rahatla',
    category: 'SAGLIK',
    estimatedDuration: 15,
    cognitiveWeight: 'LOW',
    askHour: 19,
    askMinute: 0,
    why: 'Günün yorgunluğunu atmak, akşamı yumuşatır.',
  },
  {
    id: 'cilt-bakimi',
    icon: '🧴',
    title: 'Cilt bakımı',
    category: 'SAGLIK',
    estimatedDuration: 10,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 15,
    why: 'Kendine ayırdığın küçük, sakin bir an.',
  },
  {
    id: 'evi-toparla',
    icon: '🧹',
    title: 'Evi 10 dakika toparla',
    category: 'DUZEN',
    estimatedDuration: 10,
    cognitiveWeight: 'LOW',
    askHour: 19,
    askMinute: 15,
    why: 'Düzenli bir ortam, zihni de hafifletir.',
  },
  {
    id: 'sukran',
    icon: '🌟',
    title: 'Bugünün 3 güzel şeyini yaz',
    category: 'ZIHIN',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 0,
    why: 'İyi giden küçük şeyleri fark etmek, ruh halini destekler.',
  },
  {
    id: 'sevdigini-ara',
    icon: '📞',
    title: 'Sevdiğin birine mesaj at ya da ara',
    category: 'ZIHIN',
    estimatedDuration: 10,
    cognitiveWeight: 'LOW',
    askHour: 19,
    askMinute: 30,
    why: 'Küçük bir bağlantı, günün ağırlığını paylaşmanı sağlar.',
  },
  {
    id: 'hobi',
    icon: '🎨',
    title: 'Hobine zaman ayır',
    category: 'ZIHIN',
    estimatedDuration: 30,
    cognitiveWeight: 'LOW',
    askHour: 20,
    askMinute: 0,
    why: 'Sadece keyif için yaptığın bir şey, enerjini yeniler.',
  },
  // Yolda
  {
    id: 'yolda-nefes',
    icon: '🌬️',
    title: 'Yolda 5 dakika nefes egzersizi',
    category: 'ZIHIN',
    estimatedDuration: 5,
    cognitiveWeight: 'LOW',
    askHour: 7,
    askMinute: 5,
    why: 'Minibüste de yapılır; güne sakin başlamanı sağlar.',
    days: [1, 2, 3, 4, 5, 6],
  },
  {
    id: 'yolda-dil',
    icon: '🗣️',
    title: 'Yolda dil çalış (Duolingo)',
    category: 'ODAK',
    estimatedDuration: 15,
    cognitiveWeight: 'LOW',
    askHour: 7,
    askMinute: 10,
    why: 'Yol süresi, küçük ama düzenli bir öğrenme alanına dönüşür.',
    days: [1, 2, 3, 4, 5, 6],
  },
  // Pazar (boş gün)
  {
    id: 'pazar-plan',
    icon: '🗓️',
    title: 'Pazar: haftayı planla',
    category: 'ODAK',
    estimatedDuration: 20,
    cognitiveWeight: 'MEDIUM',
    askHour: 10,
    askMinute: 0,
    days: [0],
    why: 'Pazar sabahı yapılan 20 dakikalık plan, haftanın geri kalanını hafifletir.',
  },
  {
    id: 'pazar-yuruyus',
    icon: '🥾',
    title: 'Pazar: uzun yürüyüş',
    category: 'SAGLIK',
    estimatedDuration: 45,
    cognitiveWeight: 'LOW',
    askHour: 11,
    askMinute: 0,
    days: [0],
    why: 'Boş günün en güzel yatırımı: açık hava ve hareket.',
  },
  {
    id: 'pazar-ev',
    icon: '🧺',
    title: 'Pazar: ev işleri ve çamaşır',
    category: 'DUZEN',
    estimatedDuration: 60,
    cognitiveWeight: 'LOW',
    askHour: 13,
    askMinute: 0,
    days: [0],
    why: 'Haftanın birikenlerini tek seferde toplamak, hafta içini rahatlatır.',
  },
  {
    id: 'pazar-sevdikler',
    icon: '☕',
    title: 'Pazar: sevdiklerinle bir kahve',
    category: 'ZIHIN',
    estimatedDuration: 60,
    cognitiveWeight: 'LOW',
    askHour: 15,
    askMinute: 30,
    days: [0],
    why: 'Birlikte geçirilen vakit, enerjini yeniler.',
  },
];

/**
 * Paket: bir kullanıcı tipine ya da günün bir kısmına uygun, birlikte eklenen rutinler.
 * `items` içinde saat verilirse şablonun varsayılan saati yerine o kullanılır.
 */
export interface RoutinePack {
  id: string;
  title: string;
  icon: string;
  about: string;
  items: { templateId: string; hour?: number; minute?: number }[];
}

export const ROUTINE_PACKS: RoutinePack[] = [
  {
    id: 'sabah',
    title: 'Güne güzel başla',
    icon: '🌅',
    about: 'İşe çıkmadan önce 25 dakikalık sakin bir sabah düzeni.',
    items: [
      { templateId: 'yatagi-topla', hour: 6, minute: 35 },
      { templateId: 'dis-yuz', hour: 6, minute: 40 },
      { templateId: 'su-ic', hour: 6, minute: 45 },
      { templateId: 'kahvalti', hour: 6, minute: 50 },
      { templateId: 'gunu-planla', hour: 7, minute: 0 },
    ],
  },
  {
    id: 'yolda',
    title: 'Yolda ve iş çıkışı',
    icon: '🚌',
    about: 'Minibüs yolculuğunu ve iş çıkışını değerlendiren küçük adımlar.',
    items: [
      { templateId: 'yolda-nefes', hour: 7, minute: 5 },
      { templateId: 'yolda-dil', hour: 7, minute: 10 },
      { templateId: 'esneme', hour: 18, minute: 20 },
      { templateId: 'egzersiz', hour: 18, minute: 45 },
    ],
  },
  {
    id: 'aksam',
    title: 'Akşam sakinliği',
    icon: '🌙',
    about: 'Günü kapatıp rahat bir uykuya hazırlanma düzeni.',
    items: [
      { templateId: 'dus', hour: 19, minute: 0 },
      { templateId: 'yarini-hazirla', hour: 20, minute: 45 },
      { templateId: 'sukran', hour: 21, minute: 0 },
      { templateId: 'cilt-bakimi', hour: 21, minute: 15 },
      { templateId: 'ekransiz-saat', hour: 21, minute: 30 },
      { templateId: 'uyku-hazirligi', hour: 21, minute: 45 },
    ],
  },
  {
    id: 'kendine-bakim',
    title: 'Kendine bakım',
    icon: '💆',
    about: 'Akşamları sana ayrılmış, hafif ve keyifli rutinler.',
    items: [
      { templateId: 'sevdigini-ara', hour: 19, minute: 30 },
      { templateId: 'hobi', hour: 20, minute: 0 },
      { templateId: 'kitap-oku', hour: 20, minute: 30 },
      { templateId: 'sukran', hour: 21, minute: 0 },
    ],
  },
  {
    id: 'hareket',
    title: 'Hareket ve enerji',
    icon: '⚡',
    about: 'Bedenini canlı tutan, yorucu olmayan hareketler.',
    items: [
      { templateId: 'esneme', hour: 18, minute: 20 },
      { templateId: 'egzersiz', hour: 18, minute: 45 },
      { templateId: 'evi-toparla', hour: 19, minute: 15 },
    ],
  },
  {
    id: 'pazar',
    title: 'Pazar: boş gün',
    icon: '🌿',
    about: 'İşin olmadığı günü hem dinlendiren hem toparlayan küçük bir düzen. Yalnızca Pazar günleri sorulur.',
    items: [
      { templateId: 'pazar-plan', hour: 10, minute: 0 },
      { templateId: 'pazar-yuruyus', hour: 11, minute: 0 },
      { templateId: 'pazar-ev', hour: 13, minute: 0 },
      { templateId: 'pazar-sevdikler', hour: 15, minute: 30 },
    ],
  },
];

export function getPack(id: string): RoutinePack | undefined {
  return ROUTINE_PACKS.find((p) => p.id === id);
}


export function getTemplate(id: string): RoutineTemplate | undefined {
  return ROUTINE_TEMPLATES.find((t) => t.id === id);
}
