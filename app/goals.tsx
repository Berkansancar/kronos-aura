import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { formatDuration } from '../services/format';
import { loadGoalState, type GoalState } from '../services/goals';
import {
  ACTIVITY_LEVELS,
  BEDTIME_CHOICES,
  BODY_DISCLAIMER,
  FIRST_MEAL_CHOICES,
  FOCUS_CHOICES,
  LAST_MEAL_CHOICES,
  PACES,
  SCREEN_LIMIT_CHOICES,
  ageOf,
  estimateNeed,
  hhmm,
  planCalories,
  validateBodyInput,
  type ActivityLevel,
  type BodyProfile,
  type GoalSettings,
  type GoalStatus,
  type KcalPlan,
  type Pace,
  type Sex,
} from '../services/goalsLogic';
import { clearBody, getBody, getGoalBundle, saveBody, saveGoals } from '../services/goalsSettings';
import { replanDay } from '../services/planner';
import { refreshReminders } from '../services/reminderSync';
import { askNotificationPermission } from '../services/routineReminders';
import { KCAL_TARGET_MAX, KCAL_TARGET_MIN, WATER_GOALS, clockOfMinute, formatKcal, formatWater } from '../services/nutritionLogic';
import { saveKcalTarget, setWaterGoal } from '../services/nutritionSettings';
import { getWork, saveWork } from '../services/workSettings';
import { DEFAULT_WORK, WORK_DAYS, WORK_END_CHOICES, WORK_START_CHOICES, workSummary, type WorkSchedule } from '../services/workLogic';

const STATUS_COLOR: Record<GoalStatus, string> = {
  DONE: colors.aura,
  ON_TRACK: colors.kronos,
  WAITING: colors.textMuted,
  WATCH: colors.warning,
};
const STATUS_LABEL: Record<GoalStatus, string> = {
  DONE: 'Tamam',
  ON_TRACK: 'Yolunda',
  WAITING: 'Bekliyor',
  WATCH: 'Dikkat',
};

type KcalMode = 'manual' | 'calc' | 'weight';

