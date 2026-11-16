import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import type { StudyKind } from '../database/types';
import { deviceActivityAvailable } from '../services/activity';
import { formatDuration } from '../services/format';
import {
  addStudy,
  languageForDays,
  loadLanguageDay,
  removeStudy,
  saveLanguageSettings,
  type LanguageDayState,
} from '../services/language';
import {
  GOAL_CHOICES,
  QUICK_MINUTES,
  STUDY_KINDS,
  goalRatio,
  languageWeek,
  parseAppNames,
  studyLabel,
  type LanguageWeek,
} from '../services/languageLogic';
import { weekEndDate, windowKeys } from '../services/weeklyLogic';
import { dayKey } from '../services/activityLogic';

export default function LanguageScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LanguageDayState | null>(null);
  const [week, setWeek] = useState<LanguageWeek | null>(null);
  const [kind, setKind] = useState<StudyKind>('PAPER');
  const [custom, setCustom] = useState('');
  const [appsInput, setAppsInput] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const st = await loadLanguageDay(db, now);
      setState(st);
      setAppsInput((cur) => (cur === '' ? st.settings.apps.join(', ') : cur));
      const keys = windowKeys(dayKey(weekEndDate(now)), 14);
      const days = await languageForDays(db, keys, st.settings);
      setWeek(languageWeek(days.map((d) => ({ day: d.day, total: d.summary.total }))));
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

  const add = async (minutes: number) => {
    try {
      await addStudy(db, kind, minutes, new Date());
      setMessage({ text: `${formatDuration(minutes)} eklendi.`, ok: true });
      setCustom('');
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  };

  const addCustom = () => {
    const n = Math.round(Number(custom.replace(',', '.')));
    if (!Number.isFinite(n) || n < 1) {
      setMessage({ text: 'Dakikayı sayı olarak yaz (ör. 25).', ok: false });
      return;
    }
    add(n);
  };

  const confirmRemove = (id: string, label: string) =>
    Alert.alert('Kaydı sil', `${label} silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await removeStudy(db, id).catch(() => undefined);
          await load();
        },
      },
    ]);

  const setGoal = async (g: number | null) => {
    await saveLanguageSettings(db, { goalMin: g });
    await load();
  };

  const saveApps = async () => {
    const names = parseAppNames(appsInput);
    const saved = await saveLanguageSettings(db, { apps: names });
    setAppsInput(saved.apps.join(', '));
    setMessage({ text: `Sayılan uygulamalar: ${saved.apps.join(', ')}.`, ok: true });
    await load();
  };

  const sum = state?.summary;
  const goal = state?.settings.goalMin ?? null;
  const ratio = sum ? goalRatio(sum.total, goal) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Dil öğrenme</Text>
        <Text style={styles.sub}>
          Uygulamada geçen süre ekran süresinden kendiliğinden sayılır; kalem-kağıt gibi çalışmaları sen eklersin.
        </Text>

        {loading || !state || !sum ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Bugün</Text>
              <Text style={styles.big}>
                {formatDuration(sum.total)}
                {goal !== null ? <Text style={styles.bigSub}> / {formatDuration(goal)}</Text> : null}
              </Text>
              {ratio !== null && (
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
                </View>
              )}
              <View style={styles.rows}>
                <Row
                  label={`${state.settings.apps.join(', ')} (ekran süresinden)`}
                  value={
                    sum.autoAppMinutes === null
                      ? deviceActivityAvailable
                        ? 'okunamıyor'
                        : 'bu telefonda yok'
                      : formatDuration(sum.autoAppMinutes)
                  }
                />
                {sum.autoAppMinutes === null || sum.autoAppMinutes === 0 ? (
                  <Row label="Uygulama (elle)" value={formatDuration(sum.appMinutes)} />
                ) : null}
                <Row label="Kalem kağıt" value={formatDuration(sum.paperMinutes)} />
                <Row label="Dinleme / konuşma" value={formatDuration(sum.otherMinutes)} />
              </View>
              {sum.autoAppMinutes === null && (
                <Text style={styles.muted}>
                  Ekran süresi okunamıyor (Gün analizi için Kullanım erişimi izni gerekir). Uygulamada geçen süreyi
                  aşağıdan "Uygulama (elle)" diye ekleyebilirsin.
                </Text>
              )}
            </View>

            <Text style={styles.section}>Çalışma ekle</Text>
            <View style={styles.card}>
              <View style={styles.chipRow}>
                {STUDY_KINDS.map((k) => (
                  <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[styles.chip, kind === k.kind && styles.chipOn]}>
                    <Text style={[styles.chipText, kind === k.kind && { color: colors.aura }]}>
                      {k.icon} {k.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.chipRow}>
                {QUICK_MINUTES.map((m) => (
                  <Pressable key={m} onPress={() => add(m)} style={styles.minBtn}>
                    <Text style={styles.minText}>+{m} dk</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.customRow}>
                <TextInput
                  value={custom}
                  onChangeText={(t) => setCustom(t.replace(/[^0-9]/g, ''))}
                  placeholder="Başka süre (dk)"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  maxLength={3}
                  style={styles.input}
                />
                <Pressable onPress={addCustom} style={styles.addBtn}>
                  <Text style={styles.addText}>Ekle</Text>
                </Pressable>
              </View>
              {message && <Text style={[styles.message, { color: message.ok ? colors.aura : colors.danger }]}>{message.text}</Text>}
            </View>

            {state.logs.length > 0 && (
              <>
                <Text style={styles.section}>Bugünkü kayıtlar</Text>
                <View style={styles.card}>
                  {state.logs.map((l) => {
                    const label = `${studyLabel(l.kind)} · ${formatDuration(l.minutes)}`;
                    return (
                      <View key={l.id} style={styles.logRow}>
                        <Text style={styles.logText}>{label}</Text>
                        <Pressable onPress={() => confirmRemove(l.id, label)} hitSlop={8}>
                          <Text style={styles.muted}>Sil</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {week && (
              <>
                <Text style={styles.section}>Son günler</Text>
                <View style={styles.card}>
                  <Text style={styles.body}>{week.text}</Text>
                  <Pressable onPress={() => router.push('/history')} hitSlop={8}>
                    <Text style={styles.link}>Günlük grafik için İlerleme ve geçmiş ›</Text>
                  </Pressable>
                </View>
              </>
            )}

            <Text style={styles.section}>Ayarlar</Text>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Günlük hedef</Text>
              <View style={styles.chipRow}>
                {GOAL_CHOICES.map((g) => (
                  <Pressable key={String(g)} onPress={() => setGoal(g)} style={[styles.chip, goal === g && styles.chipOn]}>
                    <Text style={[styles.chipText, goal === g && { color: colors.aura }]}>{g === null ? 'Hedef yok' : `${g} dk`}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.cardLabel}>Sayılan uygulamalar</Text>
              <TextInput
                value={appsInput}
                onChangeText={setAppsInput}
                placeholder="Duolingo, Babbel"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                autoCapitalize="words"
              />
              <Text style={styles.muted}>
                Virgülle ayır. Ad ekran süresinde geçen uygulama adının bir parçası olabilir. Telefonda en çok kullandığın
                ilk uygulamalar içinde olmalı; çok kısa kullanılan (yarım dakikadan az) uygulamalar sayılmaz.
              </Text>
              <Pressable onPress={saveApps} style={styles.addBtn}>
                <Text style={styles.addText}>Uygulamaları kaydet</Text>
              </Pressable>
            </View>
            <Text style={styles.footnote}>
              Duolingo süresi ekran süresinden sayıldığı için gün sonu analizinde "ekran yerine yap" önerisine girmez.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  big: { color: colors.text, fontSize: 30, fontWeight: '800' },
  bigSub: { color: colors.textMuted, fontSize: 18, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.aura },
  rows: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { flex: 1, color: colors.text, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipOn: { borderColor: colors.aura, backgroundColor: colors.surface },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  minBtn: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.aura,
    backgroundColor: colors.auraSoft,
    borderRadius: radius.pill,
    paddingVertical: 10,
  },
  minText: { color: colors.aura, fontSize: 14, fontWeight: '800' },
  customRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
  },
  addBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  addText: { color: colors.aura, fontWeight: '800', fontSize: 14 },
  message: { fontSize: 13, lineHeight: 19 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logText: { color: colors.text, fontSize: 14 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  link: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
