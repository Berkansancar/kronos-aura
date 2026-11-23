import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import {
  DAMACANA_BOX,
  DAMACANA_COLORS as C,
  DAMACANA_PARTS as P,
  clampRatio,
  damacanaInner,
  damacanaPercent,
  damacanaWaterColor,
} from '../services/damacana';

interface Props {
  /** İçilen su / hedef (0-1; fazlası 1 sayılır) */
  ratio: number;
  /** Yükseklik (px); genişlik orandan hesaplanır */
  size?: number;
  /** Doluluk değişince su yavaşça yükselir (açılışta da boştan dolar) */
  animate?: boolean;
}

/**
 * Damacana: içtikçe su seviyesi yükselir, hedefe ulaşınca su nane rengine döner. Resim ya da ek paket gerektirmez;
 * Views ile çizilir. Su, gövdenin yuvarlak köşelerine kırpılır.
 */
export function Damacana({ ratio, size = 100, animate = true }: Props) {
  const target = clampRatio(ratio);
  const level = useRef(new Animated.Value(animate ? 0 : target)).current;

  useEffect(() => {
    if (!animate) {
      level.setValue(target);
      return;
    }
    Animated.timing(level, { toValue: target, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [animate, level, target]);

  const k = size / DAMACANA_BOX.h;
  const inner = damacanaInner();
  const fillH = level.interpolate({ inputRange: [0, 1], outputRange: [0, inner.h * k] });
  const [bTl, bTr, bBr, bBl] = P.body.r;
  const [iTl, iTr, iBr, iBl] = inner.r;
  const bw = Math.max(1, P.body.bw * k);

  return (
    <View
      style={{ width: DAMACANA_BOX.w * k, height: size }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Su doluluğu yüzde ${damacanaPercent(target)}`}
    >
      {/* kapak ve boyun */}
      <View
        style={[
          styles.abs,
          {
            left: P.neck.x * k,
            top: P.neck.y * k,
            width: P.neck.w * k,
            height: P.neck.h * k,
            borderWidth: Math.max(1, P.neck.bw * k),
            borderColor: C.outline,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: P.cap.x * k,
            top: P.cap.y * k,
            width: P.cap.w * k,
            height: P.cap.h * k,
            backgroundColor: C.cap,
            borderTopLeftRadius: P.cap.r[0] * k,
            borderTopRightRadius: P.cap.r[1] * k,
            borderBottomRightRadius: P.cap.r[2] * k,
            borderBottomLeftRadius: P.cap.r[3] * k,
          },
        ]}
      />

      {/* gövde: çerçeve + hafif mavi plastik tonu */}
      <View
        style={[
          styles.abs,
          {
            left: P.body.x * k,
            top: P.body.y * k,
            width: P.body.w * k,
            height: P.body.h * k,
            borderWidth: bw,
            borderColor: C.outline,
            backgroundColor: C.tint,
            borderTopLeftRadius: bTl * k,
            borderTopRightRadius: bTr * k,
            borderBottomRightRadius: bBr * k,
            borderBottomLeftRadius: bBl * k,
          },
        ]}
      />

      {/* su: iç alana kırpılır, alttan yükselir */}
      <View
        style={[
          styles.abs,
          styles.clip,
          {
            left: inner.x * k,
            top: inner.y * k,
            width: inner.w * k,
            height: inner.h * k,
            borderTopLeftRadius: iTl * k,
            borderTopRightRadius: iTr * k,
            borderBottomRightRadius: iBr * k,
            borderBottomLeftRadius: iBl * k,
          },
        ]}
      >
        <Animated.View style={[styles.fill, { height: fillH, backgroundColor: damacanaWaterColor(target) }]}>
          <View style={{ height: Math.max(1.5, 2 * k), backgroundColor: C.surface, opacity: 0.85 }} />
        </Animated.View>
      </View>

      {/* kabartma çizgiler, etiket bandı ve ışık yansıması (suyun üstünde, sabit) */}
      {P.ridges.map((r, i) => (
        <View key={i} style={[styles.abs, { left: r.x * k, top: r.y * k, width: r.w * k, height: Math.max(1, r.h * k), backgroundColor: C.ridge, borderRadius: k }]} />
      ))}
      <View style={[styles.abs, { left: inner.x * k, top: P.label.y * k, width: inner.w * k, height: P.label.h * k, backgroundColor: C.label }]} />
      <View
        style={[
          styles.abs,
          { left: P.glint.x * k, top: P.glint.y * k, width: P.glint.w * k, height: P.glint.h * k, backgroundColor: C.glint, borderRadius: P.glint.w * k },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  clip: { overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
