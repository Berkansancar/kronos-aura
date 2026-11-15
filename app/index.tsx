import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CoachConsole } from '../components/CoachConsole';
import { EnergyCheckModal } from '../components/EnergyCheckModal';
import { RoutineCard } from '../components/RoutineCard';
import { SnoozeModal } from '../components/SnoozeModal';
import { TaskComposer } from '../components/TaskComposer';
import { TaskItem } from '../components/TaskItem';
import { colors, radius, spacing } from '../constants/theme';
import { useAICoachMessages } from '../hooks/useAICoachMessages';
import {
  CHRONOTYPE_PRESETS,
  getDayReview,
  getOrCreateUser,
  listDayBlocks,
  listRecentLogs,
  listVisibleTasks,
} from '../database/repository';
import type {
  ActivitySummary,
  EnergyState,
  Routine,
  RoutineBrief,
  SleepSummary,
  Task,
  TimeBlockRow,
  TimeLog,
  UserProfile,
} from '../database/types';
import {
  getAuraDriftReply,
  getAuraMessage,
  getAuraRoutineReply,
  getKronosMessage,
  type CoachAction,
  type CoachContext,
  type CoachId,
  type CoachMessage,
} from '../services/coachEngine';
import {
  deviceActivityAvailable,
  ensureTracking,
  isSharingWithAi,
  loadSleepSummary,
  refreshActivity,
} from '../services/activity';
import { dayKey, formatSteps } from '../services/activityLogic';
import { formatClock, formatDayTitle, formatDuration } from '../services/format';
import { DAY_END_HOUR, dayBounds, planningDay, replanDay } from '../services/planner';
import { loadRoutineBriefs } from '../services/routineBriefs';
import {
  acceptRoutine,
  markRoutineDone,
  retireRoutine,
  skipRoutineToday,
  snoozeRoutine,
} from '../services/routineFlow';
import { dueBriefs, todayProgress, type SnoozeOption } from '../services/routineLogic';
import { refreshReminders } from '../services/reminderSync';
import { materializePlannedRoutines, reviewAvailable, reviewDayOf } from '../services/dayReview';
import {
  addTask,
  completeTask,
  logDrift,
  postponeTasks,
  removeTask,
  restoreTask,
  startTask,
} from '../services/taskFlow';

