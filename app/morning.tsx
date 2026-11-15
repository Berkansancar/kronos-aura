import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { confirmEndHardDay, confirmStartHardDay } from '../components/hardDayAlert';
import { colors, radius, spacing } from '../constants/theme';
import { endHardDay, startHardDay } from '../services/hardDay';
import { formatDayTitle, formatDuration } from '../services/format';
import { loadMorningBrief } from '../services/morning';
import type { MorningBrief, MorningFacts } from '../services/morningLogic';
import { planningDay, replanDay } from '../services/planner';
import { refreshReminders } from '../services/reminderSync';

export default function MorningScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ facts: MorningFacts; brief: MorningBrief } | null>(null);

  const load = useCallback(async () => {
    const n = new Date();
    setNow(n);
    try {
      setData(await loadMorningBrief(db, n));
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

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refreshReminders(db).catch(() => undefined);
      await load();
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const brief = data?.brief;
  const facts = data?.facts;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>

        {loading || !brief || !facts ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.kronos} />
          </View>
        ) : (
          <>
            <Text style={styles.heading}>{brief.greeting}</Text>
            <Text style={styles.sub}>{formatDayTitle(planningDay(now))}</Text>

            <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
              <Text style={[styles.coachName, { color: colors.aura }]}>AURA</Text>
              <Text style={styles.coachText}>{brief.aura}</Text>
            </View>

            <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
              <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS</Text>
              {brief.kronos.map((line) => (
                <Text key={line} style={styles.coachText}>
                  {line}
                </Text>
              ))}
            </View>

            {brief.note && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Dün akşamdan Kronos'un notu</Text>
                <Text style={styles.cardText}>{brief.note}</Text>
              </View>
            )}

            {facts.hardDay ? (
              <View style={[styles.card, { borderColor: colors.aura }]}>
                <Text style={styles.cardTitle}>Zor gün modu açık</Text>
                <Text style={styles.cardText}>
                  Plan hafifletildi, bugün senden başka bir şey beklenmiyor.
                </Text>
                <Pressable
                  disabled={busy}
                  onPress={() => confirmEndHardDay(() => run(async () => void (await endHardDay(db, new Date()))))}
                  style={styles.addBtn}
                >
                  <Text style={styles.addBtnText}>Normal güne dön</Text>
                </Pressable>
              </View>
            ) : (
              brief.suggestHardDay && (
                <View style={[styles.card, { borderColor: colors.aura }]}>
                  <Text style={styles.cardTitle}>Bugün hafif gidelim mi?</Text>
                  <Text style={styles.cardText}>
                    Uykun kısa kalmış görünüyor. İstersen Aura planı hafifletsin: yalnızca birkaç küçük iş
                    kalsın, gerisi bekleyebilir.
                  </Text>
                  <Pressable
                    disabled={busy}
                    onPress={() => confirmStartHardDay(() => run(async () => void (await startHardDay(db, new Date()))))}
                    style={styles.addBtn}
                  >
                    <Text style={styles.addBtnText}>Zor gün modunu aç</Text>
                  </Pressable>
                </View>
              )
            )}

            {brief.top && (
              <>
                <Text style={styles.section}>{facts.hardDay ? 'Bugünün hedefi' : 'En önemli iş'}</Text>
                <View style={[styles.card, { borderColor: colors.kronos }]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{brief.top.title}</Text>
                    <Text style={styles.time}>
                      {brief.top.start ? `${brief.top.start} · ` : ''}
                      {formatDuration(brief.top.minutes)}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {brief.planned.length > 0 && (
              <>
                <Text style={styles.section}>Planda</Text>
                <View style={styles.card}>
                  {brief.planned.map((t) => (
                    <View key={t.id} style={styles.rowBetween}>
                      <Text style={styles.listText}>{t.title}</Text>
                      <Text style={styles.listTime}>
                        {t.start} · {formatDuration(t.minutes)}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {brief.unplanned.length > 0 && !facts.hardDay && (
              <Pressable
                disabled={busy}
                onPress={() => run(async () => void (await replanDay(db, new Date(), 'MANUAL')))}
                style={[styles.primary, busy && { opacity: 0.5 }]}
              >
                <Text style={styles.primaryText}>Günü planla</Text>
              </Pressable>
            )}

            {(brief.routinesOpen.length > 0 || brief.routinesDone > 0) && (
              <>
                <Text style={styles.section}>Bugünkü rutinlerin</Text>
                <View style={styles.card}>
                  {brief.routinesOpen.map((r) => (
                    <View key={r.title} style={styles.rowBetween}>
                      <Text style={styles.listText}>{r.title}</Text>
                      <Text style={styles.listTime}>{r.time}</Text>
                    </View>
                  ))}
                  {brief.routinesDone > 0 && (
                    <Text style={styles.cardText}>{brief.routinesDone} rutin bugün zaten yapıldı.</Text>
                  )}
                  <Text style={styles.hint}>Saati gelince sana sorarım; cevabını ana ekrandan verirsin.</Text>
                </View>
              </>
            )}

            <Pressable onPress={() => router.back()} style={styles.done}>
              <Text style={styles.doneText}>Tamam, güne başla</Text>
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
  back: { color: colors.kronos, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 28, fontWeight: '800' },
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
    gap: spacing.sm,
  },
  cardLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  cardText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  time: { color: colors.kronos, fontSize: 12, fontWeight: '800' },
  listText: { color: colors.text, fontSize: 14, flex: 1 },
  listTime: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  addBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  addBtnText: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  primary: {
    backgroundColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: '800' },
  done: { alignItems: 'center', paddingVertical: spacing.md },
  doneText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
