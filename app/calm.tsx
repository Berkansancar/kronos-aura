import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { EnergyCheckModal } from '../components/EnergyCheckModal';
import { confirmEndHardDay, confirmStartHardDay } from '../components/hardDayAlert';
import { radius, spacing } from '../constants/theme';
import { isHardDay, listVisibleTasks } from '../database/repository';
import type { EnergyState, Task } from '../database/types';
import { dayKey } from '../services/activityLogic';
import {
  beginFocus,
  clearTimer,
  finishFocus,
  getCalmPrefs,
  getDayEnergy,
  getTaskSteps,
  getTimer,
  getWeekStarts,
  leaveFocus,
  saveCalmPrefs,
  saveTaskSteps,
  setDayEnergy,
} from '../services/calm';
import {
  DEFAULT_PREFS,
  ENERGY_OPTIONS,
  FOCUS_MINUTES,
  MICRO_MINUTES,
  TEXT_SIZES,
  addStep,
  currentStepIndex,
  discSize,
  focusHint,
  formatClock,
  isTimerOver,
  lineHeightFor,
  needsSplit,
  paletteFor,
  pickFocusTask,
  remainingMs,
  removeStep,
  scaleFont,
  shouldOfferHardDay,
  stepsProgress,
  suggestSteps,
  timerFraction,
  timerOverText,
  toggleStep,
  weekLine,
  type CalmPalette,
  type CalmPrefs,
  type CalmStep,
  type CalmTimer,
  type DayEnergy,
} from '../services/calmLogic';
import { formatDuration } from '../services/format';
import { endHardDay, startHardDay } from '../services/hardDay';
import { dayBounds, planningDay } from '../services/planner';
import { refreshReminders } from '../services/reminderSync';

const WEIGHT_LABEL = { HIGH: 'Derin odak', MEDIUM: 'Orta', LOW: 'Hafif' } as const;
const DISC_MAX = 150;

