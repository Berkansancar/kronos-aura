import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { CognitiveWeight, Task } from '../database/types';
import { whenChoices } from '../services/weekPlanLogic';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const WEIGHTS: { value: CognitiveWeight; label: string; hint: string; color: string }[] = [
  { value: 'HIGH', label: 'Derin odak', hint: 'Yazma, strateji, problem çözme', color: colors.weightHigh },
  { value: 'MEDIUM', label: 'Orta', hint: 'E-posta, toplantı hazırlığı', color: colors.weightMedium },
  { value: 'LOW', label: 'Hafif', hint: 'Düzenleme, rutin işler', color: colors.weightLow },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** İş saatleri açıksa "iş vaktinde de yapılabilir" anahtarı gösterilir */
  workEnabled?: boolean;
  /** Verilirse "Görevi düzenle" olarak açılır ve alanlar bu görevle dolar */
  editTask?: Task | null;
  /** Planlama gününün tarihi ("Ne zaman?" seçenekleri bugünden başlar) */
  today?: Date;
  onSubmit: (input: {
    title: string;
    estimatedDuration: number;
    cognitiveWeight: CognitiveWeight;
    workOk: boolean;
    commuteOk: boolean;
    plannedDay: string | null;
  }) => void;
}

export function TaskComposer({ visible, onClose, onSubmit, workEnabled, editTask, today }: Props) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [weight, setWeight] = useState<CognitiveWeight>('MEDIUM');
  const [workOk, setWorkOk] = useState(false);
  const [commuteOk, setCommuteOk] = useState(false);
  const [plannedDay, setPlannedDay] = useState<string | null>(null);
  const choices = useMemo(() => whenChoices(today ?? new Date()), [today, visible]);

  // Her açılışta alanlar baştan kurulur: yeni görevde boş, düzenlemede görevin kendi değerleri
  useEffect(() => {
    if (!visible) return;
    setTitle(editTask?.title ?? '');
    setDuration(editTask?.estimatedDuration ?? 30);
    setWeight(editTask?.cognitiveWeight ?? 'MEDIUM');
    setWorkOk(editTask?.workOk === true);
    setCommuteOk(editTask?.commuteOk === true);
    // Yalnızca ileri bir güne ayrılmışsa seçili gelir (geçmiş gün = bugün)
    setPlannedDay(editTask?.plannedDay && choices.some((c) => c.key === editTask.plannedDay) ? editTask.plannedDay : null);
    // editTask nesnesi değil kimliği izlenir; yazarken alanlar sıfırlanmasın
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editTask?.id]);

  // Görevin süresi listede yoksa (ör. rutinden gelen 25 dk) o da seçenek olarak gösterilir
  const extraDuration = editTask?.estimatedDuration;
  const durations = useMemo(
    () =>
      extraDuration !== undefined && !DURATIONS.includes(extraDuration)
        ? [...DURATIONS, extraDuration].sort((a, b) => a - b)
        : DURATIONS,
    [extraDuration]
  );

  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      estimatedDuration: duration,
      cognitiveWeight: weight,
      // İş saatleri kapalıyken düzenlemede görevin mevcut işareti bozulmaz
      workOk: workEnabled ? workOk : editTask?.workOk === true,
      commuteOk,
      plannedDay,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.dismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.heading}>{editTask ? 'Görevi düzenle' : 'Yeni görev'}</Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Ne yapılacak?"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoFocus={!editTask}
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          <Text style={styles.label}>Tahmini süre</Text>
          <View style={styles.wrap}>
            {durations.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                style={[styles.pill, duration === d && styles.pillActive]}
              >
                <Text style={[styles.pillText, duration === d && styles.pillTextActive]}>{d} dk</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Zihinsel yük</Text>
          <View style={styles.weightList}>
            {WEIGHTS.map((w) => {
              const active = weight === w.value;
              return (
                <Pressable
                  key={w.value}
                  onPress={() => setWeight(w.value)}
                  style={[styles.weightRow, active && { borderColor: w.color }]}
                >
                  <View style={[styles.dot, { backgroundColor: w.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weightLabel}>{w.label}</Text>
                    <Text style={styles.weightHint}>{w.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Ne zaman?</Text>
          <View style={styles.wrap}>
            {choices.map((c) => (
              <Pressable
                key={c.key ?? 'today'}
                onPress={() => setPlannedDay(c.key)}
                style={[styles.pill, plannedDay === c.key && styles.pillActive]}
              >
                <Text style={[styles.pillText, plannedDay === c.key && styles.pillTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          {workEnabled && (
            <View style={styles.workRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.weightLabel}>İş vaktinde de yapılabilir</Text>
                <Text style={styles.weightHint}>
                  Kapalıysa bu iş yalnızca iş saatleri dışına yerleşir
                </Text>
              </View>
              <Switch
                value={workOk}
                onValueChange={setWorkOk}
                trackColor={{ true: colors.aura, false: colors.border }}
              />
            </View>
          )}

          <View style={styles.workRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.weightLabel}>🚌 Yolda yapılabilir</Text>
              <Text style={styles.weightHint}>Minibüste telefonla yapılabilen hafif iş; yoldayken önerilir</Text>
            </View>
            <Switch
              value={commuteOk}
              onValueChange={setCommuteOk}
              trackColor={{ true: colors.kronos, false: colors.border }}
            />
          </View>

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.submit, !canSubmit && { opacity: 0.4 }]}
          >
            <Text style={styles.submitText}>{editTask ? 'Kaydet ve yeniden yerleştir' : 'Ekle ve yerleştir'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.kronos, borderColor: colors.kronos },
  pillText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: colors.bg },
  weightList: { gap: spacing.sm },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  weightLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  weightHint: { color: colors.textMuted, fontSize: 12 },
  workRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submit: {
    backgroundColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
});
