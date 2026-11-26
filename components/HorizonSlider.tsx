import { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { clampDays, daysFromFraction, fractionFromDays, quickPicks } from '../services/analysisLogic';

interface Props {
  /** Seçili gün sayısı (1..span) */
  days: number;
  /** Üst sınır: uygulamayı kullanmaya başladığından bugüne geçen gün */
  span: number;
  onChange: (days: number) => void;
}

const THUMB = 26;

/**
 * Sürgü: sola çek = az gün, sağa çek = çok gün. Sınırı geçen gün sayısı belirler. Resim ya da ek paket gerektirmez.
 * Parmakla sürüklenir, çubuğa dokununca oraya gider; altta hızlı seçimler ve gün gün ince ayar düğmeleri vardır.
 */
export function HorizonSlider({ days, span, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const startX = useRef(0);
  const widthRef = useRef(0);
  const spanRef = useRef(span);
  const changeRef = useRef(onChange);
  spanRef.current = span;
  changeRef.current = onChange;

  // Çubuğa göre konum: alt öğeler dokunmayı yutmadığı için locationX hep çubuğun kendisine göredir.
  const setFromX = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    changeRef.current(daysFromFraction(x / w, spanRef.current));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        setFromX(startX.current);
      },
      onPanResponderMove: (_e, g) => setFromX(startX.current + g.dx),
    })
  ).current;

  const n = clampDays(days, span);
  const f = fractionFromDays(n, span);
  const disabled = span <= 1;
  const picks = quickPicks(span);

  return (
    <View style={styles.wrap}>
      {disabled ? (
        <Text style={styles.note}>Henüz yalnızca bugün var. Zaman geçtikçe sürgünün sınırı uzar.</Text>
      ) : (
        <>
          <View style={styles.row}>
            <Pressable onPress={() => onChange(clampDays(n - 1, span))} style={styles.step} hitSlop={8}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <View
              style={styles.hit}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                widthRef.current = w;
                setWidth(w);
              }}
              {...pan.panHandlers}
            >
              <View pointerEvents="none" style={styles.track} />
              <View pointerEvents="none" style={[styles.fill, { width: width * f }]} />
              <View pointerEvents="none" style={[styles.thumb, { left: Math.max(0, Math.min(width - THUMB, width * f - THUMB / 2)) }]} />
            </View>
            <Pressable onPress={() => onChange(clampDays(n + 1, span))} style={styles.step} hitSlop={8}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
          <View style={styles.ends}>
            <Text style={styles.endText}>1 gün</Text>
            <Text style={styles.endText}>{span} gün</Text>
          </View>
        </>
      )}
      <View style={styles.chips}>
        {picks.map((p) => (
          <Pressable key={p.label} onPress={() => onChange(p.days)} style={[styles.chip, n === p.days && styles.chipOn]}>
            <Text style={[styles.chipText, n === p.days && styles.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 22 },
  hit: { flex: 1, height: 44, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: colors.border },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: colors.aura },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.aura, borderWidth: 3, borderColor: colors.bg },
  ends: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 34 + spacing.md },
  endText: { color: colors.textMuted, fontSize: 10 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { borderColor: colors.aura, backgroundColor: colors.surface },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: colors.aura },
});
