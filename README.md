# Kronos & Aura

Zamanını ve enerjini yöneten, iki yapay zekâ koçlu mobil uygulama (Expo + TypeScript + SQLite).

- **Kronos**: görevleri enerji saatlerine göre zaman bloklarına yerleştirir, aksayan günü yeniden dizer. Net, stratejik, yönlendirici.
- **Aura**: suçluluk döngüsünü kırar; "zaman akıp gitti" anlarını yargılamadan veri olarak kaydeder. Empatik, sakin.

İkisiyle de sohbet edebilirsin; bugünkü görevlerini ve enerji durumunu bilirler.

## Hızlı başlangıç (Windows)

1. **Node.js kur:** nodejs.org adresinden yeşil **LTS** düğmesiyle indirip kur (bir kez).
2. **`1-kurulum-ve-dene.bat`** dosyasına çift tıkla. Paketler kurulur, ekranda QR kod çıkar.
   Telefonda **Expo Go** uygulamasıyla QR kodu okut.
3. Uygulamada sağ üstteki **⚙** düğmesinden Claude API anahtarını ekle (aşağıya bak).
4. APK için **`2-apk-olustur.bat`** dosyasına çift tıkla. Ücretsiz bir Expo hesabı (expo.dev/signup) gerekir; derleme bulutta yapılır, 10-20 dakika sürer. Sonunda indirme bağlantısı çıkar. APK yalnızca Android telefonlara kurulur.

Bir yerde hata çıkarsa pencerede görünen kırmızı yazıyı kopyalayıp Claude'a gönder.

## Yapay zekâ

- Anahtarı Claude Console'dan (platform.claude.com) alırsın. Anahtar yalnızca telefonun güvenli deposunda saklanır, APK'nın içine gömülmez.
- Her mesaj API'den ücretlendirilir (Claude aboneliğinden ayrı). Console'dan harcama sınırı koy.
- Anahtar yoksa ya da internet kesilirse koçlar kural tabanlı çalışmaya devam eder.
- Koçların kişiliğini, tonunu ve sınırlarını değiştirmek için: `services/ai/personas.ts`
- Kullanılan model seçenekleri: `services/ai/settings.ts`

## Klasör yapısı

```
app/            index.tsx (ana ekran) · chat.tsx (koç sohbeti) · settings.tsx · profile.tsx
                activity.tsx (gün analizi, uyku) · routines.tsx (rutinlerim) · review.tsx (gün sonu)
                nutrition.tsx (su ve yemek) · goals.tsx (hedefler, zaman dengesi)
components/     CoachConsole, CoachCard, TaskItem, TaskComposer, EnergyCheckModal
                RoutineCard, SnoozeModal, RoutineEditor
services/       scheduler.ts (zamanlama motoru) · coachEngine.ts (kural tabanlı koç)
                planner.ts · taskFlow.ts · coachContext.ts
                routineLogic.ts · routineFlow.ts · routineTemplates.ts · routineReminders.ts
                sleepLogic.ts · activity.ts
                dayReviewLogic.ts · dayReview.ts · reminderSync.ts · ai/reviewAI.ts
services/ai/    claudeClient.ts · personas.ts · coachAI.ts · settings.ts
hooks/          useAICoachMessages.ts
database/       schema.ts · repository.ts · types.ts
scripts/        test-scheduler.ts · test-ai.ts · test-activity.ts · test-routines.ts · test-sleep.ts · test-review.ts
```

## Testler (isteğe bağlı)

```
npm run test:scheduler    zamanlama motoru, 48 kontrol
npm run test:ai           yapay zekâ katmanı (gerçek API'ye gitmez), 37 kontrol
npm run test:activity     gün analizi ve veritabanı geçişleri, 51 kontrol
npm run test:routines     rutinler, analiz, hatırlatmalar, koç entegrasyonu, 100 kontrol
npm run test:sleep        uyku tahmini, 33 kontrol
npm run test:review       gün sonu değerlendirmesi, elle yol, ücretsiz anahtar sırası ve yarın planı, 106 kontrol
npm run test:free         Gemini ve Groq istemcisi (model yedeği, hata eşleme), 33 kontrol
npm run test:morning      sabah brifingi, bildirim planı, veritabanı v6, 62 kontrol
npm run test:hardday      zor gün modu (hangi işler kalır, aç/kapat, koç mesajları), 40 kontrol
npm run test:weekly       haftalık özet (toplamlar, kıyas, metinler, veritabanı), 52 kontrol
npm run test:nutrition    su, yemek, kalori tahmini ve koç/gün sonu/haftalık bağlantıları, 114 kontrol
npm run test:goals        hedefler, kalori hesabı güvenlik sınırları, ilerleme, zaman dengesi, hatırlatmalar, 95 kontrol
```


