import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { getNutritionOptions } from '../services/nutritionSettings';
import { loadWeekSummary } from '../services/weekly';
import type { WeekSummary } from '../services/weeklyLogic';

const BAR_MAX_HEIGHT = 84;

export default function WeeklyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          setSummary((await loadWeekSummary(db, new Date(), await getNutritionOptions())).summary);
        } catch (e) {
          Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
        } finally {
          setLoading(false);
        }
      })();
    }, [db])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>

        {loading || !summary ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.kronos} />
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Haftalık özet</Text>
            <Text style={styles.sub}>{summary.rangeLabel}</Text>

            <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
              <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
              <Text style={styles.coachText}>{summary.aura}</Text>
            </View>

            {!summary.quiet && (
              <>
                <Text style={styles.section}>Günlere göre (biten görev + yapılan rutin)</Text>
                <View style={styles.card}>
                  <View style={styles.bars}>
                    {summary.bars.map((b) => {
                      const h = b.value === 0 ? 3 : Math.max(8, (b.value / summary.maxBar) * BAR_MAX_HEIGHT);
                      return (
                        <View key={b.day} style={styles.barCol}>
                          <Text style={styles.barValue}>{b.value > 0 ? b.value : ''}</Text>
                          <View
                            style={[
                              styles.bar,
                              { height: h, backgroundColor: b.hardDay ? colors.aura : colors.kronos },
                              b.value === 0 && { opacity: 0.25 },
                            ]}
                          />
                          <Text style={styles.barLabel}>{b.weekday}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {summary.bars.some((b) => b.hardDay) && (
                    <Text style={styles.hint}>Yeşil çubuk: zor gün modunda hafif ilerlediğin gün.</Text>
                  )}
                </View>

                <Text style={styles.section}>Bu hafta</Text>
                <View style={styles.card}>
                  {summary.highlights.map((h) => (
                    <Text key={h} style={styles.listText}>
                      • {h}
                    </Text>
                  ))}
                </View>
              </>
            )}

            {summary.routines.length > 0 && (
              <>
                <Text style={styles.section}>Rutinlerin</Text>
                <View style={styles.card}>
                  {summary.routines.map((r) => (
                    <View key={r.title} style={{ gap: 4 }}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.listText}>{r.title}</Text>
                        <Text style={styles.listTime}>
                          {r.done}/{r.chances}
                        </Text>
                      </View>
                      <View style={styles.track}>
                        <View style={[styles.fill, { width: `${Math.round((r.done / r.chances) * 100)}%` }]} />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
              <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS · gelecek hafta</Text>
              {summary.kronos.map((line) => (
                <Text key={line} style={styles.coachText}>
                  {line}
                </Text>
              ))}
            </View>

            {summary.routineToAdjust && (
              <Pressable onPress={() => router.push('/routines')} style={styles.addBtn}>
                <Text style={styles.addBtnText}>Rutinlerimi düzenle</Text>
              </Pressable>
            )}

            <Text style={styles.hint}>
              Bu özet yalnızca telefondaki verinden hesaplanır; internet ya da yapay zekâ anahtarı gerekmez.
            </Text>
            <Pressable onPress={() => router.back()} style={styles.done}>
              <Text style={styles.doneText}>Tamam</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.kronos, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  coach: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  coachName: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  coachText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: BAR_MAX_HEIGHT + 44 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: 22, borderRadius: 6 },
  barValue: { color: colors.text, fontSize: 12, fontWeight: '700', height: 16 },
  barLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  listText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  listTime: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.aura },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  addBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  addBtnText: { color: colors.kronos, fontSize: 13, fontWeight: '700' },
  done: { alignItems: 'center', paddingVertical: spacing.md },
  doneText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
