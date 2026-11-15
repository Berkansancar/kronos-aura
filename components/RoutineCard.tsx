import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { RoutineBrief } from '../database/types';
import { formatAskTime } from '../services/routineLogic';

interface Props {
  brief: RoutineBrief;
  busy?: boolean;
  onAccept: () => void;
  onDone: () => void;
  onLater: () => void;
  onSkipToday: () => void;
  onRetire: () => void;
}

/** "Bugün bunu yapacak mısın?" kartı: beş cevap, hiçbiri yargılamaz. */
export function RoutineCard({ brief, busy, onAccept, onDone, onLater, onSkipToday, onRetire }: Props) {
  const { routine, stats } = brief;

  const confirmRetire = () =>
    Alert.alert(
      'Bir daha yapmayacak mısın?',
      `"${routine.title}" listenden kalkar ve sana bir daha sorulmaz. Geçmişi saklanır; istersen Rutinlerim sayfasından geri alabilirsin.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Evet, bırak', style: 'destructive', onPress: onRetire },
      ]
    );

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.time}>{formatAskTime(routine)}</Text>
        <Text style={styles.meta}>{routine.estimatedDuration} dk</Text>
      </View>
      <Text style={styles.title}>{routine.title}</Text>
      <Text style={styles.question}>
        {stats.streak >= 2 ? `${stats.streak} gündür devam ediyorsun. Bugün de yapacak mısın?` : 'Bugün bunu yapacak mısın?'}
      </Text>

      <View style={styles.row}>
        <Pressable disabled={busy} onPress={onAccept} style={[styles.primary, busy && styles.dim]}>
          <Text style={styles.primaryText}>Yapacağım</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onDone} style={[styles.secondary, busy && styles.dim]}>
          <Text style={styles.secondaryText}>Yaptım</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable disabled={busy} onPress={onLater} style={[styles.ghost, busy && styles.dim]}>
          <Text style={styles.ghostText}>Sonra</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onSkipToday} style={[styles.ghost, busy && styles.dim]}>
          <Text style={styles.ghostText}>Bugün değil</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={confirmRetire} style={[styles.ghost, busy && styles.dim]}>
          <Text style={[styles.ghostText, { color: colors.danger }]}>Bir daha yapmam</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.aura, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  meta: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  question: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  primary: {
    flex: 1.4,
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { color: colors.aura, fontWeight: '700', fontSize: 14 },
  ghost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 9,
    alignItems: 'center',
  },
  ghostText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
