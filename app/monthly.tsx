import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { formatDuration } from '../services/format';
import type { GameGoals } from '../services/gameLogic';
import { getGoalBundle } from '../services/goalsSettings';
import { monthKeyOf, shiftMonth } from '../services/habitCalendarLogic';
import { getLanguageSettings } from '../services/language';
import { loadMonthly, type MonthlyScreenData } from '../services/monthly';
import { MOODS, formatMood } from '../services/moodLogic';

export default function MonthlyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [data, setData] = useState<MonthlyScreenData | null>(null);
  const [loading, setLoading] = useState(true);
  const thisMonth = monthKeyOf(new Date());

  const load = useCallback(
    async (m: string) => {
      setLoading(true);
      try {
        const bundle = await getGoalBundle().catch(() => null);
        const lang = await getLanguageSettings(db).catch(() => null);
        const goals: GameGoals = { waterGoalMl: bundle ? bundle.waterGoalMl : null, languageGoalMin: lang ? lang.goalMin : null };
        setData(await loadMonthly(db, m, new Date(), goals));
      } finally {
        setLoading(false);
      }
    },
    [db]
  );

  useFocusEffect(
    useCallback(() => {
      load(month).catch(() => undefined);
    }, [load, month])
  );

  const goMonth = (delta: number) => setMonth((m) => shiftMonth(m, delta));
  const r = data?.report;
  const canPrev = !!data && month > data.earliestMonth;
  const canNext = month < thisMonth;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Aylık karne</Text>

        <View style={styles.monthRow}>
          <Pressable disabled={!canPrev} onPress={() => goMonth(-1)} hitSlop={10}>
            <Text style={[styles.nav, !canPrev && { opacity: 0.25 }]}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{r ? r.title : ' '}</Text>
          <Pressable disabled={!canNext} onPress={() => goMonth(1)} hitSlop={10}>
            <Text style={[styles.nav, !canNext && { opacity: 0.25 }]}>›</Text>
          </Pressable>
        </View>

        {loading && !data ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : data && r ? (
          <>
            <View style={styles.card}>
              {data.lines.map((l, i) => (
                <Text key={i} style={styles.line}>
                  {l}
                </Text>
              ))}
              {r.isCurrent && r.elapsedDays > 0 && (
                <Text style={styles.muted}>
                  Ayın {r.elapsedDays}/{r.totalDays}. günü; karne ay boyunca güncellenir.
                </Text>
              )}
            </View>

            {r.hasData && (
              <>
                <View style={styles.grid}>
                  <Tile value={`${r.activeDays}`} label="etkin gün" />
                  <Tile value={`${r.routinesDone}`} label="rutin" />
                  <Tile value={`${r.tasksDone}`} label="biten iş" />
                  <Tile value={r.languageMinutes > 0 ? formatDuration(r.languageMinutes) : '–'} label="dil çalışması" />
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Seviye</Text>
                  <Text style={styles.big}>Seviye {r.level}</Text>
                  <Text style={styles.muted}>Bu ay {r.xp} XP topladın.</Text>
                </View>

                {r.moodCount > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardLabel}>Ruh hali</Text>
                    <View style={styles.moodRow}>
                      {MOODS.map((m) => (
                        <View key={m.value} style={styles.moodCell}>
                          <Text style={styles.moodEmoji}>{m.emoji}</Text>
                          <Text style={styles.moodCount}>{r.moodDist[m.value - 1]}</Text>
                        </View>
                      ))}
                    </View>
                    {r.moodAvg !== null && <Text style={styles.muted}>Ortalama {formatMood(r.moodAvg)} / 5 · {r.moodCount} gün yazdın</Text>}
                  </View>
                )}

                {(r.sleepAvgMin !== null || r.stepsAvg !== null || r.waterAvgMl !== null) && (
                  <View style={styles.card}>
                    <Text style={styles.cardLabel}>Günlük ortalamalar</Text>
                    {r.sleepAvgMin !== null && <Row label="Uyku" value={formatDuration(r.sleepAvgMin)} />}
                    {r.stepsAvg !== null && <Row label="Adım" value={Math.round(r.stepsAvg).toLocaleString('tr-TR')} />}
                    {r.waterAvgMl !== null && <Row label="Su" value={`${(r.waterAvgMl / 1000).toFixed(1).replace('.', ',')} L`} />}
                  </View>
                )}

                {data.rows.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardLabel}>{r.isCurrent ? 'Geçen ayın aynı günleriyle' : 'Bir önceki ayla'}</Text>
                    {data.rows.map((row) => (
                      <View key={row.id} style={styles.cmpRow}>
                        <Text style={styles.rowLabel}>{row.label}</Text>
                        <Text style={[styles.rowValue, row.direction === 'UP' && { color: colors.aura }]}>
                          {row.text} {row.direction === 'UP' ? '↑' : row.direction === 'DOWN' ? '↓' : '='}
                        </Text>
                      </View>
                    ))}
                    <Text style={styles.muted}>Dönemler birbirine benzemek zorunda değil; bu yalnızca bir yön gösterir.</Text>
                  </View>
                )}
              </>
            )}

            <Pressable onPress={() => router.push('/habits')} style={styles.linkBtn}>
              <Text style={styles.linkText}>📅 Alışkanlık takvimine git ›</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cmpRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { color: colors.aura, fontSize: 32, fontWeight: '700', paddingHorizontal: spacing.md },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  line: { color: colors.text, fontSize: 15, lineHeight: 22 },
  big: { color: colors.text, fontSize: 26, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  tileValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moodCell: { alignItems: 'center', flex: 1, gap: 2 },
  moodEmoji: { fontSize: 24 },
  moodCount: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  cmpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { flex: 1, color: colors.text, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  linkBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 12,
  },
  linkText: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
