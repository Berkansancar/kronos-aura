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
  /** Bugün "yapmadım / yapamadım" denmişse kısa not (ör. "Yapamadım · İş vaktindeydi") */
  outcomeNote?: string | null;
  /** İş saatleri açıksa "iş vaktinde yapılabilir" işareti gösterilir */
  workEnabled?: boolean;
  onStart: () => void;
  /** Yaptım / Bitir: enerji sorusunu açar */
  onFinish: () => void;
  onNotDone?: () => void;
  onCouldNot?: () => void;
  onToggleWorkOk?: () => void;
  onPostpone: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

export function TaskItem({
  task,
  timeLabel,
  outcomeNote,
  workEnabled,
  onStart,
  onFinish,
  onNotDone,
  onCouldNot,
  onToggleWorkOk,
  onPostpone,
  onRestore,
  onDelete,
}: Props) {
  const weight = WEIGHT_META[task.cognitiveWeight];
  const done = task.status === 'COMPLETED';
  const running = task.status === 'IN_PROGRESS';
  const postponed = task.status === 'POSTPONED';

  const confirmDelete = () =>
    Alert.alert('Görevi sil', `"${task.title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: onDelete },
    ]);

  const open = task.status === 'PENDING' || running;

  return (
    <Pressable
      onLongPress={confirmDelete}
      style={[styles.card, running && styles.cardRunning, done && styles.cardDone]}
    >
      <View style={styles.top}>
      <View style={[styles.stripe, { backgroundColor: weight.color }]} />
      <View style={styles.main}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={styles.meta}>
          {weight.label} · {formatDuration(task.estimatedDuration)}
          {timeLabel ? `  ·  ${timeLabel}` : ''}
        </Text>
        {postponed && <Text style={styles.note}>{outcomeNote ?? 'Ertelendi'}</Text>}
        {workEnabled && !done && onToggleWorkOk && (
          <Pressable onPress={onToggleWorkOk} hitSlop={6} style={[styles.workChip, task.workOk && styles.workChipOn]}>
            <Text style={[styles.workChipText, task.workOk && styles.workChipTextOn]}>
              {task.workOk ? '✓ İş vaktinde de yapılabilir' : 'İş vaktinde yapılmaz'}
            </Text>
          </Pressable>
        )}
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
      </View>

      {open && (
        <View style={styles.outcomeRow}>
          <Pressable onPress={onFinish} style={[styles.outBtn, styles.outDone]} hitSlop={4}>
            <Text style={[styles.outText, { color: colors.aura }]}>Yaptım</Text>
          </Pressable>
          {onNotDone && (
            <Pressable onPress={onNotDone} style={styles.outBtn} hitSlop={4}>
              <Text style={styles.outText}>Yapmadım</Text>
            </Pressable>
          )}
          {onCouldNot && (
            <Pressable onPress={onCouldNot} style={styles.outBtn} hitSlop={4}>
              <Text style={styles.outText}>Yapamadım</Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  workChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: 4,
  },
  workChipOn: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  workChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  workChipTextOn: { color: colors.aura },
  outcomeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingLeft: spacing.md + 4,
  },
  outBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outDone: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  outText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
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
