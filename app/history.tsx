import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { gatherHistory } from '../services/history';
import {
  HISTORY_METRICS,
  HISTORY_RANGES,
  breakdownOutcomes,
  buildSeries,
  type HistoryDay,
  type HistoryMetricId,
  type HistoryOutcome,
  type HistoryRange,
} from '../services/historyLogic';
import { weekdayLong } from '../services/weeklyLogic';

const BAR_AREA = 120;

/** İlerleme ve geçmiş: tek metrik, günlük çubuklar. Renkler "iyi/kötü" anlatmaz; hepsi aynı sakin renk. */
export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [outcomes, setOutcomes] = useState<HistoryOutcome[]>([]);
  const [metric, setMetric] = useState<HistoryMetricId>('TASK_MIN');
  const [range, setRange] = useState<HistoryRange>(14);
  const [picked, setPicked] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      gatherHistory(db, new Date())
        .then((h) => {
          setDays(h.days);
          setOutcomes(h.outcomes);
        })
        .catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }, [db])
  );

  const series = useMemo(() => buildSeries(days, metric, range), [days, metric, range]);
  const windowDays = new Set(days.slice(-range).map((d) => d.day));
  const breakdown = useMemo(
    () => breakdownOutcomes(outcomes.filter((o) => windowDays.has(o.day))),
    // windowDays türetilmiş; days ve range değişince yeniden hesaplanır
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outcomes, days, range]
  );
  const selected = series.bars.find((b) => b.day === picked) ?? null;
  const marked = breakdown.done + breakdown.notDone + breakdown.couldNot;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>İlerleme ve geçmiş</Text>
        <Text style={styles.sub}>Hiçbir sayı iyi ya da kötü diye boyanmaz; yalnızca neyin nasıl gittiğini gösterir.</Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {HISTORY_METRICS.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setMetric(m.id);
                    setPicked(null);
                  }}
                  style={[styles.chip, metric === m.id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, metric === m.id && { color: colors.aura }]}>{m.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.rangeRow}>
              {HISTORY_RANGES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => {
                    setRange(r);
                    setPicked(null);
                  }}
                  style={[styles.rangeBtn, range === r && styles.chipOn]}
                >
                  <Text style={[styles.chipText, range === r && { color: colors.aura }]}>Son {r} gün</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {series.label} · {series.rangeLabel}
              </Text>
              <Text style={styles.pickLine}>
                {selected
                  ? `${weekdayLong(selected.day)}, ${selected.day.slice(8)}.${selected.day.slice(5, 7)}: ${selected.value === null ? 'kayıt yok' : selected.label}`
                  : 'Bir çubuğa dokununca o günün değerini görürsün.'}
              </Text>

              <View style={styles.chart}>
                {series.bars.map((b, i) => {
                  const showLabel = series.bars.length <= 14 || i % 5 === 0 || i === series.bars.length - 1;
                  return (
                    <Pressable key={b.day} style={styles.col} onPress={() => setPicked(b.day === picked ? null : b.day)}>
                      <View style={styles.barArea}>
                        {b.value === null ? (
                          <View style={styles.dot} />
                        ) : (
                          <View
                            style={[
                              styles.bar,
                              { height: Math.max(4, b.ratio * BAR_AREA) },
                              picked === b.day && { backgroundColor: colors.aura },
                            ]}
                          />
                        )}
                      </View>
                      <Text style={styles.axis} numberOfLines={1}>
                        {showLabel ? (series.bars.length <= 14 ? b.weekday : b.day.slice(8)) : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.legend}>Nokta: o gün kayıt yok.</Text>
              <Text style={styles.summary}>{series.summary}</Text>
              {series.maxLabel && series.maxDay && series.trackedDays >= 2 && (
                <Text style={styles.muted}>
                  En yüksek gün: {weekdayLong(series.maxDay)} ({series.maxLabel})
                </Text>
              )}
            </View>

            <Text style={styles.section}>Görevler: yaptım, yapmadım, yapamadım</Text>
            <View style={styles.card}>
              {marked === 0 ? (
                <Text style={styles.muted}>Bu aralıkta işaretlenmiş görev yok. Görevlerdeki düğmelerle işaretlediklerin burada toplanır.</Text>
              ) : (
                <>
                  <View style={styles.statRow}>
                    <View style={styles.stat}>
                      <Text style={styles.statNum}>{breakdown.done}</Text>
                      <Text style={styles.statLabel}>Yaptım</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statNum}>{breakdown.notDone}</Text>
                      <Text style={styles.statLabel}>Yapmadım</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statNum}>{breakdown.couldNot}</Text>
                      <Text style={styles.statLabel}>Yapamadım</Text>
                    </View>
                  </View>
                  {breakdown.reasons.length > 0 && (
                    <>
                      <Text style={styles.label}>Yapamadıklarımın sebepleri</Text>
                      {breakdown.reasons.map((r) => (
                        <View key={r.label} style={styles.reasonRow}>
                          <Text style={styles.reasonText}>{r.label}</Text>
                          <Text style={styles.reasonCount}>{r.count}</Text>
                        </View>
                      ))}
                    </>
                  )}
                  {breakdown.hint && (
                    <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
                      <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS</Text>
                      <Text style={styles.coachText}>{breakdown.hint}</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            <Text style={styles.footnote}>
              Veriler telefonda durur. Su, yemek, sigara ve gün akışı kayıtların; ekran, adım ve uyku da Gün analizi
              açıksa buraya dolar. Kayıt tutmadığın günler boş kalır, "0" sayılmaz.
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
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipOn: { borderColor: colors.aura, backgroundColor: colors.surface },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingVertical: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  pickLine: { color: colors.textMuted, fontSize: 13, minHeight: 18 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: BAR_AREA + 24 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barArea: { height: BAR_AREA, justifyContent: 'flex-end', alignItems: 'center', width: '100%' },
  bar: { width: '70%', maxWidth: 22, backgroundColor: colors.kronos, borderRadius: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.border },
  axis: { color: colors.textMuted, fontSize: 9, marginTop: 4, height: 14 },
  legend: { color: colors.textMuted, fontSize: 11 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  statNum: { color: colors.text, fontSize: 24, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  reasonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  reasonText: { color: colors.text, fontSize: 14 },
  reasonCount: { color: colors.text, fontSize: 14, fontWeight: '800' },
  coach: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  coachName: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  coachText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