## Gün analizi (yalnızca Android)

Uygulama ekran süreni, adımlarını ve arka plan takibini destekler. Kod `modules/device-activity`
klasöründeki yerel Android modülündedir (Kotlin); `npx expo prebuild` ve GitHub Actions derlemesi
bunu otomatik bağlar. Expo Go'da çalışmaz, APK gerekir.

- **Ekran süresi:** Android'in "Kullanım erişimi" izniyle okunur (Ayarlar'dan bir kez verilir).
- **Adımlar:** Telefonun adım sensöründen, küçük bir arka plan servisiyle sayılır; takibi açtığın andan
  itibaren günlük toplam tutulur. Telefon yeniden başlasa bile gün toplamı korunur.
- **Arka plan:** Bildirim çubuğunda sessiz bir bildirim görünür. "Zorla durdur" yapılırsa takip durur;
  uygulamayı açmak yeterlidir. Pil kısıtlaması muafiyeti ve markaya özel ipuçları Gün analizi ekranındadır.
- **Gizlilik:** Veriler telefonda (SQLite `DailyStat`) kalır. Yapay zekâya gönderim ayrı bir ayarla,
  varsayılan olarak kapalıdır.
- Test: `npm run test:activity`


## Rutinler ve uyku

**Rutinler.** Ana ekrandaki "Rutinlerim"den örnek rutinlerden (su içmek, yürüyüş, nefes, günlük notu...)
istediğini ekler ya da kendininkini yazarsın. Her rutin belirlediğin saatte "bugün bunu yapacak mısın?"
diye sorulur; cevaplar:

- **Yapacağım:** Kronos rutini bugünün görevi yapıp enerji saatlerine yerleştirir.
- **Yaptım:** Bugün tamam sayılır.
- **Sonra:** 30 dk, 1 saat, akşam (19:30) ya da yarın; söz verilen saatte bildirimle yeniden sorulur.
- **Bugün değil:** Bugün kapanır, yarın yine sorulur.
- **Bir daha yapmam:** Rutin bırakılır; geçmişi saklanır, Rutinlerim'den geri alınabilir.

Cevaplar `RoutineLog`'a yazılır ve son 14 günden seri, tutma oranı ve en sık yapılan saat çıkarılır.
Çok ertelenen rutinler için saati değiştirmeyi, kabul edip yapamadığın rutinler için süreyi yarıya
indirmeyi ya da bırakmayı önerir (tek dokunuşla uygulanır). Aura hiçbir cevabı yargılamaz.
Hatırlatmalar yerel bildirimdir (internet gerekmez); Android 13+ için bildirim izni istenir.

**Uyku.** Gün analizi ekranındaki "Uyku (tahmin)": Android uykuyu doğrudan ölçemediği için gece ekranın en
uzun süre kapalı kaldığı aralık (en az 3 saat, 5 dakikadan kısa gece bakışları sayılmaz) yatış ve kalkış
saati olarak alınır. Son geceler, ortalama, yatış düzeni ve kronotip önerisi gösterilir. Telefon başka
odadaysa ya da gece kullanıldıysa tahmin yanılabilir; ekranda bu açıkça yazılır. Yapay zekâya gönderim
"Koçlarla yapay zekâda paylaş" ayarına bağlıdır.

## Gün sonu değerlendirmesi

Akşam 20:00'den sonra ana ekranda "Gün sonu değerlendirmesi" kartı çıkar (21:30'da bildirim de gelir;
Ayarlar'dan kapatılabilir). Ekran:

1. Günün özeti: biten görevler, rutinler, adım, ekran süresi, uyku tahmini.
2. **Aura** günü yargılamadan yorumlar, **Kronos** yarın için kısa bir yaklaşım önerir. API anahtarı varsa
   yapay zekâ yazar ve "başka neler yapabilirsin" diye 3 yeni rutin fikri çıkarır; yoksa ya da hata olursa
   aynı yapı hazır kurallarla üretilir (yetersiz adım, çok ekran, kısa uyku gibi işaretlere göre örnek
   rutinlerden seçer). Yapay zekâ cevabı doğrulanır: yargılayıcı sözcük, geçersiz saat/süre ya da mevcut
   bir rutinin tekrarı atılır.
