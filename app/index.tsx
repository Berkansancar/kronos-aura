import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CoachConsole } from '../components/CoachConsole';
import { EnergyCheckModal } from '../components/EnergyCheckModal';
import { ReasonModal } from '../components/ReasonModal';
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
  isHardDay,
  listDayBlocks,
  listRecentLogs,
  listTaskOutcomes,
  listVisibleTasks,
} from '../database/repository';
import type {
  ActivitySummary,
  EnergyState,
  Routine,
  RoutineBrief,
  SleepSummary,
  Task,
  TaskOutcomeReason,
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
import { confirmEndHardDay, confirmStartHardDay } from '../components/hardDayAlert';
import { endHardDay, startHardDay } from '../services/hardDay';
import { countExhaustedSince, shouldSuggestHardDay } from '../services/hardDayLogic';
import { isEssentialRoutine } from '../services/routineRemindersLogic';
import { addWater, loadDayNutrition } from '../services/nutrition';
import { formatWater, type DayNutrition } from '../services/nutritionLogic';
import { getNutritionOptions } from '../services/nutritionSettings';
import { loadGoalState } from '../services/goals';
import { addSmoke, loadDayFlow, stampEvent, type DayFlowState } from '../services/dayFlow';
import { FLOW_KINDS, kindLabel } from '../services/dayFlowLogic';
import { nutritionDay } from '../services/nutritionLogic';
import { auraOutcomeReply, latestOutcomes, OUTCOME_LABEL, reasonLabel } from '../services/taskOutcomeLogic';
import { getWork } from '../services/workSettings';
import { getGoalBundle } from '../services/goalsSettings';
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
  carryOverMissed,
  completeTask,
  logDrift,
  markTaskMissed,
  postponeTasks,
  removeTask,
  restoreTask,
  startTask,
  toggleWorkOk,
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
  const [hardDay, setHardDayOn] = useState(false);
  const [nutrition, setNutrition] = useState<DayNutrition | null>(null);
  const [goalLine, setGoalLine] = useState<string | null>(null);
  const [workEnabled, setWorkEnabled] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState<Map<string, string>>(new Map());
  const [couldNot, setCouldNot] = useState<Task | null>(null);
  const [dayFlow, setDayFlow] = useState<DayFlowState | null>(null);

  const load = useCallback(async () => {
    const current = new Date();
    const { start, end } = dayBounds(planningDay(current));
    const u = await getOrCreateUser(db);
    // Dün akşam "yarın yapacağım" denen rutinler bugünün planına girer (hata verirse atlanır)
    await materializePlannedRoutines(db, current).catch(() => 0);
    // Dün "yapmadım / yapamadım" denen işler yeni günün planına geri döner (hata verirse atlanır)
    await carryOverMissed(db, current).catch(() => []);
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
    setHardDayOn(await isHardDay(db, dayKey(planningDay(current))).catch(() => false));
    // Su ve yemek özeti (kayıt yoksa ya da hata verirse kart yine de çalışır)
    try {
      setNutrition(await loadDayNutrition(db, current, await getNutritionOptions()));
    } catch {
      setNutrition(null);
    }
    // İş saatleri, görev sonuçları ve gün akışı (hata verirse kartlar yine de çalışır)
    try {
      setWorkEnabled((await getWork(db)).enabled);
      const notes = new Map<string, string>();
      for (const o of latestOutcomes(await listTaskOutcomes(db, nutritionDay(current)))) {
        if (o.taskId && o.outcome !== 'DONE') {
          notes.set(o.taskId, [OUTCOME_LABEL[o.outcome], reasonLabel(o.reason)].filter(Boolean).join(' · '));
        }
      }
      setOutcomeNotes(notes);
      setDayFlow(await loadDayFlow(db, current));
    } catch {
      setDayFlow(null);
    }
    // Hedefler özeti (hata verirse kart yine de açılır)
    try {
      const gs = await loadGoalState(db, current, await getGoalBundle());
      setGoalLine(`${gs.progress.onTrack}/${gs.progress.total} hedef yolunda`);
    } catch {
      setGoalLine(null);
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
      hardDay,
      nutrition,
    };
  }, [now, user, tasks, blocks, logs, activity, shareActivity, briefs, sleep, hardDay, nutrition]);

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
      hardDay ? 'hard' : '',
      nutrition ? `${Math.floor(nutrition.waterMl / 500)}:${nutrition.foodEntries}` : '',
    ].join('|');
  }, [coaches, tasks, blocks, logs, activity, shareActivity, briefs, sleep, hardDay, nutrition]);

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

  const toggleHardDay = () => {
    if (hardDay) {
      confirmEndHardDay(() => run(async () => void (await endHardDay(db, new Date()))));
    } else {
      confirmStartHardDay(() => run(async () => void (await startHardDay(db, new Date()))));
    }
  };

  const missTask = (task: Task, outcome: 'NOT_DONE' | 'COULD_NOT', reason: TaskOutcomeReason | null) =>
    run(async () => {
      await markTaskMissed(db, task, outcome, reason, new Date());
      setAuraReply(auraOutcomeReply(outcome, task.title, reason));
    });

  const onReasonSelect = (reason: TaskOutcomeReason | null) => {
    const task = couldNot;
    setCouldNot(null);
    if (task) missTask(task, 'COULD_NOT', reason);
  };

  const onFinishWithEnergy = (energy: EnergyState) => {
    const task = finishing;
    setFinishing(null);
    if (!task) return;
    run(async () => {
      await completeTask(db, task, energy);
      setAuraReply(auraOutcomeReply('DONE', task.title));
    });
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

  const suggestHardDay = shouldSuggestHardDay({
    hardDay,
    // Uyku yalnızca sabah yarısında bir ipucudur; akşam "uykun kısa" demenin anlamı yok.
    sleepMinutes: now.getHours() < 14 ? (sleep?.lastMinutes ?? null) : null,
    exhaustedToday: countExhaustedSince(logs, dayBounds(planningDay(now)).start),
  });
  const visibleDue = dueBriefs(briefs).filter((b) => !hardDay || isEssentialRoutine(b.routine));
  const morningWindow = now.getHours() >= 5 && now.getHours() < 12;

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

        {hardDay ? (
          <View style={styles.hardCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>Zor gün modu açık</Text>
              <Text style={styles.activitySub}>
                Plan hafifletildi; uzun rutinler bugün sorulmaz. Bugün senden fazlası beklenmiyor.
              </Text>
            </View>
            <Pressable disabled={busy} onPress={toggleHardDay} style={styles.hardBtn} hitSlop={6}>
              <Text style={styles.hardBtnText}>Normal güne dön</Text>
            </Pressable>
          </View>
        ) : suggestHardDay ? (
          <View style={styles.hardCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>Bugün hafif gidelim mi?</Text>
              <Text style={styles.activitySub}>
                Aura planı hafifletsin: birkaç küçük iş kalsın, gerisi bekleyebilir.
              </Text>
            </View>
            <Pressable disabled={busy} onPress={toggleHardDay} style={styles.hardBtn} hitSlop={6}>
              <Text style={styles.hardBtnText}>Zor gün modu</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable disabled={busy} onPress={toggleHardDay} hitSlop={6}>
            <Text style={styles.aiHint}>Zor bir gün mü? Planı hafiflet ›</Text>
          </Pressable>
        )}

        {morningWindow && (
          <Pressable onPress={() => router.push('/morning')} style={styles.activityCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle}>Sabah brifingi</Text>
              <Text style={styles.activitySub}>Günün planı, en önemli iş ve rutinlerin</Text>
            </View>
            <Text style={styles.activityArrow}>›</Text>
          </Pressable>
        )}

        <Pressable onPress={() => router.push('/review')} style={styles.reviewCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewTitle}>Gün sonu değerlendirmesi</Text>
            <Text style={styles.activitySub}>
              {!reviewAvailable(now)
                ? 'Akşam 20:00\'den sonra kendiliğinden hazır olur · kopyala-yapıştır yolu şimdi de açık'
                : hasReview
                  ? 'Hazır · yarın için rutinlerine bak'
                  : 'Bugünü birlikte değerlendirelim, yarını planlayalım'}
            </Text>
          </View>
          <Text style={styles.activityArrow}>›</Text>
        </Pressable>

        {deviceActivityAvailable && (
          <Pressable onPress={() => router.push('/activity')} style={styles.activityCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle}>Gün analizi</Text>
              <Text style={styles.activitySub}>{activityLine}</Text>
            </View>
            <Text style={styles.activityArrow}>›</Text>
          </Pressable>
        )}

        {visibleDue.map((b) => (
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

        <View style={styles.activityCard}>
          <Pressable onPress={() => router.push('/day')} style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Gün akışı</Text>
            <Text style={styles.activitySub}>
              {dayFlow
                ? `${dayFlow.next ? `Sıradaki: ${kindLabel(dayFlow.next)}` : 'Gün tamam: eve geldin'} · ${dayFlow.smoke.count} sigara`
                : 'Uyandım, duş, minibüs, dükkan ve sigara sayacı'}
            </Text>
          </Pressable>
          {dayFlow?.next && (
            <Pressable
              disabled={busy}
              onPress={() => run(async () => void (await stampEvent(db, dayFlow.next!, new Date(), 0)))}
              style={styles.waterBtn}
              hitSlop={6}
            >
              <Text style={styles.waterBtnText}>
                {FLOW_KINDS.find((k) => k.kind === dayFlow.next)?.icon} {kindLabel(dayFlow.next)}
              </Text>
            </Pressable>
          )}
          <Pressable
            disabled={busy}
            onPress={() => run(async () => void (await addSmoke(db, new Date(), 0)))}
            style={styles.smokeBtn}
            hitSlop={6}
          >
            <Text style={styles.smokeBtnText}>+1</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push('/mark')} style={styles.activityCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Günü işaretle</Text>
            <Text style={styles.activitySub}>
              Gündüz telefona bakamadıysan akşam topluca: yaptım, yapmadım, yapamadım
            </Text>
          </View>
          <Text style={styles.activityArrow}>›</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/routines')} style={styles.activityCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Rutinlerim</Text>
            <Text style={styles.activitySub}>{routineLine}</Text>
          </View>
          <Text style={styles.activityArrow}>›</Text>
        </Pressable>

        <View style={styles.activityCard}>
          <Pressable onPress={() => router.push('/nutrition')} style={{ flex: 1, gap: 6 }}>
            <Text style={styles.activityTitle}>Su ve yemek</Text>
            <Text style={styles.activitySub}>
              {nutrition
                ? `Su ${formatWater(nutrition.waterMl)} / ${formatWater(nutrition.waterGoalMl)}${nutrition.foodEntries > 0 ? ` · ${nutrition.foodEntries} yemek kaydı` : ''}`
                : 'Su, yemek ve kalori kaydı'}
            </Text>
            <View style={styles.waterTrack}>
              <View style={[styles.waterFill, { width: `${Math.round((nutrition?.waterRatio ?? 0) * 100)}%` }]} />
            </View>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => run(async () => void (await addWater(db, new Date(), 200)))}
            style={styles.waterBtn}
            hitSlop={6}
          >
            <Text style={styles.waterBtnText}>+200 ml</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/nutrition')} hitSlop={8}>
            <Text style={styles.activityArrow}>›</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push('/goals')} style={styles.activityCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Hedefler ve zaman dengesi</Text>
            <Text style={styles.activitySub}>{goalLine ?? 'Su, kalori, yemek saatleri, ekran süresi, yatış ve boş zaman'}</Text>
          </View>
          <Text style={styles.activityArrow}>›</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/weekly')} style={styles.activityCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>Haftalık özet</Text>
            <Text style={styles.activitySub}>Son 7 günün görev, rutin, uyku ve enerji özeti</Text>
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
                outcomeNote={outcomeNotes.get(task.id) ?? null}
                workEnabled={workEnabled}
                onToggleWorkOk={() => run(() => toggleWorkOk(db, task))}
                onNotDone={() => missTask(task, 'NOT_DONE', null)}
                onCouldNot={() => setCouldNot(task)}
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
        workEnabled={workEnabled}
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
      <ReasonModal
        taskTitle={couldNot?.title ?? null}
        workEnabled={workEnabled}
        onSelect={onReasonSelect}
        onClose={() => setCouldNot(null)}
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
  waterTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  waterFill: { height: 6, borderRadius: 3, backgroundColor: colors.aura },
  waterBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    backgroundColor: colors.auraSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  waterBtnText: { color: colors.aura, fontSize: 13, fontWeight: '800' },
  smokeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  smokeBtnText: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
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
  hardCard: {
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
  hardBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  hardBtnText: { color: colors.aura, fontSize: 12, fontWeight: '800' },
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