const STATUS_RANK: Record<Task['status'], number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  POSTPONED: 2,
  COMPLETED: 3,
};

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockRow[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [finishing, setFinishing] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [auraReply, setAuraReply] = useState<CoachMessage | null>(null);
  const [aiTick, setAiTick] = useState(0);
  const [activity, setActivity] = useState<ActivitySummary | undefined>(undefined);
  const [shareActivity, setShareActivity] = useState(false);
  const [briefs, setBriefs] = useState<RoutineBrief[]>([]);
  const [sleep, setSleep] = useState<SleepSummary | undefined>(undefined);
  const [snoozing, setSnoozing] = useState<Routine | null>(null);
  const [hasReview, setHasReview] = useState(false);

  const load = useCallback(async () => {
    const current = new Date();
    const { start, end } = dayBounds(planningDay(current));
    const u = await getOrCreateUser(db);
    // Dün akşam "yarın yapacağım" denen rutinler bugünün planına girer (hata verirse atlanır)
    await materializePlannedRoutines(db, current).catch(() => 0);
    const t = await listVisibleTasks(db, start.toISOString());
    const b = await listDayBlocks(db, start, end);
    const l = await listRecentLogs(db, 10);
    // Rutinlerin bugünkü durumu + hatırlatma bildirimlerinin eşitlenmesi (hata verirse atlanır)
    try {
      const rb = await loadRoutineBriefs(db, current);
      setBriefs(rb);
      refreshReminders(db, current, rb).catch(() => undefined);
      setHasReview((await getDayReview(db, dayKey(reviewDayOf(current)))) !== null);
    } catch {
      // Rutin verisi olmadan da görevler çalışır.
    }
    setNow(current);
    setUser(u);
    setTasks(t);
    setBlocks(b);
    setLogs(l);
  }, [db]);

  // Telefon aktivitesi (ekran süresi, adım): Android'de okunur, hata verirse sessizce atlanır.
  const loadActivity = useCallback(async () => {
    if (!deviceActivityAvailable) return;
    try {
      await ensureTracking();
      const { summary } = await refreshActivity(db);
      setActivity(summary);
      setSleep(await loadSleepSummary(db));
      setShareActivity(summary ? await isSharingWithAi() : false);
    } catch {
      // Aktivite verisi olmadan da uygulama çalışır.
    }
  }, [db]);

  // Ekrana her dönüldüğünde (ör. profil ayarından sonra) yeniden yükle.
  useFocusEffect(
    useCallback(() => {
      load();
      loadActivity();
    }, [load, loadActivity])
  );

  // Aktivite verisi beş dakikada bir tazelenir.
  useEffect(() => {
    const id = setInterval(loadActivity, 5 * 60_000);
    return () => clearInterval(id);
  }, [loadActivity]);

  // Koç mesajları zamana bağlı: yarım dakikada bir saati tazele.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Bir rutinin sorulma saati gelince kart kendiliğinden çıksın.
  useEffect(() => {
    const id = setInterval(() => {
      loadRoutineBriefs(db, new Date())
        .then(setBriefs)
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [db]);

  // Yapay zekâ mesajları aynı durumda bile 20 dakikada bir tazelenir.
  useEffect(() => {
    const id = setInterval(() => setAiTick((t) => t + 1), 20 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Aura'nın "not aldım" yanıtı kısa süre görünür, sonra normal mesaja döner.
  useEffect(() => {
    if (!auraReply) return;
    const id = setTimeout(() => setAuraReply(null), 45_000);
    return () => clearTimeout(id);
  }, [auraReply]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
        await load();
      } catch (e) {
        Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const blocksByTask = useMemo(() => {
    const map = new Map<string, TimeBlockRow[]>();
    for (const b of blocks) {
      const list = map.get(b.taskId) ?? [];
      list.push(b);
      map.set(b.taskId, list);
    }
    return map;
  }, [blocks]);

  const unplannedIds = useMemo(
    () => tasks.filter((t) => t.status === 'PENDING' && !blocksByTask.has(t.id)).map((t) => t.id),
    [tasks, blocksByTask]
  );

  const sortedTasks = useMemo(() => {
    const firstStart = (t: Task) => {
      const own = blocksByTask.get(t.id);
      return own && own.length > 0 ? new Date(own[0].startTime).getTime() : Number.MAX_SAFE_INTEGER;
    };
    return [...tasks].sort((a, b) => {
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (byStatus !== 0) return byStatus;
      const sa = firstStart(a);
      const sb = firstStart(b);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [tasks, blocksByTask]);

  const timeLabel = useCallback(
    (task: Task) =>
      (blocksByTask.get(task.id) ?? [])
        .map((b) => `${formatClock(new Date(b.startTime))}–${formatClock(new Date(b.endTime))}`)
        .join(' · '),
    [blocksByTask]
  );

  const ctx = useMemo<CoachContext | null>(() => {
    if (!user) return null;
    return {
      now,
      user,
      tasks,
      blocks: blocks.map((b) => ({
        taskId: b.taskId,
        startTime: new Date(b.startTime),
        endTime: new Date(b.endTime),
      })),
      recentLogs: logs,
      dayEndHour: DAY_END_HOUR,
      activity,
      shareActivityWithAi: shareActivity,
      routines: briefs,
      sleep,
    };
  }, [now, user, tasks, blocks, logs, activity, shareActivity, briefs, sleep]);

  const coaches = useMemo(
    () => (ctx ? { kronos: getKronosMessage(ctx), aura: getAuraMessage(ctx) } : null),
    [ctx]
  );

  // Yapay zekâ yalnızca durum gerçekten değişince çağrılır (dakikalık saat farkları sayılmaz).
  const situationKey = useMemo(() => {
    if (!coaches) return '';
    const stripNumbers = (s: string) => s.replace(/\d+/g, '#');
    return [
      tasks.map((t) => `${t.id}:${t.status}`).join(','),
      blocks.map((b) => b.id).join(','),
      logs[0]?.id ?? '',
      stripNumbers(coaches.kronos.headline),
      stripNumbers(coaches.aura.headline),
      // Ekran süresi saat, adım 2000'lik dilim değiştiğinde yapay zekâ mesajı tazelenir.
      activity
        ? `${Math.floor((activity.screenMinutes ?? 0) / 60)}:${Math.floor((activity.steps ?? 0) / 2000)}:${shareActivity ? 1 : 0}`
        : '',
      briefs.map((b) => `${b.routine.id}:${b.state}`).join(','),
      sleep?.lastMinutes != null ? Math.floor(sleep.lastMinutes / 60) : '',
    ].join('|');
  }, [coaches, tasks, blocks, logs, activity, shareActivity, briefs, sleep]);

  const ai = useAICoachMessages(ctx, coaches, situationKey, aiTick);

  const onCoachAction = (action: CoachAction) =>
    run(async () => {
      const n = new Date();
      switch (action.id) {
        case 'PLAN_DAY':
          await replanDay(db, n, 'MANUAL');
          break;
        case 'REPLAN':
          await replanDay(db, n, 'OVERRUN');
          break;
        case 'POSTPONE_OVERFLOW':
          await postponeTasks(db, unplannedIds, n);
          break;
        case 'LOG_DRIFT': {
          const minutes = action.minutes ?? 15;
          await logDrift(db, minutes, n);
          setAuraReply(getAuraDriftReply(minutes));
          break;
        }
      }
    });

  const answerRoutine = (routine: Routine, kind: 'ACCEPTED' | 'DONE' | 'SKIPPED' | 'RETIRED') =>
    run(async () => {
      const n = new Date();
      if (kind === 'ACCEPTED') await acceptRoutine(db, routine, n);
      else if (kind === 'DONE') await markRoutineDone(db, routine, n);
      else if (kind === 'SKIPPED') await skipRoutineToday(db, routine, n);
      else await retireRoutine(db, routine, n);
      setAuraReply(getAuraRoutineReply(kind, routine.title));
    });

  const onSnoozeSelect = (option: SnoozeOption) => {
    const routine = snoozing;
    setSnoozing(null);
    if (!routine) return;
    run(async () => {
      const until = await snoozeRoutine(db, routine, option, new Date());
      setAuraReply(getAuraRoutineReply(until ? 'SNOOZED' : 'SKIPPED', routine.title));
    });
  };

  const onFinishWithEnergy = (energy: EnergyState) => {
    const task = finishing;
    setFinishing(null);
    if (!task) return;
    run(() => completeTask(db, task, energy));
  };

  if (!user || !coaches) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.kronos} />
      </View>
    );
  }

  const activityParts: string[] = [];
  if (activity?.steps !== null && activity?.steps !== undefined) {
    activityParts.push(`${formatSteps(activity.steps)} adım`);
  }
  if (activity?.screenMinutes !== null && activity?.screenMinutes !== undefined) {
    activityParts.push(`${formatDuration(activity.screenMinutes)} ekran`);
  }
  const activityLine =
    activityParts.length > 0 ? activityParts.join(' · ') : 'Ekran süren ve adımların için aç';

  const progress = todayProgress(briefs);
  const routineLine =
    briefs.length === 0
      ? 'Su içmek, yürüyüş, nefes... örnek rutinlerden seç'
      : `${progress.done} yapıldı · ${progress.open} açık${progress.skipped > 0 ? ` · ${progress.skipped} bugünlük kapalı` : ''}`;

  const preset = CHRONOTYPE_PRESETS[user.chronotype];
  const planDay = planningDay(now);
  const isTomorrow = planDay.getDate() !== now.getDate();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.date}>{formatDayTitle(planDay)}</Text>
            <Text style={styles.subtitle}>{isTomorrow ? 'Yarın için plan' : 'Bugünün akışı'}</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10}>
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/profile')} style={styles.profileChip} hitSlop={8}>
            <Text style={styles.profileChipText}>
              {preset.label} · {String(user.peakStartHour).padStart(2, '0')}–
              {String(user.peakEndHour).padStart(2, '0')}
            </Text>
          </Pressable>
        </View>

        <CoachConsole
          kronos={ai.kronos ?? coaches.kronos}
          aura={auraReply ?? ai.aura ?? coaches.aura}
          onAction={onCoachAction}
          busy={busy}
          onTalk={(coach: CoachId) => router.push({ pathname: '/chat', params: { coach } })}
        />
        {ai.status === 'OFF' && (
          <Pressable onPress={() => router.push('/settings')}>
            <Text style={styles.aiHint}>
              Koçlar şu an kural tabanlı. Gerçek yapay zekâ ve sohbet için API anahtarını ekle ›
            </Text>
          </Pressable>
        )}
        {ai.status === 'ERROR' && (
          <Text style={styles.aiHint}>
            {ai.error ?? 'Yapay zekâ yanıt vermedi.'} Şimdilik kural tabanlı mesajlar gösteriliyor.
          </Text>
        )}

        {reviewAvailable(now) && (
          <Pressable onPress={() => router.push('/review')} style={styles.reviewCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>Gün sonu değerlendirmesi</Text>
              <Text style={styles.activitySub}>
                {hasReview
                  ? 'Hazır · yarın için rutinlerine bak'
                  : 'Bugünü birlikte değerlendirelim, yarını planlayalım'}
              </Text>
            </View>
            <Text style={styles.activityArrow}>›</Text>
          </Pressable>
        )}

        {deviceActivityAvailable && (
          <Pressable onPress={() => router.push('/activity')} style={styles.activityCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle}>Gün analizi</Text>
              <Text style={styles.activitySub}>{activityLine}</Text>
            </View>
            <Text style={styles.activityArrow}>›</Text>
          </Pressable>
        )}

        {dueBriefs(briefs).map((b) => (
          <RoutineCard
            key={b.routine.id}
            brief={b}
            busy={busy}
            onAccept={() => answerRoutine(b.routine, 'ACCEPTED')}
            onDone={() => answerRoutine(b.routine, 'DONE')}
            onLater={() => setSnoozing(b.routine)}
            onSkipToday={() => answerRoutine(b.routine, 'SKIPPED')}
            onRetire={() => answerRoutine(b.routine, 'RETIRED')}
          />
        ))}

        <Pressable onPress={() => router.push('/routines')} style={styles.activityCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Rutinlerim</Text>
            <Text style={styles.activitySub}>{routineLine}</Text>
          </View>
          <Text style={styles.activityArrow}>›</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Görevler</Text>
        {sortedTasks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Henüz görev yok. Aşağıdaki + ile ilkini ekle.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {sortedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                timeLabel={timeLabel(task)}
                onStart={() => run(() => startTask(db, task))}
                onFinish={() => setFinishing(task)}
                onPostpone={() => run(() => postponeTasks(db, [task.id]))}
                onRestore={() => run(() => restoreTask(db, task.id))}
                onDelete={() => run(() => removeTask(db, task.id))}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable onPress={() => setComposerOpen(true)} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <TaskComposer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={(input) => {
          setComposerOpen(false);
          run(() => addTask(db, input));
        }}
      />
      <EnergyCheckModal
        taskTitle={finishing?.title ?? null}
        onSelect={onFinishWithEnergy}
        onClose={() => setFinishing(null)}
      />
      <SnoozeModal
        routineTitle={snoozing?.title ?? null}
        now={now}
        onSelect={onSnoozeSelect}
        onClose={() => setSnoozing(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  gear: { color: colors.textMuted, fontSize: 22 },
  aiHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.auraSoft,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  reviewTitle: { color: colors.aura, fontSize: 15, fontWeight: '800' },
  activityTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  activitySub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  activityArrow: { color: colors.textMuted, fontSize: 24 },
  profileChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  profileChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  list: { gap: spacing.sm },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.kronos,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabText: { color: colors.bg, fontSize: 30, fontWeight: '600', marginTop: -2 },
});
