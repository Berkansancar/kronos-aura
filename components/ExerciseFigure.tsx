import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { ExerciseVariant } from '../services/exerciseData';
import { buildFigure, VIEW_H, VIEW_W, type PoseSpec, type SegTone } from '../services/exerciseFigure';

const TONE_COLOR: Record<SegTone, string> = {
  body: colors.text,
  far: '#7A849A',
  prop: '#5B6680',
  ground: colors.border,
};
const TONE_WIDTH: Record<SegTone, number> = { body: 3.4, far: 3.4, prop: 1.6, ground: 1 };

/**
 * Tek bir pozu çizer. Dış bağımlılık yok: çizgiler döndürülmüş ince kutularla, baş bir daireyle çizilir.
 * Kutunun genişliği ekrana göre ölçülür, çizim orantılı büyür.
 */
export function ExercisePose({ pose }: { pose: PoseSpec }) {
  const [w, setW] = useState(0);
  const fig = useMemo(() => buildFigure(pose), [pose]);
  const k = w / VIEW_W;
  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));

  return (
    <View style={[styles.canvas, { height: w > 0 ? VIEW_H * k : undefined }]} onLayout={onLayout}>
      {w > 0 && (
        <>
          {fig.rects.map((r, i) => (
            <View
              key={`r${i}`}
              style={{
                position: 'absolute',
                left: r.x * k,
                top: r.y * k,
                width: r.w * k,
                height: r.h * k,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: TONE_COLOR.prop,
                borderRadius: 2,
              }}
            />
          ))}
          {fig.segs.map((s, i) => {
            const dx = (s.x2 - s.x1) * k;
            const dy = (s.y2 - s.y1) * k;
            const len = Math.hypot(dx, dy);
            if (len < 0.5) return null;
            const t = TONE_WIDTH[s.tone] * k;
            const mx = ((s.x1 + s.x2) / 2) * k;
            const my = ((s.y1 + s.y2) / 2) * k;
            return (
              <View
                key={`s${i}`}
                style={{
                  position: 'absolute',
                  left: mx - len / 2,
                  top: my - t / 2,
                  width: len,
                  height: Math.max(1, t),
                  borderRadius: t / 2,
                  backgroundColor: TONE_COLOR[s.tone],
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                }}
              />
            );
          })}
          <View
            style={{
              position: 'absolute',
              left: (fig.head.cx - fig.head.r) * k,
              top: (fig.head.cy - fig.head.r) * k,
              width: fig.head.r * 2 * k,
              height: fig.head.r * 2 * k,
              borderRadius: fig.head.r * k,
              borderWidth: Math.max(1.5, 1.2 * k),
              borderColor: colors.aura,
            }}
          />
        </>
      )}
    </View>
  );
}

/** Basamağın çizimleri: iki pozsa yan yana (başlangıç / bitiş), tek pozsa ortada. */
export function ExerciseFigures({ variant }: { variant: ExerciseVariant }) {
  const two = variant.poses.length > 1;
  return (
    <View style={styles.row}>
      {variant.poses.map((p, i) => (
        <View key={i} style={[styles.cell, !two && styles.cellSingle]}>
          <ExercisePose pose={p} />
          <Text style={styles.caption}>{variant.poseLabels[i] ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    aspectRatio: VIEW_W / VIEW_H,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1, gap: spacing.xs },
  cellSingle: { flex: 0, width: '70%', alignSelf: 'center' },
  caption: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
