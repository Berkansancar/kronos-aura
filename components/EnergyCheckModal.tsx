import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { EnergyState } from '../database/types';

const OPTIONS: { value: EnergyState; label: string; hint: string; color: string }[] = [
  { value: 'HIGH', label: 'Enerjik', hint: 'Akıcı geçti, daha da yapabilirim', color: colors.aura },
  { value: 'EXHAUSTED', label: 'Yorgun', hint: 'Bitti ama beni tüketti', color: colors.warning },
  { value: 'DISTRACTED', label: 'Dağınık', hint: 'Zihnim sık sık başka yere gitti', color: colors.kronos },
];

interface Props {
  taskTitle: string | null;
  onSelect: (state: EnergyState) => void;
  onClose: () => void;
}

/** Görev bitince "şimdi nasılsın?" sorusu; cevap TimeLog'a yazılır ve koçları besler. */
export function EnergyCheckModal({ taskTitle, onSelect, onClose }: Props) {
  return (
    <Modal visible={taskTitle !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.heading}>Tebrikler, bitti</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {taskTitle}
          </Text>
          <Text style={styles.question}>Şu an nasıl hissediyorsun?</Text>

          {OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => onSelect(o.value)}
              style={({ pressed }) => [
                styles.option,
                { borderColor: o.color, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.optionLabel, { color: o.color }]}>{o.label}</Text>
              <Text style={styles.optionHint}>{o.hint}</Text>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 14 },
  question: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: spacing.sm },
  option: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  optionLabel: { fontSize: 15, fontWeight: '700' },
  optionHint: { color: colors.textMuted, fontSize: 12 },
  cancel: { alignSelf: 'center', marginTop: spacing.xs },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
