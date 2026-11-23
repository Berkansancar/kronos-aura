import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { parseDayKey } from '../services/activityLogic';
import { formatDayTitle } from '../services/format';
import { loadJournal, saveJournal, type JournalScreenData } from '../services/journal';
import { FACTOR_LABELS } from '../services/insightLogic';
import { EMPTY_FIELDS, JOURNAL_MAX, JOURNAL_QUESTIONS, monthSummaryText, type JournalFields } from '../services/journalLogic';
import { MOODS, moodInfo } from '../services/moodLogic';
import type { MoodValue } from '../database/types';

type Tab = 'yaz' | 'gecmis' | 'analiz';
const TABS: { id: Tab; label: string }[] = [
  { id: 'yaz', label: 'Bugün' },
  { id: 'gecmis', label: 'Geçmiş' },
  { id: 'analiz', label: 'Seni ne iyi yapıyor?' },
];

export default function JournalScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('yaz');
  const [data, setData] = useState<JournalScreenData | null>(null);
  const [fields, setFields] = useState<JournalFields>({ ...EMPTY_FIELDS });
  const [mood, setMood] = useState<MoodValue | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await loadJournal(db);
      setData(d);
      setFields(d.fields);
      setMood(d.mood ? (d.mood.mood as MoodValue) : null);
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const set = (key: keyof JournalFields, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await saveJournal(db, new Date(), fields, mood);
      setReply(r.reply);
      await load();
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Geri</Text>
          </Pressable>
          <Text style={styles.heading}>Akşam günlüğü</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((t) => (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
                <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {!data ? (
            <ActivityIndicator color={colors.aura} style={{ marginTop: spacing.xl }} />
          ) : tab === 'yaz' ? (
            <>
              <Text style={styles.sub}>{formatDayTitle(parseDayKey(data.day))}</Text>

              {data.todayGoal ? (
                <View style={styles.goalCard}>
                  <Text style={styles.goalLabel}>DÜN YAZDIĞIN BUGÜNKÜ HEDEF</Text>
                  <Text style={styles.goalText}>{data.todayGoal}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>BUGÜN NASILDI?</Text>
              <View style={styles.moodRow}>
                {MOODS.map((m) => (
                  <Pressable
                    key={m.value}
                    onPress={() => setMood(mood === m.value ? null : m.value)}
                    style={[styles.moodBtn, mood === m.value && { borderColor: m.color }]}
                    accessibilityLabel={m.label}
                  >
                    <Text style={styles.moodEmoji}>{m.emoji}</Text>
                  </Pressable>
                ))}
              </View>
              {mood !== null && <Text style={styles.moodName}>{moodInfo(mood).label}</Text>}

              {JOURNAL_QUESTIONS.map((q) => (
                <View key={q.key} style={{ gap: spacing.xs }}>
                  <Text style={styles.question}>{q.label}</Text>
                  <TextInput
                    value={fields[q.key]}
                    onChangeText={(t) => set(q.key, t)}
                    placeholder={q.placeholder}
                    placeholderTextColor={colors.textMuted}
                    maxLength={JOURNAL_MAX}
                    multiline
                    style={styles.input}
                    accessibilityLabel={q.label}
                  />
                </View>
              ))}

              <Pressable onPress={onSave} disabled={busy} style={[styles.save, busy && { opacity: 0.6 }]}>
                <Text style={styles.saveText}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Text>
              </Pressable>

              {reply ? (
                <View style={styles.reply}>
                  <Text style={styles.replyWho}>AURA</Text>
                  <Text style={styles.replyText}>{reply}</Text>
                </View>
              ) : null}
              {data.streakDays >= 2 && !reply ? <Text style={styles.muted}>{data.streakDays} gündür yazıyorsun.</Text> : null}
              <Text style={styles.foot}>Günlük yalnızca bu telefonda durur ve yedeğe girer; yapay zekâya gönderilmez. 04:00'e kadar yazdığın dünün günlüğüne gider.</Text>
            </>
          ) : tab === 'gecmis' ? (
            <>
              <Text style={styles.summary}>{monthSummaryText(data.summary)}</Text>
              {data.summary.bestDays.length > 0 && (
                <View style={{ gap: spacing.sm }}>
                  <Text style={styles.label}>BU AYIN GÜZEL GÜNLERİ</Text>
                  {data.summary.bestDays.map((b) => (
                    <View key={b.day} style={styles.bestCard}>
                      <Text style={styles.bestDay}>
                        {moodInfo(b.mood).emoji} {formatDayTitle(parseDayKey(b.day))}
                      </Text>
                      <Text style={styles.entryText}>{b.good}</Text>
                    </View>
                  ))}
                </View>
              )}
              {data.history.length === 0 ? (
                <Text style={styles.muted}>Henüz günlük yazısı yok. İlkini “Bugün” sekmesinde yazabilirsin.</Text>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  <Text style={styles.label}>SON YAZILAR</Text>
                  {data.history.map((e) => (
                    <View key={e.day} style={styles.entry}>
                      <Text style={styles.entryDay}>{formatDayTitle(parseDayKey(e.day))}</Text>
                      {e.good ? <Text style={styles.entryText}>İyi giden: {e.good}</Text> : null}
                      {e.grateful ? <Text style={styles.entryText}>Şükür: {e.grateful}</Text> : null}
                      {e.goal ? <Text style={styles.entryText}>Hedef: {e.goal}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.note}>
                Ruh hali kayıtlarını, aynı günlerde yaptığın işlerle yan yana koyar. Yalnızca birlikte görünen şeyleri gösterir; biri diğerine sebep oldu demez.
              </Text>
              <Text style={styles.summary}>{data.insights.moodDays} günlük ruh hali kaydı var.</Text>
              {data.insights.items.map((it) => (
                <View key={it.factor} style={styles.insight}>
                  <Text style={styles.insightTitle}>{FACTOR_LABELS[it.factor]} günler</Text>
                  <View style={styles.bars}>
                    <Bar label={`Yaptığın (${it.withDays} gün)`} value={it.withAvg} color={colors.aura} />
                    <Bar label={`Yapmadığın (${it.withoutDays} gün)`} value={it.withoutAvg} color={colors.kronos} />
                  </View>
                  <Text style={styles.insightText}>{it.text}</Text>
                </View>
              ))}
              {data.insights.needText ? <Text style={styles.muted}>{data.insights.needText}</Text> : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.barLabel}>
        {label}: {String(value).replace('.', ',')}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
  tabs: { gap: spacing.sm },
  tab: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  tabOn: { backgroundColor: colors.aura },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: colors.bg },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  goalCard: { backgroundColor: colors.auraSoft, borderWidth: 1, borderColor: colors.aura, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  goalLabel: { color: colors.aura, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  goalText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  moodRow: { flexDirection: 'row', gap: spacing.sm },
  moodBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, borderRadius: radius.md },
  moodEmoji: { fontSize: 26 },
  moodName: { color: colors.textMuted, fontSize: 12 },
  question: { color: colors.text, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  save: { backgroundColor: colors.aura, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs },
  saveText: { color: colors.bg, fontSize: 16, fontWeight: '800' },
  reply: { backgroundColor: colors.auraSoft, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  replyWho: { color: colors.aura, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  replyText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  foot: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 20 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  entry: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  entryDay: { color: colors.aura, fontSize: 12, fontWeight: '800' },
  entryText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bestCard: { backgroundColor: colors.auraSoft, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  bestDay: { color: colors.text, fontSize: 13, fontWeight: '800' },
  insight: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  insightTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  insightText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  bars: { gap: spacing.sm },
  barLabel: { color: colors.text, fontSize: 12 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
});
