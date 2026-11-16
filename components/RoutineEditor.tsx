import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { CognitiveWeight, Routine, RoutineCategory } from '../database/types';
import { CATEGORY_LABEL } from '../services/routineTemplates';
import { ROUTINE_COLORS, ROUTINE_ICONS, routineColor, routineIcon } from '../services/routineLook';

const DURATIONS = [5, 10, 15, 20, 30, 45, 60];
const MINUTES = [0, 15, 30, 45];
const HOURS = [6, 7, 8, 9, 10, 12, 13, 15, 17, 18, 19, 20, 21];
const WEIGHTS: { value: CognitiveWeight; label: string; color: string }[] = [
  { value: 'LOW', label: 'Hafif', color: colors.weightLow },
  { value: 'MEDIUM', label: 'Orta', color: colors.weightMedium },
  { value: 'HIGH', label: 'Derin odak', color: colors.weightHigh },
];

export interface RoutineDraft {
  title: string;
  category: RoutineCategory;
  estimatedDuration: number;
  cognitiveWeight: CognitiveWeight;
  askHour: number;
  askMinute: number;
  icon: string;
  color: string;
}

interface Props {
  visible: boolean;
  /** Verilirse düzenleme, verilmezse yeni rutin */
  routine: Routine | null;
  onClose: () => void;
  onSubmit: (draft: RoutineDraft) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function RoutineEditor({ visible, routine, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<RoutineCategory>('SAGLIK');
  const [duration, setDuration] = useState(20);
  const [weight, setWeight] = useState<CognitiveWeight>('LOW');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  // Pencere her açıldığında alanlar rutinden (ya da varsayılandan) doldurulur.
  useEffect(() => {
    if (!visible) return;
    setTitle(routine?.title ?? '');
    setCategory(routine?.category ?? 'SAGLIK');
    setDuration(routine?.estimatedDuration ?? 20);
    setWeight(routine?.cognitiveWeight ?? 'LOW');
    setHour(routine?.askHour ?? 9);
    setMinute(routine?.askMinute ?? 0);
    setIcon(routine?.icon ?? null);
    setColor(routine?.color ?? null);
  }, [visible, routine]);

  const canSubmit = title.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      category,
      estimatedDuration: duration,
      cognitiveWeight: weight,
      askHour: hour,
      askMinute: minute,
      icon: shownIcon,
      color: shownColor,
    });
  };

  // Seçim yapılmadıysa kategorinin varsayılanı gösterilir ve kaydedilir.
  const shownIcon = routineIcon({ icon, category });
  const shownColor = routineColor({ color, category });

  const hours = HOURS.includes(hour) ? HOURS : [...HOURS, hour].sort((a, b) => a - b);
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.dismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>{routine ? 'Rutini düzenle' : 'Yeni rutin'}</Text>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Rutin adı (ör. Akşam esneme)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              returnKeyType="done"
            />

            <View style={[styles.preview, { borderColor: shownColor }]}>
              <Text style={styles.previewIcon}>{shownIcon}</Text>
              <Text style={[styles.previewText, { color: shownColor }]} numberOfLines={1}>
                {title.trim() || 'Rutin adı'}
              </Text>
            </View>

            <Text style={styles.label}>Simge</Text>
            <View style={styles.wrap}>
              {ROUTINE_ICONS.map((ic) => (
                <Pressable
                  key={ic}
                  onPress={() => setIcon(ic)}
                  style={[styles.iconBtn, shownIcon === ic && { borderColor: shownColor, backgroundColor: colors.surfaceAlt }]}
                >
                  <Text style={styles.iconText}>{ic}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Renk</Text>
            <View style={styles.wrap}>
              {ROUTINE_COLORS.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setColor(c.value)}
                  accessibilityLabel={c.label}
                  style={[
                    styles.swatch,
                    { backgroundColor: c.value },
                    shownColor.toLowerCase() === c.value.toLowerCase() && styles.swatchOn,
                  ]}
                />
              ))}
            </View>

            <Text style={styles.label}>Kategori</Text>
            <View style={styles.wrap}>
              {(Object.keys(CATEGORY_LABEL) as RoutineCategory[]).map((c) => (
                <Chip key={c} active={category === c} onPress={() => setCategory(c)} label={CATEGORY_LABEL[c]} />
              ))}
            </View>

            <Text style={styles.label}>Kaçta sorulsun?</Text>
            <View style={styles.wrap}>
              {hours.map((h) => (
                <Chip key={h} active={hour === h} onPress={() => setHour(h)} label={pad(h)} />
              ))}
            </View>
            <View style={styles.wrap}>
              {minutes.map((m) => (
                <Chip key={m} active={minute === m} onPress={() => setMinute(m)} label={`:${pad(m)}`} />
              ))}
            </View>

            <Text style={styles.label}>Ne kadar sürer?</Text>
            <View style={styles.wrap}>
              {durations.map((d) => (
                <Chip key={d} active={duration === d} onPress={() => setDuration(d)} label={`${d} dk`} />
              ))}
            </View>

            <Text style={styles.label}>Zihinsel yük</Text>
            <View style={styles.wrap}>
              {WEIGHTS.map((w) => (
                <Chip
                  key={w.value}
                  active={weight === w.value}
                  onPress={() => setWeight(w.value)}
                  label={w.label}
                  color={w.color}
                />
              ))}
            </View>

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[styles.submit, !canSubmit && { opacity: 0.4 }]}
            >
              <Text style={styles.submitText}>{routine ? 'Kaydet' : 'Ekle'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({
  label,
  active,
  onPress,
  color = colors.aura,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && { backgroundColor: color, borderColor: color }]}
    >
      <Text style={[styles.pillText, active && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  dismiss: { flex: 0.12 },
  sheet: {
    flex: 0.88,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  content: { padding: spacing.xl, gap: spacing.md },
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
  pillText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  previewIcon: { fontSize: 26 },
  previewText: { flex: 1, fontSize: 16, fontWeight: '700' },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 22 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  submit: {
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
});
