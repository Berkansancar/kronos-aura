import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { WeightChart } from '../components/WeightChart';
import { colors, radius, spacing } from '../constants/theme';
import { parseDayKey } from '../services/activityLogic';
import { chartGeometry, formatKg, formatSigned, weightNote } from '../services/bodyLogic';
import { loadBodyScreen, logWeight, removeWeight, saveTarget, type BodyScreenData } from '../services/body';
import { formatDayTitle } from '../services/format';

type Tab = 'kilo' | 'rekor';

export default function BodyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>(params.tab === 'rekor' ? 'rekor' : 'kilo');
  const [data, setData] = useState<BodyScreenData | null>(null);
  const [kgText, setKgText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await loadBodyScreen(db);
      setData(d);
      setTargetText(d.targetKg === null ? '' : String(d.targetKg).replace('.', ','));
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onSaveWeight = async () => {
    const r = await logWeight(db, new Date(), kgText);
    if (!r.ok) {
      setMsg(r.message);
      return;
    }
    setKgText('');
    setMsg(`Kaydedildi: ${formatKg(r.log.kg)}`);
    await load();
  };

  const onSaveTarget = async () => {
    const ok = await saveTarget(db, targetText);
    setMsg(ok ? (targetText.trim() === '' ? 'Hedef kaldırıldı.' : 'Hedef kaydedildi.') : 'Hedef kiloyu 30 ile 300 arasında yaz.');
    if (ok) await load();
  };

  const onDelete = (day: string) =>
    Alert.alert('Kaydı sil', `${formatDayTitle(parseDayKey(day))} tarihli kilo kaydı silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await removeWeight(db, day);
          await load();
        },
      },
    ]);

  const chartW = Math.min(width, 520) - spacing.lg * 2;
  const geo = data ? chartGeometry(data.logs, data.today, chartW, 190, 18, data.targetKg) : null;
  const s = data?.stats;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>{tab === 'kilo' ? 'Kilo' : 'Rekorlar'}</Text>

        <View style={styles.tabs}>
          {(['kilo', 'rekor'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'kilo' ? 'Kilo' : 'Egzersiz rekorları'}</Text>
            </Pressable>
          ))}
        </View>

        {!data || !geo || !s ? (
          <ActivityIndicator color={colors.aura} style={{ marginTop: spacing.xl }} />
        ) : tab === 'kilo' ? (
          <>
            <View style={styles.cards}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Şimdi</Text>
                <Text style={styles.metricValue}>{s.latest ? formatKg(s.latest.kg) : '–'}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Hedef</Text>
                <Text style={[styles.metricValue, { color: colors.aura }]}>{s.targetKg !== null ? formatKg(s.targetKg) : '–'}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Haftalık</Text>
                <Text style={styles.metricValue}>{s.perWeek === null ? '–' : `${formatSigned(s.perWeek)} kg`}</Text>
              </View>
            </View>

            <WeightChart geo={geo} width={chartW} height={190} />
            <Text style={styles.note}>{weightNote(s)}</Text>
            {s.changeSinceFirst !== null && s.first && (
              <Text style={styles.note}>
                İlk kayıttan bu yana {formatSigned(s.changeSinceFirst)} kg ({s.count} kayıt).
                {s.toTarget !== null ? ` Hedefe ${formatKg(Math.abs(s.toTarget))} ${s.toTarget === 0 ? '' : s.toTarget > 0 ? 'çıkmak' : 'inmek'} kaldı.` : ''}
              </Text>
            )}

            <Text style={styles.label}>BUGÜNKÜ KİLOM</Text>
            <View style={styles.row}>
              <TextInput
                value={kgText}
                onChangeText={setKgText}
                keyboardType="decimal-pad"
                placeholder="78,4"
                placeholderTextColor={colors.textMuted}
                maxLength={6}
                style={styles.input}
                accessibilityLabel="Bugünkü kilo"
              />
              <Pressable onPress={onSaveWeight} style={styles.button}>
                <Text style={styles.buttonText}>Kaydet</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>HEDEF KİLO (İSTEĞE BAĞLI)</Text>
            <View style={styles.row}>
              <TextInput
                value={targetText}
                onChangeText={setTargetText}
                keyboardType="decimal-pad"
                placeholder="boş bırakırsan hedef olmaz"
                placeholderTextColor={colors.textMuted}
                maxLength={6}
                style={styles.input}
                accessibilityLabel="Hedef kilo"
              />
              <Pressable onPress={onSaveTarget} style={[styles.button, styles.buttonAlt]}>
                <Text style={styles.buttonText}>Kaydet</Text>
              </Pressable>
            </View>
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}

            {data.logs.length > 0 && (
              <>
                <Text style={styles.label}>SON KAYITLAR</Text>
                {data.logs
                  .slice(-14)
                  .reverse()
                  .map((l) => (
                    <View key={l.day} style={styles.logRow}>
                      <Text style={styles.logDay}>{formatDayTitle(parseDayKey(l.day))}</Text>
                      <Text style={styles.logKg}>{formatKg(l.kg)}</Text>
                      <Pressable onPress={() => onDelete(l.day)} hitSlop={8} accessibilityLabel="Kaydı sil">
                        <Text style={styles.del}>Sil</Text>
                      </Pressable>
                    </View>
                  ))}
              </>
            )}
            <Text style={styles.foot}>Kilo kayıtları yalnızca bu telefonda durur ve yedeğe girer; yapay zekâya gönderilmez.</Text>
          </>
        ) : data.records.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Henüz egzersiz kaydı yok. Bir seans bitirince her hareketin en iyi seti burada görünür.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.note}>Her hareketin, çalıştığın en yüksek basamaktaki en iyi tek seti. İlk kaydınla karşılaştırılır.</Text>
            {data.records.map((r) => (
              <View key={r.move} style={[styles.recCard, r.recent && styles.recCardNew]}>
                <Text style={styles.recIcon}>{r.icon}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.recTitle}>{r.title}</Text>
                  <Text style={styles.recVariant}>{r.variantName}</Text>
                  <Text style={styles.recLine}>
                    En iyi set: <Text style={styles.recBest}>{r.best} {r.unitWord}</Text> ({formatDayTitle(parseDayKey(r.bestDay))})
                  </Text>
                  <Text style={styles.recMuted}>
                    İlk kayıt: {r.first} {r.unitWord}
                    {r.gain > 0 ? `  ·  +${r.gain}` : ''}
                  </Text>
                </View>
                {r.recent && <Text style={styles.badge}>yeni</Text>}
              </View>
            ))}
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
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  tabOn: { backgroundColor: colors.kronos },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: colors.bg },
  cards: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  metricLabel: { color: colors.textMuted, fontSize: 11 },
  metricValue: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 2 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  button: { backgroundColor: colors.kronos, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 13 },
  buttonAlt: { backgroundColor: colors.surfaceAlt },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  msg: { color: colors.aura, fontSize: 13, fontWeight: '600' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  logDay: { flex: 1, color: colors.text, fontSize: 13 },
  logKg: { color: colors.text, fontSize: 14, fontWeight: '700' },
  del: { color: colors.textMuted, fontSize: 12 },
  foot: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  empty: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg },
  emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  recCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  recCardNew: { borderColor: colors.aura },
  recIcon: { fontSize: 28 },
  recTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  recVariant: { color: colors.textMuted, fontSize: 12 },
  recLine: { color: colors.text, fontSize: 13 },
  recBest: { color: colors.aura, fontWeight: '800' },
  recMuted: { color: colors.textMuted, fontSize: 12 },
  badge: { color: colors.aura, fontSize: 11, fontWeight: '800' },
});
