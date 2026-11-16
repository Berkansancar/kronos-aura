import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { dayKey, parseDayKey } from '../services/activityLogic';
import {
  dayDetail,
  lockedDone,
  monthKeyOf,
  monthTitle,
  shiftMonth,
  WEEKDAY_SHORT,
} from '../services/habitCalendarLogic';
import type { Routine } from '../database/types';
import { loadHabitScreen, setMoodForDay, type HabitScreenData } from '../services/habits';
import { formatMood, MOODS, moodInfo } from '../services/moodLogic';
import { markRoutineDoneOnDay, unmarkRoutineDay } from '../services/routineFlow';
import { refreshReminders } from '../services/reminderSync';
import { CATEGORY_COLOR, routineColor, routineIcon, withAlpha } from '../services/routineLook';
import { tipOfDay } from '../services/selfCareTips';

type Tab = 'HABITS' | 'MOOD';
const LEVEL_ALPHA = [0, 0.22, 0.45, 0.7, 1];

export default function HabitsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('HABITS');
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [routineId, setRoutineId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string>(() => dayKey(new Date()));
  const [data, setData] = useState<HabitScreenData | null>(null);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dayKey(now);

  const load = useCallback(async () => {
    setData(await loadHabitScreen(db, month, new Date(), routineId));
  }, [db, month, routineId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load])
  );

  const chosen = data?.routines.find((r) => r.id === routineId) ?? null;
  const accent = chosen ? routineColor(chosen) : CATEGORY_COLOR.ZIHIN;
  const detail = data ? dayDetail(selected, data.routines, data.logs) : null;
  const selectedMood = data?.moods.find((m) => m.day === selected) ?? null;
  const selectedIsFuture = selected > today;

  const pickMood = async (v: 1 | 2 | 3 | 4 | 5) => {
    if (busy || selectedIsFuture) return;
    setBusy(true);
    try {
      await setMoodForDay(db, selected, v, new Date());
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Takvimden sonradan işaretleme: telefona bakamadığın günleri düzeltmek için
  const toggleDone = async (r: Routine, isDone: boolean) => {
    if (busy || selectedIsFuture) return;
    setBusy(true);
    try {
      if (isDone) {
        const res = await unmarkRoutineDay(db, r.id, selected);
        if (res === 'LOCKED') {
          Alert.alert('Geri alınamıyor', 'Bu, bir görev olarak tamamlanmış. Görevi "Günü işaretle" ekranından geri alabilirsin.');
        }
      } else {
        await markRoutineDoneOnDay(db, r, selected, new Date());
      }
      if (selected === today) await refreshReminders(db, new Date()).catch(() => undefined);
      await load();
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const goMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelected(next === monthKeyOf(new Date()) ? dayKey(new Date()) : `${next}-01`);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Takvim</Text>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>Bugünün küçük ipucu</Text>
          <Text style={styles.tipText}>{tipOfDay(today)}</Text>
        </View>

        <View style={styles.seg}>
          {(['HABITS', 'MOOD'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segOn]}>
              <Text style={[styles.segText, tab === t && styles.segTextOn]}>
                {t === 'HABITS' ? 'Alışkanlıklar' : 'Ruh hali'}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'HABITS' && data && data.routines.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Pressable
              onPress={() => setRoutineId(undefined)}
              style={[styles.chip, !routineId && { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}
            >
              <Text style={styles.chipText}>Hepsi</Text>
            </Pressable>
            {data.routines.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setRoutineId(r.id)}
                style={[
                  styles.chip,
                  routineId === r.id && { borderColor: routineColor(r), backgroundColor: withAlpha(routineColor(r), 0.15) },
                ]}
              >
                <Text style={styles.chipText}>
                  {routineIcon(r)} {r.title.length > 18 ? `${r.title.slice(0, 17)}…` : r.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.monthRow}>
          <Pressable onPress={() => goMonth(-1)} hitSlop={10}>
            <Text style={styles.monthArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{monthTitle(month)}</Text>
          <Pressable onPress={() => goMonth(1)} hitSlop={10} disabled={month >= monthKeyOf(new Date())}>
            <Text style={[styles.monthArrow, month >= monthKeyOf(new Date()) && { opacity: 0.25 }]}>›</Text>
          </Pressable>
        </View>

        <View style={styles.weekHead}>
          {WEEKDAY_SHORT.map((d) => (
            <Text key={d} style={styles.weekHeadText}>
              {d}
            </Text>
          ))}
        </View>

        {data &&
          data.weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((c, ci) =>
                c ? (
                  <Pressable
                    key={c.day}
                    onPress={() => setSelected(c.day)}
                    style={[
                      styles.cell,
                      tab === 'HABITS'
                        ? { backgroundColor: c.level > 0 ? withAlpha(accent, LEVEL_ALPHA[c.level]) : colors.surface }
                        : { backgroundColor: c.mood ? withAlpha(moodInfo(c.mood).color, 0.25) : colors.surface },
                      c.isToday && styles.cellToday,
                      selected === c.day && styles.cellSelected,
                      c.isFuture && { opacity: 0.35 },
                    ]}
                  >
                    {tab === 'MOOD' && c.mood ? (
                      <Text style={styles.cellEmoji}>{moodInfo(c.mood).emoji}</Text>
                    ) : (
                      <Text style={[styles.cellText, c.level >= 3 && tab === 'HABITS' && { color: colors.bg, fontWeight: '800' }]}>
                        {c.dom}
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <View key={`e${wi}-${ci}`} style={styles.cellEmpty} />
                )
              )}
            </View>
          ))}

        {tab === 'HABITS' && data && (
          <>
            <View style={styles.stats}>
              <Stat value={`${data.summary.doneDays}`} label={`gün · bu ay`} />
              <Stat value={`${data.summary.currentStreak}`} label="gün seri" />
              <Stat value={`${data.summary.bestStreak}`} label="en uzun seri" />
            </View>
            {data.routines.length === 0 && (
              <Text style={styles.muted}>
                Henüz rutin yok. Rutinlerim ekranından bir paket ekleyince takvim dolmaya başlar.
              </Text>
            )}
            {detail && data.routines.length > 0 && (
              <View style={styles.detail}>
                <Text style={styles.detailTitle}>{parseDayKey(selected).getDate()} {monthTitle(selected.slice(0, 7)).split(' ')[0]}</Text>
                {detail.done.map((r) => (
                  <View key={r.id} style={styles.markRow}>
                    <Text style={[styles.detailRow, { color: routineColor(r), flex: 1 }]}>
                      ✓ {routineIcon(r)} {r.title}
                    </Text>
                    {!selectedIsFuture && !lockedDone(selected, data.logs).has(r.id) && (
                      <Pressable disabled={busy} onPress={() => toggleDone(r, true)} hitSlop={6}>
                        <Text style={styles.undo}>Geri al</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                {detail.notDone.map((r) => (
                  <View key={r.id} style={styles.markRow}>
                    <Text style={[styles.detailRow, { color: colors.textMuted, flex: 1 }]}>
                      ○ {routineIcon(r)} {r.title}
                    </Text>
                    {!selectedIsFuture && (
                      <Pressable
                        disabled={busy}
                        onPress={() => toggleDone(r, false)}
                        style={[styles.markBtn, { borderColor: routineColor(r) }]}
                      >
                        <Text style={[styles.markBtnText, { color: routineColor(r) }]}>Yaptım</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                {detail.done.length === 0 && detail.notDone.length === 0 && (
                  <Text style={styles.muted}>Bu gün için planlı rutin yok.</Text>
                )}
                {!selectedIsFuture && detail.notDone.length > 0 && (
                  <Text style={styles.muted}>
                    Telefona bakamadığın günleri buradan "Yaptım" diyerek tamamlayabilirsin. İşaretlenmeyen rutin sorun değil.
                  </Text>
                )}
                {selectedIsFuture && <Text style={styles.muted}>Bu gün henüz gelmedi.</Text>}
              </View>
            )}
          </>
        )}

        {tab === 'MOOD' && data && (
          <>
            <View style={styles.stats}>
              <Stat value={data.moodAvg === null ? '–' : formatMood(data.moodAvg)} label="ay ortalaması" />
              <Stat value={`${data.monthMoods.length}`} label="kayıtlı gün" />
            </View>

            <View style={styles.weekBars}>
              {data.week.map((w) => (
                <View key={w.day} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    {w.mood && (
                      <View
                        style={[
                          styles.barFill,
                          { height: `${w.mood * 20}%`, backgroundColor: moodInfo(w.mood).color },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={styles.barEmoji}>{w.mood ? moodInfo(w.mood).emoji : '·'}</Text>
                  <Text style={styles.barLabel}>{WEEKDAY_SHORT[(parseDayKey(w.day).getDay() + 6) % 7]}</Text>
                </View>
              ))}
            </View>

            {data.moodDistribution.length > 0 && (
              <Text style={styles.muted}>
                {data.moodDistribution.map((d) => `${d.info.emoji} ${d.count}`).join('   ')}
              </Text>
            )}
            {data.insight && (
              <View style={styles.insight}>
                <Text style={styles.insightText}>{data.insight}</Text>
              </View>
            )}

            <View style={styles.detail}>
              <Text style={styles.detailTitle}>
                {parseDayKey(selected).getDate()} {monthTitle(selected.slice(0, 7)).split(' ')[0]}
                {selectedMood ? ` · ${moodInfo(selectedMood.mood).emoji} ${moodInfo(selectedMood.mood).label}` : ''}
              </Text>
              {selectedMood?.note ? <Text style={styles.noteText}>“{selectedMood.note}”</Text> : null}
              {selectedIsFuture ? (
                <Text style={styles.muted}>Bu gün henüz gelmedi.</Text>
              ) : (
                <View style={styles.moodRow}>
                  {MOODS.map((m) => (
                    <Pressable
                      key={m.value}
                      disabled={busy}
                      onPress={() => pickMood(m.value)}
                      style={[styles.moodBtn, selectedMood?.mood === m.value && { borderColor: m.color }]}
                    >
                      <Text style={styles.cellEmoji}>{m.emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.kronos, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  tipCard: {
    backgroundColor: colors.auraSoft,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  tipTitle: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  tipText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill },
  segOn: { backgroundColor: colors.surfaceAlt },
  segText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  segTextOn: { color: colors.text },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthArrow: { color: colors.text, fontSize: 28, paddingHorizontal: spacing.md },
  monthTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  weekHead: { flexDirection: 'row' },
  weekHeadText: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  weekRow: { flexDirection: 'row', gap: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellEmpty: { flex: 1, aspectRatio: 1 },
  cellToday: { borderColor: colors.text },
  cellSelected: { borderColor: colors.aura, borderWidth: 2 },
  cellText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cellEmoji: { fontSize: 20 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  detail: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  detailTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  detailRow: { fontSize: 14, fontWeight: '600' },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  markBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  markBtnText: { fontSize: 12, fontWeight: '800' },
  undo: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  noteText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', lineHeight: 19 },
  weekBars: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: {
    width: '70%',
    height: 70,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 8 },
  barEmoji: { fontSize: 16 },
  barLabel: { color: colors.textMuted, fontSize: 10 },
  insight: { backgroundColor: colors.auraSoft, borderRadius: radius.md, padding: spacing.md },
  insightText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  moodRow: { flexDirection: 'row', gap: spacing.sm },
  moodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
});
