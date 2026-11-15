import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { SNOOZE_LABEL, availableSnoozeOptions, type SnoozeOption } from '../services/routineLogic';

interface Props {
  routineTitle: string | null;
  now: Date;
  onSelect: (option: SnoozeOption) => void;
  onClose: () => void;
}

const HINT: Record<SnoozeOption, string> = {
  MIN30: 'Yarım saat sonra tekrar soracağım',
  HOUR1: 'Bir saat sonra tekrar soracağım',
  EVENING: '19:30\'da tekrar soracağım',
  TOMORROW: 'Bugünlük kapanır, yarın yeniden sorarım',
};

/** "Sonra" denince ne zaman yeniden sorulacağını seçtirir. */
export function SnoozeModal({ routineTitle, now, onSelect, onClose }: Props) {
  const options = availableSnoozeOptions(now);
  return (
    <Modal visible={routineTitle !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.heading}>Ne zaman tekrar soralım?</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {routineTitle}
          </Text>
          {options.map((o) => (
            <Pressable
              key={o}
              onPress={() => onSelect(o)}
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.optionLabel}>{SNOOZE_LABEL[o]}</Text>
              <Text style={styles.optionHint}>{HINT[o]}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>Vazgeç</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  heading: { color: colors.text, fontSize: 19, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 14 },
  option: {
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  optionLabel: { color: colors.aura, fontSize: 15, fontWeight: '700' },
  optionHint: { color: colors.textMuted, fontSize: 12 },
  cancel: { alignSelf: 'center', marginTop: spacing.xs },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
