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
components/     CoachConsole, CoachCard, TaskItem, TaskComposer, EnergyCheckModal
services/       scheduler.ts (zamanlama motoru) · coachEngine.ts (kural tabanlı koç)
                planner.ts · taskFlow.ts · coachContext.ts
services/ai/    claudeClient.ts · personas.ts · coachAI.ts · settings.ts
hooks/          useAICoachMessages.ts
database/       schema.ts · repository.ts · types.ts
scripts/        test-scheduler.ts · test-ai.ts
```

## Testler (isteğe bağlı)

```
npm run test:scheduler    zamanlama motoru, 48 kontrol
npm run test:ai           yapay zekâ katmanı (gerçek API'ye gitmez), 37 kontrol
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
