import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Damacana } from '../components/Damacana';
import { WaterIcon } from '../components/WaterIcon';
import { colors, radius, spacing } from '../constants/theme';
import type { MealKind, MealLog, WaterLog } from '../database/types';
import { FOOD_GROUPS, estimateMeal, groupLabel } from '../services/foodTable';
import { formatClock, formatDayTitle } from '../services/format';
import { addDrink, addMeal, addWater, loadDayLogs, loadDayNutrition, removeMeal, removeWater } from '../services/nutrition';
import {
  DRINK_PRESETS,
  MEAL_KINDS,
  WATER_PRESETS,
  formatKcal,
  formatWater,
  mealKindLabel,
  nutritionDay,
  suggestMealKind,
  type DayNutrition,
} from '../services/nutritionLogic';
import { damacanaPercent } from '../services/damacana';
import { drinkIcon, groupIcon, mealIcon } from '../services/nutritionIcons';
import { getNutritionOptions } from '../services/nutritionSettings';
import { refreshReminders } from '../services/reminderSync';
import type { NutritionOptions } from '../services/nutrition';
import { waterKindForMl } from '../services/waterIcon';

const AGO_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Şimdi' },
  { minutes: 30, label: '30 dk önce' },
  { minutes: 60, label: '1 sa önce' },
  { minutes: 120, label: '2 sa önce' },
  { minutes: 180, label: '3 sa önce' },
];

const fmtQty = (q: number): string => (Number.isInteger(q) ? String(q) : q.toFixed(1).replace('.', ','));

