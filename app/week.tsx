import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { formatDuration } from '../services/format';
import { applyAssignments, loadWeek, moveTaskToDay, pullAllToToday, suggestWeek, type WeekData } from '../services/weekPlan';
import { assignmentSummary, dayLine, moveTargets } from '../services/weekPlanLogic';

export default function WeekScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<WeekData | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadWeek(db, new Date()));
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const distribute = () =>
    run(async () => {
      const { data: d, assignments } = await suggestWeek(db, new Date());
      const text = assignmentSummary(d.plan, assignments);
      if (assignments.every((a) => a.day <= d.todayKey)) {
        Alert.alert('Hafta planı', text);
        return;
      }
      Alert.alert('İşleri haftaya dağıt', `${text}\n\nOdak isteyen ve uzun işler boş güne, kısa işler yakın güne gider. Sonra tek tek değiştirebilirsin.`, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Uygula', onPress: () => void run(async () => void (await applyAssignments(db, assignments, new Date()))) },
      ]);
    });

  const parkedCount = data ? data.tasks.filter((t) => t.plannedDay && t.plannedDay > data.todayKey).length : 0;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Hafta planı</Text>
        <Text style={styles.sub}>
          İşlerini günlere ayır. Ayrılan iş o güne kadar ana ekranda ve günlük planda görünmez; Pazar gibi boş günler uzun ve odak isteyen işler
          için iyi bir yerdir.
        </Text>

        {loading || !data ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <View style={styles.actions}>
              <Pressable disabled={busy} onPress={distribute} style={[styles.primary, busy && { opacity: 0.5 }]}>
                <Text style={styles.primaryText}>Otomatik dağıt</Text>
              </Pressable>
              {parkedCount > 0 && (
                <Pressable
                  disabled={busy}
                  onPress={() => void run(async () => void (await pullAllToToday(db, new Date())))}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Hepsini bugüne al ({parkedCount})</Text>
                </Pressable>
              )}
            </View>

            {data.plan.map((d) => (
              <View key={d.key} style={[styles.card, d.kind === 'FREE' && { borderColor: colors.aura }]}>
                <View style={styles.dayHead}>
                  <Text style={styles.dayTitle}>
                    {d.kind === 'FREE' ? '🌿 ' : ''}
                    {d.label}
                    <Text style={styles.dayDate}> · {d.dateText}</Text>
                  </Text>
                  <Text style={[styles.tag, d.load === 'FULL' && { color: colors.kronos }]}>{d.load === 'FULL' ? 'Dolu' : 'Rahat'}</Text>
                </View>
                <Text style={styles.muted}>{dayLine(d)}</Text>
                {d.tasks.length === 0 && <Text style={styles.empty}>İş ayrılmadı</Text>}
                {d.tasks.map((t) => (
                  <View key={t.id} style={{ gap: spacing.sm }}>
                    <View style={styles.taskRow}>
                      <Text style={styles.taskTitle} numberOfLines={2}>
                        {t.heavy ? '● ' : ''}
                        {t.title}
                      </Text>
                      <Text style={styles.muted}>{formatDuration(t.minutes)}</Text>
                      <Pressable onPress={() => setMoving(moving === t.id ? null : t.id)} hitSlop={8}>
                        <Text style={styles.link}>Taşı</Text>
                      </Pressable>
                    </View>
                    {moving === t.id && (
                      <View style={styles.chipRow}>
                        {d.key !== data.todayKey && (
                          <Pressable
                            disabled={busy}
                            onPress={() => {
                              setMoving(null);
                              void run(async () => moveTaskToDay(db, t.id, null, new Date()));
                            }}
                            style={styles.chip}
                          >
                            <Text style={styles.chipText}>Bugün</Text>
                          </Pressable>
                        )}
                        {moveTargets(data.plan)
                          .filter((m) => m.key !== d.key)
                          .map((m) => (
                            <Pressable
                              key={m.key}
                              disabled={busy}
                              onPress={() => {
                                setMoving(null);
                                void run(async () => moveTaskToDay(db, t.id, m.key, new Date()));
                              }}
                              style={styles.chip}
                            >
                              <Text style={styles.chipText}>{m.label}</Text>
                            </Pressable>
                          ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ))}
            <Text style={styles.footnote}>
              Boş zaman yaklaşıktır: uyanık 07:00–23:00, iş günlerinde yol ve hazırlık için 90 dakika düşülür. Her güne boş zamanın en çok %60'ı kadar iş
              ayrılır; gerisi dinlenmeye kalır. ● işareti odak isteyen ya da uzun işi gösterir.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  primary: { backgroundColor: colors.aura, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: 12 },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  dayDate: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  tag: { color: colors.aura, fontSize: 12, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  taskTitle: { flex: 1, color: colors.text, fontSize: 14 },
  link: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
