import { StyleSheet, Text, View } from 'react-native';
import { DRAWN_ICON_TEXT, ROUTINE_WATER_ICONS, WATER_BOX, waterIconRects, type WaterKind } from '../services/waterIcon';

interface Props {
  kind: WaterKind;
  /** Yükseklik (px); genişlik orandan hesaplanır */
  size?: number;
}

/** Su bardağı ve şişe simgesi. Resim dosyası, yazı tipi ya da ek paket gerektirmez; Views ile çizilir. */
export function WaterIcon({ kind, size = 32 }: Props) {
  const k = size / WATER_BOX.h;
  return (
    <View style={{ width: WATER_BOX.w * k, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {waterIconRects(kind).map((r, i) => {
        const half = Math.min(r.w, r.h) / 2;
        const [tl, tr, br, bl] = (r.r ?? [0, 0, 0, 0]).map((v) => Math.min(v, half));
        const bw = r.bw ? Math.max(1, r.bw * k) : 0;
        return (
          <View
            key={i}
            style={[
              styles.abs,
              {
                left: r.x * k,
                top: r.y * k,
                width: r.w * k,
                height: r.h * k,
                backgroundColor: r.fill,
                borderTopLeftRadius: tl * k,
                borderTopRightRadius: tr * k,
                borderBottomRightRadius: br * k,
                borderBottomLeftRadius: bl * k,
              },
              r.border ? { borderColor: r.border, borderWidth: bw, borderTopWidth: r.openTop ? 0 : bw } : null,
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * Rutin simgesi: "ico:glass" ve "ico:bottle" çizilir, diğerleri emoji olarak yazılır.
 * `size` emoji için yazı boyutunu, çizilen simge için yüksekliği belirler.
 */
export function RoutineIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  const kind = ROUTINE_WATER_ICONS[icon];
  if (kind) return <WaterIcon kind={kind} size={Math.round(size * 1.25)} />;
  return <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }}>{icon in DRAWN_ICON_TEXT ? DRAWN_ICON_TEXT[icon] : icon}</Text>;
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
