import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import type { DayEventKind } from '../database/types';
import {
  addSmoke,
  loadDayFlow,
  removeEvent,
  removeSmoke,
  setSmokeLimit,
  stampEvent,
  type DayFlowState,
} from '../services/dayFlow';
import { AGO_CHOICES, FLOW_KINDS, WAKE_WATER_PROMPT, flowChips, kindLabel } from '../services/dayFlowLogic';
import { formatClock, formatDuration } from '../services/format';
import { addWater } from '../services/nutrition';
import { SMOKE_LIMIT_CHOICES } from '../services/smokeLogic';

const agoLabel = (m: number) => (m === 0 ? 'Şimdi' : `${m} dk önce`);

export default function DayFlowScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [state, setState] = useState<DayFlowState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [ago, setAgo] = useState(0);
  const [smokeAgo, setSmokeAgo] = useState(0);
  const [drank, setDrank] = useState(false);

  const reload = useCallback(async () => {
    const current = new Date();
    setNow(current);
    setState(await loadDayFlow(db, current));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload().catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)));
    }, [reload])
  );

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stamp = (kind: DayEventKind) =>
    run(async () => {
      await stampEvent(db, kind, new Date(), ago);
      setAgo(0);
      if (kind === 'WAKE') setDrank(false);
    });

  const confirmRemoveEvent = (id: string, label: string) =>
    Alert.alert('Damgayı sil', `"${label}" kaydı silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void run(async () => removeEvent(db, id)) },
    ]);

  if (!state) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.aura} />
        </View>
      </SafeAreaView>
    );
  }

  const { flow, events, smoke, smokeLogs, next } = state;
  const chips = flowChips(flow);
  const wakeFresh = flow.wakeAt !== null && now.getTime() - flow.wakeAt.getTime() < 120 * 60_000;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün akışı</Text>
        <Text style={styles.sub}>Her adımda bir dokunuş; süreleri ben hesaplarım.</Text>

        {wakeFresh && !drank && (
          <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
            <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
            <Text style={styles.coachText}>{WAKE_WATER_PROMPT}</Text>
            <Pressable
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await addWater(db, new Date(), 200);
                  setDrank(true);
                })
              }
              style={styles.primary}
            >
              <Text style={styles.primaryText}>+200 ml su içtim</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.section}>Ne zaman oldu?</Text>
        <View style={styles.chipRow}>
          {AGO_CHOICES.map((m) => (
            <Pressable key={m} onPress={() => setAgo(m)} style={[styles.chip, ago === m && styles.chipOn]}>
              <Text style={[styles.chipText, ago === m && { color: colors.aura }]}>{agoLabel(m)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.grid}>
          {FLOW_KINDS.map((k) => {
            const isNext = next === k.kind;
            return (
              <Pressable
                key={k.kind}
                disabled={busy}
                onPress={() => stamp(k.kind)}
                style={[styles.step, isNext && styles.stepNext]}
              >
                <Text style={styles.stepIcon}>{k.icon}</Text>
                <Text style={[styles.stepText, isNext && { color: colors.aura }]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {next === null && <Text style={styles.muted}>Gün tamam: eve geldin. Yeni bir güne 04:00'te başlanır.</Text>}

        <Text style={styles.section}>Bugünün akışı</Text>
        <View style={styles.card}>
          {events.length === 0 ? (
            <Text style={styles.muted}>Henüz damga yok. İlk adım genelde "Uyandım".</Text>
          ) : (
            events.map((e) => (
              <Pressable
                key={e.id}
                onLongPress={() => confirmRemoveEvent(e.id, kindLabel(e.kind))}
                style={styles.rowBetween}
              >
                <Text style={styles.itemTitle}>
                  {FLOW_KINDS.find((k) => k.kind === e.kind)?.icon} {kindLabel(e.kind)}
                </Text>
                <Text style={styles.time}>{formatClock(new Date(e.at))}</Text>
              </Pressable>
            ))
          )}
          {events.length > 0 && <Text style={styles.hint}>Silmek için bir satıra uzun bas.</Text>}
        </View>

        {chips.length > 0 && (
          <View style={styles.chipRow}>
            {chips.map((c) => (
              <View key={c} style={styles.tag}>
                <Text style={styles.tagText}>{c}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>Sigara sayacı</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.big}>{smoke.count}</Text>
              <Text style={styles.muted}>{smoke.line}</Text>
            </View>
            <Pressable
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await addSmoke(db, new Date(), smokeAgo);
                  setSmokeAgo(0);
                })
              }
              style={styles.primary}
            >
              <Text style={styles.primaryText}>+1</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Ne zaman içildi?</Text>
          <View style={styles.chipRow}>
            {AGO_CHOICES.map((m) => (
              <Pressable key={m} onPress={() => setSmokeAgo(m)} style={[styles.chip, smokeAgo === m && styles.chipOn]}>
                <Text style={[styles.chipText, smokeAgo === m && { color: colors.aura }]}>{agoLabel(m)}</Text>
              </Pressable>
            ))}
          </View>

          {smokeLogs.length > 0 && (
            <>
              <Text style={styles.label}>Bugünkü kayıtlar</Text>
              <View style={styles.chipRow}>
                {smokeLogs.map((l) => (
                  <Pressable
                    key={l.id}
                    onLongPress={() =>
                      Alert.alert('Kaydı sil', `${formatClock(new Date(l.at))} kaydı silinsin mi?`, [
                        { text: 'Vazgeç', style: 'cancel' },
                        { text: 'Sil', style: 'destructive', onPress: () => void run(async () => removeSmoke(db, l.id)) },
                      ])
                    }
                    style={styles.tag}
                  >
                    <Text style={styles.tagText}>{formatClock(new Date(l.at))}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>Yanlış girdiysen saate uzun bas, sil.</Text>
            </>
          )}

          {smoke.count > 1 && smoke.longestGapMinutes !== null && (
            <Text style={styles.muted}>En uzun ara: {formatDuration(smoke.longestGapMinutes)}</Text>
          )}

          <Text style={styles.label}>Günlük sınır (isteğe bağlı, sana kalmış)</Text>
          <View style={styles.chipRow}>
            {SMOKE_LIMIT_CHOICES.map((n) => (
              <Pressable
                key={n}
                disabled={busy}
                onPress={() => run(async () => setSmokeLimit(db, n))}
                style={[styles.chip, smoke.limit === n && styles.chipOn]}
              >
                <Text style={[styles.chipText, smoke.limit === n && { color: colors.aura }]}>{n}</Text>
              </Pressable>
            ))}
            <Pressable
              disabled={busy}
              onPress={() => run(async () => setSmokeLimit(db, null))}
              style={[styles.chip, smoke.limit === null && { borderColor: colors.textMuted }]}
            >
              <Text style={[styles.chipText, smoke.limit === null && { color: colors.text }]}>Kapalı</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footnote}>
          Bu kayıtlar yalnızca telefonunda durur. Gün sonu analizine, sen "ekran, adım ve uyku verisini paylaş" demediysen
          sigara bilgisi hiç gitmez; paylaşıyorsan yalnızca toplam sayı ve ortalama aralık gider.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
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
    gap: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  step: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  stepNext: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  stepIcon: { fontSize: 18 },
  stepText: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  time: { color: colors.text, fontSize: 16, fontWeight: '800' },
  big: { color: colors.text, fontSize: 34, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.textMuted, fontSize: 11 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tag: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  primary: {
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: spacing.md },
});
