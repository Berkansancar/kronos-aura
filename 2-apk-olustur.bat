@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Kronos ve Aura - APK olustur
echo.
echo  === APK olusturma: bulutta yapilir, Android Studio gerekmez ===
echo.

if not exist node_modules\expo goto once

echo  Bu islem icin ucretsiz bir Expo hesabi gerekir.
echo  Hesabin yoksa once tarayicida expo.dev/signup adresinden olustur.
echo.
pause

echo.
echo  [1/2] Expo hesabina giris: kullanici adini ve sifreni yazip Enter'a bas.
echo.
call npx --yes eas-cli@latest login
if errorlevel 1 goto hata

echo.
echo  [2/2] APK derleniyor. Sorulari Y yazip Enter'a basarak onayla:
echo    - EAS projesi olusturulsun mu: Y
echo    - Yeni Android Keystore uretilsin mi: Y
echo  Derleme bulutta yapilir ve 10-20 dakika surebilir. Pencereyi kapatma.
echo.
call npx --yes eas-cli@latest build --platform android --profile preview
if errorlevel 1 goto hata

echo.
echo  Bitti. Ekrandaki indirme baglantisini Android telefonunda ac ve APK dosyasini indir.
echo  Telefon bilinmeyen kaynaklardan yuklemeye izin vermeni isteyebilir, izin ver.
echo.
pause
goto :eof

:once
echo  Once 1-kurulum-ve-dene.bat dosyasini calistirman gerekiyor.
echo.
pause
exit /b 1

:hata
echo.
echo  Bir hata olustu. Yukaridaki kirmizi yaziyi kopyalayip Claude'a gonder.
echo.
pause
exit /b 1
