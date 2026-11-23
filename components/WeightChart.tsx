import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import { formatKg, type ChartGeometry } from '../services/bodyLogic';

const SHORT_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortDay = (key: string): string => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[(m ?? 1) - 1]}`;
};

/**
 * Kilo çizgi grafiği: nokta ve döndürülmüş ince çizgi parçalarıyla (SVG gerekmez). Geometri services/bodyLogic.ts içinde hesaplanır.
 */
export function WeightChart({ geo, width, height }: { geo: ChartGeometry; width: number; height: number }) {
  if (geo.points.length === 0) {
    return (
      <View style={[styles.box, { width, height }]}>
        <Text style={styles.empty}>İlk kilonu yazınca grafik burada başlar.</Text>
      </View>
    );
  }
  return (
    <View>
      <View style={[styles.box, { width, height }]} accessibilityLabel={`Kilo grafiği, ${geo.points.length} kayıt`}>
        {geo.targetY !== null && <View style={[styles.target, { top: geo.targetY }]} />}
        {geo.segments.map((s, i) => (
          <View
            key={`s${i}`}
            style={[styles.seg, { left: s.cx - s.length / 2, top: s.cy - 1, width: s.length, transform: [{ rotate: `${s.angle}deg` }] }]}
          />
        ))}
        {geo.points.map((p, i) => {
          const last = i === geo.points.length - 1;
          const size = last ? 12 : 8;
          return <View key={p.day} style={[styles.dot, last && styles.dotLast, { left: p.x - size / 2, top: p.y - size / 2, width: size, height: size, borderRadius: size / 2 }]} />;
        })}
        <Text style={[styles.axis, { top: 2, left: 6 }]}>{formatKg(geo.maxKg)}</Text>
        <Text style={[styles.axis, { bottom: 2, left: 6 }]}>{formatKg(geo.minKg)}</Text>
      </View>
      <View style={[styles.dates, { width }]}>
        <Text style={styles.axisDate}>{shortDay(geo.startDay)}</Text>
        {geo.targetY !== null && <Text style={styles.targetLabel}>hedef çizgisi</Text>}
        <Text style={styles.axisDate}>{shortDay(geo.endDay)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', justifyContent: 'center' },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  seg: { position: 'absolute', height: 2, backgroundColor: colors.kronos, borderRadius: 1 },
  dot: { position: 'absolute', backgroundColor: colors.kronos },
  dotLast: { backgroundColor: colors.text },
  target: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.aura, opacity: 0.7 },
  axis: { position: 'absolute', color: colors.textMuted, fontSize: 10 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  axisDate: { color: colors.textMuted, fontSize: 11 },
  targetLabel: { color: colors.aura, fontSize: 11 },
});