type Row =
  | { type: 'water'; at: string; log: WaterLog }
  | { type: 'meal'; at: string; log: MealLog };

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [opts, setOpts] = useState<NutritionOptions>({ waterGoalMl: 2000, kcalTarget: null });
  const [n, setN] = useState<DayNutrition | null>(null);
  const [logs, setLogs] = useState<{ water: WaterLog[]; meals: MealLog[] }>({ water: [], meals: [] });

  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<MealKind>(() => suggestMealKind(new Date()));
  const [note, setNote] = useState('');
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [kcalText, setKcalText] = useState<string | null>(null);
  const [ago, setAgo] = useState(0);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const t = new Date();
    setNow(t);
    const o = await getNutritionOptions();
    setOpts(o);
    const day = nutritionDay(t);
    setN(await loadDayNutrition(db, t, o, day));
    setLogs(await loadDayLogs(db, day));
    // Su hedefine ulaşıldıysa günün su hatırlatmaları sessizce kalkar (hata verirse atlanır)
    refreshReminders(db, t).catch(() => undefined);
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

  // ── Form: yazıdan tahmin ──
  const estimate = useMemo(() => estimateMeal(note), [note]);
  const groupOn = (id: string): boolean => (id in manual ? manual[id] : (estimate.groups as string[]).includes(id));
  const selectedGroups = FOOD_GROUPS.filter((g) => groupOn(g.id)).map((g) => g.id as string);
  const kcalShown = kcalText !== null ? kcalText : estimate.kcal !== null ? String(estimate.kcal) : '';

  const resetForm = () => {
    setNote('');
    setManual({});
    setKcalText(null);
    setAgo(0);
    setKind(suggestMealKind(new Date()));
  };

  const saveMeal = () => {
    const text = note.trim();
    if (!text && selectedGroups.length === 0 && kcalShown.trim() === '') {
      Alert.alert('Boş kayıt', 'Ne yediğini yaz ya da bir grup seç.');
      return;
    }
    let kcal: number | null = null;
    if (kcalShown.trim() !== '') {
      const v = Number(kcalShown.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > 6000) {
        Alert.alert('Kalori geçersiz', '0 ile 6000 arasında bir sayı yaz ya da boş bırak.');
        return;
      }
      kcal = Math.round(v);
    }
    void run(async () => {
      await addMeal(db, new Date(), { kind, note: text, groups: selectedGroups, kcal, minutesAgo: ago });
      resetForm();
      setFormOpen(false);
    });
  };

  const confirmDelete = (title: string, onYes: () => Promise<void>) => {
    Alert.alert('Silinsin mi?', title, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void run(onYes) },
    ]);
  };

  const rows: Row[] = useMemo(
    () =>
      [
        ...logs.water.map((log): Row => ({ type: 'water', at: log.loggedAt, log })),
        ...logs.meals.map((log): Row => ({ type: 'meal', at: log.eatenAt, log })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [logs]
  );

  const drinkCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of logs.meals) {
      if (m.kind !== 'ICECEK') continue;
      for (const p of DRINK_PRESETS) if (m.note === p.note) c[p.id] = (c[p.id] ?? 0) + 1;
    }
    return c;
  }, [logs]);

  const lastWater = logs.water.length > 0 ? logs.water[logs.water.length - 1] : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>

        {loading || !n ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Su ve yemek</Text>
            <Text style={styles.sub}>{formatDayTitle(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < 4 ? 1 : 0)))}</Text>

            <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
              <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
              <Text style={styles.coachText}>{n.aura}</Text>
            </View>
            <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
              <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS · zaman ve düzen</Text>
              {n.kronos.map((line) => (
                <Text key={line} style={styles.coachText}>
                  {line}
                </Text>
              ))}
            </View>

            {/* ───── Su ───── */}
            <Text style={styles.section}>Su</Text>
            <View style={styles.card}>
              <View style={styles.jugRow}>
                <Damacana ratio={n.waterRatio} size={120} />
                <View style={styles.jugInfo}>
                  <Text style={styles.big}>{formatWater(n.waterMl)}</Text>
                  <Text style={styles.muted}>hedef {formatWater(n.waterGoalMl)}</Text>
                  <Text style={styles.jugPercent}>%{damacanaPercent(n.waterRatio)}</Text>
                  <Text style={styles.muted}>
                    {n.waterLeftMl <= 0 ? 'Hedef tamam 🎉' : `Hedefe ${formatWater(n.waterLeftMl)} kaldı`}
                  </Text>
                </View>
              </View>
              <View style={styles.waterRow}>
                {WATER_PRESETS.map((p) => (
                  <Pressable
                    key={p.ml}
                    disabled={busy}
                    onPress={() => void run(async () => void (await addWater(db, new Date(), p.ml)))}
                    style={styles.waterTile}
                    accessibilityLabel={`${p.label} ${p.ml} mililitre su ekle`}
                  >
                    <View style={styles.waterIconBox}>
                      <WaterIcon kind={waterKindForMl(p.ml)} size={46} />
                    </View>
                    <Text style={styles.waterLabel} numberOfLines={1}>
                      {p.label}
                    </Text>
                    <Text style={styles.waterMl}>+{p.ml} ml</Text>
                  </Pressable>
                ))}
              </View>
              {lastWater && (
                <Pressable disabled={busy} onPress={() => void run(() => removeWater(db, lastWater.id))} hitSlop={8}>
                  <Text style={styles.link}>Son su kaydını geri al ({lastWater.amountMl} ml)</Text>
                </Pressable>
              )}
              <Text style={styles.hint}>Hedefi Ayarlar'dan değiştirebilirsin. İhtiyaç kişiden kişiye değişir.</Text>
            </View>

            {/* ───── İçecek ───── */}
            <Text style={styles.section}>Çay, kahve ve diğer içecekler</Text>
            <View style={styles.card}>
              <View style={styles.chipRow}>
                {DRINK_PRESETS.map((p) => (
                  <Pressable key={p.id} disabled={busy} onPress={() => void run(async () => void (await addDrink(db, new Date(), p.id)))} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {drinkIcon(p.id)} + {p.label}
                      {drinkCounts[p.id] ? ` · ${drinkCounts[p.id]}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>Şekerli içecek yaklaşık 140 kcal sayılır. Kayıtlardan silebilirsin.</Text>
            </View>

            {/* ───── Yemek ekle ───── */}
            <Text style={styles.section}>Yemek</Text>
            {!formOpen ? (
              <Pressable onPress={() => setFormOpen(true)} style={styles.addBtn}>
                <Text style={styles.addBtnText}>+ Yemek ekle</Text>
              </Pressable>
            ) : (
              <View style={styles.card}>
                <View style={styles.chipRow}>
                  {MEAL_KINDS.map((m) => (
                    <Pressable key={m.id} onPress={() => setKind(m.id)} style={[styles.chip, kind === m.id && styles.chipOn]}>
                      <Text style={[styles.chipText, kind === m.id && styles.chipTextOn]}>
                        {mealIcon(m.id)} {m.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Ne yedin? Örn: 2 yumurta, 3 dilim ekmek, çay"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  multiline
                  maxLength={200}
                />

                {estimate.items.length > 0 && (
                  <View style={{ gap: 2 }}>
                    <Text style={styles.hint}>
                      Tahmin:{' '}
                      {estimate.items.map((i) => `${i.name} ×${fmtQty(i.qty)}${i.assumed ? '*' : ''} ≈${i.kcal}`).join(', ')}
                    </Text>
                    {estimate.items.some((i) => i.assumed) && (
                      <Text style={styles.hint}>* Miktar yazmadığın için tipik bir porsiyon varsaydım; sayıyı değiştirebilirsin.</Text>
                    )}
                  </View>
                )}
                {note.trim() !== '' && estimate.items.length === 0 && (
                  <Text style={styles.hint}>Bu yemeği tanıyamadım. İstersen kaloriyi kendin yazabilir ya da boş bırakabilirsin.</Text>
                )}

                <Text style={styles.label}>Kalori (yaklaşık, isteğe bağlı)</Text>
                <TextInput
                  value={kcalShown}
                  onChangeText={(t) => setKcalText(t.replace(/[^0-9.,]/g, ''))}
                  placeholder="Boş bırakabilirsin"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  style={[styles.input, { minHeight: 0 }]}
                  maxLength={5}
                />

                <Text style={styles.label}>Ne zaman?</Text>
                <View style={styles.chipRow}>
                  {AGO_CHOICES.map((a) => (
                    <Pressable key={a.minutes} onPress={() => setAgo(a.minutes)} style={[styles.chip, ago === a.minutes && styles.chipOn]}>
                      <Text style={[styles.chipText, ago === a.minutes && styles.chipTextOn]}>{a.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>İçinde neler var? (yazdıkça otomatik işaretlenir)</Text>
                <View style={styles.chipRow}>
                  {FOOD_GROUPS.map((g) => {
                    const on = groupOn(g.id);
                    return (
                      <Pressable key={g.id} onPress={() => setManual((m) => ({ ...m, [g.id]: !on }))} style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {groupIcon(g.id)} {g.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.rowEnd}>
                  <Pressable
                    onPress={() => {
                      resetForm();
                      setFormOpen(false);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>Vazgeç</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={saveMeal} style={styles.saveBtn}>
                    <Text style={styles.saveBtnText}>Kaydet</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* ───── Kalori ───── */}
            {n.kcalTotal !== null && (
              <>
                <Text style={styles.section}>Kalori (yaklaşık)</Text>
                <View style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.big}>≈{formatKcal(n.kcalTotal)}</Text>
                    {n.kcalTarget !== null && <Text style={styles.muted}>hedef {formatKcal(n.kcalTarget)}</Text>}
                  </View>
                  {n.kcalTarget !== null && (
                    <>
                      <View style={styles.track}>
                        <View style={[styles.fill, { backgroundColor: colors.kronos, width: `${Math.min(100, Math.round((n.kcalTotal / n.kcalTarget) * 100))}%` }]} />
                      </View>
                      <Text style={styles.hint}>
                        {n.kcalLeft !== null && n.kcalLeft >= 0
                          ? `Hedefe yaklaşık ${formatKcal(n.kcalLeft)} kaldı.`
                          : 'Bugünkü kayıtlar hedefinin biraz üstünde. Tek gün bütün resmi belirlemez.'}
                      </Text>
                    </>
                  )}
                  <Text style={styles.hint}>
                    Sayılar tipik porsiyonlardan tahmindir, kesin ölçüm değildir. Kayıt eksikse toplam gerçeğin altında kalır.
                    {opts.kcalTarget === null ? " İstersen Ayarlar'dan kendine bir günlük hedef koyabilirsin." : ''}
                  </Text>
                </View>
              </>
            )}

            {/* ───── Gruplar ───── */}
            {Object.keys(n.groupCounts).length > 0 && (
              <>
                <Text style={styles.section}>Bugün neler var</Text>
                <View style={styles.card}>
                  <View style={styles.chipRow}>
                    {FOOD_GROUPS.filter((g) => (n.groupCounts[g.id] ?? 0) > 0).map((g) => (
                      <View key={g.id} style={[styles.chip, styles.chipStatic]}>
                        <Text style={styles.chipText}>
                          {groupIcon(g.id)} {g.label} · {n.groupCounts[g.id]}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* ───── Kayıtlar ───── */}
            <Text style={styles.section}>Bugünkü kayıtlar</Text>
            <View style={styles.card}>
              {rows.length === 0 && <Text style={styles.hint}>Henüz kayıt yok.</Text>}
              {rows.map((r) => {
                const time = formatClock(new Date(r.at));
                if (r.type === 'water') {
                  return (
                    <View key={r.log.id} style={styles.logRow}>
                      <Text style={styles.logTime}>{time}</Text>
                      <View style={styles.logIcon}>
                        <WaterIcon kind={waterKindForMl(r.log.amountMl)} size={26} />
                      </View>
                      <Text style={styles.logText}>Su · {r.log.amountMl} ml</Text>
                      <Pressable hitSlop={10} disabled={busy} onPress={() => confirmDelete(`Su · ${r.log.amountMl} ml`, () => removeWater(db, r.log.id))}>
                        <Text style={styles.del}>✕</Text>
                      </Pressable>
                    </View>
                  );
                }
                const m = r.log;
                const label = m.note ? `${mealKindLabel(m.kind)} · ${m.note}` : `${mealKindLabel(m.kind)} · ${m.groups.map(groupLabel).join(', ') || 'kayıt'}`;
                return (
                  <View key={m.id} style={styles.logRow}>
                    <Text style={styles.logTime}>{time}</Text>
                    <Text style={styles.logEmoji}>{mealIcon(m.kind)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logText}>{label}</Text>
                      {m.kcal !== null && <Text style={styles.logSub}>≈{formatKcal(m.kcal)}</Text>}
                    </View>
                    <Pressable hitSlop={10} disabled={busy} onPress={() => confirmDelete(label, () => removeMeal(db, m.id))}>
                      <Text style={styles.del}>✕</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Text style={styles.hint}>
              Bu kayıtlar yalnızca telefonda durur. Yapay zekâya, yalnızca Ayarlar'da gün analizi paylaşımını açtıysan, toplu bir özet (su miktarı, yemek sayısı, yaklaşık kalori) gider; yazdığın yemek adları asla gitmez.
            </Text>
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
  big: { color: colors.text, fontSize: 28, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 13 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.lg },
  jugRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  jugInfo: { flex: 1, gap: 4 },
  jugPercent: { color: colors.aura, fontSize: 22, fontWeight: '800' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.aura },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipStatic: { backgroundColor: colors.auraSoft, borderColor: colors.aura },
  chipOn: { backgroundColor: colors.auraSoft, borderColor: colors.aura },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: colors.aura },
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
    minHeight: 48,
  },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  link: { color: colors.kronos, fontSize: 13, fontWeight: '600' },
  addBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  addBtnText: { color: colors.aura, fontSize: 14, fontWeight: '700' },
  saveBtn: { backgroundColor: colors.aura, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: 10 },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: '800' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logTime: { color: colors.textMuted, fontSize: 12, fontWeight: '700', width: 42 },
  logText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  logIcon: { width: 26, alignItems: 'center' },
  logEmoji: { fontSize: 20, width: 26, textAlign: 'center' },
  waterRow: { flexDirection: 'row', gap: spacing.sm },
  waterTile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  waterIconBox: { height: 48, justifyContent: 'flex-end', alignItems: 'center' },
  waterLabel: { color: colors.text, fontSize: 11, fontWeight: '700' },
  waterMl: { color: colors.aura, fontSize: 12, fontWeight: '800' },
  logSub: { color: colors.textMuted, fontSize: 12 },
  del: { color: colors.textMuted, fontSize: 16, paddingHorizontal: 4 },
  done: { alignItems: 'center', paddingVertical: spacing.md },
  doneText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
