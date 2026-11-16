import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { loadGuide, type GuideData } from '../services/dayGuide';
import { guideLines, guideNow, type GuideKind } from '../services/dayGuideLogic';
import { hhmm } from '../services/goalsLogic';
import { getGoals } from '../services/goalsSettings';

const ICONS: Record<GuideKind, string> = {
  PREP: '☀️',
  COMMUTE: '🚌',
  WORK: '🏪',
  TASK: '●',
  MEAL: '🍽️',
  LANGUAGE: '🗣️',
  MOVE: '🚶',
  FREE: '🌿',
  REVIEW: '📝',
  WINDDOWN: '🌙',
};

export default function GuideScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GuideData | null>(null);
  const [tick, setTick] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const goals = await getGoals();
      setData(await loadGuide(db, new Date(), { bedtimeMin: goals.bedtime }));
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
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const res = data?.result;
  // "Şimdi" dakikası ekran açıkken ilerler
  const nowMin = data ? Math.floor((tick.getTime() - data.midnightMs) / 60_000) : 0;
  const g = res ? guideNow(res.segments, nowMin) : null;
  const lines = g ? guideLines(g) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün rehberi</Text>

        {loading || !res || !g || !lines ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <Text style={styles.sub}>{res.headline}</Text>
            <View style={styles.nowCard}>
              <Text style={styles.nowLabel}>ŞİMDİ</Text>
              <Text style={styles.nowText}>{lines.now}</Text>
              {g.current?.note && <Text style={styles.muted}>{g.current.note}</Text>}
              {lines.next && <Text style={styles.muted}>Sıradaki · {lines.next}</Text>}
            </View>

            <View style={styles.timeline}>
              {res.segments.map((s) => {
                const past = s.to <= nowMin;
                const current = g.current?.id === s.id;
                return (
                  <View key={s.id} style={[styles.row, current && styles.rowNow, past && { opacity: 0.45 }]}>
                    <Text style={styles.time}>
                      {hhmm(s.from)}
                      {'\n'}
                      <Text style={styles.timeEnd}>{hhmm(s.to)}</Text>
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.title, !s.fixed && styles.titleSoft]} numberOfLines={2}>
                        {ICONS[s.kind]} {s.title}
                      </Text>
                      {s.note && <Text style={styles.muted}>{s.note}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>

            {res.overflow.length > 0 && (
              <Text style={styles.muted}>Bugüne sığmayanlar: {res.overflow.join(', ')}. Hafta planından başka güne taşıyabilirsin.</Text>
            )}

            <View style={styles.links}>
              <Pressable onPress={() => router.push('/week')} hitSlop={8}>
                <Text style={styles.link}>Hafta planı ›</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/goals')} hitSlop={8}>
                <Text style={styles.link}>İş saatleri ›</Text>
              </Pressable>
            </View>
            <Text style={styles.footnote}>
              Çizelge iş saatlerinden, tipik uyanış ve yol süresinden (kayıt yoksa 25 dk) ve planlayıcının yerleştirdiği işlerden çıkar. ● işaretli satırlar
              senin işlerin; 🌿, 🚶 ve 🗣️ satırları yalnızca öneridir, yok sayabilirsin.
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
  sub: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  nowCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  nowLabel: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  nowText: { color: colors.text, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  timeline: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowNow: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  time: { width: 46, color: colors.text, fontSize: 13, fontWeight: '800' },
  timeEnd: { color: colors.textMuted, fontWeight: '600' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  titleSoft: { fontWeight: '600' },
  links: { flexDirection: 'row', gap: spacing.xl },
  link: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