3. Fikirler tek dokunuşla (ya da "Hepsini ekle" ile) rutin olur.
4. Her rutin için **"Yarın yapacağım"** / **"Yarın değil"** / "Bir daha yapmam". "Yapacağım" dedikleri ertesi
   sabah (05:00 sonrası) otomatik plana yerleştirilir, "yarın değil" dedikleri yarın sorulmaz, bildirimleri de
   gitmez.

Değerlendirme `DayReview` tablosunda saklanır (gün başına bir kez; "yeniden yaz" ile tazelenir). Gece
04:00'e kadar hâlâ "dünün" gün sonu sayılır. Yapay zekâya adım, ekran süresi ve uyku yalnızca "Koçlarla
yapay zekâda paylaş" açıksa gider; görev ve rutin adları koç sohbetiyle aynı kapsamda her zaman gider.

**Ücretsiz yapay zekâyla, elle.** API anahtarı olmadan da yapay zekâlı değerlendirme alınabilir: Gün sonu
ekranındaki "Özeti kopyala" günün özetini kişilik ve kurallarla birlikte hazır bir komut olarak panoya alır.
Komut Gemini, ChatGPT ya da Claude gibi ücretsiz bir sohbet uygulamasına yapıştırılır; gelen cevap (kod bloğu
içinde JSON) kopyalanıp "Panodan yapıştır" + "Cevabı ekle" ile uygulamaya girilir. Okuma toleranslıdır (kod
bloğu çiti, eğri tırnak, fazladan virgül); yargılayıcı sözcük içeren ya da eksik cevap kaydedilmez, mevcut
değerlendirme korunur. Cevaptaki yeni rutin fikirleri normal fikirler gibi tek dokunuşla eklenir.

**Ücretsiz anahtarla, otomatik (isteğe bağlı).** Ayarlar'dan ücretsiz bir Gemini (aistudio.google.com) ya da
Groq (console.groq.com) anahtarı eklenirse gün sonu yorumu kopyala-yapıştır olmadan uygulamanın kendisi
tarafından yazılır. Kart istenmez; sınır aşılırsa servis 429 döner, ücret çıkmaz. Anahtar eklenmezse hiçbir şey
değişmez ve elle yol aynen çalışır. Sıra: ücretsiz anahtar, Claude anahtarı, hazır kurallar. Her sağlayıcıda
model adı bulunamaz ya da sınırına takılırsa sıradaki model denenir (`services/ai/freeClient.ts`); anahtar
hatasında ya da ağ sorununda denenmez. Anahtarlar Claude anahtarı gibi yalnızca telefonun güvenli deposunda
tutulur. Gemini'nin ücretsiz planında içerik Google'ın ürün geliştirmesinde kullanılabilir; Ayarlar'da açıkça
yazılıdır. Adım, ekran ve uyku bilgisi yine yalnızca paylaşım açıksa gönderilir.


## Sabah brifingi

Ana ekrandaki "Sabah brifingi" kartı (05:00–12:00) ya da sabah bildirimi `/morning` ekranını açar: selamlama,
Aura'nın uykuya göre sıcak cümlesi, Kronos'un günün özeti (açık görev sayısı ve toplam süre, en önemli iş,
tepe saati), dünkü gün sonu değerlendirmesindeki Kronos notu, planlı görevler ve bugünkü rutinler. Hepsi
telefondaki veriden ve kurallardan gelir; internet ya da anahtar gerekmez. Mantık `services/morningLogic.ts`,
veri toplama `services/morning.ts`.

Bildirim Ayarlar'daki "Sabah brifingi" anahtarıyla açılıp kapanır (varsayılan açık, 08:00; 07/08/09/10
seçilebilir). Her sabah için tek seferlik yerel bildirim kurulur; bildirime dokunmak ilgili ekranı açar
(bildirimin `data.route` alanı, `app/_layout.tsx` içinde karşılanır; gün sonu bildirimi de `/review` açar).

## Zor gün modu

Ana ekrandaki "Zor bir gün mü? Planı hafiflet" bağlantısıyla (ya da sabah brifinginden) açılır. Kısa uyku
(5,5 saatten az) ya da bugün iki "tükendim" kaydı varsa kart kendiliğinden önerilir. Açılınca:

