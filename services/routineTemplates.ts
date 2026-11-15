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
    title: 'Uyku hazırlığı (ışıkları kıs, telefonu bırak)',
    category: 'DUZEN',
    estimatedDuration: 20,
    cognitiveWeight: 'LOW',
    askHour: 21,
    askMinute: 45,
    why: 'Düzenli yatış saati, ertesi günün enerjisini belirler.',
  },
];

export function getTemplate(id: string): RoutineTemplate | undefined {
  return ROUTINE_TEMPLATES.find((t) => t.id === id);
}
