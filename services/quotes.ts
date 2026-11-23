/**
 * Açılış sözleri (saf mantık): uygulama her açıldığında farklı, anlamlı bir söz gösterilir.
 * Sözler "torba" düzeniyle seçilir: liste karıştırılır, hepsi birer kez gösterilmeden hiçbiri tekrar etmez;
 * yeni torbanın ilk sözü bir önceki torbanın sonuncusu olmaz. Torbanın durumu Ayarlar tablosunda saklanır.
 * Çizimi components/OpeningQuote.tsx yapar; veritabanı kısmı services/quoteStore.ts.
 */

export type QuoteKind = 'atasozu' | 'bilge' | 'kronos' | 'aura';

export interface Quote {
  text: string;
  /** Söyleyen: "Atasözü", bir düşünür ya da uygulamanın iki koçu (Kronos, Aura) */
  author: string;
}

export const ATASOZU = 'Atasözü';

/** Kronos (zaman) ve Aura (enerji) sözleri bu uygulamaya özel yazılmıştır; diğerleri atasözleri ve bilinen düşünürlerin serbest çevirisidir. */
export const QUOTES: Quote[] = [
  // Atasözleri
  { text: 'Damlaya damlaya göl olur.', author: ATASOZU },
  { text: 'Sabreden derviş muradına ermiş.', author: ATASOZU },
  { text: 'Bugünün işini yarına bırakma.', author: ATASOZU },
  { text: 'Ne ekersen onu biçersin.', author: ATASOZU },
  { text: 'Erken kalkan yol alır.', author: ATASOZU },
  { text: 'Sakla samanı, gelir zamanı.', author: ATASOZU },
  { text: 'Bu da geçer.', author: ATASOZU },
  { text: 'Gülü seven dikenine katlanır.', author: ATASOZU },
  { text: 'Sabır acıdır, meyvesi tatlıdır.', author: ATASOZU },
  { text: 'Su akar, yolunu bulur.', author: ATASOZU },
  { text: 'Ağaç yaşken eğilir.', author: ATASOZU },
  { text: 'Âdet ikinci tabiattır.', author: ATASOZU },
  { text: 'Bin düşün bir söyle.', author: ATASOZU },
  { text: 'Acele işe şeytan karışır.', author: ATASOZU },
  { text: 'Sabrın sonu selamettir.', author: ATASOZU },
  { text: 'İşleyen demir ışıldar.', author: ATASOZU },
  { text: 'Her şeyin bir zamanı vardır.', author: ATASOZU },
  { text: 'Gün doğmadan neler doğar.', author: ATASOZU },
  { text: 'Umut fakirin ekmeğidir.', author: ATASOZU },
  { text: 'Emeksiz yemek olmaz.', author: ATASOZU },
  { text: 'Ağır ol ki batman gelsin.', author: ATASOZU },
  { text: 'Her işte bir hayır vardır.', author: ATASOZU },

  // Düşünürler
  { text: 'Bin millik yolculuk tek bir adımla başlar.', author: 'Lao Tzu' },
  { text: 'Önündeki engel, yolun kendisine dönüşür.', author: 'Marcus Aurelius' },
  { text: 'Zihin, düşüncelerinin rengini alır.', author: 'Marcus Aurelius' },
  { text: 'Sabah kalkmak zor geldiğinde şunu hatırla: bir insan olarak yapacak işlerim var.', author: 'Marcus Aurelius' },
  { text: 'Bizi üzen, olayların kendisi değil, onlara yüklediğimiz anlamlardır.', author: 'Epiktetos' },
  { text: 'Elinde olanı yap, olmayanı bırak.', author: 'Epiktetos' },
  { text: 'Zor olduğu için cesaret edemiyor değiliz; cesaret etmediğimiz için zor görünüyor.', author: 'Seneca' },
  { text: 'Hayatımız kısa değil; biz onun büyük kısmını boşa harcıyoruz.', author: 'Seneca' },
  { text: 'Sorgulanmamış bir hayat yaşanmaya değmez.', author: 'Sokrates' },
  { text: 'Değişimden başka hiçbir şey değişmez.', author: 'Herakleitos' },
  { text: 'Hayatı seviyorsan zamanı boşa harcama; çünkü hayat zamandan yapılmıştır.', author: 'Benjamin Franklin' },
  { text: 'Bilmek yetmez, uygulamak gerekir; istemek yetmez, yapmak gerekir.', author: 'Goethe' },
  { text: 'Yapılana kadar her şey imkânsız görünür.', author: 'Nelson Mandela' },
  { text: 'Kışın ortasında, içimde yenilmez bir yaz olduğunu öğrendim.', author: 'Albert Camus' },
  { text: 'Hayatta en hakiki mürşit ilimdir, fendir.', author: 'Mustafa Kemal Atatürk' },
  { text: 'Biz, tekrar tekrar yaptığımız şeyleriz; mükemmellik bir eylem değil, bir alışkanlıktır.', author: 'Will Durant' },
  { text: 'Önemli olan hayatın uzunluğu değil, ne kadar iyi yaşandığıdır.', author: 'Seneca' },
  { text: 'Önce ne olmak istediğini kendine söyle; sonra yapman gerekeni yap.', author: 'Epiktetos' },
  { text: 'Yavaş ilerlemekten korkma; durmaktan kork.', author: 'Çin atasözü' },
  { text: 'Doğa acele etmez, ama her şey tamamlanır.', author: 'Lao Tzu' },
  { text: 'Başkalarını bilmek akıllılık, kendini bilmek bilgeliktir.', author: 'Lao Tzu' },
  { text: 'Tutkusuz hiçbir büyük iş başarılmamıştır.', author: 'Ralph Waldo Emerson' },
  { text: 'Kendine güvenmek, başarının ilk sırrıdır.', author: 'Ralph Waldo Emerson' },
  { text: 'Hayal gücü bilgiden daha önemlidir.', author: 'Albert Einstein' },
  { text: 'Hayatta korkulacak bir şey yok, yalnızca anlaşılması gereken şeyler var.', author: 'Marie Curie' },
  { text: 'Elindekiyle, bulunduğun yerde, yapabileceğini yap.', author: 'Theodore Roosevelt' },
  { text: 'Daha iyisini bildiğin an, daha iyisini yap.', author: 'Maya Angelou' },
  { text: 'Yaşamak için bir nedeni olan, hemen her koşula katlanır.', author: 'Friedrich Nietzsche' },
  { text: 'Her şey elinden alınabilir; yalnızca tutumunu seçme özgürlüğü alınamaz.', author: 'Viktor Frankl' },
  { text: 'Başlangıç, bir işin en önemli parçasıdır.', author: 'Platon' },

  // Kronos: zaman
  { text: 'Zamanı yönetemezsin; ama ona ne vereceğini seçebilirsin.', author: 'Kronos' },
  { text: 'Bugünün en önemli işi, yarının en küçük pişmanlığıdır.', author: 'Kronos' },
  { text: 'Küçük bir adım, bekleyen büyük bir plandan değerlidir.', author: 'Kronos' },
  { text: 'Takvimde olmayan niyet, yalnızca bir dilektir.', author: 'Kronos' },
  { text: 'Mükemmel zamanı bekleme; şimdiki zamanı iyi kullan.', author: 'Kronos' },
  { text: 'Her saat bir seçimdir. Seçimini bilerek yap.', author: 'Kronos' },
  { text: 'Dakikalara sahip çık; saatler kendiliğinden toplanır.', author: 'Kronos' },
  { text: 'Önce en önemli işi yap; günün geri kalanı seni rahat bırakır.', author: 'Kronos' },
  { text: 'Plan nereye gideceğini söyler, alışkanlık oraya vardırır.', author: 'Kronos' },
  { text: 'Yarım saat bile olsa, başlamak bırakmaktan iyidir.', author: 'Kronos' },
  { text: 'Bugün yaptığın küçük iş, yarınki sana bırakılmış bir armağandır.', author: 'Kronos' },
  { text: 'Dinlenmek zaman kaybı değil, yolun bir parçasıdır.', author: 'Kronos' },
  { text: 'Takvimini, değerlerinin gösterdiği yere göre doldur.', author: 'Kronos' },
  { text: 'Her şeye yetişmeye çalışmak, hiçbirine tam varamamaktır.', author: 'Kronos' },
  { text: 'Bugün seçtiğin üç iş, bırakmadığın otuz işten daha değerlidir.', author: 'Kronos' },
  { text: 'Beklemek de bir plandır; yeter ki ne için beklediğini bil.', author: 'Kronos' },
  { text: 'Kısa mola, uzun yolun ilk şartıdır.', author: 'Kronos' },
  { text: 'Bir gün ertelenen iş, kolayca bir hafta olur.', author: 'Kronos' },
  { text: 'Zaman, ona verdiğin dikkat kadar uzar.', author: 'Kronos' },
  { text: 'Akşam kendine bir soru sor: bugünü neye verdim?', author: 'Kronos' },
  { text: 'Büyük işler, küçük saatlerin toplamıdır.', author: 'Kronos' },
  { text: 'Düzen, özgürlüğün sessiz temelidir.', author: 'Kronos' },
  { text: 'İşi ikiye bölmek onu küçültmez; başlamayı kolaylaştırır.', author: 'Kronos' },
  { text: 'Yoldaki dakikalar da senin; onları boşa akıp gitmeye bırakma.', author: 'Kronos' },

  // Aura: enerji ve nezaket
  { text: 'Enerjini koru: her şeye evet demek, kendine hayır demektir.', author: 'Aura' },
  { text: 'Önce kendine nazik ol; gerisi daha kolay gelir.', author: 'Aura' },
  { text: 'Yorgunluk bir uyarıdır, suçlu değil.', author: 'Aura' },
  { text: 'Bir bardak su, kısa bir nefes, küçük bir yürüyüş: günün yönü bazen buradan değişir.', author: 'Aura' },
  { text: 'Kendine verdiğin söz, en önce tutulması gereken sözdür.', author: 'Aura' },
  { text: 'Tökezlemek yolun dışına çıkmak değil, yolda olmaktır.', author: 'Aura' },
  { text: 'Bugün her şeyi yapman gerekmiyor; doğru şeyi yapman yeter.', author: 'Aura' },
  { text: 'Sabah kendine ayırdığın yarım saat, akşam sana geri döner.', author: 'Aura' },
  { text: 'Hafif bir gün de ilerlemedir.', author: 'Aura' },
  { text: 'Kendini başkasıyla değil, dünkü seninle karşılaştır.', author: 'Aura' },
  { text: 'Dinlenmiş zihin daha net görür.', author: 'Aura' },
  { text: 'Alışkanlıklar, istek bittiği yerde devreye girer.', author: 'Aura' },
  { text: 'Nefes almak da bir iştir; bugün ona zaman ayır.', author: 'Aura' },
  { text: 'Kendine karşı sabırlı ol; sen de bir yolculuktasın.', author: 'Aura' },
  { text: 'Bugün yorulduysan, yarın daha güçlü dönmenin yolu dinlenmektir.', author: 'Aura' },
  { text: 'Küçük iyilikler, büyük günlerin habercisidir.', author: 'Aura' },
  { text: 'Suyun, güneşin ve temiz havanın değeri, yorgun günde anlaşılır.', author: 'Aura' },
  { text: 'Kendine sert davranarak değil, kendine bakarak ilerlersin.', author: 'Aura' },
  { text: 'Mükemmel olmak zorunda değilsin; devam etmen yeter.', author: 'Aura' },
  { text: 'Bir şeyi yapamadıysan yargılama; öğren ve yarına taşı.', author: 'Aura' },
  { text: 'Enerjin sınırlı bir hazinedir; en değerli işlere harca.', author: 'Aura' },
  { text: 'Güne nazik bir başlangıç, bütün günü yumuşatır.', author: 'Aura' },
  { text: 'Sevdiğin küçük şeylere zaman ayırmak lüks değil, ihtiyaçtır.', author: 'Aura' },
  { text: 'Zor duygular misafir gibidir: gelir, kalır, gider.', author: 'Aura' },
];

