import { Alert } from 'react-native';
import { HARD_DAY_MAX_TASKS } from '../services/hardDayLogic';

/** Zor gün modunu açmadan önce ne olacağını açıkça söyleyen onay penceresi. */
export function confirmStartHardDay(onConfirm: () => void): void {
  Alert.alert(
    'Zor gün modunu açalım mı?',
    `Planında en fazla ${HARD_DAY_MAX_TASKS} hafif iş kalır. Diğer işler bugünlük ertelenir; modu kapatınca geri gelir. 10 dakikadan uzun rutinler bugün sorulmaz ve hiçbiri kaçırılmış sayılmaz.`,
    [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Aç', onPress: onConfirm },
    ]
  );
}

export function confirmEndHardDay(onConfirm: () => void): void {
  Alert.alert('Normal güne dönelim mi?', 'Ertelenen işler plana geri gelir ve rutinlerin yine sorulur.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Evet, dönelim', onPress: onConfirm },
  ]);
}
