import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { DeviceActivity } from '../modules/device-activity';
import { getOrCreateUser, listDailyStats, listSleepLogs } from '../database/repository';
import type { Chronotype, DailyStat, SleepLog } from '../database/types';
import {
  deviceActivityAvailable,
  disableTracking,
  enableTracking,
  isSharingWithAi,
  refreshActivity,
  setSharingWithAi,
  type ActivityReading,
} from '../services/activity';
import { batteryHint, formatSteps, parseDayKey } from '../services/activityLogic';
import { formatDayTitle, formatDuration } from '../services/format';
import { formatClockIso, sleepInsights } from '../services/sleepLogic';

export default function ActivityScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [reading, setReading] = useState<ActivityReading | null>(null);
  const [history, setHistory] = useState<DailyStat[]>([]);
  const [sleepLogs, setSleepLogs] = useState<SleepLog[]>([]);
  const [chronotype, setChronotype] = useState<Chronotype>('BALANCED');
  const [share, setShare] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { reading: r } = await refreshActivity(db);
      setReading(r);
      setHistory(await listDailyStats(db, 7));
      setSleepLogs(await listSleepLogs(db, 14));
      setChronotype((await getOrCreateUser(db)).chronotype);
      setShare(await isSharingWithAi());
    } catch {
      // Okuma başarısızsa mevcut ekran korunur.
    }
  }, [db]);

  // Ekrana dönüldüğünde ve ekran açıkken 15 saniyede bir tazele.
  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 15_000);
      return () => clearInterval(id);
    }, [refresh])
  );

  // Ayarlar sayfasından (izin verip) geri dönünce hemen güncelle.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const toggleTracking = async (on: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      if (on) {
        const r = await enableTracking();
        if (!r.ok) setNotice(r.reason ?? 'Takip açılamadı.');
      } else {
        await disableTracking();
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const toggleShare = async (on: boolean) => {
    setShare(on);
    await setSharingWithAi(on);
  };

  if (!deviceActivityAvailable) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.heading}>Gün analizi</Text>
          <Text style={styles.sub}>
            Ekran süresi ve adım takibi yalnızca Android uygulamasında çalışır.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Text style={styles.closeText}>Geri</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const r = reading;
  const maxApp = Math.max(1, ...(r?.apps ?? []).map((a) => a.minutes));
  const stepsValue = r && r.trackingEnabled ? formatSteps(r.steps) : '—';
  const screenValue =
    r && r.screenMinutes !== null ? formatDuration(r.screenMinutes) : '—';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün analizi</Text>
        <Text style={styles.sub}>
          Ekran süren ve adımların, Aura ile Kronos'un önerilerini besler. Veriler bu telefonda kalır;
          yapay zekâya gönderim aşağıdaki ayara bağlıdır.
        </Text>

        <View style={styles.row}>
          <View style={[styles.stat, { borderColor: colors.aura }]}>
            <Text style={styles.statValue}>{stepsValue}</Text>
            <Text style={styles.statLabel}>
              {r && r.trackingEnabled ? 'adım bugün' : 'adım · takip kapalı'}
            </Text>
          </View>
          <View style={[styles.stat, { borderColor: colors.kronos }]}>
            <Text style={styles.statValue}>{screenValue}</Text>
            <Text style={styles.statLabel}>
              {r && r.usageAccess ? 'ekran bugün' : 'ekran · izin gerekli'}
            </Text>
          </View>
        </View>

        {r && r.apps.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Bugün en çok kullanılanlar</Text>
            <View style={styles.card}>
              {r.apps.slice(0, 8).map((a) => (
                <View key={a.label} style={styles.appRow}>
                  <View style={styles.appHead}>
                    <Text style={styles.appName} numberOfLines={1}>
                      {a.label}
                    </Text>
                    <Text style={styles.appTime}>{formatDuration(a.minutes)}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[styles.barFill, { width: `${Math.max(4, (a.minutes / maxApp) * 100)}%` }]}
                    />
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>Uyku (tahmin)</Text>
        <View style={styles.card}>
          {!r?.usageAccess ? (
            <Text style={styles.cardText}>
              Uyku tahmini için aşağıdaki "Kullanım erişimi" izni gerekir. İzin verince yatış ve kalkış
              saatini ekranın gece ne zaman kapanıp açıldığından tahmin ederim.
            </Text>
          ) : sleepLogs.length === 0 ? (
            <Text style={styles.cardText}>
              Henüz tahmin yok. Telefon gece kapalı kalıp sabah açılınca yatış ve kalkış saatin burada
              görünecek.
            </Text>
          ) : (
            <>
              <Text style={styles.cardTitle}>
                {formatClockIso(sleepLogs[0].bedtime)} → {formatClockIso(sleepLogs[0].wakeTime)} ·{' '}
                {formatDuration(sleepLogs[0].durationMinutes)}
              </Text>
              <Text style={styles.cardText}>{formatDayTitle(parseDayKey(sleepLogs[0].day))} sabahı</Text>
              {sleepInsights(sleepLogs, chronotype).map((line) => (
                <Text key={line} style={styles.cardText}>
                  {line}
                </Text>
              ))}
              {sleepLogs.slice(1, 7).map((l) => (
                <View key={l.day} style={styles.histRow}>
                  <Text style={styles.histDay}>{formatDayTitle(parseDayKey(l.day))}</Text>
                  <Text style={styles.histVal}>
                    {formatClockIso(l.bedtime)} → {formatClockIso(l.wakeTime)} ·{' '}
                    {formatDuration(l.durationMinutes)}
                  </Text>
                </View>
              ))}
            </>
          )}
          <Text style={styles.hint}>
            Telefon uykuyu doğrudan ölçemez; ekranın gece en uzun kapalı kaldığı aralığa bakarım. Telefon
            başka odadaysa ya da gece kullandıysan tahmin yanılabilir.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Kurulum</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ekran süresi</Text>
          <Text style={styles.cardText}>
            Android'in "Kullanım erişimi" izni gerekir. Açılan listede Kronos & Aura'yı bulup izni aç.
          </Text>
          {r?.usageAccess ? (
            <Text style={styles.ok}>İzin verildi</Text>
          ) : (
            <Pressable
              onPress={() => DeviceActivity?.openUsageAccessSettings()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Kullanım erişimini aç</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Adım sayacı ve arka plan takibi</Text>
              <Text style={styles.cardText}>
                Bildirim çubuğunda küçük, sessiz bir bildirimle arka planda çalışır. Adımlar takibi
                açtığın andan itibaren sayılır.
              </Text>
            </View>
            <Switch
              value={!!r?.trackingEnabled}
              onValueChange={toggleTracking}
              disabled={busy || !r?.stepSensor}
              trackColor={{ true: colors.aura, false: colors.border }}
            />
          </View>
          {r && !r.stepSensor && (
            <Text style={styles.warn}>Bu telefonda adım sensörü bulunamadı.</Text>
          )}
          {r?.trackingEnabled && !r.serviceRunning && (
            <Text style={styles.warn}>
              Takip şu an durmuş görünüyor. Uygulamayı açık tutarsan kendiliğinden yeniden başlar.
            </Text>
          )}
          {notice && <Text style={styles.warn}>{notice}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Arka planda kapanmasın</Text>
          <Text style={styles.cardText}>
            Android pil tasarrufu için uygulamaları kapatabilir. Aşağıdaki izin bunu azaltır.
            Ayarlardan "Zorla durdur" yaparsan takip durur, uygulamayı bir kez açman yeterli.
          </Text>
          {r?.batteryUnrestricted ? (
            <Text style={styles.ok}>Pil kısıtlaması kapalı</Text>
          ) : (
            <Pressable
              onPress={() => DeviceActivity?.requestIgnoreBatteryOptimizations()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Pil kısıtlamasını kaldır</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>{batteryHint(r?.manufacturer ?? '')}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Koçlarla yapay zekâda paylaş</Text>
              <Text style={styles.cardText}>
                Açıksa, yapay zekâ anahtarı varken koçlara bugünkü adım, ekran süresi ve en çok
                kullanılan 5 uygulamanın adı gönderilir. Kapalıyken veriler telefonda kalır ve yalnızca
                hazır kural mesajlarında kullanılır.
              </Text>
            </View>
            <Switch
              value={share}
              onValueChange={toggleShare}
              trackColor={{ true: colors.kronos, false: colors.border }}
            />
          </View>
        </View>

        {history.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Son günler</Text>
            <View style={styles.card}>
              {history.map((h) => (
                <View key={h.day} style={styles.histRow}>
                  <Text style={styles.histDay}>{formatDayTitle(parseDayKey(h.day))}</Text>
                  <Text style={styles.histVal}>
                    {formatSteps(h.steps)} adım ·{' '}
                    {h.screenMinutes === null ? '—' : formatDuration(h.screenMinutes)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: 60 },
  back: { color: colors.textMuted, fontSize: 14 },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  ok: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  button: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  buttonText: { color: colors.kronos, fontWeight: '700', fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  appRow: { gap: 6 },
  appHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  appName: { color: colors.text, fontSize: 14, flex: 1 },
  appTime: { color: colors.textMuted, fontSize: 13 },
  barTrack: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.kronos, borderRadius: 3 },
  histRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  histDay: { color: colors.text, fontSize: 13, flex: 1 },
  histVal: { color: colors.textMuted, fontSize: 13 },
  close: { alignSelf: 'center', marginTop: spacing.md },
  closeText: { color: colors.textMuted, fontSize: 13 },
});
