import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CoachConsole } from '../components/CoachConsole';
import { EnergyCheckModal } from '../components/EnergyCheckModal';
import { HomeGrid } from '../components/HomeGrid';
import { HomeTile } from '../components/HomeTile';
import { Damacana } from '../components/Damacana';
import { MoodCard } from '../components/MoodCard';
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
  getSetting,
  listRecentLogs,
  listTaskOutcomes,
  listVisibleTasks,
  setSetting,
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
import { upgradeRoutineIcons } from '../services/routineIconUpgrade';
import { HOME_PAGES, QUICK_WATER_ML, pageFromOffset, quickWaterMessage, tapHint, type HomeTileDef } from '../services/homeGrid';
import { formatWater, type DayNutrition } from '../services/nutritionLogic';
import { getNutritionOptions } from '../services/nutritionSettings';
import { loadGoalState } from '../services/goals';
import { addSmoke, loadDayFlow, stampEvent, type DayFlowState } from '../services/dayFlow';
import { FLOW_KINDS, kindLabel } from '../services/dayFlowLogic';
import { nutritionDay } from '../services/nutritionLogic';
import { auraOutcomeReply, latestOutcomes, OUTCOME_LABEL, reasonLabel } from '../services/taskOutcomeLogic';
import { getWork } from '../services/workSettings';
import { freeDayPlan } from '../services/freeDayLogic';
import { isFreeDay, workWindowFor, type WorkSchedule } from '../services/workLogic';
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
import { loadBackupNudge, snoozeBackupNudge } from '../services/backupNudge';
import { loadTypicalCommute } from '../services/commute';
import { loadGame, takeLevelUp } from '../services/game';
import { loadExercise } from '../services/exercise';
import { defaultState as defaultExerciseState, morningCard, type ExerciseState } from '../services/exerciseLogic';
import { DATA_CHANGED_EVENT } from '../services/notificationActionQueue';
import { countParked } from '../services/weekPlan';
import { loadGuide, type GuideData } from '../services/dayGuide';
import { guideLines, guideNow } from '../services/dayGuideLogic';
import type { GameSummary } from '../services/gameLogic';
import { loadLanguageDay, type LanguageDayState } from '../services/language';
import { languageLine } from '../services/languageLogic';
import { commuteLine, commuteState, commuteSuggestions, remainingMinutes } from '../services/commuteLogic';
import { todayLine } from '../services/todayLogic';
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
  undoOutcome,
  updateTaskDetails,
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
  const [exerciseState, setExerciseState] = useState<ExerciseState>(defaultExerciseState());
  const [workEnabled, setWorkEnabled] = useState(false);
  const [workSched, setWorkSched] = useState<WorkSchedule | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState<Map<string, string>>(new Map());
  const [couldNot, setCouldNot] = useState<Task | null>(null);
  const [dayFlow, setDayFlow] = useState<DayFlowState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Ana ekran iki sayfa: 0 = simgeli ızgara, 1 = tam akış (eski ana ekran)
  const { width: pageW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pager = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Task | null>(null);
  const [typicalCommute, setTypicalCommute] = useState<number | null>(null);
  const [lang, setLang] = useState<LanguageDayState | null>(null);
  const [game, setGame] = useState<GameSummary | null>(null);
  const [parked, setParked] = useState(0);
  const [guide, setGuide] = useState<GuideData | null>(null);
  const [levelMsg, setLevelMsg] = useState<string | null>(null);
  const [backupHint, setBackupHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = new Date();
    const { start, end } = dayBounds(planningDay(current));
    const u = await getOrCreateUser(db);
    // Dün akşam "yarın yapacağım" denen rutinler bugünün planına girer (hata verirse atlanır)
    await upgradeRoutineIcons(db).catch(() => 0);
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
      const wk = await getWork(db);
      setWorkEnabled(wk.enabled);
      setWorkSched(wk);
      setMoreOpen((await getSetting(db, 'home_more')) === '1');
      const notes = new Map<string, string>();
      for (const o of latestOutcomes(await listTaskOutcomes(db, nutritionDay(current)))) {
        if (o.taskId && o.outcome !== 'DONE') {
          notes.set(o.taskId, [OUTCOME_LABEL[o.outcome], reasonLabel(o.reason)].filter(Boolean).join(' · '));
        }
      }
      setOutcomeNotes(notes);
      setDayFlow(await loadDayFlow(db, current));
      setTypicalCommute(await loadTypicalCommute(db, current));
    } catch {
      setDayFlow(null);
    }
    setBackupHint(await loadBackupNudge(db, current));
    // Dil öğrenme (Duolingo ekran süresi + elle kayıtlar); hata verirse satır ve tuş gizlenir
    const langState = await loadLanguageDay(db, current).catch(() => null);
    setLang(langState);
    // Gün rehberi: şimdi ve sıradaki (hata verirse kart gizlenir)
    try {
      const gb = await getGoalBundle();
      setGuide(await loadGuide(db, current, { bedtimeMin: gb.settings.bedtime }));
    } catch {
      setGuide(null);
    }
    // Başka bir güne ayrılmış işler (Hafta planı)
    setParked(await countParked(db, current).catch(() => 0));
    // Oyunlaştırma: seviye, altın, seri (hata verirse satır gizlenir)
    try {
      const bundle = await getGoalBundle();
      const gm = await loadGame(db, current, { waterGoalMl: bundle.waterGoalMl, languageGoalMin: langState ? langState.settings.goalMin : null });
      setGame(gm.summary);
      const msg = await takeLevelUp(db, gm.summary.level);
      if (msg) setLevelMsg(msg);
    } catch {
      setGame(null);
    }
    // Sabah egzersizi kartı için program ve son seanslar (hata verirse kart gösterilmez)
    try {
      setExerciseState(await loadExercise(db));
    } catch {
      setExerciseState(defaultExerciseState());
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

  // Bildirimdeki düğmeden (ör. "Yaptım") bir cevap işlenince ekranı tazele.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(DATA_CHANGED_EVENT, () => {
      load();
      loadActivity();
    });
    return () => sub.remove();
  }, [load, loadActivity]);

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

  // "Daha fazla" bölümünün açık/kapalı hâli hatırlanır
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    setSetting(db, 'home_more', next ? '1' : '0').catch(() => undefined);
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
  // İş programı gün bazlıdır: Cumartesi yarım gün, Pazar tamamen boş olabilir
  const logicalDay = planningDay(now);
  const workToday = workSched ? workWindowFor(logicalDay, workSched) : null;
  const freeDay = workSched ? isFreeDay(logicalDay, workSched) : false;
  const freePlan = freeDay ? freeDayPlan(tasks) : null;
  // Günün saatine göre öne çıkan tek kart; geri kalanı "Daha fazla" altında durur
  // Sabah egzersizi kartı: yalnızca egzersiz gününde 05:00-12:00 arası; zor gün modunda gizlenir
  const exerciseCard = morningCard(exerciseState, now, hardDay);
  const focus: 'MORNING' | 'MARK' | 'REVIEW' | null = reviewAvailable(now)
    ? 'REVIEW'
    : morningWindow
      ? 'MORNING'
      : workToday && now.getHours() * 60 + now.getMinutes() >= workToday.endMin - 60
        ? 'MARK'
        : null;

  const summaryLine = todayLine({
    done: tasks.filter((t) => t.status === 'COMPLETED').length,
    open: tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length,
    waterMl: nutrition ? nutrition.waterMl : null,
    waterGoalMl: nutrition ? nutrition.waterGoalMl : null,
    smoke: dayFlow ? dayFlow.smoke.count : null,
    smokeLimit: dayFlow ? dayFlow.smoke.limit : null,
    language: lang ? lang.summary.total : null,
    languageGoal: lang ? lang.settings.goalMin : null,
  });
  const commute = commuteState(dayFlow?.events ?? [], now);
  const commuteSugs =
    commute.onBus && commute.direction
      ? commuteSuggestions(
          tasks,
          remainingMinutes(commute, typicalCommute),
          commute.direction,
          now.getDate(),
          3,
          lang ? { goalMin: lang.settings.goalMin, doneMin: lang.summary.total, appName: lang.settings.apps[0] } : undefined
        )
      : [];

  const guideMidnight = new Date(planningDay(now).getFullYear(), planningDay(now).getMonth(), planningDay(now).getDate()).getTime();
  const guideNowState = guide ? guideNow(guide.result.segments, Math.floor((now.getTime() - guideMidnight) / 60_000)) : null;
  const guideText = guideNowState ? guideLines(guideNowState) : null;

  // Izgara: kısa dokunuş hızlı işlem (su kutusu +200 ml), basılı tutma ilgili ekranı açar
  const onGridTap = async (tile: HomeTileDef): Promise<string | null> => {
    if (tile.id === 'su') {
      if (busy) return null;
      await run(async () => void (await addWater(db, new Date(), QUICK_WATER_ML)));
      return quickWaterMessage();
    }
    return tapHint(tile);
  };
  const onGridOpen = (tile: HomeTileDef) => {
    router.push((tile.params ? { pathname: tile.route, params: tile.params } : tile.route) as Href);
  };
  const goToPage = (i: number) => {
    pager.current?.scrollTo({ x: i * pageW, animated: true });
    setPage(i);
  };
  const openTaskTitles = sortedTasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').map((t) => t.title);

  const preset = CHRONOTYPE_PRESETS[user.chronotype];
  const planDay = planningDay(now);
  const isTomorrow = planDay.getDate() !== now.getDate();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(pageFromOffset(e.nativeEvent.contentOffset.x, pageW))}
        style={styles.pager}
      >
        <View style={{ width: pageW }}>
          <HomeGrid
            title={formatDayTitle(planDay)}
            subtitle={isTomorrow ? 'Yarın için plan' : 'Bugünün akışı'}
            nowText={guideNowState && guideText ? guideText.now : null}
            nowNote={guideNowState?.current?.note ?? null}
            onNow={() => router.push('/guide')}
            waterRatio={nutrition ? nutrition.waterRatio : 0}
            openCount={openTaskTitles.length}
            openTitles={openTaskTitles}
            onTasks={() => goToPage(1)}
            onSettings={() => router.push('/settings')}
            onTap={onGridTap}
            onOpen={onGridOpen}
          />
        </View>
        <View style={{ width: pageW }}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.date}>{formatDayTitle(planDay)}</Text>
                <Text style={styles.subtitle}>{isTomorrow ? 'Yarın için plan' : 'Bugünün akışı'}</Text>
                {summaryLine && <Text style={styles.todayLine}>{summaryLine}</Text>}
                {game && (
                  <Pressable onPress={() => router.push('/hero')} style={styles.heroLine} hitSlop={6}>
                    <Text style={styles.heroText}>
                      {game.rank.icon} Sv {game.level} · {game.rank.title} · 🪙 {game.gold}
                      {game.streak.current > 0 ? ` · 🔥 ${game.streak.current}` : ''}
                    </Text>
                    <View style={styles.heroTrack}>
                      <View style={[styles.heroFill, { width: `${Math.round(game.levelInfo.ratio * 100)}%` }]} />
                    </View>
                  </Pressable>
                )}
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

            {guideNowState && guideText && (
              <Pressable onPress={() => router.push('/guide')} style={styles.guideCard}>
                <Text style={styles.guideLabel}>ŞİMDİ</Text>
                <Text style={styles.guideNow}>{guideText.now}</Text>
                {guideNowState.current?.note && <Text style={styles.activitySub}>{guideNowState.current.note}</Text>}
                {guideText.next && <Text style={styles.activitySub}>Sıradaki · {guideText.next} ›</Text>}
              </Pressable>
            )}

            {parked > 0 && (
              <Pressable onPress={() => router.push('/week')} style={styles.hintCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>📅 {parked} iş başka günlere ayrıldı</Text>
                  <Text style={styles.activitySub}>O güne kadar burada görünmez · Hafta planı ›</Text>
                </View>
              </Pressable>
            )}

            {levelMsg && (
              <Pressable onPress={() => setLevelMsg(null)} style={styles.freeCard}>
                <Text style={styles.activityTitle}>{levelMsg}</Text>
                <Text style={styles.activitySub}>Kahraman ekranında rozetlerine ve ödüllerine bakabilirsin. Kapatmak için dokun.</Text>
              </Pressable>
            )}

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

            <MoodCard hardDay={hardDay} onSuggestHardDay={toggleHardDay} />

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

            {freePlan && (
              <View style={styles.freeCard}>
                <Text style={styles.activityTitle}>🌿 Boş gün</Text>
                <Text style={styles.activitySub}>{freePlan.headline}</Text>
                {freePlan.items.map((it) => (
                  <View key={it.id} style={styles.commuteRow}>
                    <Text style={styles.commuteText} numberOfLines={2}>
                      {it.title}
                    </Text>
                    <Text style={styles.commuteMin}>
                      {it.why} · {it.minutes} dk
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {commute.onBus && (
              <View style={styles.commuteCard}>
                <Text style={styles.activityTitle}>🚌 Yoldasın</Text>
                <Text style={styles.activitySub}>{commuteLine(commute, typicalCommute)}</Text>
                {commuteSugs.map((sg) => (
                  <View key={sg.taskId ?? sg.title} style={styles.commuteRow}>
                    <Text style={styles.commuteText} numberOfLines={2}>
                      {sg.title}
                    </Text>
                    {sg.minutes > 0 && <Text style={styles.commuteMin}>{sg.kind === 'LANGUAGE' ? '≈ ' : ''}{sg.minutes} dk</Text>}
                    {sg.kind === 'TASK' && (
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          const target = tasks.find((x) => x.id === sg.taskId);
                          if (target) setFinishing(target);
                        }}
                        style={styles.waterBtn}
                        hitSlop={6}
                      >
                        <Text style={styles.waterBtnText}>Yaptım</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {exerciseCard && (
              <Pressable
                onPress={() => router.push(exerciseCard.kind === 'TODO' ? '/exercise-run' : '/exercise')}
                style={styles.activityCard}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>{exerciseCard.title}</Text>
                  <Text style={styles.activitySub}>{exerciseCard.sub}</Text>
                </View>
                <Text style={styles.activityArrow}>›</Text>
              </Pressable>
            )}

            {focus === 'MORNING' && (
              <Pressable onPress={() => router.push('/morning')} style={styles.activityCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>Sabah brifingi</Text>
                  <Text style={styles.activitySub}>Günün planı, en önemli iş ve rutinlerin</Text>
                </View>
                <Text style={styles.activityArrow}>›</Text>
              </Pressable>
            )}

            {focus === 'MARK' && (
              <Pressable onPress={() => router.push('/mark')} style={styles.activityCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>Günü işaretle</Text>
                  <Text style={styles.activitySub}>
                    Gündüz bakamadıysan topluca: yaptım, yapmadım, yapamadım
                  </Text>
                </View>
                <Text style={styles.activityArrow}>›</Text>
              </Pressable>
            )}

            {focus === 'REVIEW' && (
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

            <View style={styles.quickRow}>
              <Pressable
                disabled={busy}
                onPress={() => run(async () => void (await addWater(db, new Date(), 200)))}
                style={styles.quickBtn}
              >
                <View style={styles.quickWater}>
                  <Damacana ratio={nutrition ? nutrition.waterRatio : 0} size={30} />
                  <Text style={styles.quickMain}>+200 ml</Text>
                </View>
                <Text style={styles.quickSub} numberOfLines={1}>
                  {nutrition ? `${formatWater(nutrition.waterMl)} / ${formatWater(nutrition.waterGoalMl)}` : 'Su'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() =>
                  dayFlow?.next
                    ? run(async () => void (await stampEvent(db, dayFlow.next!, new Date(), 0)))
                    : router.push('/day')
                }
                style={styles.quickBtn}
              >
                <Text style={styles.quickMain} numberOfLines={1}>
                  {dayFlow?.next
                    ? `${FLOW_KINDS.find((k) => k.kind === dayFlow.next)?.icon ?? ''} ${kindLabel(dayFlow.next)}`
                    : 'Gün akışı'}
                </Text>
                <Text style={styles.quickSub} numberOfLines={1}>
                  {dayFlow?.next ? 'Tek dokunuş damga' : dayFlow ? 'Gün tamam' : 'Uyandım, dükkan…'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => run(async () => void (await addSmoke(db, new Date(), 0)))}
                style={styles.quickBtn}
              >
                <Text style={styles.quickMain}>Sigara +1</Text>
                <Text style={styles.quickSub} numberOfLines={1}>
                  {dayFlow ? `bugün ${dayFlow.smoke.count}` : 'sayaç'}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => router.push({ pathname: '/review', params: { manual: '1' } })}
              style={styles.activityCard}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle}>🤖 Yapay zekâya kopyala-yapıştır</Text>
                <Text style={styles.activitySub}>
                  Günün özetini kopyala, Gemini / ChatGPT / Claude'a yapıştır, cevabı buraya geri getir. Ücretsiz.
                </Text>
              </View>
              <Text style={styles.activityArrow}>›</Text>
            </Pressable>

            {backupHint && (
              <View style={styles.hintCard}>
                <Pressable onPress={() => router.push('/settings')} style={{ flex: 1 }}>
                  <Text style={styles.activitySub}>{backupHint} ›</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setBackupHint(null);
                    snoozeBackupNudge(db).catch(() => undefined);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.hintLater}>Şimdi değil</Text>
                </Pressable>
              </View>
            )}

            <Pressable onPress={toggleMore} style={styles.moreRow} hitSlop={6}>
              <Text style={styles.moreText}>{moreOpen ? 'Daha az göster' : 'Daha fazla: rutinler, hedefler, geçmiş…'}</Text>
              <Text style={styles.activityArrow}>{moreOpen ? '⌃' : '⌄'}</Text>
            </Pressable>
            {moreOpen && (
              <View style={styles.tileGrid}>
                <HomeTile title="Rutinlerim" subtitle={routineLine} onPress={() => router.push('/routines')} />
                <HomeTile title="Rutin modu" subtitle="Rutinleri tek ekranda, sırayla ve süreyle yap" onPress={() => router.push('/routine-run')} />
                <HomeTile
                  title="Su ve yemek"
                  subtitle={
                    nutrition
                      ? `Su ${formatWater(nutrition.waterMl)}${nutrition.foodEntries > 0 ? ` · ${nutrition.foodEntries} yemek` : ''}`
                      : 'Su, yemek ve kalori kaydı'
                  }
                  onPress={() => router.push('/nutrition')}
                />
                <HomeTile title="Gün rehberi" subtitle="Saat saat çizelge: yol, iş, yemek, öneriler" onPress={() => router.push('/guide')} />
                <HomeTile
                  title="Hafta planı"
                  subtitle={parked > 0 ? `${parked} iş başka günlerde · Pazar için öneri` : 'İşleri günlere ayır, Pazar için plan'}
                  onPress={() => router.push('/week')}
                />
                <HomeTile
                  title="Kahraman"
                  subtitle={game ? `Seviye ${game.level} · 🪙 ${game.gold} · ödüller ve rozetler` : 'Seviye, ödüller ve rozetler'}
                  onPress={() => router.push('/hero')}
                />
                <HomeTile
                  title="Dil öğrenme"
                  subtitle={lang ? (languageLine(lang.summary.total, lang.settings.goalMin) ?? 'Duolingo otomatik, kalem-kağıt elle') : 'Duolingo otomatik, kalem-kağıt elle'}
                  onPress={() => router.push('/language')}
                />
                <HomeTile title="Alışkanlık takvimi" subtitle="Ay görünümü, seriler ve ruh hali" onPress={() => router.push('/habits')} />
                <HomeTile title="Aylık karne" subtitle="Ayın tek sayfalık özeti ve önceki ayla kıyas" onPress={() => router.push('/monthly')} />
                <HomeTile title="Hedefler" subtitle={goalLine ?? 'Su, kalori, ekran, yatış, boş zaman'} onPress={() => router.push('/goals')} />
                <HomeTile title="İlerleme ve geçmiş" subtitle="Günlük çubuk grafikler, 7-30 gün" onPress={() => router.push('/history')} />
                <HomeTile title="Gün akışı" subtitle="Damgalar, süreler, sigara sayacı" onPress={() => router.push('/day')} />
                {focus !== 'MARK' && (
                  <HomeTile title="Günü işaretle" subtitle="Akşam topluca: yaptım, yapmadım, yapamadım" onPress={() => router.push('/mark')} />
                )}
                {focus !== 'MORNING' && (
                  <HomeTile title="Sabah brifingi" subtitle="Günün planı ve en önemli iş" onPress={() => router.push('/morning')} />
                )}
                <HomeTile title="Haftalık özet" subtitle="Son 7 günün görev, rutin, uyku ve enerji özeti" onPress={() => router.push('/weekly')} />
                {deviceActivityAvailable && (
                  <HomeTile title="Gün analizi" subtitle={activityLine} onPress={() => router.push('/activity')} />
                )}
              </View>
            )}

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
                    // "Plana al": bugünkü "yapmadım / yapamadım" kaydı varsa o da geri alınır, yoksa yalnızca plana girer
                    onRestore={() =>
                      run(async () => {
                        if ((await undoOutcome(db, task)) === null) await restoreTask(db, task.id);
                      })
                    }
                    onDelete={() => run(() => removeTask(db, task.id))}
                    onEdit={() => setEditing(task)}
                    onUndoDone={() => run(async () => void (await undoOutcome(db, task)))}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </ScrollView>

      <View style={[styles.dots, { top: insets.top + 4 }]} pointerEvents="box-none">
        {Array.from({ length: HOME_PAGES }).map((_, i) => (
          <Pressable key={i} onPress={() => goToPage(i)} hitSlop={10} accessibilityLabel={i === 0 ? 'Simgeli ekran' : 'Tüm akış'}>
            <View style={[styles.dot, page === i && styles.dotOn]} />
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => setComposerOpen(true)} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <TaskComposer
        visible={composerOpen || editing !== null}
        workEnabled={workEnabled}
        editTask={editing}
        today={planningDay(now)}
        onClose={() => {
          setComposerOpen(false);
          setEditing(null);
        }}
        onSubmit={(input) => {
          const target = editing;
          setComposerOpen(false);
          setEditing(null);
          if (target) run(() => updateTaskDetails(db, target.id, input));
          else run(() => addTask(db, input));
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
  pager: { flex: 1 },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.aura },
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
  todayLine: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  commuteCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  guideCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 2,
  },
  guideLabel: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  guideNow: { color: colors.text, fontSize: 17, fontWeight: '800' },
  heroLine: { marginTop: 6, gap: 4, alignSelf: 'stretch' },
  heroText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  heroTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  heroFill: { height: 4, borderRadius: 2, backgroundColor: colors.aura },
  freeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  commuteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  commuteText: { flex: 1, color: colors.text, fontSize: 14 },
  commuteMin: { color: colors.textMuted, fontSize: 12 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintLater: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  quickWater: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quickMain: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  quickSub: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  moreText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
