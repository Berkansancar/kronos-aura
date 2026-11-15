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
                activity.tsx (gün analizi, uyku) · routines.tsx (rutinlerim)
components/     CoachConsole, CoachCard, TaskItem, TaskComposer, EnergyCheckModal
                RoutineCard, SnoozeModal, RoutineEditor
services/       scheduler.ts (zamanlama motoru) · coachEngine.ts (kural tabanlı koç)
                planner.ts · taskFlow.ts · coachContext.ts
                routineLogic.ts · routineFlow.ts · routineTemplates.ts · routineReminders.ts
                sleepLogic.ts · activity.ts
services/ai/    claudeClient.ts · personas.ts · coachAI.ts · settings.ts
hooks/          useAICoachMessages.ts
database/       schema.ts · repository.ts · types.ts
scripts/        test-scheduler.ts · test-ai.ts · test-activity.ts · test-routines.ts · test-sleep.ts
```

## Testler (isteğe bağlı)

```
npm run test:scheduler    zamanlama motoru, 48 kontrol
npm run test:ai           yapay zekâ katmanı (gerçek API'ye gitmez), 37 kontrol
npm run test:activity     gün analizi ve veritabanı geçişleri, 51 kontrol
npm run test:routines     rutinler, analiz, hatırlatmalar, koç entegrasyonu, 100 kontrol
npm run test:sleep        uyku tahmini, 33 kontrol
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
