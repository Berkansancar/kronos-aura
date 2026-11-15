import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { CHRONOTYPE_PRESETS, getOrCreateUser, saveUserProfile } from '../database/repository';
import type { Chronotype } from '../database/types';
import { replanDay } from '../services/planner';

const DESCRIPTIONS: Record<Chronotype, string> = {
  MORNING: 'Sabah erken saatlerde en berraksın.',
  BALANCED: 'Gün ortasında en verimlisin.',
  NIGHT: 'Akşam ve gece saatlerinde zihnin açılır.',
};

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [chronotype, setChronotype] = useState<Chronotype>('BALANCED');
  const [start, setStart] = useState(10);
  const [end, setEnd] = useState(14);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getOrCreateUser(db).then((u) => {
      setChronotype(u.chronotype);
      setStart(u.peakStartHour);
      setEnd(u.peakEndHour);
      setReady(true);
    });
  }, [db]);

  const pick = (c: Chronotype) => {
    setChronotype(c);
    setStart(CHRONOTYPE_PRESETS[c].peakStartHour);
    setEnd(CHRONOTYPE_PRESETS[c].peakEndHour);
  };

  const save = async () => {
    try {
      await saveUserProfile(db, { chronotype, peakStartHour: start, peakEndHour: end });
      await replanDay(db, new Date(), 'MANUAL');
      router.back();
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : String(e));
    }
  };

  if (!ready) return <View style={styles.screen} />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.heading}>Enerji ritmin</Text>
        <Text style={styles.sub}>
          Kronos, zor işleri tepe saatlerine; hafif işleri enerjinin düştüğü saatlere yerleştirir.
        </Text>

        <View style={styles.list}>
          {(Object.keys(CHRONOTYPE_PRESETS) as Chronotype[]).map((c) => {
            const active = c === chronotype;
            return (
              <Pressable
                key={c}
                onPress={() => pick(c)}
                style={[styles.option, active && { borderColor: colors.kronos }]}
              >
                <Text style={[styles.optionTitle, active && { color: colors.kronos }]}>
                  {CHRONOTYPE_PRESETS[c].label}
                </Text>
                <Text style={styles.optionText}>{DESCRIPTIONS[c]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Tepe enerji penceresi</Text>
        <Stepper
          label="Başlangıç"
          value={hh(start)}
          onMinus={() => setStart(Math.max(0, start - 1))}
          onPlus={() => setStart(Math.min(end - 1, start + 1))}
        />
        <Stepper
          label="Bitiş"
          value={hh(end)}
          onMinus={() => setEnd(Math.max(start + 1, end - 1))}
          onPlus={() => setEnd(Math.min(24, end + 1))}
        />

        <Pressable onPress={save} style={styles.save}>
          <Text style={styles.saveText}>Kaydet ve günü yeniden planla</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.cancel} hitSlop={8}>
          <Text style={styles.cancelText}>Vazgeç</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Stepper(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{props.label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={props.onMinus} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{props.value}</Text>
        <Pressable onPress={props.onPlus} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.md },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  list: { gap: spacing.sm, marginTop: spacing.sm },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  optionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  optionText: { color: colors.textMuted, fontSize: 13 },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  stepperLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: '600' },
  stepValue: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 56, textAlign: 'center' },
  save: {
    backgroundColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  cancel: { alignSelf: 'center' },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
