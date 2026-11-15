import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { TaskOutcomeReason } from '../database/types';
import { REASON_CHOICES } from '../services/taskOutcomeLogic';

interface Props {
  taskTitle: string | null;
  /** İş saatleri kapalıysa "İş vaktindeydi" seçeneği gösterilmez */
  workEnabled: boolean;
  onSelect: (reason: TaskOutcomeReason | null) => void;
  onClose: () => void;
}

/** "Yapamadım" denince sorulan kısa, yargısız soru: ne engelledi? Cevap vermek zorunlu değil. */
export function ReasonModal({ taskTitle, workEnabled, onSelect, onClose }: Props) {
  const choices = REASON_CHOICES.filter((c) => workEnabled || c.id !== 'WORK');
  return (
    <Modal visible={taskTitle !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.heading}>Olmadı, sorun değil</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {taskTitle}
          </Text>
          <Text style={styles.question}>Ne engelledi?</Text>

          {choices.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onSelect(c.id)}
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.optionLabel}>{c.label}</Text>
            </Pressable>
          ))}

          <Pressable onPress={() => onSelect(null)} hitSlop={8} style={styles.skip}>
            <Text style={styles.skipText}>Sebep söylemek istemiyorum</Text>
          </Pressable>
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
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  optionLabel: { color: colors.aura, fontSize: 15, fontWeight: '700' },
  skip: { alignSelf: 'center', marginTop: spacing.xs },
  skipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cancel: { alignSelf: 'center' },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