export function quoteKind(q: Quote): QuoteKind {
  if (q.author === ATASOZU) return 'atasozu';
  if (q.author === 'Kronos') return 'kronos';
  if (q.author === 'Aura') return 'aura';
  return 'bilge';
}

// ───────────── Torba düzeniyle seçim ─────────────

export interface QuoteBag {
  v: 1;
  /** Torba oluşturulduğundaki söz sayısı (liste değişirse torba yenilenir) */
  n: number;
  /** Karıştırılmış söz sırası */
  order: number[];
  /** Sıradaki sözün yeri */
  pos: number;
  /** En son gösterilen söz (yeni torbanın ilk sözü bu olmasın diye) */
  last: number | null;
}

export const QUOTE_BAG_KEY = 'quote_bag_v1';
export const OPENING_SETTING_KEY = 'opening_quote';

/** Saklanan metinden torbayı okur; bozuk ya da eski ise null. */
export function parseBag(raw: string | null, count: number): QuoteBag | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<QuoteBag>;
    if (!b || b.v !== 1 || b.n !== count || !Array.isArray(b.order) || b.order.length !== count) return null;
    if (typeof b.pos !== 'number' || !Number.isInteger(b.pos) || b.pos < 0 || b.pos > count) return null;
    const seen = new Set<number>();
    for (const i of b.order) {
      if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) return null;
      seen.add(i);
    }
    const last = typeof b.last === 'number' && Number.isInteger(b.last) && b.last >= 0 && b.last < count ? b.last : null;
    return { v: 1, n: count, order: b.order, pos: b.pos, last };
  } catch {
    return null;
  }
}

