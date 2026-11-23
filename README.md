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
                exercise.tsx (egzersiz programı) · exercise-move.tsx (çizimli hareket anlatımı) · exercise-run.tsx (seans)
components/     CoachConsole, CoachCard, TaskItem, TaskComposer, EnergyCheckModal, ExerciseFigure (çubuk adam çizimi)
                RoutineCard, SnoozeModal, RoutineEditor
services/       scheduler.ts (zamanlama motoru) · coachEngine.ts (kural tabanlı koç)
                planner.ts · taskFlow.ts · coachContext.ts
                routineLogic.ts · routineFlow.ts · routineTemplates.ts · routineReminders.ts
                sleepLogic.ts · activity.ts
                exerciseData.ts (hareketler, anlatımlar, pozlar) · exerciseFigure.ts (çizim geometrisi) · exerciseLogic.ts · exercise.ts
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
npm run test:outcomes     yaptım/yapmadım/yapamadım, iş saatleri, gün akışı, sigara sayacı, zaman analizi, 98 kontrol
npm run test:history      ilerleme ve geçmiş (günlük seriler, ortalamalar, sebepler, veri toplama), 31 kontrol
npm run test:backup       yedek ve geri yükleme (bozuk metin, eski sürüm, tek işlemlilik), 27 kontrol
npm run test:taskedit     görev düzenleme ve yanlış işareti geri alma, 17 kontrol
npm run test:commute      yolda yapılabilir işler, günün özet satırı, yedek hatırlatması, 39 kontrol
npm run test:work         haftalık iş programı (Cmt yarım gün, Pazar boş), planlayıcı, hatırlatma, boş gün planı, 43 kontrol
npm run test:guide        gün rehberi (iş günü/Cumartesi/Pazar çizelgesi, öneriler, şimdi-sıradaki), 38 kontrol
npm run test:habits       şablon paketleri, simge/renk, alışkanlık takvimi, ruh hali, rutin tarzı testi, veritabanı v12, 119 kontrol
npm run test:days         rutinleri belirli günlere bağlama (Pazar'a özel, hafta içi, seri, hatırlatma, haftalık özet, takvim), 57 kontrol
npm run test:backfill     takvimden geçmiş günü sonradan işaretleme ve geri alma, 21 kontrol
npm run test:vocab        kelime defteri: Leitner kutuları, tekrar seansı, yedek, 41 kontrol
npm run test:runmode      rutin modu: sıra, bölümler, Yaptım/Sonra/Atla, sayaç, 37 kontrol
npm run test:monthly      aylık karne: toplamlar, ruh hali, seviye, önceki ayla karşılaştırma, 34 kontrol
npm run test:quests       haftalık görevler: seçim, ilerleme, bonus XP, geçmişe bonus verilmemesi, 43 kontrol
npm run test:notifyactions  bildirimden Yaptım / Yapacağım / Bugün değil: ayrıştırma, karar, kuyruk, kayıt, 47 kontrol
npm run test:weekplan     hafta planı (güne ayırma, kapasite, otomatik dağıtım, veritabanı v11), 41 kontrol
npm run test:game         oyunlaştırma (XP, seviye, altın, seri, rozet, ödül, veritabanından türetme, yedek), 62 kontrol
npm run test:homegrid     ana ekran ızgarası: kutular, rotalar, sayfa hesabı, ipuçları, eski ekranın korunması, 36 kontrol
npm run test:icons        simgeler: çizilen bardak ve şişeler, ada göre rutin simgesi, eski rutinleri yenileme, beslenme simgeleri, eski telefon uyumu, 111 kontrol
npm run test:exercise     egzersiz: çizim geometrisi, içerik bütünlüğü, basamak atlama, seans kaydı, program (gün, güne başlama saati), sabah kartı, alarm, bildirim planı, yedek, 334 kontrol
npm run test:language     dil öğrenme (uygulama süresi, kalem-kağıt, hedef, geçmiş, gün analizi, yedek, veritabanı v10), 52 kontrol
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

## Yaptım / Yapmadım / Yapamadım, iş saatleri, gün akışı

Gündüz çalışan ve telefona bakamayan biri için: her şey akşam topluca da işaretlenebilir.

- **Üç düğme:** her görevde **Yaptım** (enerji sorusu, süre kaydı), **Yapmadım** ve **Yapamadım** (kısa bir "ne
  engelledi?" sorusu: iş vaktindeydi / enerjim yoktu / zamanım yetmedi / başka bir şey çıktı; cevap vermek
  zorunlu değil). Aura üçünü de aynı sıcaklıkla karşılar; hiçbiri borç ya da suç değildir. Yapmadım ve Yapamadım
  denen işler bugünün planından çıkar ve ertesi gün (22:00'den sonra yarının planına) kendiliğinden bir kez geri
  döner. "Ertele" eskisi gibi çalışır.
- **İş saatleri (Hedefler ekranı, varsayılan kapalı):** başlangıç, bitiş ve günler. Planlayıcı, "İş vaktinde de
  yapılabilir" işaretlenmemiş işleri iş saatlerine koymaz; işaretlenmiş olanlar gün içine de yerleşebilir. Yer
  yalnızca iş saatindeyse sebep "iş saati" olarak ayrılır ve Kronos işareti önerir. İş saatleri zaman dengesinde boş
  pencere sayılmaz. Ayar veritabanındaki `Setting` tablosunda durur (planlayıcı ve testler okuyabilsin diye).
- **Günü işaretle (`/mark`):** akşam bütün görevleri topluca işaretlersin, "planda olmayan ama yaptığım" işleri
  geriye dönük eklersin (süre + enerji; iş vaktinde yapıldıysa belirtirsin). Gece yarısından sonra işaretlenenler
  işaretlenen günün sonuna yazılır. İş saatleri açıksa işin bitiminden 15 dk sonra bir hatırlatma gelir.
- **Gün akışı (`/day`):** tek dokunuşla Uyandım, Duş aldım, Minibüse bindim, Dükkana geldim, Dükkandan çıktım, Eve
  geldim. "10 dk önce" gibi geriye dönük girilir. Hazırlık, yol (işe) ve dükkanda geçen süre ile yol (eve) otomatik
  hesaplanır. "Uyandım" sonrası Aura bir bardak su önerir (+200 ml tek dokunuş). Sabah su hatırlatması son
  "Uyandım" damgalarının ortancasına göre, damga yoksa 07:45'e kurulur.
- **Sigara sayacı:** +1, "N dk önce", silme, ortalama aralık, isteğe bağlı günlük sınır. Aura yargılamaz, bırakma
  baskısı yoktur. Veri telefonda kalır; yapay zekâya yalnızca (gün analizi paylaşımı açıksa) toplam sayı ve
  ortalama aralık gider.
- **Gün sonu analizi:** "Zaman nereye gitti?" bölümü: uyanıktan iş, yol ve hazırlık düşülür, bitirilen işler
  düşülür, kalan **kayıt dışı kalan zaman** olarak yazılır (yemek, dinlenme, sohbet, oyalanma burada durur; "boşa"
  denmez, çünkü Aura değer yargısı taşıyan sözcük kullanmaz). Ekran süresi biliniyorsa (en az 1 sa) bunun dörtte
  biri (30–120 dk) kadarını başka işe ayırmak için "Ekran yerine" önerileri çıkar: önce yapmadığın/yapamadığın açık
  işler, sonra kısa fikirler ("Yarın plana ekle"). Bu bölüm kural tabanlı yolda, ücretsiz/Claude anahtarıyla ve
  **elle kopyala-yapıştır** yolunda aynı şekilde çalışır; elle yol bozulmadı, istem yalnızca yeni alanları ister.

Veritabanı sürümü 11 (`TaskOutcome`, `Setting`, `DayEvent`, `SmokeLog`, `StudyLog` tabloları, `Task.workOk`, `Task.commuteOk` ve `Task.plannedDay`).

## Ana ekran: iki sayfa (simgeli ızgara + tüm akış)

Ana ekran **yatay iki sayfadır**; alttaki iki nokta hangi sayfada olduğunu gösterir (noktaya dokunarak da geçilir).

- **1. sayfa (açılış): simgeli ızgara.** Üstte tarih ve ayar düğmesi, "ŞİMDİ" kartı (gün rehberinden), sonra üç sütunlu **15 simgeli kutu**
  ve altta açık görevlerin kısa özeti (dokununca 2. sayfaya geçer). Kutular renkle gruplanır: yeşil sağlık ve rutin (Rutinler,
  Rutin yap, Egzersiz, Su yemek, Dil), mavi plan ve takip (Rehber, Gün akışı, İşaretle, Hafta, Takvim, Geçmiş, Hedefler, Kahraman),
  koçlar (Kronos, Aura; sohbeti ilgili koçla açar). Su kutusunda **damacana** durur ve içtikçe dolar.
- **Basılı tutma (yaklaşık yarım saniye) ilgili ekranı açar.** Su kutusuna **kısa dokunuş +200 ml ekler**; diğer kutulara kısa
  dokunuş yalnızca "Basılı tut: … açılır" ipucunu gösterir (yanlışlıkla açılmasın diye).
- **2. sayfa (yana kaydır): eski ana ekran aynen.** Koç konsolu, ruh hali, zor gün, sabah egzersizi, brifing, hızlı düğmeler,
  "Daha fazla" kutuları ve tam görev listesi burada durur. Izgarada olmayan ekranlara (Aylık karne, Haftalık özet, Sabah
  brifingi, Gün analizi) buradan girilir.
- Kutu listesi, rotalar ve sayfa hesabı `services/homeGrid.ts`, çizim `components/HomeGrid.tsx`, sayfalama `app/index.tsx`.

## Ana ekran ve İlerleme ve geçmiş

**Ana ekran sadeleştirildi.** Üstte koç konsolu, zor gün modu ve gün saatine göre **tek öne çıkan kart** durur:
sabah "Sabah brifingi", akşam 20:00'den sonra "Gün sonu değerlendirmesi", iş saatlerini açtıysan 17:00'den sonra
"Günü işaretle". Altında tek dokunuşluk üç düğme vardır: **su +200 ml**, **gün akışının sıradaki damgası**,
**sigara +1**. Sonra görevler gelir. Diğer her şey ("Rutinlerim", "Su ve yemek", "Hedefler", "İlerleme ve geçmiş",
"Gün akışı", "Haftalık özet", "Gün analizi"...) **"Daha fazla"** bölümünde küçük kutular olarak durur; açık/kapalı
hâli hatırlanır. Gün sonu değerlendirmesi ve **kopyala-yapıştır yolu** gün boyu açıktır (öne çıkan kart değilken
küçük bir bağlantı olarak ana ekranda durur).

**İlerleme ve geçmiş** (`/history`): tek bir ölçü seçilir (biten iş süresi, rutinler, su, kalori, sigara, ekran,
adım, uyku, uyanış saati, dükkanda ve yolda geçen süre), 7 / 14 / 30 günlük çubuk grafik çizilir. Çubuklara
dokunulunca o günün değeri görünür. Renkler iyi/kötü anlatmaz; hepsi aynı sakin renktir. Kayıt tutulmayan gün
**boş nokta**dır, "0" sayılmaz (sigara için 0 yalnızca o gün gün akışı kullanıldıysa sayılır). Ortalama ve "son
günler / öncesi" kıyası en az 3 kayıtlı günle verilir, yargı içermez. Altında seçili aralığın **yaptım / yapmadım /
yapamadım** sayıları ve yapamadıkların sebepleri durur; sebep çoğunlukla iş vaktiyse Kronos görevleri "iş vaktinde
yapılabilir" diye işaretlemeyi önerir. Veri `services/history.ts` içinde toplanır, hesap `services/historyLogic.ts`
içindedir (veritabanı değişmedi).

## Yedek ve geri yükleme (Ayarlar > Verilerim ve yedek)

Kayıtlar yalnızca telefondadır; uygulama silinir ya da telefon değişirse giderler. **Yedeği Google hesabıma gönder**
düğmesi yedeği tek bir metin olarak Android paylaşım ekranına verir: Gmail'de kendine gönder, ya da Drive / Keep'e
kaydet. Uygulama Google'a giriş istemez ve internet hesabı tutmaz; telefondaki hesabın kullanılır. (Otomatik ve
arka planda Google Drive eşitlemesi, Google Cloud'da OAuth ayarı ve uygulama imza kaydı gerektirir; şimdilik yok.)
**Yedeği kopyala** aynı metni panoya koyar. **Panodan geri yükle** metni okur, neyin yükleneceğini gösterir,
onay alır ve yükler.

- Yedeğe giren: görevler, rutinler, zaman/su/yemek/sigara kayıtları, gün akışı, görev sonuçları, uyku, gün sonu
  değerlendirmeleri, iş saati ve sigara sınırı ayarları, su/kalori/hedef/hatırlatma ayarları, kilo-boy bilgisi.
- Yedeğe **girmeyen**: yapay zekâ API anahtarları (hiçbir koşulda) ve koç sohbet geçmişi.
- Geri yükleme **tek işlemdir**: hata olursa (bozuk metin, uyumsuz sürüm, kopuk ilişki) eski kayıtlar olduğu gibi
  kalır. Metne bir sağlama kodu konur; kısaltılmış ya da bozulmuş metin yüklenmez. Yedekte olmayan tablolara
  dokunulmaz; eski sürümden alınmış yedekler yüklenir (eksik alanlar varsayılanla dolar), daha yeni sürümün
  yedeği reddedilir. Mantık `services/backupLogic.ts` içindedir.

## Görev düzenleme ve geri alma

Görev kartında **Düzenle** (bekleyen ve ertelenmiş görevlerde): ad, süre, zihinsel yük ve "iş vaktinde de
yapılabilir" işareti değişir, gün yeniden yerleştirilir. Süre listesinde olmayan değerler (ör. rutinden gelen 25 dk)
seçenek olarak görünür. Yanlış işaretler geri alınır: biten görevde **Geri al** (onaylı), ertelenmiş görevde
**Plana al**. Geri alınca sonuç kaydı, süre kaydı ve rutine yazılan "yaptım" silinir; geçmiş grafikleri ve sayılar
da buna göre düşer. Dünün ya da yarına taşınmış kayıtlar silinmez. Mantık `services/taskFlow.ts` (`undoOutcome`,
`updateTaskDetails`) içindedir.

## Yolda yapılabilir işler, günün özeti, yedek hatırlatması

**Yolda:** Göreve "🚌 Yolda yapılabilir" işareti konabilir (görev eklerken ya da Düzenle ile): minibüste telefonla
yapılabilen hafif iş. Gün akışında "Minibüse bindim" damgası vurulunca (son damga buysa, 2 saatten eskiyse sayılmaz)
ana ekranda **"Yoldasın"** kartı çıkar: tipik yol süren (son 14 günün tek yön yol sürelerinin ortancası, en az 3
örnek; yoksa 25 dk varsayılır) ve kalan süre kadar iş önerilir. Önce işaretli işler, sonra yola sığan hafif
(zihinsel yükü düşük) işler; süreler toplamı yolu aşmaz, derin odak ve ertelenmiş işler önerilmez. Uygun iş yoksa
iki kısa fikir çıkar (işe giderken planlama, eve giderken günü bırakma türünden; yargı içermez). Kartta "Yaptım"
düğmesi görevi her zamanki enerji sorusuyla bitirir. Yolda işareti plana etki etmez; yalnızca öneri kartını besler.

**Günün özet satırı:** ana ekranda tarihin altında "3 iş bitti, 2 açık · su 1,2 L / 2,0 L · sigara 4/10". Yalnızca
sayılar; yorum yok.

**Yedek hatırlatması:** en az 30 kaydın varsa ve hiç yedek alınmadıysa ya da son yedek 14 günden eskiyse ana ekranda
küçük bir satır çıkar. "Şimdi değil" bir hafta susturur; satıra dokununca Ayarlar'daki yedek bölümü açılır.

## Dil öğrenme (Ana ekran > Daha fazla > Dil öğrenme)

Dil çalışması üç kaynaktan toplanır: **uygulama** (varsayılan Duolingo), **kalem kağıt** ve **dinleme / konuşma**.
- **Uygulama süresi kendiliğinden sayılır.** Gün analizindeki ekran süresi okumasında adı eşleşen uygulamanın dakikası
  (büyük/küçük harf ve ı/İ fark etmez; adlar Ayarlar bölümünde virgülle değiştirilebilir, en çok 8) dil öğrenme
  sayılır. Ekran süresi okunamıyorsa (izin yok / iOS) "Uygulama (elle)" ile dakika eklenir. Otomatik süre varken elle
  uygulama kaydı **çift sayılmaz**.
- **Kalem kağıt / dinleme:** tür seçip +10 / +15 / +20 / +30 dk ya da kendi süreni yazarak eklersin; bugünkü kayıtlar
  tek tek silinebilir. Gece 04:00'e kadar yapılanlar önceki güne yazılır.
- **Günlük hedef** (10–60 dk ya da "Hedef yok", varsayılan 20 dk) ilerleme çubuğuyla gösterilir; baskı ya da yargı yok.
- **Geçmiş:** "İlerleme ve geçmiş" ekranında "Dil öğrenme" günlük grafiği; dil ekranında son 7 gün / öncesindeki 7 gün.
- **Gün sonu analizi:** uygulamada geçen dil süresi ekran süresinden **düşülür**, yani "Ekran yerine" önerisi dil
  öğrenme dakikalarını saymaz ("bunun 40 dk'sı dil öğrenme uygulamasında geçti, kalan …"). Ekran dışı dil çalışması
  "kayıt dışı" zamandan düşülür ("… dil çalışmasına gitti"). Kopyala-yapıştır yolunda istem aynı satırları ister; dil
  uygulaması bilgisi yalnızca ekran paylaşımı açıksa isteme girer.
- **Yolda kartı:** dil öğrenme ilk öneridir (kalan hedef kadar, "bugün 12 / 20 dk"); hedef tamamsa dakika yazılmaz.
- Günün özet satırına "dil 12 / 20 dk" eklenir; yedek ve geri yükleme `StudyLog` tablosunu da kapsar.

## Haftalık iş programı ve boş gün (Hedefler > İş saatleri)

İş saatleri gün bazlıdır: **ortak saat** (özel saati olmayan iş günleri) ve istenen günlere **özel saat**. İlk açılışta
bir kez şu program kaydedilir (sonra Hedefler'den değiştirilebilir, bir daha üzerine yazılmaz): **Pzt–Cum 07:40–18:00,
Cumartesi 08:30–13:30, Pazar tamamen boş**. Ekranda gün gün program, haftalık toplam, çalışılan gün seçimi ve 10/30
dakikalık adımlarla saat ayarı vardır.
- Planlayıcı, gün sonu zaman analizi, zaman dengesi ve işaretleme ekranı her günün kendi penceresini kullanır
  (Cumartesi 13:30'dan sonrası serbest; Pazar günün tamamı serbest).
- "Günü işaretle" kartı ve hatırlatması iş bitişine göre gelir (Cumartesi 13:45, hafta içi 18:15); boş günde gelmez.
- **Boş gün kartı:** iş saatleri açıkken çalışılmayan günde (Pazar) ana ekranda "🌿 Boş gün" çıkar: odak isteyen, uzun
  ve ertelenmiş işlerden en çok 5 tanesi, toplam ≈5 saati geçmeyecek şekilde önerilir (gün baştan sona doldurulmaz;
  yargı içermez).

## Kahraman: seviye, altın, ödüller, seri, rozetler (Habitica benzeri)

Ana ekranda tarihin altında tek satır ("🌱 Sv 3 · Yolcu · 🪙 85 · 🔥 5" ve ince bir XP çubuğu); dokununca **Kahraman**
ekranı açılır (Daha fazla > Kahraman).
- **Puan kayıtlarından hesaplanır** (ayrı puan tablosu yok): iş bitirmek 10 XP + her 5 dakika için 1 (günde en çok 8 saat),
  rutin 5 (günde en çok 50), su hedefi 10, dil çalışması 2 dakikada 1 (günde en çok 60 dk; dil hedefi tamamlanırsa +10).
  Bu yüzden bir işi geri alırsan puanı da geri gider; eski kayıtların puanı da sayılır (son 2 yıl).
- **Seviye:** 1. seviyeden 2'ye 100 XP, her seviye 50 XP fazla. Ünvanlar: Çaylak, Yolcu (3), Kâşif (6), Usta (10),
  Üstat (15), Efsane (20). Seviye atlayınca ana ekranda bir kez tebrik kartı çıkar.
- **Altın:** XP'nin yarısı. **Ödüller** (kahve molası, tatlı, 30 dk dizi… ya da kendi yazdığın, 1–1000 altın, en çok 20)
  altınla "satın alınır"; satın alma "Geri al" ile geri alınır, altın geri döner. Ödül listesi ayarlarda durur
  (yedeğe girer).
- **Seri:** puan kazanılan günlerin zinciri; iki gün arasında bir boş gün (dinlenme günü) seriyi bozmaz, bugün henüz
  bitmediği için bozmaz. **Rozetler:** iş sayısı, seri, su, dil saati, rutin ve seviye için 17 rozet.
- **Habitica'dan farkı:** can kaybı, ceza ya da puan düşmesi yoktur (Aura yargılamaz).

## Hafta planı (Daha fazla > Hafta planı)

Görev eklerken/düzenlerken **"Ne zaman?"**: Bugün, Yarın ya da sonraki günlerden biri. Bir güne ayrılan iş o güne kadar
ana ekranda, günlük planda ve gün analizinde görünmez (o gün gelince kendiliğinden çıkar; günü geçmiş iş yuvarlanır,
kaybolmaz). Ana ekranda "📅 N iş başka günlere ayrıldı" ipucu çıkar.
- **Hafta planı ekranı:** önümüzdeki 7 gün; her günün iş saati (iş günü / Cumartesi yarım gün / 🌿 boş gün), yaklaşık
  iş dışı boş zamanı ve ayrılan işler ("Rahat" / "Dolu"). Her işte **Taşı** ile başka güne ya da bugüne alınır.
- **Otomatik dağıt:** bugünün bekleyen/ertelenen işlerini haftaya dağıtmayı önerir (onay sorar): odak isteyen ya da 45 dk
  ve üstü işler önce boş güne (Pazar), sonra yarım güne; kısa işler en yakın uygun güne. Her güne boş zamanın en çok %60'ı
  kadar iş ayrılır; sığmayan yerinde kalır, başlanmış işe dokunulmaz. "Hepsini bugüne al" ile geri alınır.
- Boş zaman yaklaşıktır: uyanık 07:00–23:00, iş günlerinde yol + hazırlık için 90 dk düşülür.
- Yedekte `Task.plannedDay` da yer alır; eski yedekler günsüz geri yüklenir.

## Gün rehberi (ana ekranda "ŞİMDİ" kartı, Daha fazla > Gün rehberi)

Saatleri sen verdin; uygulama günü saat saat yönlendirir. Ana ekranın üstünde **ŞİMDİ** kartı ne yapman gerektiğini ("İş ·
18:00'e kadar") ve sıradakini ("18:00 Yolda · eve") söyler; dokununca tüm gün çizelgesi açılır.
- **İş günü (Pzt–Cum 07:40–18:00):** hazırlık ve kahvaltı (tipik uyanışa göre; kayıt yoksa çıkıştan 1 saat önce), yolda
  (tipik yol süresi, kayıt yoksa 25 dk), iş, eve yol, akşam yemeği, gün sonu değerlendirmesi 21:30, yatıştan 30 dk önce
  "günü yavaşça kapat".
- **Cumartesi (08:30–13:30):** işten sonra öğle yemeği, öğleden sonra serbest, akşam yemeği 19:30.
- **Pazar (boş gün):** 08:00'de yavaş başlangıç, öğle 13:00, akşam 19:30, gün boyu serbest; "Haftaya bakış" (Hafta planı)
  önerisi yalnızca Pazar günü.
- **İşlerin:** planlayıcının yerleştirdiği işler boş aralıklara oturur (yemek/yolla çakışırsa sonraya kayar, sığmayan
  "bugüne sığmayanlar"da yazılır); iş saatine denk gelenler İş parçasının notunda görünür.
- **Öneriler (yok sayılabilir):** dil öğrenme (kalan hedef kadar, en çok 30 dk; boş günde 45 dk), kısa yürüyüş, serbest
  zaman. Yargı içermez.

## Rutin paketleri, simge/renk, alışkanlık takvimi, ruh hali (Me+ benzeri)

- **Hazır paketler** (Rutinlerim > Hazır paketler): "Güne güzel başla", "Yolda ve iş çıkışı", "Akşam sakinliği", "Kendine bakım", "Hareket ve enerji". Tek dokunuşla paketteki tüm rutinler eklenir; zaten ekli olanlar atlanır. Şablon sayısı 25'e çıktı; saatler iş saatlerine göre ayarlıdır ve sonradan değiştirilebilir.
- **Simge ve renk**: her rutine 24 simgeden ve 8 renkten biri seçilir (Rutinlerim > Düzenle). Seçilmezse kategorinin varsayılanı kullanılır. Rutin listesinde ve ana ekrandaki rutin kartında görünür.
- **Alışkanlık takvimi** (ana ekran > Daha fazla > Alışkanlık takvimi ya da ruh hali kartındaki "Takvim ›"): ay görünümü, yapılan rutin sayısına göre koyulaşan günler, tek rutine göre süzme, güncel ve en uzun seri, gün ayrıntısı. Yapılmayan gün boş bir hücredir; kimse suçlanmaz.
- **Ruh hali kaydı**: ana ekranda "Bugün nasılsın?" kartı (5 seçenek + isteğe bağlı kısa not). Düşük günlerde Aura yargılamadan planı hafifletmeyi önerir; üst üste 3 düşük günde nazikçe konuşmayı önerir. Takvimde geçmiş günler düzeltilebilir, haftalık çubuklar ve ay dağılımı görünür. Yeterli veri varsa ve fark olumluysa "rutin yaptığın günlerde ruh halin ortalama X" gözlemi çıkar.
- **Gün sonu değerlendirmesi**: seçilen ruh hali değerlendirmeye ve kopyala-yapıştır özetine girer; notun hiçbir yere gitmez.
- **Rutin tarzı testi** (Rutinlerim > Rutin tarzı testi): altı soru, sana uygun iki paket önerir.
- **Günün küçük ipucu**: takvim ekranının üstünde, her gün farklı (30 ipucu).
- **Günlere bağlı rutinler** (Rutinlerim > Düzenle > Hangi günler?): her gün, iş günleri (Pzt–Cmt), hafta içi, hafta sonu, yalnız Pazar ya da tek tek günler. Planlı olmayan günde rutin sorulmaz, bildirim gitmez, ana ekran ve sabah brifinginde görünmez; gün sonu değerlendirmesinde "açık kalan" sayılmaz; haftalık özette o gün "yapma şansı" sayılmaz. Seri yalnızca planlı günlere göre sayılır (haftalık bir rutinin serisi üst üste Pazarlardır). Gün sonu ekranında "yarın" listesi de yalnızca yarın planlı rutinleri gösterir.
- **Pazar paketi** ("Pazar: boş gün"): haftayı planla, uzun yürüyüş, ev işleri ve çamaşır, sevdiklerinle bir kahve; hepsi yalnızca Pazar günleri sorulur. "Yolda" şablonları (nefes, dil çalışması) Pzt–Cmt günlerine bağlıdır.
- Yedeğe `MoodLog` tablosu ve rutin simge/renk/günleri dahildir.

## Sonradan işaretleme, rutin modu, kelime defteri, aylık karne, haftalık görevler

- **Geçmiş günü sonradan işaretleme** (Alışkanlık takvimi > bir güne dokun): işte telefona bakamadığın günleri akşam ya da Pazar günü düzeltirsin. Her rutinin yanında "Yaptım" (geçmiş ve bugün için) ve "Geri al" düğmesi vardır; gelecek gün işaretlenemez. Kayıt, rutinin sorulma saatine yazılır, yani "en iyi saat" gibi istatistikler bozulmaz. Seri, takvim, haftalık özet ve Kahraman puanı kendiliğinden güncellenir. Bir görevden doğan "yapıldı" kaydı kilitlidir (görev "Günü işaretle"den geri alınır).
- **Rutin modu** (ana ekran > Rutin modu ya da Rutinlerim > "Rutin modunu başlat"): bugünün açık rutinlerini tek ekranda, sorulma saatine göre sırayla yürütür. Tur seçimi: Sabah / Akşam / Hepsi (saate göre önerilir). Her adımda yalnızca o rutin görünür: simge, ad, tahmini süre ve isteğe bağlı geri sayım sayacı (süre dolunca "+" ile fazlası gösterilir, baskı yoktur). "Yaptım" rutini tamamlar (açık görevi de kapatır), "Sonra" turun sonuna alır (bir kez), "Bugün atla" bugünü kapatır ve yarın yine sorulur. Pazar rutini Pazartesi turunda çıkmaz.
- **Kelime defteri** (Dil öğrenme > Kelime defteri): yolda ya da işte gördüğün kelimeyi hızla yaz (kelime, anlam, isteğe bağlı not). Aynı kelime ikinci kez eklenmez (Türkçe harf duyarlı). Tekrar kartları Leitner kutularıyla çalışır: bilince kart 1-3-7-16-35 gün aralıklarla geri gelir, "Tekrar göreceğim" denince iki kutu geri düşer (sıfırlanmaz). Bir seans en çok 12 kart; biten seansın süresi dil çalışmasına ("Dinleme / konuşma") yazılır. Yedeğe `Vocab` tablosu dahildir.
- **Aylık karne** (ana ekran > Aylık karne): ayın tek sayfalık özeti. Etkin gün, tamamlanan rutin, biten iş, dil çalışması, en uzun rutin serisi, en dolu gün, ruh hali dağılımı ve ortalaması, uyku/adım/su ortalamaları, Kahraman seviyesi. Önceki ayla kıyas yargısızdır: düşüşte "biraz daha sakin geçti" denir; süren ay, önceki ayın aynı sayıdaki gününe göre kıyaslanır. Aylar arasında gezilir.
- **Haftalık görevler** (Kahraman ekranı): her Pazartesi 3 yeni görev ("Bu hafta 3 gün dil çalış", "5 gün en az bir rutin yap", "Su hedefini 4 gün tamamla", "4 gün ruh halini yaz" gibi). Seçim haftaya göre sabittir ve her görev farklı bir alandandır; su hedefi yoksa su görevi çıkmaz. İlerleme geçmişten türetilir, tamamlanan görevin XP'si (20-40) ve altını eklenir, "İlk görev" ve "10 görev" rozetleri vardır. Görevler ilk görüldüğü haftadan başlar: eski haftalara bonus yağmaz, seviye birden sıçramaz. Tamamlanmayan görev puan düşürmez.

## Bildirimden cevap (Yaptım / Yapacağım / Bugün değil)

Rutin hatırlatma bildiriminde üç düğme çıkar: **Yaptım ✓**, **Yapacağım**, **Bugün değil**. Bildirimi açıp rutini aramana gerek kalmaz; düğmeye basınca uygulama bir an açılır, cevap kaydedilir ve küçük bir mesajla onaylanır (ana ekran ve Rutinlerim kendiliğinden tazelenir). Düğmeler yalnızca rutin hatırlatmalarında vardır; sabah brifingi, su ve gün sonu bildirimlerinde yoktur.

- Cevap, bildirimin ait olduğu güne işlenir: dünkü bildirimdeki "Yaptım" dünü işaretler; "Yapacağım" ve "Bugün değil" yalnızca bugünün bildirimleri için geçerlidir.
- Güvenli: zaten yapılmış rutin sonradan "Bugün değil" ile bozulmaz; aynı cevap iki kez yazılmaz; planlı olmayan günde (ör. Pazar rutini Pazartesi) bir şey değişmez; 36 saatten eski bildirim cevabı işlenmez.
- Düğme uygulamayı bilerek açar: uygulama kapalıyken arka planda çalışmaya güvenilmediği için cevabın kaybolmaması tercih edildi.
- Eski bildirimler uygulama ilk açıldığında düğmeli olarak yeniden kurulur.

## Sabah egzersizi (ana ekranda sabah kartı, Ayarlar > Sabah egzersizi)

Ekipmansız güç programı artık "Daha fazla" menüsünde değil; **sabah saatinde** yapılır. Program ekranına ana ekrandaki sabah kartından ya da Ayarlar > Sabah egzersizi'nden girilir.

- **Güne başlama saati**: varsayılan 06:00 (05:00-07:00 arası seçenekler). Egzersiz bu saatte başlar ve 30 dakika sürer (06:00-06:30). Saat değişince pencere, bildirim ve alarm saati birlikte değişir.
- **Egzersiz günleri**: varsayılan Pzt-Çar-Cum; günler program ekranından seçilir, en az bir gün kalır.
- **Ana ekran kartı**: yalnızca egzersiz gününde 05:00-12:00 arası görünür (yapıldıysa "tamam" kartı); zor gün modunda yapılmamış kart gizlenir. Dokununca seans açılır.
- **Hatırlatma bildirimi**: egzersiz günlerinde güne başlama saatinde, sesli ve titreşimli ayrı kanalda ("Sabah egzersizi"). Bugün yapıldıysa ya da zor gün modundaysa bugünün bildirimi gelmez. Ayarlardan kapatılabilir.
- **Alarm**: program ekranındaki "Alarmı Saat uygulamasına kur" düğmesi telefonun Saat uygulamasını güne başlama saati ve "Sabah egzersizi" adıyla hazır dolu açar. Onay işaretine dokunup tekrar günlerini seçmek kullanıcıya kalır (Android, uygulamanın izinsiz ve sessizce alarm kurmasına izin vermez; böylece çift alarm da oluşmaz). Yeni paket gerekmez; yalnızca normal (kullanıcıya sorulmayan) `SET_ALARM` izni eklendi.
- **30 dakikalık seans**: her hareket 3 set. 2 dk ısınma + 3 blok: Bacak ↔ Çekme, İtme ↔ Arka zincir, Karın. Bloktaki iki hareket dönüşümlü yapılır, setler arası 60 sn dinlenme (90 sn ya da 3 dk da seçilebilir). Aynı hareketin iki seti arası yaklaşık 3 dakika olur, güç için yeterli. Tahmini süre ekranda görünür; dinlenme uzarsa son blok (karın) atlanabilir.
- **Günü değerlendirme**: sabah egzersizi yapıldıysa özetteki çipe ("sabah egzersizi yapıldı"), kural tabanlı değerlendirme metnine ve yapay zekâ komutuna (hangi hareket, kaç set) girer. Planlı ama yapılmadıysa yargılamadan yalnızca veri olarak anılır. Programın olduğu günlerde yeni "egzersiz" rutini önerilmez; önerilen rutin saatleri iş saatlerine ve sabah egzersiz penceresine denk gelmez (gerekirse iş çıkışına kaydırılır).
- Veriler Setting tablosundadır (`exercise_v1`), yedeğe kendiliğinden dahildir; eski kayıtlar varsayılan programla açılır.

## Simgeler: su bardağı, şişe ve diğerleri

- **Su ekranı (Su ve yemek)**: dört hazır miktarın her biri kendi simgesiyle dokunulabilir kutu olarak gelir: Bardak (200 ml), Küçük şişe (330 ml), Şişe (500 ml), Büyük şişe (750 ml). Bardak ve şişeler emoji değil, uygulamanın içinde çizilir (yazı tipine ve telefona bağlı değildir). Bugünkü kayıtlar listesinde her su kaydının yanında miktarına uyan simge görünür. Gün akışındaki "+200 ml su içtim" düğmesinde de bardak vardır.
- **Damacana**: Su kartının başında büyük bir damacana durur; içtikçe içindeki su yükselir (içilen su / günlük hedef). Ekran açılınca damacana boştan hedefe doğru dolar, hedef tamamlanınca su mavi yerine nane yeşili olur. Yanında içilen miktar, hedef, yüzde ve "Hedefe … kaldı" yazar. Ana ekrandaki "+200 ml" düğmesinde de aynı damacananın küçüğü vardır ve aynı oranı gösterir. Damacana da çizilir (`services/damacana.ts` geometri, `components/Damacana.tsx` çizim); hedef Ayarlar'dan değiştirilince doluluk oranı da buna göre değişir.
- **Beslenme**: çay 🍵, kahve ☕, şekerli içecek 🥤; öğünler kahvaltı 🍳, öğle 🍽️, akşam 🍲, ara öğün 🍪; yiyecek grupları (sebze 🥗, meyve 🍎, protein 🍗, ekmek ve tahıl 🍞, süt ürünü 🥛, kuruyemiş 🥜, tatlı 🍰, kızartma 🍟).
- **Rutinler**: simge seçilmediyse rutin adına uyan simge kendiliğinden gelir ("Bir bardak su iç" bardak, "Öğle arası su şişesi doldurma" şişe, "Çalışma masası yüzey düzeni" süpürge, "Oda Havalandırma ve Nefes" rüzgâr, "Zihinsel Odaklanma Seansı" beyin ...). Rutin düzenleme penceresinde bardak ve şişe seçilebilir; ad yazıldıkça önizlemedeki simge de değişir.
- **Eski rutinler**: uygulama bir kez, simgesi boş olan ya da yalnızca kategorinin varsayılan simgesini taşıyan rutinlerin simgesini adına göre yeniler. Kendi seçtiğin simgeye dokunulmaz. Sonradan değiştirdiğin simge bir daha otomatik değişmez.
- **Eski telefon uyumu**: yalnızca Emoji 11 ve öncesi kullanıldı. Diş fırçası emojisi (🪥) eski Samsung ve Android telefonlarda kutucuk olarak göründüğü için diş 🦷 ile değiştirildi. Test, Emoji 12 ve sonrası (U+1FA70 üstü) bir simgenin eklenmesini engeller.
- Çizilen simgeler rutinde `ico:glass` ve `ico:bottle` anahtarıyla saklanır; yedeğe ve geri yüklemeye kendiliğinden dahildir.

## Logo ve ikon

Logo özgündür: koyu arka planda, mavi (Kronos, zaman) ve nane yeşili (Aura, enerji) iki yaydan oluşan bir saat; akrep
mavi, yelkovan ise Aura'yı temsil eden bir yaprak. Dosyalar `assets/` klasöründe:
`icon.png` (uygulama ikonu), `adaptive-icon.png` (Android uyarlanabilir ikon ön planı, arka plan `#0B0D12`),
`notification-icon.png` (bildirim simgesi, beyaz silüet), `logo.png` / `logo.svg` (yuvarlatılmış logo),
`logo-wordmark.png` (yazılı yatay logo). `app.json` bunları kullanır.
