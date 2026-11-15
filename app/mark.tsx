import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { EnergyCheckModal } from '../components/EnergyCheckModal';
import { ReasonModal } from '../components/ReasonModal';
import { colors, radius, spacing } from '../constants/theme';
import { listDayEvents, listTaskOutcomes, listVisibleTasks } from '../database/repository';
import type { EnergyState, Task, TaskOutcomeKind, TaskOutcomeReason } from '../database/types';
import { dayKey } from '../services/activityLogic';
import { reviewAvailable, reviewDayOf } from '../services/dayReview';
import { buildFlow } from '../services/dayFlowLogic';
import { formatDuration } from '../services/format';
import { addDoneTask, completeTask, markTaskMissed } from '../services/taskFlow';
import { OUTCOME_LABEL, latestOutcomes, reasonLabel } from '../services/taskOutcomeLogic';
import { getWork } from '../services/workSettings';
import { workWindowFor, type WorkSchedule } from '../services/workLogic';

const QUICK_MINUTES = [10, 15, 30, 45, 60, 90];

interface Row {
  task: Task;
  outcome: TaskOutcomeKind | null;
  reason: TaskOutcomeReason | null;
}

/** Akşam topluca işaretleme: gündüz telefona bakamayan için. Seçilen gün: gün sonu değerlendirmesinin günü. */
export default function MarkScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [work, setWork] = useState<WorkSchedule | null>(null);
  const [shopRange, setShopRange] = useState<{ from: Date; to: Date } | null>(null);

  const [finishing, setFinishing] = useState<Task | null>(null);
  const [couldNot, setCouldNot] = useState<Task | null>(null);

  // Planda olmayan ama yapılan iş
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [inWork, setInWork] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<{ title: string; minutes: number; inWork: boolean } | null>(null);

  const day = reviewDayOf(now);
  const key = dayKey(day);

  const reload = useCallback(async () => {
    const current = new Date();
    const d = reviewDayOf(current);
    const k = dayKey(d);
    const [visible, outcomes, w, events] = await Promise.all([
      listVisibleTasks(db, d.toISOString()),
      listTaskOutcomes(db, k),
      getWork(db),
      listDayEvents(db, k),
    ]);
    const byTask = new Map(latestOutcomes(outcomes).filter((o) => o.taskId).map((o) => [o.taskId as string, o]));
    const list: Row[] = [];
    for (const t of visible) {
      const o = byTask.get(t.id) ?? null;
      if (t.status === 'POSTPONED' && !o) continue; // "Ertele" ile bilerek kaydırılanlar
      list.push({ task: t, outcome: t.status === 'COMPLETED' ? 'DONE' : (o?.outcome ?? null), reason: o?.reason ?? null });
    }
    const rank = (r: Row) => (r.outcome === null ? 0 : r.outcome === 'DONE' ? 2 : 1);
    list.sort((a, b) => rank(a) - rank(b));
    const flow = buildFlow(events, current);
    setNow(current);
    setRows(list);
    setWork(w);
    setShopRange(flow.shopInAt ? { from: flow.shopInAt, to: flow.shopOutAt ?? current } : null);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload()
        .catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
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

  // Geriye dönük kayıtlar işaretlenen günün içinde kalsın (gece yarısından sonra işaretlense bile)
  const endOfReviewDay = () => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59);
  const evening = () => (now.getTime() > endOfReviewDay().getTime() ? endOfReviewDay() : now);

  // İş vaktinde yapılan bir iş için kayıt anı: dükkan damgaları varsa onların, yoksa iş saatlerinin ortası
  const workTime = (): Date | null => {
    if (shopRange) return new Date((shopRange.from.getTime() + shopRange.to.getTime()) / 2);
    const win = work ? workWindowFor(day, work) : null;
    if (!win) return null;
    return new Date(day.getTime() + ((win.startMin + win.endMin) / 2) * 60_000);
  };
  const canAskWork = work?.enabled === true && workTime() !== null;

  const finish = (task: Task, energy: EnergyState, atWork: boolean) =>
    run(async () => {
      const at = atWork ? (workTime() ?? evening()) : evening();
      await completeTask(db, task, energy, new Date(), { loggedAt: at });
    });

  const onEnergy = (energy: EnergyState) => {
    const task = finishing;
    setFinishing(null);
    if (!task) return;
    if (canAskWork && task.workOk) {
      Alert.alert('Ne zaman yaptın?', `"${task.title}"`, [
        { text: 'İş vaktinde', onPress: () => void finish(task, energy, true) },
        { text: 'İş dışında', onPress: () => void finish(task, energy, false) },
      ]);
    } else {
      void finish(task, energy, false);
    }
  };

  const miss = (task: Task, outcome: 'NOT_DONE' | 'COULD_NOT', reason: TaskOutcomeReason | null) =>
    run(async () => void (await markTaskMissed(db, task, outcome, reason, new Date(), { at: evening() })));

  const onReason = (reason: TaskOutcomeReason | null) => {
    const task = couldNot;
    setCouldNot(null);
    if (task) void miss(task, 'COULD_NOT', reason);
  };

  const submitAdd = () => {
    const t = title.trim();
    if (!t) return;
    setPendingAdd({ title: t, minutes, inWork: canAskWork && inWork });
  };

  const onAddEnergy = (energy: EnergyState) => {
    const p = pendingAdd;
    setPendingAdd(null);
    if (!p) return;
    void run(async () => {
      const at = p.inWork ? (workTime() ?? evening()) : evening();
      await addDoneTask(db, { title: p.title, minutes: p.minutes, energy, workOk: p.inWork }, new Date(), at);
      setTitle('');
      setMinutes(30);
      setInWork(false);
      setAdding(false);
    });
  };

  const counts = {
    done: rows.filter((r) => r.outcome === 'DONE').length,
    notDone: rows.filter((r) => r.outcome === 'NOT_DONE').length,
    couldNot: rows.filter((r) => r.outcome === 'COULD_NOT').length,
    open: rows.filter((r) => r.outcome === null).length,
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Geri</Text>
          </Pressable>
          <Text style={styles.heading}>Günü işaretle</Text>
          <Text style={styles.sub}>
            Gündüz telefona bakamadıysan şimdi topluca işaretle. Hiçbiri suç değil; yalnızca günün kaydı.
          </Text>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.aura} />
            </View>
          ) : (
            <>
              <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
                <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
                <Text style={styles.coachText}>
                  {counts.open > 0
                    ? `${counts.open} iş işaretini bekliyor. Yaptıysan "Yaptım", olmadıysa "Yapamadım" de; yarına ben taşırım.`
                    : rows.length > 0
                      ? 'Hepsi işaretli. Bugünün kaydı hazır.'
                      : 'Bugün için bir görev görünmüyor. Yaptığın bir şey varsa aşağıdan ekleyebilirsin.'}
                </Text>
                {rows.length > 0 && (
                  <Text style={styles.muted}>
                    {counts.done} yaptım · {counts.notDone} yapmadım · {counts.couldNot} yapamadım
                  </Text>
                )}
              </View>

              {rows.map(({ task, outcome, reason }) => (
                <View key={task.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{task.title}</Text>
                      <Text style={styles.muted}>
                        {formatDuration(task.estimatedDuration)}
                        {outcome ? ` · ${outcome === 'DONE' ? '✓ ' : ''}${OUTCOME_LABEL[outcome]}${reason ? ` (${reasonLabel(reason)})` : ''}` : ''}
                      </Text>
                    </View>
                  </View>
                  {outcome !== 'DONE' && (
                  <View style={styles.btnRow}>
                    <Pressable disabled={busy} onPress={() => setFinishing(task)} style={styles.btn}>
                      <Text style={styles.btnText}>Yaptım</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => void miss(task, 'NOT_DONE', null)}
                      style={[styles.btn, outcome === 'NOT_DONE' && styles.btnOn]}
                    >
                      <Text style={[styles.btnText, outcome === 'NOT_DONE' && { color: colors.text }]}>Yapmadım</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => setCouldNot(task)}
                      style={[styles.btn, outcome === 'COULD_NOT' && styles.btnOn]}
                    >
                      <Text style={[styles.btnText, outcome === 'COULD_NOT' && { color: colors.text }]}>Yapamadım</Text>
                    </Pressable>
                  </View>
                  )}
                </View>
              ))}

              <Text style={styles.section}>Planda olmayan ama yaptığım</Text>
              {!adding ? (
                <Pressable onPress={() => setAdding(true)} style={styles.addBtn}>
                  <Text style={styles.addBtnText}>+ Yaptığım bir işi ekle</Text>
                </Pressable>
              ) : (
                <View style={styles.card}>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Ne yaptın?"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    returnKeyType="done"
                    onSubmitEditing={submitAdd}
                  />
                  <Text style={styles.label}>Yaklaşık ne kadar sürdü?</Text>
                  <View style={styles.chipRow}>
                    {QUICK_MINUTES.map((m) => (
                      <Pressable key={m} onPress={() => setMinutes(m)} style={[styles.chip, minutes === m && styles.chipOn]}>
                        <Text style={[styles.chipText, minutes === m && { color: colors.aura }]}>{m} dk</Text>
                      </Pressable>
                    ))}
                  </View>
                  {canAskWork && (
                    <View style={styles.rowBetween}>
                      <Text style={[styles.itemTitle, { flex: 1 }]}>İş vaktinde yaptım</Text>
                      <Switch value={inWork} onValueChange={setInWork} trackColor={{ true: colors.aura, false: colors.border }} />
                    </View>
                  )}
                  <View style={styles.btnRow}>
                    <Pressable onPress={() => setAdding(false)} style={styles.btn}>
                      <Text style={styles.btnText}>Vazgeç</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy || title.trim().length === 0}
                      onPress={submitAdd}
                      style={[styles.btn, styles.btnDone, title.trim().length === 0 && { opacity: 0.4 }]}
                    >
                      <Text style={[styles.btnText, { color: colors.aura }]}>Ekle</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {reviewAvailable(now) && (
                <Pressable onPress={() => router.push('/review')} style={styles.reviewBtn}>
                  <Text style={styles.reviewBtnText}>Bitti, gün sonu değerlendirmesine geç ›</Text>
                </Pressable>
              )}
              <Text style={styles.footnote}>İşaretlenen gün: {key}. Yapmadım ve Yapamadım dediklerin ertesi gün plana geri döner.</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <EnergyCheckModal taskTitle={finishing?.title ?? null} onSelect={onEnergy} onClose={() => setFinishing(null)} />
      <EnergyCheckModal taskTitle={pendingAdd?.title ?? null} onSelect={onAddEnergy} onClose={() => setPendingAdd(null)} />
      <ReasonModal
        taskTitle={couldNot?.title ?? null}
        workEnabled={work?.enabled === true}
        onSelect={onReason}
        onClose={() => setCouldNot(null)}
      />
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDone: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  btnOn: { borderColor: colors.textMuted, backgroundColor: colors.surfaceAlt },
  btnText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
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
  addBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  addBtnText: { color: colors.aura, fontSize: 14, fontWeight: '700' },
  reviewBtn: {
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  reviewBtnText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