/** Fisher-Yates karıştırma; rng 0 ile 1 arası (1 hariç) sayı verir. */
export function shuffled(count: number, rng: () => number): number[] {
  const a = Array.from({ length: count }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const r = rng();
    const j = Math.min(i, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * (i + 1))));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sıradaki sözün numarasını ve güncel torbayı verir. */
export function nextQuoteIndex(bag: QuoteBag | null, count: number, rng: () => number): { index: number; bag: QuoteBag } {
  if (count <= 0) throw new Error('Söz listesi boş.');
  let b = bag && bag.n === count && bag.pos < count ? bag : null;
  if (!b) {
    const last = bag && bag.n === count ? bag.last : null;
    const order = shuffled(count, rng);
    // Yeni torba, bir önceki sözle başlamasın
    if (count > 1 && last !== null && order[0] === last) {
      const r = rng();
      const swapWith = 1 + Math.min(count - 2, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * (count - 1))));
      [order[0], order[swapWith]] = [order[swapWith], order[0]];
    }
    b = { v: 1, n: count, order, pos: 0, last };
  }
  const index = b.order[b.pos];
  return { index, bag: { ...b, pos: b.pos + 1, last: index } };
}

// ───────────── Açılış ekranı ayrıntıları ─────────────

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Günaydın';
  if (hour >= 12 && hour < 18) return 'İyi günler';
  if (hour >= 18 && hour < 22) return 'İyi akşamlar';
  return 'İyi geceler';
}

/** Uygulama arka plandan dönünce ne kadar uzaklıktan sonra yeni söz gösterilsin (ms) */
export const RESUME_AWAY_MS = 20 * 60 * 1000;
export const shouldShowOnResume = (awayMs: number): boolean => Number.isFinite(awayMs) && awayMs >= RESUME_AWAY_MS;

/** Açılış sözü ayarı: kapatılmadıkça açık. */
export const isOpeningEnabled = (raw: string | null): boolean => raw !== '0';
