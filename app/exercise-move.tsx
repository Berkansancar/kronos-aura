import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExerciseFigures } from '../components/ExerciseFigure';
import { colors, radius, spacing } from '../constants/theme';
import { chooseExerciseLevel, loadExercise } from '../services/exercise';
import { ALT_REST_SECONDS, EXERCISE_BY_ID, LEVEL_NAMES, type Level, type MoveId } from '../services/exerciseData';
import { defaultState, lastResult, setsLine, targetLine, type ExerciseState } from '../services/exerciseLogic';

const LEVELS: Level[] = [1, 2, 3];

export default function ExerciseMoveScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ move?: string; level?: string }>();
  const move = params.move && params.move in EXERCISE_BY_ID ? EXERCISE_BY_ID[params.move as MoveId] : null;
  const [state, setState] = useState<ExerciseState>(defaultState());
  const [picked, setPicked] = useState<Level | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadExercise(db)
        .then(setState)
        .catch(() => undefined);
    }, [db])
  );

  if (!move) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Geri</Text>
          </Pressable>
          <Text style={styles.heading}>Hareket bulunamadı</Text>
        </View>
      </SafeAreaView>
    );
  }

  const current = state.levels[move.id];
  const level: Level = picked ?? (params.level && ['1', '2', '3'].includes(params.level) ? (Number(params.level) as Level) : current);
  const v = move.variants[level - 1];
  const last = lastResult(state, move.id);

  const choose = async () => {
    try {
      setState(await chooseExerciseLevel(db, move.id, level));
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>
          {move.icon} {move.title}
        </Text>
        <Text style={styles.sub}>
          {move.area}. {move.why}
        </Text>

        <View style={styles.tabs}>
          {LEVELS.map((l) => (
            <Pressable key={l} onPress={() => setPicked(l)} style={[styles.tab, l === level && styles.tabOn]}>
              <Text style={[styles.tabText, l === level && styles.tabTextOn]}>{LEVEL_NAMES[l]}</Text>
              {l === current && <Text style={styles.tabNow}>şu an</Text>}
            </Pressable>
          ))}
        </View>

        <Text style={styles.name}>{v.name}</Text>
        <Text style={styles.muted}>{v.summary}</Text>

        <ExerciseFigures variant={v} />

        <View style={styles.targetCard}>
          <Text style={styles.label}>HEDEF</Text>
          <Text style={styles.target}>{targetLine(v)}</Text>
          <Text style={styles.muted}>
            Setler arası {ALT_REST_SECONDS} saniye dinlen; hareketleri dönüşümlü yaptığın için aynı hareketin iki seti arası yaklaşık 3 dakika olur. Tüm
            setlerde {v.max} {v.unit === 'sec' ? 'saniyeye' : 'tekrara'} ulaşınca bir üst basamağa geçersin.
          </Text>
          {last && last.item.level === level && <Text style={styles.muted}>Son seferin: {setsLine(v, last.item.sets)}</Text>}
        </View>

        {level !== current && (
          <Pressable onPress={choose} style={styles.primary}>
            <Text style={styles.primaryText}>Bu basamakta çalış</Text>
          </Pressable>
        )}

        <Text style={styles.section}>Nasıl yapılır</Text>
        <View style={styles.box}>
          {v.steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Sık yapılan hatalar</Text>
        <View style={styles.box}>
          {v.mistakes.map((s, i) => (
            <Text key={i} style={styles.bullet}>
              • {s}
            </Text>
          ))}
        </View>

        <Text style={styles.section}>İpuçları ve güvenlik</Text>
        <View style={styles.box}>
          {v.tips.map((s, i) => (
            <Text key={i} style={styles.bullet}>
              • {s}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: colors.aura },
  tabNow: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  targetCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  target: { color: colors.text, fontSize: 18, fontWeight: '800' },
  primary: { backgroundColor: colors.aura, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  section: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: spacing.sm },
  box: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  stepRow: { flexDirection: 'row', gap: spacing.md },
  stepNum: { color: colors.aura, fontSize: 14, fontWeight: '800', width: 16 },
  stepText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  bullet: { color: colors.text, fontSize: 13, lineHeight: 19 },
});