/** Seçenek düğmeleri (bir tanesi seçilir; "Kapalı" ile hedef kaldırılır). */
function Choices<T extends number>({
  options,
  value,
  label,
  onPick,
  offLabel,
  tint = colors.aura,
}: {
  options: readonly T[];
  value: number | null;
  label: (v: T) => string;
  onPick: (v: T | null) => void;
  offLabel?: string;
  tint?: string;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const on = value === o;
        return (
          <Pressable key={o} onPress={() => onPick(o)} style={[styles.chip, on && { borderColor: tint, backgroundColor: colors.surface }]}>
            <Text style={[styles.chipText, on && { color: tint }]}>{label(o)}</Text>
          </Pressable>
        );
      })}
      {offLabel && (
        <Pressable onPress={() => onPick(null)} style={[styles.chip, value === null && { borderColor: colors.textMuted }]}>
          <Text style={[styles.chipText, value === null && { color: colors.text }]}>{offLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function GoalsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<GoalState | null>(null);
  const [settings, setSettings] = useState<GoalSettings | null>(null);
  const [waterGoal, setWaterGoalState] = useState(2000);
  const [kcalTarget, setKcalTargetState] = useState<number | null>(null);
  const [work, setWork] = useState<WorkSchedule>(DEFAULT_WORK);

  // Kalori hedefi formları
  const [mode, setMode] = useState<KcalMode>('manual');
  const [kcalInput, setKcalInput] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [targetKg, setTargetKg] = useState('');
  const [pace, setPace] = useState<Pace>('EASY');
  const [profile, setProfile] = useState<BodyProfile | null>(null);
  const [plan, setPlan] = useState<KcalPlan | null>(null);
  const [formMsg, setFormMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const reload = useCallback(async () => {
    const now = new Date();
    const bundle = await getGoalBundle();
    setSettings(bundle.settings);
    setWaterGoalState(bundle.waterGoalMl);
    setKcalTargetState(bundle.kcalTarget);
    setWork(await getWork(db));
    setState(await loadGoalState(db, now, bundle));
    const body = await getBody();
    setProfile(body);
    if (body) {
      setSex((s) => s ?? body.sex);
      setAge((a) => a || String(ageOf(body, now)));
      setHeight((h) => h || String(body.heightCm));
      setWeight((w) => w || String(body.weightKg));
      setActivity((a) => a ?? body.activity);
    }
    refreshReminders(db, now).catch(() => undefined);
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

  const patch = (p: Partial<GoalSettings>) => void run(async () => void (await saveGoals(p)));

  // İş saatleri değişince bugünün planı hemen yeniden dizilir
  const applyWork = (p: Partial<WorkSchedule>) =>
    void run(async () => {
      await saveWork(db, p);
      await replanDay(db, new Date(), 'MANUAL');
    });

  const toggleReminders = (on: boolean) =>
    void run(async () => {
      if (on && !(await askNotificationPermission())) {
        Alert.alert(
          'Bildirim izni gerekli',
          'Hatırlatmaların gelmesi için telefonun ayarlarından bu uygulamanın bildirimlerine izin vermen gerekir. Sonra anahtarı yeniden açabilirsin.'
        );
        await saveGoals({ reminders: false });
        return;
      }
      await saveGoals({ reminders: on });
    });

  const applyKcal = (value: string) =>
    run(async () => {
      const r = await saveKcalTarget(value);
      if (!r.ok) setFormMsg({ text: r.message, ok: false });
      else {
        setKcalInput(r.value === null ? '' : String(r.value));
        setFormMsg({ text: r.value === null ? 'Kalori hedefi kapatıldı.' : `Hedef kaydedildi: ${formatKcal(r.value)}.`, ok: true });
      }
    });

  const compute = () => {
    const v = validateBodyInput({ sex, age, heightCm: height, weightKg: weight, activity }, new Date());
    if (!v.ok) {
      setPlan(null);
      setFormMsg({ text: v.message, ok: false });
      return;
    }
    let target: number | null = null;
    if (mode === 'weight') {
      target = Number(targetKg.trim().replace(',', '.'));
      if (!Number.isFinite(target)) {
        setPlan(null);
        setFormMsg({ text: 'Hedef kiloyu kg olarak yaz.', ok: false });
        return;
      }
    }
    const result = planCalories(v.profile, target, mode === 'weight' ? pace : 'MAINTAIN', new Date());
    setPlan(result);
    setFormMsg(result.ok ? null : { text: result.message, ok: false });
    void saveBody(v.profile).then(() => setProfile(v.profile));
  };

  const need = profile ? estimateNeed(profile, new Date()) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>

        {loading || !state || !settings ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Hedefler</Text>
            <Text style={styles.sub}>
              Bugün {state.progress.onTrack}/{state.progress.total} hedef yolunda
            </Text>

            <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
              <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
              <Text style={styles.coachText}>{state.progress.aura}</Text>
            </View>
            <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
              <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS</Text>
              {state.progress.kronos.map((l) => (
                <Text key={l} style={styles.coachText}>
                  {l}
                </Text>
              ))}
            </View>

            {/* ───── Bugünkü hedefler ───── */}
            <Text style={styles.section}>Bugünkü hedefler</Text>
            <View style={styles.card}>
              {state.progress.items.map((it) => (
                <View key={it.id} style={{ gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemTitle}>{it.title}</Text>
                    <Text style={[styles.badge, { color: STATUS_COLOR[it.status] }]}>{STATUS_LABEL[it.status]}</Text>
                  </View>
                  <Text style={styles.itemValue}>
                    {it.value} <Text style={styles.muted}>/ {it.target}</Text>
                  </Text>
                  {it.ratio !== null && (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.round(it.ratio * 100)}%`, backgroundColor: STATUS_COLOR[it.status] }]} />
                    </View>
                  )}
                  <Text style={styles.hint}>{it.line}</Text>
                </View>
              ))}
            </View>

            {/* ───── Zaman dengesi ───── */}
            <Text style={styles.section}>Zaman dengesi</Text>
            <View style={styles.card}>
              <View style={styles.tiles}>
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{formatDuration(state.balance.doneMinutes)}</Text>
                  <Text style={styles.tileLabel}>biten iş</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{formatDuration(state.balance.freeTotal)}</Text>
                  <Text style={styles.tileLabel}>boş pencere</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{formatDuration(state.balance.driftMinutes)}</Text>
                  <Text style={styles.tileLabel}>akıp giden</Text>
                </View>
              </View>
              {state.balance.freeWindows.length > 0 && (
                <View style={{ gap: 4 }}>
                  <Text style={styles.label}>Boş pencereler</Text>
                  {state.balance.freeWindows.map((w) => (
                    <Text key={w.from} style={styles.hint}>
                      {clockOfMinute(w.from)}–{clockOfMinute(w.to)} · {formatDuration(w.minutes)}
                    </Text>
                  ))}
                </View>
              )}
              <Text style={styles.coachText}>{state.balance.aura}</Text>
              {state.balance.kronos.map((l) => (
                <Text key={l} style={[styles.coachText, { color: colors.kronos }]}>
                  {l}
                </Text>
              ))}
              {state.balance.canPlan && (
                <Pressable
                  disabled={busy}
                  onPress={() => void run(async () => void (await replanDay(db, new Date(), 'MANUAL')))}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>Günü planla</Text>
                </Pressable>
              )}
              <Text style={styles.hint}>
                "Kayıt dışı" zaman (yemek, yol, dinlenme gibi) olağandır; burada işe ya da akıp giden zamana yazılmayanı görürsün
                ({formatDuration(state.balance.unrecordedMinutes)}).
              </Text>
            </View>

            {/* ───── Düzenle ───── */}
            <Text style={styles.section}>Hedeflerini düzenle</Text>

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>İş saatleri</Text>
                <Switch
                  value={work.enabled}
                  disabled={busy}
                  onValueChange={(on) => applyWork({ enabled: on })}
                  trackColor={{ true: colors.aura, false: colors.border }}
                />
              </View>
              <Text style={styles.muted}>
                {work.enabled
                  ? `Çalışma saatlerin: ${workSummary(work)}. Planlayıcı, "iş vaktinde de yapılabilir" demediğin işleri bu saatlere koymaz.`
                  : 'Gündüz çalışıyorsan aç: planlayıcı işleri iş saatlerinin dışına yerleştirsin, iş vaktinde yapılabilenleri ayrıca işaretlersin.'}
              </Text>
              {work.enabled && (
                <>
                  <Text style={styles.label}>Başlangıç</Text>
                  <Choices
                    options={WORK_START_CHOICES}
                    value={work.startMin}
                    label={hhmm}
                    onPick={(v) => v !== null && applyWork({ startMin: v })}
                  />
                  <Text style={styles.label}>Bitiş</Text>
                  <Choices
                    options={WORK_END_CHOICES}
                    value={work.endMin}
                    label={hhmm}
                    onPick={(v) => v !== null && applyWork({ endMin: v })}
                  />
                  <Text style={styles.label}>Günler</Text>
                  <View style={styles.chipRow}>
                    {WORK_DAYS.map((d) => {
                      const on = work.days.includes(d.day);
                      return (
                        <Pressable
                          key={d.day}
                          disabled={busy}
                          onPress={() => {
                            // En az bir iş günü kalmalı
                            if (on && work.days.length <= 1) return;
                            applyWork({ days: on ? work.days.filter((x) => x !== d.day) : [...work.days, d.day] });
                          }}
                          style={[styles.chip, on && { borderColor: colors.aura, backgroundColor: colors.surface }]}
                        >
                          <Text style={[styles.chipText, on && { color: colors.aura }]}>{d.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>Su</Text>
              <Choices
                options={WATER_GOALS}
                value={waterGoal}
                label={formatWater}
                onPick={(v) => v !== null && void run(async () => setWaterGoal(v))}
              />
              {need && (
                <Pressable disabled={busy} onPress={() => void run(async () => setWaterGoal(need.waterMl))} hitSlop={6}>
                  <Text style={styles.link}>Kilomdan öner: {formatWater(need.waterMl)}</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>Kalori</Text>
              <Text style={styles.muted}>
                {kcalTarget !== null ? `Şu anki hedef: ${formatKcal(kcalTarget)}` : 'Hedef yok (isteğe bağlı)'}
              </Text>
              <View style={styles.chipRow}>
                {(
                  [
                    ['manual', 'Kendim yazarım'],
                    ['calc', 'Hesapla'],
                    ['weight', 'Kilo hedefiyle'],
                  ] as [KcalMode, string][]
                ).map(([m, l]) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMode(m);
                      setPlan(null);
                      setFormMsg(null);
                    }}
                    style={[styles.chip, mode === m && { borderColor: colors.aura, backgroundColor: colors.surface }]}
                  >
                    <Text style={[styles.chipText, mode === m && { color: colors.aura }]}>{l}</Text>
                  </Pressable>
                ))}
              </View>

              {mode === 'manual' ? (
                <>
                  <TextInput
                    value={kcalInput}
                    onChangeText={(t) => {
                      setKcalInput(t.replace(/[^0-9.,]/g, ''));
                      setFormMsg(null);
                    }}
                    placeholder={`Örn. 2000 (${KCAL_TARGET_MIN}–${KCAL_TARGET_MAX})`}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    maxLength={5}
                    style={styles.input}
                  />
                  <View style={styles.rowEnd}>
                    {kcalTarget !== null && (
                      <Pressable disabled={busy} onPress={() => void applyKcal('')} hitSlop={8}>
                        <Text style={styles.link}>Hedefi kapat</Text>
                      </Pressable>
                    )}
                    <Pressable disabled={busy} onPress={() => void applyKcal(kcalInput)} style={styles.primaryBtn}>
                      <Text style={styles.primaryBtnText}>Kaydet</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Cinsiyet (formül için)</Text>
                  <View style={styles.chipRow}>
                    {(
                      [
                        ['F', 'Kadın'],
                        ['M', 'Erkek'],
                      ] as [Sex, string][]
                    ).map(([id, l]) => (
                      <Pressable key={id} onPress={() => setSex(id)} style={[styles.chip, sex === id && { borderColor: colors.aura, backgroundColor: colors.surface }]}>
                        <Text style={[styles.chipText, sex === id && { color: colors.aura }]}>{l}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.fieldRow}>
                    <View style={styles.field}>
                      <Text style={styles.label}>Yaş</Text>
                      <TextInput value={age} onChangeText={setAge} keyboardType="numeric" maxLength={3} style={styles.input} placeholder="30" placeholderTextColor={colors.textMuted} />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Boy (cm)</Text>
                      <TextInput value={height} onChangeText={setHeight} keyboardType="numeric" maxLength={5} style={styles.input} placeholder="170" placeholderTextColor={colors.textMuted} />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Kilo (kg)</Text>
                      <TextInput value={weight} onChangeText={setWeight} keyboardType="numeric" maxLength={5} style={styles.input} placeholder="65" placeholderTextColor={colors.textMuted} />
                    </View>
                  </View>
                  <Text style={styles.label}>Hareket düzeyi</Text>
                  <View style={styles.chipRow}>
                    {ACTIVITY_LEVELS.map((a) => (
                      <Pressable key={a.id} onPress={() => setActivity(a.id)} style={[styles.chip, activity === a.id && { borderColor: colors.aura, backgroundColor: colors.surface }]}>
                        <Text style={[styles.chipText, activity === a.id && { color: colors.aura }]}>{a.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {activity && <Text style={styles.hint}>{ACTIVITY_LEVELS.find((a) => a.id === activity)?.hint}</Text>}

                  {mode === 'weight' && (
                    <>
                      <Text style={styles.label}>Hedef kilo (kg)</Text>
                      <TextInput value={targetKg} onChangeText={setTargetKg} keyboardType="numeric" maxLength={5} style={styles.input} placeholder="60" placeholderTextColor={colors.textMuted} />
                      <Text style={styles.label}>Tempo</Text>
                      <View style={styles.chipRow}>
                        {PACES.map((p) => (
                          <Pressable key={p.id} onPress={() => setPace(p.id)} style={[styles.chip, pace === p.id && { borderColor: colors.aura, backgroundColor: colors.surface }]}>
                            <Text style={[styles.chipText, pace === p.id && { color: colors.aura }]}>{p.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={styles.hint}>{PACES.find((p) => p.id === pace)?.hint}</Text>
                    </>
                  )}

                  <Pressable onPress={compute} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>Hesapla</Text>
                  </Pressable>

                  {plan && plan.ok && (
                    <View style={styles.result}>
                      <Text style={styles.big}>{formatKcal(plan.kcal)}</Text>
                      <Text style={styles.hint}>
                        Günlük ihtiyacın yaklaşık {formatKcal(plan.tdee)} (dinlenme enerjisi {formatKcal(plan.bmr)}).
                        {plan.deltaPerDay < 0 ? ` Önerilen miktar günde yaklaşık ${formatKcal(-plan.deltaPerDay)} daha az.` : ''}
                        {plan.deltaPerDay > 0 ? ` Önerilen miktar günde yaklaşık ${formatKcal(plan.deltaPerDay)} daha fazla.` : ''}
                        {plan.weeks !== null ? ` Hedefe tahmini ${plan.weeks} hafta; vücut düz bir çizgide ilerlemez.` : ''}
                      </Text>
                      {plan.notes.map((n) => (
                        <Text key={n} style={styles.hint}>
                          • {n}
                        </Text>
                      ))}
                      <Pressable disabled={busy} onPress={() => void applyKcal(String(plan.kcal))} style={styles.primaryBtn}>
                        <Text style={styles.primaryBtnText}>Bunu hedef yap</Text>
                      </Pressable>
                    </View>
                  )}
                  <Text style={styles.hint}>{BODY_DISCLAIMER}</Text>
                  {profile && (
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        Alert.alert('Bilgilerin silinsin mi?', 'Boy, kilo ve yaş bu telefondan silinir. Kalori hedefin kalır.', [
                          { text: 'Vazgeç', style: 'cancel' },
                          {
                            text: 'Sil',
                            style: 'destructive',
                            onPress: () =>
                              void run(async () => {
                                await clearBody();
                                setSex(null);
                                setAge('');
                                setHeight('');
                                setWeight('');
                                setActivity(null);
                                setPlan(null);
                              }),
                          },
                        ])
                      }
                      hitSlop={8}
                    >
                      <Text style={styles.link}>Boy, kilo ve yaş bilgilerimi sil</Text>
                    </Pressable>
                  )}
                </>
              )}
              {formMsg && <Text style={[styles.message, { color: formMsg.ok ? colors.aura : colors.warning }]}>{formMsg.text}</Text>}
              <Text style={styles.hint}>Sayılar tahmindir. Boy, kilo ve yaş yalnızca bu telefonda durur; yapay zekâya hiçbir zaman gönderilmez.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>İlk yemek en geç</Text>
              <Choices options={FIRST_MEAL_CHOICES} value={settings.firstMealBy} label={hhmm} onPick={(v) => patch({ firstMealBy: v })} offLabel="Kapalı" />
              <Text style={styles.itemTitle}>Son yemek en geç</Text>
              <Choices options={LAST_MEAL_CHOICES} value={settings.lastMealBy} label={hhmm} onPick={(v) => patch({ lastMealBy: v })} offLabel="Kapalı" />
              <Text style={styles.hint}>Yemek kayıtlarına göre izlenir. Düzenli saatler enerjiyi ve uykuyu dengeler.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>Günlük ekran süresi sınırı</Text>
              <Choices options={SCREEN_LIMIT_CHOICES} value={settings.screenLimitMin} label={formatDuration} onPick={(v) => patch({ screenLimitMin: v })} offLabel="Kapalı" tint={colors.kronos} />
              <Text style={styles.hint}>Ekran süresi Gün analizi'nden (yalnızca Android) gelir.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>Yatış saati</Text>
              <Choices options={BEDTIME_CHOICES} value={settings.bedtime} label={hhmm} onPick={(v) => patch({ bedtime: v })} offLabel="Kapalı" tint={colors.kronos} />
              <Text style={styles.hint}>Dün geceyi uyku tahminine göre, bu geceyi saate göre izler.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.itemTitle}>Günlük dolu zaman hedefi</Text>
              <Choices options={FOCUS_CHOICES} value={settings.focusMin} label={formatDuration} onPick={(v) => patch({ focusMin: v })} offLabel="Kapalı" tint={colors.kronos} />
              <Text style={styles.hint}>Bitirdiğin işlerin toplam süresi. Dinlenme hedefe yazılmaz ama planlıysa zaman sana kalır.</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>Hedef hatırlatmaları</Text>
                  <Text style={styles.hint}>
                    Sabah uyanınca (Gün akışı'ndaki saatlerine göre) ve öğle ile ikindi saatlerinde su hatırlatması
                    (hedefe ulaşınca susar), iş saatlerin açıksa işin bitiminden 15 dk sonra "günü işaretleyelim mi?"
                    ve yatış saatine 45 dk kala hazırlık hatırlatması. Varsayılan kapalı.
                  </Text>
                </View>
                <Switch
                  value={settings.reminders}
                  onValueChange={toggleReminders}
                  trackColor={{ true: colors.aura, false: colors.border }}
                />
              </View>
            </View>

            <Text style={styles.hint}>Hedefler isteğe bağlıdır ve istediğin zaman değiştirilir ya da kapatılır. Hepsi bu telefonda durur.</Text>
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
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
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
    gap: spacing.md,
  },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  itemValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  badge: { fontSize: 12, fontWeight: '800' },
  big: { color: colors.text, fontSize: 28, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.lg },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', gap: 2 },
  tileValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  tileLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: 4 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  link: { color: colors.kronos, fontSize: 13, fontWeight: '600' },
  message: { fontSize: 13, lineHeight: 19 },
  result: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  primaryBtn: { alignSelf: 'flex-start', backgroundColor: colors.aura, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: 10 },
  primaryBtnText: { color: colors.bg, fontSize: 14, fontWeight: '800' },
  done: { alignItems: 'center', paddingVertical: spacing.md },
  doneText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
