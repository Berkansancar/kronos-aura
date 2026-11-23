import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { HONESTY_NOTE, SOURCES, type EffectId } from '../services/effectsData';
import { nextHint, type EffectView } from '../services/effectsLogic';
import { loadEffects } from '../services/effects';

export default function EffectsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [views, setViews] = useState<EffectView[]>([]);
  const [open, setOpen] = useState<EffectId | null>(null);
  const [showSources, setShowSources] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadEffects(db)
        .then((v) => {
          if (!alive) return;
          setViews(v);
          // İlk açılışta bugün yapılan bir şey varsa onu, yoksa şınavı açık göster
          setOpen((cur) => cur ?? (v.find((x) => x.todayDone)?.id ?? 'push'));
        })
        .catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [db])
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Etki</Text>
        <Text style={styles.sub}>Yaptığın her şeyin sana gün gün, hafta hafta ne kazandırdığı ve serin.</Text>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{HONESTY_NOTE}</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          views.map((v) => {
            const isOpen = open === v.id;
            const hint = nextHint(v);
            return (
              <View key={v.id} style={[styles.card, v.streak.alive && styles.cardAlive]}>
                <Pressable onPress={() => setOpen(isOpen ? null : v.id)} style={styles.head}>
                  <Text style={styles.icon}>{v.profile.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{v.profile.title}</Text>
                    <Text style={[styles.headline, v.streak.alive && styles.headlineAlive]}>{v.headline}</Text>
                  </View>
                  <Text style={styles.chev}>{isOpen ? '▾' : '›'}</Text>
                </Pressable>

                {isOpen ? (
                  <View style={styles.body}>
                    <Text style={styles.label}>{v.profile.strength ? 'ÇALIŞAN KASLAR' : 'ETKİLENEN'}</Text>
                    <View style={styles.chips}>
                      {v.profile.focus.map((f) => (
                        <View key={f} style={styles.chip}>
                          <Text style={styles.chipText}>{f}</Text>
                        </View>
                      ))}
                    </View>

                    <Text style={styles.label}>BUGÜN</Text>
                    <Text style={[styles.today, v.todayDone && styles.todayDone]}>
                      {v.todayDone ? '✓ ' : ''}
                      {v.todayText}
                    </Text>

                    {v.current ? (
                      <View style={styles.nowBox}>
                        <Text style={styles.nowLabel}>ŞU AN: {v.current.label.toUpperCase()}</Text>
                        <Text style={styles.nowText}>{v.current.text}</Text>
                        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
                      </View>
                    ) : (
                      <Text style={styles.muted}>
                        {v.streak.activeDays === 0 ? 'İlk kaydından sonra etkiler burada açılır.' : 'Yeni bir seri başlayınca etkiler yeniden açılır.'}
                      </Text>
                    )}

                    <Text style={styles.label}>ZAMAN ÇİZELGESİ</Text>
                    {v.stages.map((s) => (
                      <View key={s.id} style={styles.stageRow}>
                        <View style={styles.rail}>
                          <View
                            style={[styles.dot, s.state === 'reached' && styles.dotReached, s.state === 'current' && styles.dotCurrent]}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={styles.stageHead}>
                            <Text style={[styles.stageLabel, s.state === 'later' && styles.dim]}>{s.label}</Text>
                            {s.state === 'later' ? (
                              <Text style={styles.left}>{v.streak.alive ? `${s.daysLeft} gün kaldı` : 'seriyle açılır'}</Text>
                            ) : (
                              <Text style={styles.reached}>{s.state === 'current' ? 'şu an' : 'geçtin'}</Text>
                            )}
                          </View>
                          <Text style={[styles.stageText, s.state === 'later' && styles.dim]}>{s.text}</Text>
                        </View>
                      </View>
                    ))}

                    {v.totalText ? <Text style={styles.total}>{v.totalText}</Text> : null}
                    {v.profile.note ? <Text style={styles.muted}>{v.profile.note}</Text> : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        <Pressable onPress={() => setShowSources((s) => !s)} style={styles.sourcesHead}>
          <Text style={styles.sourcesTitle}>Kaynaklar {showSources ? '▾' : '›'}</Text>
        </Pressable>
        {showSources
          ? SOURCES.map((s) => (
              <Text key={s} style={styles.source}>
                • {s}
              </Text>
            ))
          : null}
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
  noteBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  noteText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardAlive: { borderColor: colors.aura },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { fontSize: 26 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headline: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2 },
  headlineAlive: { color: colors.aura },
  chev: { color: colors.textMuted, fontSize: 22 },
  body: { gap: spacing.sm, paddingTop: spacing.xs },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  today: { color: colors.text, fontSize: 14, lineHeight: 20 },
  todayDone: { color: colors.aura, fontWeight: '700' },
  nowBox: {
    backgroundColor: colors.auraSoft,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  nowLabel: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  nowText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.kronos, fontSize: 12, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  stageRow: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 16, alignItems: 'center', paddingTop: 3 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.border },
  dotReached: { backgroundColor: colors.aura, borderColor: colors.aura },
  dotCurrent: { backgroundColor: colors.bg, borderColor: colors.aura, borderWidth: 4 },
  stageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stageLabel: { color: colors.text, fontSize: 14, fontWeight: '800' },
  stageText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  dim: { color: colors.textMuted },
  reached: { color: colors.aura, fontSize: 11, fontWeight: '800' },
  left: { color: colors.kronos, fontSize: 11, fontWeight: '700' },
  total: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: spacing.xs },
  sourcesHead: { paddingVertical: spacing.sm },
  sourcesTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  source: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
