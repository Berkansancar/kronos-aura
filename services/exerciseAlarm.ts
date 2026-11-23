/**
 * Saat uygulamasına alarm kurar (Android "alarm kur" amacı). Yeni bir paket gerekmez: React Native'in kendi
 * Linking.sendIntent işlevi kullanılır. Saat uygulaması hazır dolu bir alarm ekranıyla açılır; kullanıcı
 * onaylar ve tekrar günlerini orada seçer. Böylece çift alarm oluşmaz ve alarmı kullanıcı kontrol eder.
 */
import { Linking, Platform } from 'react-native';
import { alarmExtras } from './exerciseLogic';

export type AlarmResult = { ok: true } | { ok: false; message: string };

export async function openAlarmEditor(startMin: number, message = 'Sabah egzersizi'): Promise<AlarmResult> {
  if (Platform.OS !== 'android') return { ok: false, message: 'Alarm kurma yalnızca Android telefonda çalışır.' };
  try {
    await Linking.sendIntent('android.intent.action.SET_ALARM', alarmExtras(startMin, message));
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'Saat uygulaması açılamadı. Saat uygulamasını elle açıp alarmı kurabilirsin.',
    };
  }
}
