@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Kronos ve Aura - Kurulum
echo.
echo  === Kronos ve Aura: kurulum ve deneme ===
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules\expo goto kurulu

echo  [1/2] Paketler kuruluyor. Birkac dakika surebilir, pencereyi kapatma.
echo.
call npm install
if errorlevel 1 goto hata
call npx expo install expo-router expo-sqlite expo-secure-store expo-status-bar expo-constants expo-linking expo-location expo-task-manager react react-native react-native-screens react-native-safe-area-context
if errorlevel 1 goto hata
call npm install --save-dev typescript @types/react tsx
if errorlevel 1 goto hata
goto baslat

:kurulu
echo  [1/2] Paketler zaten kurulu.

:baslat
echo.
echo  [2/2] Uygulama baslatiliyor. Ekranda bir QR kod cikacak.
echo  Telefonunda Expo Go uygulamasini ac ve QR kodu okut.
echo  Kapatmak icin bu pencerede Ctrl+C tusuna bas.
echo.
call npx expo start
goto :eof

:nonode
echo  Node.js bulunamadi. Once onu kurman gerekiyor:
echo    1. Tarayicida nodejs.org adresini ac
echo    2. Yesil LTS dugmesiyle indirip kur
echo    3. Bu dosyaya tekrar cift tikla
echo.
pause
exit /b 1

:hata
echo.
echo  Bir hata olustu. Yukaridaki kirmizi yaziyi kopyalayip Claude'a gonder.
echo.
pause
exit /b 1
