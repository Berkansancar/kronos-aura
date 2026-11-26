import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Damacana } from '../components/Damacana';
import { HorizonSlider } from '../components/HorizonSlider';
import { colors, radius, spacing } from '../constants/theme';
import { formatSteps } from '../services/activityLogic';
import { getSetting, setSetting } from '../database/repository';
import { loadAnalysis, type AnalysisScreenData } from '../services/analysis';
import {
  ANALYSIS_DAYS_KEY,
  analyze,
  clampDays,
  fmtKm,
  fmtLiters,
  fmtNum,
  fmtStudy,
  journalCompareText,
  parseHorizon,
  serializeHorizon,
  windowLabel,
  wordRateText,
} from '../services/analysisLogic';
import { getBody } from '../services/goalsSettings';

const MAX_DAMACANA_ICONS = 6;

export default function AnalysisScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loaded, setLoaded] = useState<AnalysisScreenData | null>(null);
  const [days, setDays] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [body, saved] = await Promise.all([getBody(), getSetting(db, ANALYSIS_DAYS_KEY).catch(() => null)]);
        const res = await loadAnalysis(db, new Date(), body?.heightCm ?? null);
        if (!alive) return;
        setLoaded(res);
        // İlk açılışta son seçilen aralık (yoksa 7 gün); sonra seçim korunur, yalnızca sınırın içinde kalır.
        setDays((prev) => (prev === null ? parseHorizon(saved, res.span) : clampDays(prev, res.span)));
      })().catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [db])
  );

  const span = loaded?.span ?? 1;
  const n = clampDays(days ?? 7, span);
  const result = useMemo(() => (loaded ? analyze(loaded.data, n) : null), [loaded, n]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Analiz</Text>

        {!loaded || !result ? (
          <ActivityIndicator color={colors.aura} style={{ marginTop: spacing.xl }} />
        ) : !loaded.data.firstDay ? (
          <View style={styles.card}>
            <Text style={styles.body}>Henüz kayıt yok. Dil çalıştıkça, yürüdükçe, su içtikçe ve günlük yazdıkça burada toplamlar ve kıyaslar görünür.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.window}>{windowLabel(n, span, loaded.data.today)}</Text>
            <Text style={styles.sub}>
              Sürgüyü aşağıdan çek: sınır, ilk kayıttan bugüne geçen gün sayısıdır ({span} gün). Gösterilenler gerçek toplamlardır; tahmin yoktur.
            </Text>

            {/* Dil */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🌍 Dil</Text>
              <Row label={`${loaded.appLabel} (ekran süresi)`} value={fmtStudy(result.language.minutes)} />
              <Row label="Kullandığın gün" value={`${result.language.studyDays} gün`} />
              {result.language.paperMinutes > 0 && <Row label="Kalem kağıt (ayrı)" value={fmtStudy(result.language.paperMinutes)} />}
              {result.language.otherMinutes > 0 && <Row label="Dinleme / konuşma (ayrı)" value={fmtStudy(result.language.otherMinutes)} />}
              <Row label="Öğrenilen kelime" value={String(result.language.learned)} />
              <Row label="Deftere eklenen" value={String(result.language.added)} />
              <Text style={styles.note}>{wordRateText(result.language, result.languageAllTimeRate)}</Text>
              <Text style={styles.hint}>Çalışma süresi dil uygulamasının ekran süresidir; kalem kağıt ve dinleme ayrı gösterilir, toplanmaz. Öğrenildi: kelime defterinde en yüksek kutuya ulaşan kelime.</Text>
            </View>

            {/* Adım */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>👣 Adım</Text>
              {result.steps.steps > 0 ? (
                <>
                  <Row label="Toplam adım" value={formatSteps(result.steps.steps)} />
                  <Row label="Yürünen yol" value={fmtKm(result.steps.km)} />
                  {result.steps.avgPerDay !== null && <Row label="Kayıtlı günlerde ortalama" value={`${formatSteps(result.steps.avgPerDay)} adım`} />}
                  {result.steps.compare && <Text style={styles.note}>Bu, {result.steps.compare.text}.</Text>}
                  {result.steps.compare?.next && (
                    <View style={{ gap: 4 }}>
                      <View style={styles.progress}>
                        <View style={[styles.progressFill, { width: `${Math.max(2, Math.round(result.steps.compare.next.ratio * 100))}%` }]} />
                      </View>
                      <Text style={styles.hint}>
                        Sıradaki: {result.steps.compare.next.landmark.short} · {fmtKm(result.steps.compare.next.remainingKm)} kaldı
                      </Text>
                    </View>
                  )}
                  <Text style={styles.hint}>
                    {result.steps.strideAssumed
                      ? `Adım uzunluğu varsayılan ${fmtNum(result.steps.strideM * 100, 0)} cm. Boyunu Hedefler sayfasına girersen km daha doğru olur.`
                      : `Adım uzunluğu boyundan hesaplandı (${fmtNum(result.steps.strideM * 100, 0)} cm).`}
                  </Text>
                </>
              ) : (
                <Text style={styles.muted}>Bu aralıkta adım kaydı yok.</Text>
              )}
            </View>

            {/* Su */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>💧 Su</Text>
              {result.water.ml > 0 ? (
                <>
                  <Row label="Toplam" value={fmtLiters(result.water.ml)} />
                  <Row label="Kayıtlı gün" value={`${result.water.days} gün`} />
                  {result.water.avgMlPerDay !== null && <Row label="Kayıtlı günlerde ortalama" value={fmtLiters(result.water.avgMlPerDay)} />}
                  <View style={styles.damRow}>
                    {Array.from({ length: Math.min(result.water.compare.full, MAX_DAMACANA_ICONS) }).map((_, i) => (
                      <Damacana key={i} ratio={1} size={64} animate={false} />
                    ))}
                    {result.water.compare.fraction > 0.02 && result.water.compare.full <= MAX_DAMACANA_ICONS && (
                      <Damacana ratio={result.water.compare.fraction} size={64} animate={false} />
                    )}
                    {result.water.compare.full > MAX_DAMACANA_ICONS && <Text style={styles.damMore}>+{result.water.compare.full - MAX_DAMACANA_ICONS}</Text>}
                  </View>
                  <Text style={styles.note}>Bu, {result.water.compare.text}.</Text>
                  <Text style={styles.hint}>1 damacana = 19 litre.</Text>
                </>
              ) : (
                <Text style={styles.muted}>Bu aralıkta su kaydı yok.</Text>
              )}
            </View>

            {/* Günlük */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📓 Günlük</Text>
              {result.journal.words > 0 ? (
                <>
                  <Row label="Yazılan gün" value={`${result.journal.entries} gün`} />
                  <Row label="Toplam kelime" value={formatSteps(result.journal.words)} />
                  {result.journal.avgWords !== null && <Row label="Yazılan günlerde ortalama" value={`${result.journal.avgWords} kelime`} />}
                  <Text style={styles.note}>Bu, {result.journal.compare.text}.</Text>
                  {journalCompareText(result.journalVsPrevious, n) && <Text style={styles.body}>{journalCompareText(result.journalVsPrevious, n)}</Text>}
                </>
              ) : (
                <Text style={styles.muted}>Bu aralıkta günlük yazısı yok.</Text>
              )}
              <Text style={styles.hint}>Yalnızca kelime sayısı kullanılır; yazdıkların hiçbir yere gönderilmez.</Text>
            </View>

            <Text style={styles.hint}>Kayıt olmayan gün "sıfır" sayılmaz; ortalamalar yalnızca kayıtlı günlerden hesaplanır. Bu ekran yapay zekâya hiçbir şey göndermez.</Text>
          </>
        )}
      </ScrollView>

      {loaded && loaded.data.firstDay && (
        <View style={styles.panel}>
          <HorizonSlider
            days={n}
            span={span}
            onChange={(d) => {
              const next = clampDays(d, span);
              setDays(next);
              setSetting(db, ANALYSIS_DAYS_KEY, serializeHorizon(next, span)).catch(() => undefined);
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  window: { color: colors.aura, fontSize: 15, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  rowLabel: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.aura, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  progress: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.kronos },
  damRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.xs },
  damMore: { color: colors.text, fontSize: 18, fontWeight: '800', paddingBottom: spacing.sm },
  panel: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
});
