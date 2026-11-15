import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { CognitiveWeight, Task } from '../database/types';
import { formatDuration } from '../services/format';

const WEIGHT_META: Record<CognitiveWeight, { label: string; color: string }> = {
  HIGH: { label: 'Derin odak', color: colors.weightHigh },
  MEDIUM: { label: 'Orta', color: colors.weightMedium },
  LOW: { label: 'Hafif', color: colors.weightLow },
};

interface Props {
  task: Task;
  /** "09:00–10:30" ya da "09:00–10:00 · 13:00–14:00"; yer yoksa boş */
  timeLabel: string;
  onStart: () => void;
  onFinish: () => void;
  onPostpone: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

export function TaskItem({ task, timeLabel, onStart, onFinish, onPostpone, onRestore, onDelete }: Props) {
  const weight = WEIGHT_META[task.cognitiveWeight];
  const done = task.status === 'COMPLETED';
  const running = task.status === 'IN_PROGRESS';
  const postponed = task.status === 'POSTPONED';

  const confirmDelete = () =>
    Alert.alert('Görevi sil', `"${task.title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: onDelete },
    ]);

  return (
    <Pressable
      onLongPress={confirmDelete}
      style={[styles.card, running && styles.cardRunning, done && styles.cardDone]}
    >
      <View style={[styles.stripe, { backgroundColor: weight.color }]} />
      <View style={styles.main}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={styles.meta}>
          {weight.label} · {formatDuration(task.estimatedDuration)}
          {timeLabel ? `  ·  ${timeLabel}` : ''}
        </Text>
        {postponed && <Text style={styles.note}>Ertelendi</Text>}
        {!done && !postponed && !timeLabel && !running && (
          <Text style={styles.note}>Henüz yer ayrılmadı</Text>
        )}
      </View>

      <View style={styles.actions}>
        {task.status === 'PENDING' && (
          <>
            <Pressable onPress={onStart} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>Başla</Text>
            </Pressable>
            <Pressable onPress={onPostpone} hitSlop={8}>
              <Text style={styles.link}>Ertele</Text>
            </Pressable>
          </>
        )}
        {running && (
          <Pressable onPress={onFinish} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Bitir</Text>
          </Pressable>
        )}
        {postponed && (
          <Pressable onPress={onRestore} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnGhostText}>Plana al</Text>
          </Pressable>
        )}
        {done && <Text style={styles.check}>✓</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  cardRunning: { borderColor: colors.kronos },
  cardDone: { opacity: 0.55 },
  stripe: { width: 4, alignSelf: 'stretch' },
  main: { flex: 1, paddingVertical: spacing.md, gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  titleDone: { textDecorationLine: 'line-through' },
  meta: { color: colors.textMuted, fontSize: 12 },
  note: { color: colors.warning, fontSize: 11, marginTop: 2 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  btn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  btnPrimary: { backgroundColor: colors.kronos },
  btnPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: colors.textMuted },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  link: { color: colors.textMuted, fontSize: 12 },
  check: { color: colors.aura, fontSize: 18, fontWeight: '700' },
});
