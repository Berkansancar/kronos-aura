import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import type { RoutineBrief } from '../database/types';
import { refreshReminders } from '../services/reminderSync';
import { applyRunAnswer, finishRun, loadRunBriefs, type RunOutcome } from '../services/routineMode';
import {
  SEGMENT_LABEL,
  availableSegments,
  buildRun,
  defaultSegment,
  formatTimer,
  newTimer,
  remainingMinutes,
  runAnswer,
  runCurrent,
  runFinished,
  runProgress,
  runSummary,
  startRun,
  timerRemainingSec,
  timerToggle,
  type RunAnswer,
  type RunSegment,
  type RunState,
  type TimerState,
} from '../services/routineModeLogic';
import { RoutineIcon } from '../components/WaterIcon';
import { withAlpha } from '../services/routineLook';
import { CATEGORY_LABEL } from '../services/routineTemplates';

export default function RoutineRunScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ seg?: string }>();
  const [briefs, setBriefs] = useState<RoutineBrief[] | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [timer, setTimer] = useState<TimerState>(newTimer());
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    setBriefs(await loadRunBriefs(db, new Date()));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      if (!started.current) load().catch(() => undefined);
    }, [load])
  );

  // Sayaç çalışırken her saniye ekranı yenile
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timer.running]);

  const segments = useMemo(() => (briefs ? availableSegments(briefs) : []), [briefs]);

  const begin = (segment: RunSegment) => {
    if (!briefs) return;
    const steps = buildRun(briefs, segment);
    if (steps.length === 0) return;
    started.current = true;
    setOutcome(null);
    setTimer(newTimer());
    setRun(startRun(steps));
  };

  const answer = async (a: RunAnswer) => {
    if (!run || busy) return;
    const cur = runCurrent(run);
    if (!cur) return;
    setBusy(true);
    try {
      const now = new Date();
      await applyRunAnswer(db, cur.routineId, a, now);
      const next = runAnswer(run, a);
      setRun(next);
      setTimer(newTimer());
      if (runFinished(next)) {
        const res = await finishRun(db, next.done, new Date());
        setOutcome(res);
        await refreshReminders(db, new Date()).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const exit = () => {
    started.current = false;
    setRun(null);
    setOutcome(null);
    router.back();
  };

  const restart = async () => {
    started.current = false;
    setRun(null);
    setOutcome(null);
    await load();
  };

  // ───────── Bölüm seçimi ─────────
  if (!run) {
    const preferred = briefs ? (params.seg as RunSegment | undefined) ?? defaultSegment(briefs, new Date()) : 'ALL';
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Geri</Text>
          </Pressable>
          <Text style={styles.heading}>Rutin modu</Text>
          <Text style={styles.sub}>
            Rutinlerini tek ekranda sırayla yap: her adımda yalnızca o rutini görürsün. Telefonu elinden bırakmadan bitir.
          </Text>
          {!briefs ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.aura} />
            </View>
          ) : segments.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.body}>
                Bugün için bekleyen rutin yok. Hepsi tamam ya da bugün planlı olan kalmadı. Rutinlerim ekranından yenilerini
                ekleyebilirsin.
              </Text>
              <Pressable onPress={() => router.push('/routines')} style={styles.primary}>
                <Text style={styles.primaryText}>Rutinlerim</Text>
              </Pressable>
            </View>
          ) : (
            segments.map((s) => (
              <Pressable
                key={s.segment}
                onPress={() => begin(s.segment)}
                style={[styles.card, s.segment === preferred && { borderColor: colors.aura }]}
              >
                <Text style={styles.segTitle}>
                  ▶ {SEGMENT_LABEL[s.segment]}
                  {s.segment === preferred ? '  · önerilen' : ''}
                </Text>
                <Text style={styles.muted}>
                  {s.count} rutin · yaklaşık {s.minutes} dk
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ───────── Tur bitti ─────────
  if (runFinished(run)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>Tur bitti {run.done.length > 0 ? '🌿' : ''}</Text>
          <View style={styles.card}>
            <Text style={styles.body}>{runSummary(run)}</Text>
            {outcome ? (
              <Text style={styles.muted}>
                Bugün {outcome.done}/{outcome.planned} rutin tamam
                {outcome.bestStreak >= 2 ? ` · ${outcome.bestStreak} gün seri` : ''}.
              </Text>
            ) : null}
          </View>
          <Pressable onPress={restart} style={styles.primary}>
            <Text style={styles.primaryText}>Başka tur</Text>
          </Pressable>
          <Pressable onPress={exit} style={styles.ghost}>
            <Text style={styles.ghostText}>Bitir</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ───────── Adım ─────────
  const cur = runCurrent(run)!;
  const prog = runProgress(run);
  const remaining = timerRemainingSec(timer, Date.now(), cur.minutes);
  const over = remaining < 0;
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable onPress={exit} hitSlop={10}>
            <Text style={styles.back}>‹ Çık</Text>
          </Pressable>
          <Text style={styles.muted}>
            {prog.position} / {prog.total} · kalan ~{remainingMinutes(run)} dk
          </Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(prog.ratio * 100)}%` }]} />
        </View>

        <View style={[styles.stepCard, { borderColor: cur.color, backgroundColor: withAlpha(cur.color, 0.08) }]}>
          <View style={styles.stepIcon}>
            <RoutineIcon icon={cur.icon} size={48} />
          </View>
          <Text style={styles.stepTitle}>{cur.title}</Text>
          <Text style={styles.muted}>
            {CATEGORY_LABEL[cur.category]} · ~{cur.minutes} dk
          </Text>
          <Text style={[styles.timer, over && { color: colors.kronos }]}>{formatTimer(remaining)}</Text>
          <Pressable onPress={() => setTimer(timerToggle(timer, Date.now()))} style={[styles.timerBtn, { borderColor: cur.color }]}>
            <Text style={[styles.timerBtnText, { color: cur.color }]}>{timer.running ? 'Duraklat' : timer.accumulated > 0 ? 'Devam' : 'Süreyi başlat'}</Text>
          </Pressable>
          {over ? <Text style={styles.muted}>Süre doldu; acelen yoksa devam edebilirsin.</Text> : null}
        </View>

        <Pressable disabled={busy} onPress={() => answer('DONE')} style={[styles.doneBtn, busy && { opacity: 0.6 }]}>
          <Text style={styles.doneText}>Yaptım ✓</Text>
        </Pressable>
        <View style={styles.answerRow}>
          <Pressable disabled={busy} onPress={() => answer('LATER')} style={styles.secondary}>
            <Text style={styles.secondaryText}>Sonra</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => answer('SKIP')} style={styles.secondary}>
            <Text style={styles.secondaryText}>Bugün atla</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>"Sonra" rutini turun sonuna alır. "Atla" bugünü kapatır, yarın yine sorulur.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  segTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  primary: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.aura,
    backgroundColor: colors.auraSoft,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  primaryText: { color: colors.aura, fontWeight: '800', fontSize: 15 },
  ghost: { alignItems: 'center', paddingVertical: 12 },
  ghostText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.aura },
  stepCard: {
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    minHeight: 280,
    justifyContent: 'center',
  },
  stepIcon: { alignItems: 'center', minHeight: 60, justifyContent: 'center' },
  stepTitle: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  timer: { color: colors.text, fontSize: 44, fontWeight: '800', marginTop: spacing.md, fontVariant: ['tabular-nums'] },
  timerBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  timerBtnText: { fontSize: 13, fontWeight: '800' },
  doneBtn: {
    alignItems: 'center',
    backgroundColor: colors.auraSoft,
    borderWidth: 1.5,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 16,
  },
  doneText: { color: colors.aura, fontSize: 18, fontWeight: '800' },
  answerRow: { flexDirection: 'row', gap: spacing.md },
  secondary: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 13,
  },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