- Planda en fazla 2 hafif iş ve toplam 90 dakika kalır (başlamış iş her zaman kalır); diğerleri bugünlük
  ertelenir. Normal güne dönülünce yalnızca zor gün modunun ertelediği işler geri gelir (kullanıcının sildiği ya
  da elle geri aldığı işlere dokunulmaz).
- 10 dakikadan uzun rutinler o gün sorulmaz (kart ve bildirim yok) ve kaçırılmış sayılmaz; istatistikleri bozmaz.
- Kronos "Hafif plan", Aura "Bugün zor bir gün, sorun değil" der; yapay zekâya da bu mod bildirilir ve baskı
  kurmaması istenir.

Kayıt `DayMode` tablosundadır (veritabanı v6; gün anahtarı + ertelenen görev kimlikleri).
Mantık `services/hardDayLogic.ts`, aç/kapat `services/hardDay.ts`.

## Haftalık özet

Ana ekrandaki "Haftalık özet" satırı `/weekly` ekranını açar: son 7 günün biten görev ve süresi, rutinlerin
yapılma oranı, ortalama uyku, adım ve ekran süresi, zor gün sayısı, günlere göre çubuk grafik, rutin başına
ilerleme ve önceki haftayla kıyas. Aura haftayı yargılamadan yorumlar; Kronos en tutarlı rutini, ayarlanması
gereken rutini (3+ şansta %40'ın altı) ve gelecek hafta için tepe saati önerisini söyler. Rutinden gelen görevler
ikinci kez "görev" sayılmaz; sabah bakınca henüz bitmemiş gün rutin oranını düşürmez. Yapay zekâ gerekmez
(`services/weeklyLogic.ts`, veri `services/weekly.ts`).


## Su, yemek ve kalori

Ana ekrandaki "Su ve yemek" kartı (üzerinde tek dokunuşla +200 ml) `/nutrition` ekranını açar:

- **Su:** bardak (200), küçük şişe (330), şişe (500), büyük şişe (750) tek dokunuşla eklenir; son kayıt geri
  alınır. Hedef Ayarlar'dan seçilir (1,5–3 L; varsayılan 2 L). Kronos, kalan suyu saat 21:00'e kadar saatlik
  miktara böler.
- **Çay, kahve, şekerli içecek:** tek dokunuşla eklenir (içecek kaydı olarak, yemek sayılmaz).
- **Yemek:** öğün türü (kahvaltı, öğle, akşam, ara öğün), ne zaman yendiği (şimdi ... 3 saat önce) ve serbest
  yazı. Yazdıkça besin grupları (sebze, meyve, protein, ekmek/tahıl, süt ürünü, kuruyemiş, tatlı, kızartma,
  şekerli içecek, çay/kahve) kendiliğinden işaretlenir; istenirse elle değiştirilir.
- **Kalori:** "2 yumurta, 3 dilim ekmek, çay" gibi yazıdan yaklaşık kalori tahmin edilir
  (`services/foodTable.ts`: 127 yemeklik tablo, 190+ yazım biçimi; sayı, "yarım", gram ve ml anlaşılır). Tanınmayan
  yemek için uydurma sayı yazılmaz; kullanıcı sayıyı her zaman kendisi yazar ya da boş bırakır. Sayılar
  tipik porsiyonlardan tahmindir. İstenirse Ayarlar'dan günlük kalori hedefi konur (1.200–4.500 kcal;
  daha düşüğü kaydedilmez ve bir diyetisyene yönlendirilir). Hedef yoksa hiçbir yerde hedef gösterilmez.
- **Analiz** (`services/nutritionLogic.ts`, yapay zekâ gerekmez): su oranı ve dağılımı, öğün sayısı, ilk ve son
  yemek saati, en uzun yemek arası, son çay/kahve saati (akşamsa uyku notu), geç yemek, sebze/meyve eksikliği.
  Aura yargılamaz; "fazla yedin" gibi cümle kurulmaz. Kronos zamanı yönetir (su hızı, ara öğün, tepe saatinden
  önce bir bardak su).

Bağlantılar: ana ekran Aura'sı öğleden sonra su çok azsa nazik bir hatırlatma yapar; gün sonu değerlendirmesinde
su/yemek özeti gösterilir; haftalık özette ortalama su, hedefe ulaşılan gün ve kalori ortalaması (yalnızca 2+ yemek
kaydı olan günlerden) yer alır. Yapay zekâya, yalnızca "gün analizi paylaşımı" açıksa, toplu özet gider (su miktarı,
yemek kaydı sayısı, yaklaşık kalori, çay/kahve sayısı); yazılan yemek adları asla gönderilmez.

