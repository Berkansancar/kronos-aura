/**
 * Rutin tarzı testi: altı kısa soru, cevaplara göre en uygun rutin paketleri. Saf mantık.
 * Doğru ya da yanlış cevap yoktur; sonuç bir etiket değil, bir başlangıç önerisidir.
 */
import { ROUTINE_PACKS } from './routineTemplates';

export interface QuizOption {
  label: string;
  /** paket id -> puan */
  points: Record<string, number>;
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: QuizOption[];
}

export const STYLE_QUIZ: QuizQuestion[] = [
  {
    id: 'enerji',
    text: 'Gün içinde enerjin en çok ne zaman yüksek olur?',
    options: [
      { label: 'Sabah erken', points: { sabah: 2, hareket: 1 } },
      { label: 'Öğleden sonra', points: { yolda: 1, hareket: 1 } },
      { label: 'Akşam', points: { aksam: 2, 'kendine-bakim': 1 } },
    ],
  },
  {
    id: 'toparlanma',
    text: 'Yoğun bir günün sonunda seni en çok ne toparlar?',
    options: [
      { label: 'Biraz hareket ya da yürüyüş', points: { hareket: 2 } },
      { label: 'Sakin bir akşam, duş, kitap', points: { aksam: 2, 'kendine-bakim': 1 } },
      { label: 'Kendime küçük bir keyif ayırmak', points: { 'kendine-bakim': 2 } },
      { label: 'Yarını hazırlayıp rahatlamak', points: { yolda: 1, aksam: 1 } },
    ],
  },
  {
    id: 'sabah',
    text: 'Sabahların nasıl geçer?',
    options: [
      { label: 'Acelem olur, her dakika sayılır', points: { yolda: 2 } },
      { label: 'Kısa bir hazırlıkla çıkarım', points: { sabah: 1, yolda: 1 } },
      { label: 'Yavaş ve sakin başlamayı severim', points: { sabah: 2, 'kendine-bakim': 1 } },
    ],
  },
  {
    id: 'aliskanlik',
    text: 'Yeni bir alışkanlık için hangisi sana daha kolay gelir?',
    options: [
      { label: 'Çok küçük adımlar', points: { 'kendine-bakim': 1, sabah: 1 } },
      { label: 'Net bir saat ve liste', points: { yolda: 1, aksam: 1 } },
      { label: 'Hareket içeren şeyler', points: { hareket: 2 } },
    ],
  },
  {
    id: 'yol',
    text: 'Yolda geçen vaktini nasıl değerlendirmek istersin?',
    options: [
      { label: 'Bir şey öğrenerek', points: { yolda: 2 } },
      { label: 'Nefes alıp dinlenerek', points: { yolda: 1, 'kendine-bakim': 1 } },
      { label: 'Fark etmez, zaten yoldayım', points: { aksam: 1 } },
    ],
  },
  {
    id: 'bosgun',
    text: 'Boş bir gün (ör. Pazar) nasıl olsun?',
    options: [
      { label: 'Dışarıda, hareketli', points: { hareket: 2, pazar: 1 } },
      { label: 'Evde, dinlenerek', points: { 'kendine-bakim': 2, aksam: 1, pazar: 1 } },
      { label: 'Planlı: işleri toparlamak', points: { aksam: 1, yolda: 1, pazar: 2 } },
    ],
  },
];

/** Her paketin sonuç başlığı ve kısa açıklaması. */
export const STYLE_RESULT: Record<string, { title: string; text: string }> = {
  sabah: {
    title: 'Güne sakin başlayan',
    text: 'Sabahın ilk saatlerini en verimli kullanıyorsun. Küçük bir sabah düzeni sana en çok yarar.',
  },
  yolda: {
    title: 'Yolu değerlendiren',
    text: 'Zamanın kısıtlı ama düzenlisin. Yolda ve iş çıkışında yapılacak küçük adımlar sana uyar.',
  },
  aksam: {
    title: 'Günü akşam toparlayan',
    text: 'Akşam daha sakin ve odaklısın. Günü kapatıp uykuya hazırlanan bir düzen sana iyi gelir.',
  },
  'kendine-bakim': {
    title: 'Kendine zaman ayıran',
    text: 'Hafif ve keyifli adımlar seni motive ediyor. Kendine ayırdığın küçük anlar enerjini yeniler.',
  },
  pazar: {
    title: 'Boş günü değerlendiren',
    text: 'Boş günlerde hem dinlenmek hem toparlanmak istiyorsun. Pazar için küçük bir düzen sana iyi gelir.',
  },
  hareket: {
    title: 'Hareketle açılan',
    text: 'Bedenin hareket ettikçe zihnin de açılıyor. Kısa ve yorucu olmayan hareketler sana uyar.',
  },
};

export interface QuizResult {
  /** Puana göre sıralı paket id'leri (ilk iki öneri) */
  packs: string[];
  title: string;
  text: string;
  scores: Record<string, number>;
}

/** `answers[i]`: i. sorunun seçilen seçenek sırası. Eksik cevaplar sayılmaz. */
export function scoreQuiz(answers: (number | null)[]): QuizResult {
  const scores: Record<string, number> = {};
  for (const p of ROUTINE_PACKS) scores[p.id] = 0;
  STYLE_QUIZ.forEach((q, i) => {
    const a = answers[i];
    if (a === null || a === undefined) return;
    const opt = q.options[a];
    if (!opt) return;
    for (const [id, pts] of Object.entries(opt.points)) {
      if (id in scores) scores[id] += pts;
    }
  });
  // Eşitlikte pakette tanımlı sıra korunur (kararlı sıralama).
  const order = ROUTINE_PACKS.map((p) => p.id);
  const ranked = [...order].sort((a, b) => scores[b] - scores[a] || order.indexOf(a) - order.indexOf(b));
  const top = ranked[0];
  return { packs: ranked.slice(0, 2), title: STYLE_RESULT[top].title, text: STYLE_RESULT[top].text, scores };
}