export default function CalmScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<CalmPrefs>(DEFAULT_PREFS);
  const [energy, setEnergy] = useState<DayEnergy | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skip, setSkip] = useState<string[]>([]);
  const [timer, setTimer] = useState<CalmTimer | null>(null);
  const [steps, setSteps] = useState<CalmStep[]>([]);
  const [newStepText, setNewStepText] = useState('');
  const [hardDay, setHardDayOn] = useState(false);
  const [weekStarts, setWeekStarts] = useState(0);
  const [finishing, setFinishing] = useState<Task | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const p = paletteFor(prefs);
  const styles = useMemo(() => makeStyles(p, prefs), [p, prefs]);

  const load = useCallback(async () => {
    const n = new Date();
    try {
      const day = planningDay(n);
      const list = await listVisibleTasks(db, dayBounds(day).start.toISOString());
      setTasks(list);
      setPrefs(await getCalmPrefs(db));
      setEnergy(await getDayEnergy(db, n));
      setHardDayOn(await isHardDay(db, dayKey(day)).catch(() => false));
      setWeekStarts(await getWeekStarts(db, n));
      let t = await getTimer(db, n.getTime());
      // Sayaç artık açık olmayan bir işe aitse (başka yerden bitirildi ya da silindi) kapatılır
      if (t && !list.some((x) => x.id === t?.taskId && (x.status === 'PENDING' || x.status === 'IN_PROGRESS'))) {
        await clearTimer(db).catch(() => undefined);
        t = null;
      }
      setTimer(t);
      setNowMs(Date.now());
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

  const focus = useMemo(() => pickFocusTask(tasks, energy, skip), [tasks, energy, skip]);
  const activeTimer = timer && focus && timer.taskId === focus.id ? timer : null;

  // Odaktaki işin adımları
  const focusId = focus?.id ?? null;
  useEffect(() => {
    let alive = true;
    setNewStepText('');
    if (!focusId) {
      setSteps([]);
      return;
    }
    getTaskSteps(db, focusId).then((s) => {
      if (alive) setSteps(s);
    });
    return () => {
      alive = false;
    };
  }, [db, focusId]);

  // Süre sayılırken ekran saniyede bir tazelenir; bitince (sessiz ayar kapalıysa) kısa titreşim verilir
  const wasOver = useRef(false);
  useEffect(() => {
    if (!activeTimer) {
      wasOver.current = false;
      return;
    }
    const tick = () => {
      const t = Date.now();
      setNowMs(t);
      const over = isTimerOver(activeTimer, t);
      if (over && !wasOver.current && !prefs.quiet) Vibration.vibrate(300);
      wasOver.current = over;
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeTimer, prefs.quiet]);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      await load();
      after?.();
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseEnergy = (value: DayEnergy) =>
    run(async () => {
      await setDayEnergy(db, value, new Date());
      setSkip([]);
    });

  const start = (kind: 'MICRO' | 'FOCUS') => {
    if (!focus) return;
    setNotice(null);
    run(async () => void (await beginFocus(db, focus, kind, new Date())));
  };

  const leave = () => {
    if (!focus) return;
    run(
      async () => void (await leaveFocus(db, focus, new Date())),
      () => setNotice('Sorun değil. İş beklemeye alındı; hazır olunca buradan devam edersin.')
    );
  };

  const finish = (state: EnergyState) => {
    const task = finishing;
    setFinishing(null);
    if (!task) return;
    run(
      async () => void (await finishFocus(db, task, state, new Date())),
      () => setNotice('Bitti. Bir nefes al.')
    );
  };

  const toggleHardDay = () => {
    const act = (fn: () => Promise<unknown>) =>
      run(async () => {
        await fn();
        await refreshReminders(db).catch(() => undefined);
      });
    if (hardDay) confirmEndHardDay(() => act(() => endHardDay(db, new Date())));
    else confirmStartHardDay(() => act(() => startHardDay(db, new Date())));
  };

  const updateSteps = (next: CalmStep[]) => {
    setSteps(next);
    if (focus) saveTaskSteps(db, focus.id, next).catch(() => undefined);
  };

  const updatePrefs = (patch: Partial<CalmPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveCalmPrefs(db, next).catch(() => undefined);
  };

  const fraction = activeTimer ? timerFraction(activeTimer, nowMs) : 0;
  const over = activeTimer ? isTimerOver(activeTimer, nowMs) : false;
  const progress = stepsProgress(steps);
  const nextStep = currentStepIndex(steps);
  const openCount = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Geri dön">
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>

        <Text style={styles.heading} accessibilityRole="header">
          Sakin
        </Text>
        <Text style={styles.sub}>Şimdilik tek bir şeye bakıyoruz.</Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={p.accent} />
          </View>
        ) : (
          <>
            {notice && (
              <View style={styles.noticeCard}>
                <Text style={styles.body}>{notice}</Text>
              </View>
            )}

            {/* Gün enerjisi */}
            {energy === null ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Bugün enerjin nasıl?</Text>
                <Text style={styles.muted}>Seçimine göre sana en uygun işi öne alırım. İstediğin zaman değiştirebilirsin.</Text>
                {ENERGY_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    disabled={busy}
                    onPress={() => chooseEnergy(o.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Enerji ${o.label}. ${o.hint}`}
                    style={({ pressed }) => [styles.optionBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.optionLabel}>{o.label}</Text>
                    <Text style={styles.muted}>{o.hint}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.energyRow}>
                <Text style={styles.muted}>Enerji</Text>
                {ENERGY_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    disabled={busy}
                    onPress={() => chooseEnergy(o.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: energy === o.value }}
                    accessibilityLabel={`Enerji ${o.label}`}
                    style={[styles.pill, energy === o.value && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, energy === o.value && styles.pillTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Zor gün */}
            {hardDay ? (
              <View style={styles.card}>
                <Text style={styles.body}>Zor gün modu açık: planda yalnızca hafif işler var.</Text>
                <Pressable disabled={busy} onPress={toggleHardDay} accessibilityRole="button" style={styles.linkBtn}>
                  <Text style={styles.link}>Normal güne dön</Text>
                </Pressable>
              </View>
            ) : shouldOfferHardDay(energy, hardDay) ? (
              <View style={styles.card}>
                <Text style={styles.body}>Enerjin düşük. Bugünü hafifletelim mi?</Text>
                <Text style={styles.muted}>Planda en fazla iki hafif iş kalır; gerisi ertelenir ve hiçbiri kaçırılmış sayılmaz.</Text>
                <Pressable disabled={busy} onPress={toggleHardDay} accessibilityRole="button" style={styles.secondaryBtn}>
                  <Text style={styles.secondaryText}>Zor gün modunu aç</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Tek görev */}
            {focus ? (
              <View style={styles.focusCard}>
                <Text style={styles.label}>ŞİMDİ</Text>
                <Text style={styles.focusTitle} accessibilityRole="header">
                  {focus.title}
                </Text>
                <Text style={styles.muted}>
                  ~{formatDuration(focus.estimatedDuration)} · {WEIGHT_LABEL[focus.cognitiveWeight]}
                </Text>
                {!activeTimer && <Text style={styles.body}>{focusHint(focus, energy)}</Text>}

                {activeTimer ? (
                  <View style={styles.timerBox}>
                    <View style={styles.discArea} accessible accessibilityLabel={`Kalan süre ${formatClock(remainingMs(activeTimer, nowMs))}`}>
                      <View
                        style={{
                          width: discSize(fraction, DISC_MAX),
                          height: discSize(fraction, DISC_MAX),
                          borderRadius: DISC_MAX,
                          backgroundColor: p.accent,
                          opacity: 0.85,
                        }}
                      />
                    </View>
                    <Text style={styles.clock}>{formatClock(remainingMs(activeTimer, nowMs))}</Text>
                    {over ? (
                      <>
                        <Text style={styles.body}>{timerOverText(activeTimer.kind)}</Text>
                        <Pressable disabled={busy} onPress={() => start('FOCUS')} accessibilityRole="button" style={styles.primaryBtn}>
                          <Text style={styles.primaryText}>{FOCUS_MINUTES} dakika daha</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={styles.muted}>Sadece bununla ilgileniyorsun. Gerisi bekleyebilir.</Text>
                    )}
                    <Pressable disabled={busy} onPress={() => setFinishing(focus)} accessibilityRole="button" style={styles.secondaryBtn}>
                      <Text style={styles.secondaryText}>Bitirdim</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={leave} accessibilityRole="button" style={styles.linkBtn}>
                      <Text style={styles.link}>Burada bırakıyorum</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Pressable
                      disabled={busy}
                      onPress={() => start('MICRO')}
                      accessibilityRole="button"
                      accessibilityLabel={`Sadece ${MICRO_MINUTES} dakika başla`}
                      style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.primaryText}>Sadece {MICRO_MINUTES} dakika</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => start('FOCUS')} accessibilityRole="button" style={styles.secondaryBtn}>
                      <Text style={styles.secondaryText}>{FOCUS_MINUTES} dakika odak</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => setFinishing(focus)} accessibilityRole="button" style={styles.linkBtn}>
                      <Text style={styles.link}>Zaten bitti</Text>
                    </Pressable>
                    {focus.status === 'PENDING' && openCount > 1 && (
                      <Pressable
                        disabled={busy}
                        onPress={() => setSkip((s) => [...s, focus.id])}
                        accessibilityRole="button"
                        style={styles.linkBtn}
                      >
                        <Text style={styles.link}>Başka bir iş göster</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {/* Adımlar */}
                <View style={styles.divider} />
                {steps.length === 0 ? (
                  <Pressable
                    disabled={busy}
                    onPress={() => updateSteps(suggestSteps(focus.title, focus.estimatedDuration))}
                    accessibilityRole="button"
                    style={needsSplit(focus, energy) ? styles.secondaryBtn : styles.linkBtn}
                  >
                    <Text style={needsSplit(focus, energy) ? styles.secondaryText : styles.link}>Adımlara böl</Text>
                  </Pressable>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    <Text style={styles.label}>
                      ADIMLAR · {progress.done}/{progress.total}
                    </Text>
                    {steps.map((s, i) => (
                      <View key={`${i}-${s.text}`} style={[styles.stepRow, i === nextStep && styles.stepNext]}>
                        <Pressable
                          onPress={() => updateSteps(toggleStep(steps, i))}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: s.done }}
                          accessibilityLabel={s.text}
                          style={styles.stepMain}
                        >
                          <View style={[styles.box, s.done && styles.boxOn]}>{s.done && <Text style={styles.tick}>✓</Text>}</View>
                          <Text style={[styles.stepText, s.done && styles.stepDone]}>{s.text}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => updateSteps(removeStep(steps, i))}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Adımı sil: ${s.text}`}
                          style={styles.stepRemove}
                        >
                          <Text style={styles.muted}>✕</Text>
                        </Pressable>
                      </View>
                    ))}
                    <View style={styles.addRow}>
                      <TextInput
                        value={newStepText}
                        onChangeText={setNewStepText}
                        placeholder="Yeni adım"
                        placeholderTextColor={p.textMuted}
                        maxLength={80}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          updateSteps(addStep(steps, newStepText));
                          setNewStepText('');
                        }}
                        style={styles.input}
                      />
                      <Pressable
                        onPress={() => {
                          updateSteps(addStep(steps, newStepText));
                          setNewStepText('');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Adımı ekle"
                        style={styles.addBtn}
                      >
                        <Text style={styles.secondaryText}>Ekle</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Şu an açık bir iş yok</Text>
                <Text style={styles.body}>Dinlenmek de plan. İş eklemek istersen ana ekrandan ekleyebilirsin.</Text>
                <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.secondaryBtn}>
                  <Text style={styles.secondaryText}>Ana ekrana dön</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.week}>{weekLine(weekStarts)}</Text>

            {/* Görünüm */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Görünüm</Text>
              <Text style={styles.muted}>Bu ekranı gözüne ve sinirlerine rahat gelecek şekilde ayarla.</Text>
              <Text style={styles.label}>YAZI BOYUTU</Text>
              <View style={styles.sizeRow}>
                {TEXT_SIZES.map((s) => (
                  <Pressable
                    key={s.value}
                    onPress={() => updatePrefs({ textSize: s.value })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: prefs.textSize === s.value }}
                    style={[styles.pill, prefs.textSize === s.value && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, prefs.textSize === s.value && styles.pillTextOn]}>{s.label}</Text>
                  </Pressable>
                ))}
              </View>
              <SwitchRow
                styles={styles}
                palette={p}
                label="Geniş satır aralığı"
                hint="Yazılar daha ferah durur"
                value={prefs.spacious}
                onChange={(v) => updatePrefs({ spacious: v })}
              />
              <SwitchRow
                styles={styles}
                palette={p}
                label="Yumuşak renkler"
                hint="Parlak renk ve sert karşıtlık yok"
                value={prefs.calmColors}
                onChange={(v) => updatePrefs({ calmColors: v })}
              />
              <SwitchRow
                styles={styles}
                palette={p}
                label="Sessiz mod"
                hint="Süre bitince titreşim olmaz"
                value={prefs.quiet}
                onChange={(v) => updatePrefs({ quiet: v })}
              />
            </View>
          </>
        )}
      </ScrollView>

      <EnergyCheckModal taskTitle={finishing?.title ?? null} onSelect={finish} onClose={() => setFinishing(null)} />
    </SafeAreaView>
  );
}