Veritabanı v7: `WaterLog` ve `MealLog` (gün anahtarı gece 04:00'e kadar önceki gün sayılır).

## Hedefler ve zaman dengesi

Ana ekrandaki "Hedefler ve zaman dengesi" kartı `/goals` ekranını açar (Ayarlar'dan da bağlantı var). Hedeflerin
hepsi isteğe bağlıdır; konmayan hedef hiçbir yerde gösterilmez ve hepsi kapatılabilir.

- **Hedefler:** su (1,5–3 L), kalori, ilk yemek en geç / son yemek en geç, günlük ekran süresi sınırı, yatış saati ve
  günlük "dolu zaman" hedefi (bitirilen işlerin toplam süresi). Her hedef için bugünkü durum çubuğu gösterilir
  (Tamam / Yolunda / Bekliyor / Dikkat). "Dikkat" kırmızı değil sarıdır; Aura "fazla yedin" ya da "başaramadın"
  demez, Kronos yalnızca kalan zamanı ve sayıyı söyler.
- **Kalori hedefi, üç yol:** (1) kendin yazarsın, (2) "Hesapla": cinsiyet, yaş, boy, kilo ve hareket düzeyinden
  Mifflin-St Jeor formülüyle günlük ihtiyaç ve su önerisi, (3) "Kilo hedefiyle": hedef kilo ve tempo (korumak,
  yavaş, ılımlı) seçilir, tahmini süre gösterilir. Güvenlik sınırları (`services/goalsLogic.ts`): yalnızca 18–80
  yaş (dışı için doktor/diyetisyen yönlendirmesi), öneri hiçbir zaman 1.200 kcal (erkekte 1.500) ve dinlenme
  enerjisinin altına inmez, günlük açık ihtiyacın %20'sini geçmez, hedef BMI 19'un altına ya da kilonun %30'undan
  fazlasına izin verilmez, kilo alma yalnızca BMI 25'in altında, sonuç 1.200–4.500 kcal. Her sonuçta "tahmindir,
  doktor/diyetisyen yerine geçmez" uyarısı vardır. Boy, kilo ve yaş yalnızca telefonda durur, yapay zekâya hiçbir
  zaman gönderilmez ve tek dokunuşla silinir.
- **Zaman dengesi:** bugün kalan gün içinde planda yeri olmayan, en az 20 dakikalık boş pencereler, biten iş, akıp
  giden zaman ve kayıt dışı zaman gösterilir. Bekleyen işler varsa "Günü planla" düğmesi var. Yatışa 1 saat kala gün
  kapanıyor sayılır ve yeni plan önerilmez. Aura dinlenmenin de dolu zaman olduğunu söyler, boşa giden zamanı
  suçlamaz.
- **Hatırlatmalar (varsayılan KAPALI, tek anahtar):** açılırsa öğle 12:00 ve ikindi 16:30'da su hatırlatması (su
  hedefi tamamlanınca o günün hatırlatmaları susar) ve yatıştan 45 dakika önce "günü yavaşça kapatma" hatırlatması
  gelir. Zor gün modundayken o günün hedef hatırlatması gönderilmez. Açarken bildirim izni istenir; verilmezse anahtar
  kapalı kalır. Bildirimler `rtn-water-…` ve `rtn-winddown-…` kimlikleriyle diğer rutin bildirimleriyle birlikte
  eşitlenir.

Yapay zekâ gerekmez; tüm hesaplar telefonda yapılır. Hedefler SecureStore'da (`goals_v1`, `body_profile`) durur.

## Logo ve ikon

Logo özgündür: koyu arka planda, mavi (Kronos, zaman) ve nane yeşili (Aura, enerji) iki yaydan oluşan bir saat; akrep
mavi, yelkovan ise Aura'yı temsil eden bir yaprak. Dosyalar `assets/` klasöründe:
`icon.png` (uygulama ikonu), `adaptive-icon.png` (Android uyarlanabilir ikon ön planı, arka plan `#0B0D12`),
`notification-icon.png` (bildirim simgesi, beyaz silüet), `logo.png` / `logo.svg` (yuvarlatılmış logo),
`logo-wordmark.png` (yazılı yatay logo). `app.json` bunları kullanır.
