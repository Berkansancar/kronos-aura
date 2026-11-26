import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { getSetting, setSetting } from '../database/repository';
import { colors, radius, spacing } from '../constants/theme';
import { loadAnalysis, type AnalysisScreenData } from '../services/analysis';
import {
  ANALYSIS_DAYS_KEY,
  analyze,
  clampDays,
  homeSummary,
  parseHorizon,
  serializeHorizon,
  windowLabel,
} from '../services/analysisLogic';
import { getBody } from '../services/goalsSettings';
import { HorizonSlider } from './HorizonSlider';

interface Props {
  /** Değişince veri yeniden okunur (örneğin su eklenince) */
  refreshKey: string;
  /** "Ayrıntı" bağlantısı: tam analiz ekranı */
  onDetail: () => void;
}

/**
 * Ana ekranda doğrudan görünen analiz: dört satırlık özet ve aralığı seçen sürgü. Tıklamadan okunur;
 * ayrıntı isteyen "Ayrıntı ›" ile tam ekranı açar. Seçilen aralık hatırlanır.
 */
export function HomeAnalysis({ refreshKey, onDetail }: Props) {
  const db = useSQLiteContext();
  const [loaded, setLoaded] = useState<AnalysisScreenData | null>(null);
  const [days, setDays] = useState<number | null>(null);

  const load = useCallback(() => {
    let alive = true;
    (async () => {
      const [body, saved] = await Promise.all([getBody().catch(() => null), getSetting(db, ANALYSIS_DAYS_KEY).catch(() => null)]);
      const res = await loadAnalysis(db, new Date(), body?.heightCm ?? null);
      if (!alive) return;
      setLoaded(res);
      setDays((prev) => (prev === null ? parseHorizon(saved, res.span) : clampDays(prev, res.span)));
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [db]);

  // Ekrana dönünce okunur (ilk açılış dahil); anahtar değişince (ör. su eklenince) yeniden okunur.
  useFocusEffect(load);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    return load();
  }, [load, refreshKey]);

  const span = loaded?.span ?? 1;
  const n = clampDays(days ?? 7, span);
  const lines = useMemo(() => (loaded ? homeSummary(analyze(loaded.data, n), loaded.appLabel) : null), [loaded, n]);

  const choose = (d: number) => {
    const next = clampDays(d, span);
    setDays(next);
    setSetting(db, ANALYSIS_DAYS_KEY, serializeHorizon(next, span)).catch(() => undefined);
  };

  if (!loaded || !lines) return null;

  return (
    <View style={styles.card}>
      <Pressable onPress={onDetail} style={styles.head} hitSlop={6}>
        <Text style={styles.title}>📊 Analiz</Text>
        <Text style={styles.detail}>Ayrıntı ›</Text>
      </Pressable>
      {loaded.data.firstDay === null ? (
        <Text style={styles.empty}>Henüz kayıt yok. Dil çalıştıkça, yürüdükçe, su içtikçe ve günlük yazdıkça burada görünür.</Text>
      ) : (
        <>
          <Text style={styles.window}>{windowLabel(n, span, loaded.data.today)}</Text>
          {lines.map((l) => (
            <View key={l.key} style={styles.line}>
              <Text style={styles.icon}>{l.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.main}>
                  <Text style={styles.lineTitle}>{l.title}  </Text>
                  {l.main}
                </Text>
                {l.sub && <Text style={styles.sub}>{l.sub}</Text>}
              </View>
            </View>
          ))}
          <HorizonSlider days={n} span={span} onChange={choose} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  detail: { color: colors.aura, fontSize: 12, fontWeight: '700' },
  window: { color: colors.aura, fontSize: 12, fontWeight: '800' },
  empty: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  line: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  icon: { fontSize: 16, width: 22, textAlign: 'center', marginTop: 1 },
  main: { color: colors.text, fontSize: 13, lineHeight: 19 },
  lineTitle: { color: colors.textMuted, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 1 },
});