function SwitchRow({
  styles,
  palette,
  label,
  hint,
  value,
  onChange,
}: {
  styles: ReturnType<typeof makeStyles>;
  palette: CalmPalette;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{label}</Text>
        <Text style={styles.muted}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: palette.border, true: palette.accent }}
        thumbColor={palette.text}
      />
    </View>
  );
}

/** Renkler ve yazı boyutu ayara göre değiştiği için stiller her ayar değişiminde yeniden kurulur. */
function makeStyles(p: CalmPalette, prefs: CalmPrefs) {
  const text = (base: number, weight?: '600' | '700') => {
    const fontSize = scaleFont(base, prefs.textSize);
    return { fontSize, lineHeight: lineHeightFor(fontSize, prefs.spacious), ...(weight ? { fontWeight: weight } : {}) };
  };
  const button = { minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center' as const, justifyContent: 'center' as const };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.lg },
    loading: { paddingTop: 60, alignItems: 'center' },
    back: { color: p.accent, ...text(16) },
    heading: { color: p.text, ...text(30, '700') },
    sub: { color: p.textMuted, ...text(16) },
    card: { backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: p.border, padding: spacing.lg, gap: spacing.md },
    noticeCard: { backgroundColor: p.accentSoft, borderRadius: radius.lg, padding: spacing.lg },
    focusCard: { backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: p.accent, padding: spacing.lg, gap: spacing.md },
    cardTitle: { color: p.text, ...text(19, '700') },
    label: { color: p.textMuted, ...text(12, '700'), letterSpacing: 1 },
    focusTitle: { color: p.text, ...text(26, '700') },
    body: { color: p.text, ...text(16) },
    muted: { color: p.textMuted, ...text(14) },
    pressed: { opacity: 0.7 },
    optionBtn: { backgroundColor: p.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, padding: spacing.lg, gap: 2, minHeight: 56 },
    optionLabel: { color: p.text, ...text(17, '700') },
    energyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    sizeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    pill: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: p.border, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    pillOn: { backgroundColor: p.accentSoft, borderColor: p.accent },
    pillText: { color: p.textMuted, ...text(14, '600') },
    pillTextOn: { color: p.text },
    actions: { gap: spacing.sm },
    primaryBtn: { ...button, backgroundColor: p.accent },
    primaryText: { color: p.bg, ...text(18, '700') },
    secondaryBtn: { ...button, borderWidth: 1, borderColor: p.accent, backgroundColor: p.accentSoft },
    secondaryText: { color: p.text, ...text(16, '600') },
    linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    link: { color: p.accent, ...text(15, '600') },
    timerBox: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    discArea: { width: DISC_MAX, height: DISC_MAX, alignItems: 'center', justifyContent: 'center' },
    clock: { color: p.text, ...text(40, '700') },
    divider: { height: 1, backgroundColor: p.border },
    stepRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
    stepNext: { borderColor: p.accent, backgroundColor: p.accentSoft },
    stepMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.md },
    stepRemove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    stepText: { flex: 1, color: p.text, ...text(16) },
    stepDone: { color: p.textMuted, textDecorationLine: 'line-through' },
    box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.good, borderColor: p.good },
    tick: { color: p.bg, fontSize: 18, fontWeight: '700' },
    addRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    input: { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, backgroundColor: p.surfaceAlt, color: p.text, paddingHorizontal: spacing.md, ...text(16) },
    addBtn: { ...button, borderWidth: 1, borderColor: p.accent, backgroundColor: p.accentSoft },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
    week: { color: p.textMuted, ...text(14), textAlign: 'center' },
  });
}
