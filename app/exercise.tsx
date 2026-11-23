import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { formatDayTitle } from '../services/format';
import { loadExercise, updateExercise } from '../services/exercise';
import { openAlarmEditor } from '../services/exerciseAlarm';
import { refreshReminders } from '../services/reminderSync';
import { parseDayKey } from '../services/activityLogic';
import { EXERCISES, LEVEL_NAMES, PRINCIPLES, SESSION_MINUTES } from '../services/exerciseData';
import {
  DAY_SHORT,
  START_CHOICES,
  WEEK_ORDER,
  clock,
  defaultState,
  sessionSummary,
  sessionsThisWeek,
  targetLine,
  setRemind,
  setStart,
  todayAdvice,
  toggleDay,
  variantFor,
  windowText,
  type ExerciseState,
} from '../services/exerciseLogic';

export default function ExerciseScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ExerciseState>(defaultState());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadExercise(db)
        .then((s) => alive && setState(s))
        .catch((e) => Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [db])
  );

  // Program ayarını kaydeder; bildirimler yeni güne ve saate göre yeniden planlanır
  const savePlan = async (change: (s: ExerciseState) => ExerciseState) => {
    try {
      setState(await updateExercise(db, change));
      refreshReminders(db).catch(() => undefined);
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : String(e));
    }
  };

  const setAlarm = async () => {
    const res = await openAlarmEditor(state.plan.startMin);
    if (!res.ok) Alert.alert('Alarm kurulamadı', res.message);
  };

  const today = new Date();
  const target = state.plan.days.length;
  const week = sessionsThisWeek(state, today);
  const recent = state.sessions.slice(-5).reverse();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Egzersiz</Text>
        <Text style={styles.sub}>Ekipmansız güç programı. Kas büyütmeden güçlenmek için: zor hareket, az tekrar, uzun dinlenme.</Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <View style={styles.weekCard}>
              <Text style={styles.label}>BU HAFTA</Text>
              <View style={styles.dots}>
                {Array.from({ length: target }, (_, i) => (
                  <View key={i} style={[styles.dot, i < week && styles.dotOn]} />
                ))}
                <Text style={styles.weekText}>
                  {Math.min(week, 99)}/{target} seans
                </Text>
              </View>
              <Text style={styles.muted}>{todayAdvice(state, today)}</Text>
              <Pressable onPress={() => router.push('/exercise-run')} style={styles.primary}>
                <Text style={styles.primaryText}>Seansı başlat</Text>
              </Pressable>
            </View>

            <Text style={styles.section}>Sabah programı</Text>
            <View style={styles.rules}>
              <Text style={styles.ruleTitle}>Egzersiz günleri</Text>
              <View style={styles.chips}>
                {WEEK_ORDER.map((d) => {
                  const on = state.plan.days.includes(d);
                  return (
                    <Pressable key={d} onPress={() => savePlan((s) => toggleDay(s, d))} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{DAY_SHORT[d]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.muted}>Seanslar arasında en az bir gün dinlenme olsun (örneğin Pzt, Çar, Cum).</Text>

              <Text style={[styles.ruleTitle, { marginTop: spacing.sm }]}>Güne başlama saati</Text>
              <View style={styles.chips}>
                {START_CHOICES.map((m) => {
                  const on = state.plan.startMin === m;
                  return (
                    <Pressable key={m} onPress={() => savePlan((s) => setStart(s, m))} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{clock(m)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.muted}>
                Egzersiz {windowText(state.plan)} arasında yapılır ({SESSION_MINUTES} dakika). Alarm ve hatırlatma bu saate göre kurulur.
              </Text>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleTitle}>Uygulama hatırlatması</Text>
                  <Text style={styles.muted}>Egzersiz günlerinde {clock(state.plan.startMin)}'da bildirim gelir. Dokununca seans açılır.</Text>
                </View>
                <Switch
                  value={state.plan.remind}
                  onValueChange={(on) => savePlan((s) => setRemind(s, on))}
                  trackColor={{ true: colors.aura, false: colors.border }}
                />
              </View>

              <Pressable onPress={setAlarm} style={styles.alarmBtn}>
                <Text style={styles.alarmText}>⏰ Alarmı Saat uygulamasına kur ({clock(state.plan.startMin)})</Text>
              </Pressable>
              <Text style={styles.muted}>
                Saat uygulaması hazır dolu açılır. Onay işaretine dokun ve tekrar günlerini seç. Gerçek alarm Saat uygulamasında çalar;
                uygulama bildirimi ek hatırlatmadır.
              </Text>
            </View>

            <Text style={styles.section}>Hareketler</Text>
            {EXERCISES.map((m) => {
              const level = state.levels[m.id];
              const v = variantFor(m.id, level);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => router.push({ pathname: '/exercise-move', params: { move: m.id } })}
                  style={styles.moveCard}
                >
                  <View style={styles.moveHead}>
                    <Text style={styles.moveIcon}>{m.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.moveTitle}>
                        {m.title} <Text style={styles.moveArea}>· {m.area}</Text>
                      </Text>
                      <Text style={styles.moveName} numberOfLines={2}>
                        {v.name}
                      </Text>
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </View>
                  <Text style={styles.muted}>
                    {LEVEL_NAMES[level]} basamak · {targetLine(v)}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={styles.section}>Program kuralları</Text>
            <View style={styles.rules}>
              {PRINCIPLES.map((p) => (
                <View key={p.title} style={styles.rule}>
                  <Text style={styles.ruleTitle}>{p.title}</Text>
                  <Text style={styles.muted}>{p.text}</Text>
                </View>
              ))}
            </View>

            {recent.length > 0 && (
              <>
                <Text style={styles.section}>Son seanslar</Text>
                <View style={styles.rules}>
                  {recent.map((s) => (
                    <View key={s.day} style={styles.recentRow}>
                      <Text style={styles.recentDay}>{formatDayTitle(parseDayKey(s.day))}</Text>
                      <Text style={styles.muted}>{sessionSummary(s)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.footnote}>
              Keskin ağrı hissedersen o hareketi bırak. Eklem, kalp ya da sırt sorunun varsa başlamadan önce doktoruna danış. Sandalye, masa ve kanepe
              kullanan hareketlerde eşyanın sağlam ve kaymaz olduğundan emin ol.
            </Text>
          </>
        )}
      </ScrollView>
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
  weekCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.border },
  dotOn: { backgroundColor: colors.aura, borderColor: colors.aura },
  weekText: { color: colors.text, fontSize: 15, fontWeight: '800', marginLeft: spacing.xs },
  primary: { backgroundColor: colors.aura, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.xs },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  section: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: spacing.sm },
  moveCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  moveHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  moveIcon: { fontSize: 26 },
  moveTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  moveArea: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  moveName: { color: colors.kronos, fontSize: 13, fontWeight: '700', marginTop: 2 },
  chev: { color: colors.textMuted, fontSize: 22 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  rules: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rule: { gap: 2 },
  ruleTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  recentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  recentDay: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { borderColor: colors.aura, backgroundColor: colors.auraSoft },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: colors.aura },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  alarmBtn: {
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  alarmText: { color: colors.kronos, fontSize: 14, fontWeight: '800' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
