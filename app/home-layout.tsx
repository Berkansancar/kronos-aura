import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { TileIcon, TINT } from '../components/HomeGrid';
import { colors, radius, spacing } from '../constants/theme';
import { TILE_COLUMNS, chunkTiles, type HomeTileDef } from '../services/homeGrid';
import {
  addTile,
  availableTiles,
  getHomeLayout,
  isDefaultOrder,
  moveBy,
  positionLabel,
  removeTile,
  resetHomeLayout,
  saveHomeLayout,
  selectionAfterRemove,
  tilesFor,
} from '../services/homeLayout';

export default function HomeLayoutScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getHomeLayout(db)
        .then(setOrder)
        .catch(() => setOrder([]));
    }, [db])
  );

  // Her değişiklik anında kaydedilir; ayrıca "Kaydet" düğmesi yoktur.
  const apply = (next: string[], select: string | null) => {
    setOrder(next);
    setSelected(select);
    saveHomeLayout(db, next).catch(() => Alert.alert('Kaydedilemedi', 'Düzen kaydedilemedi, tekrar dene.'));
  };

  if (!order) return <SafeAreaView style={styles.screen} edges={['top']} />;

  const visible = tilesFor(order);
  const rows = chunkTiles(visible, TILE_COLUMNS);
  const extra = availableTiles(order);
  const sel = selected && order.includes(selected) ? selected : null;
  const selTile = sel ? visible.find((t) => t.id === sel) ?? null : null;
  const selIndex = sel ? order.indexOf(sel) : -1;

  const reset = () =>
    Alert.alert('Varsayılan düzene dönülsün mü?', 'Kutuların sırası ve eklediklerin ya da kaldırdıkların ilk haline döner.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Dön',
        onPress: () =>
          resetHomeLayout(db)
            .then((o) => {
              setOrder(o);
              setSelected(null);
            })
            .catch(() => undefined),
      },
    ]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Ana ekranı düzenle</Text>
        <Text style={styles.sub}>Bir kutuya dokun, sonra aşağıdaki oklarla yerini değiştir ya da kaldır. Değişiklikler kendiliğinden kaydedilir.</Text>

        <Text style={styles.section}>Ana ekranda ({visible.length})</Text>
        {visible.length === 0 ? (
          <Text style={styles.muted}>Ana ekranda kutu yok. Aşağıdan istediğini ekle.</Text>
        ) : (
          <View style={styles.grid}>
            {rows.map((row, i) => (
              <View key={i} style={styles.row}>
                {row.map((tile) => (
                  <Pressable key={tile.id} onPress={() => setSelected(sel === tile.id ? null : tile.id)} style={styles.tile} accessibilityLabel={tile.label}>
                    <View style={[styles.iconBox, { backgroundColor: TINT[tile.group] }, sel === tile.id && styles.iconSel]}>
                      <TileIcon tile={tile} waterRatio={0.6} />
                    </View>
                    <Text style={[styles.label, sel === tile.id && styles.labelSel]} numberOfLines={1}>
                      {tile.label}
                    </Text>
                  </Pressable>
                ))}
                {row.length < TILE_COLUMNS && Array.from({ length: TILE_COLUMNS - row.length }).map((_, k) => <View key={`s${k}`} style={styles.tile} />)}
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>Eklenebilir ({extra.length})</Text>
        {extra.length === 0 ? (
          <Text style={styles.muted}>Hepsi ana ekranda.</Text>
        ) : (
          <View style={styles.grid}>
            {chunkTiles<HomeTileDef>(extra, TILE_COLUMNS).map((row, i) => (
              <View key={i} style={styles.row}>
                {row.map((tile) => (
                  <Pressable key={tile.id} onPress={() => apply(addTile(order, tile.id), tile.id)} style={styles.tile} accessibilityLabel={`${tile.label} ekle`}>
                    <View style={[styles.iconBox, styles.iconAdd]}>
                      <TileIcon tile={tile} waterRatio={0.6} />
                      <View style={styles.plus}>
                        <Text style={styles.plusText}>+</Text>
                      </View>
                    </View>
                    <Text style={styles.label} numberOfLines={1}>
                      {tile.label}
                    </Text>
                  </Pressable>
                ))}
                {row.length < TILE_COLUMNS && Array.from({ length: TILE_COLUMNS - row.length }).map((_, k) => <View key={`e${k}`} style={styles.tile} />)}
              </View>
            ))}
          </View>
        )}
        <Text style={styles.hint}>Eklenen kutu sona gelir; sonra yerini değiştirebilirsin. Kutuya ana ekranda basılı tutunca ilgili ekran açılır.</Text>

        {!isDefaultOrder(order) && (
          <Pressable onPress={reset} style={styles.ghost}>
            <Text style={styles.ghostText}>Varsayılan düzene dön</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.panel}>
        {selTile ? (
          <>
            <Text style={styles.panelTitle}>
              {selTile.label} · {positionLabel(selIndex)}
            </Text>
            <View style={styles.panelRow}>
              <MoveButton label="◀" hint="Sola" disabled={selIndex <= 0} onPress={() => apply(moveBy(order, selTile.id, -1), selTile.id)} />
              <MoveButton label="▶" hint="Sağa" disabled={selIndex >= order.length - 1} onPress={() => apply(moveBy(order, selTile.id, 1), selTile.id)} />
              <MoveButton label="▲" hint="Yukarı" disabled={selIndex <= 0} onPress={() => apply(moveBy(order, selTile.id, -TILE_COLUMNS), selTile.id)} />
              <MoveButton label="▼" hint="Aşağı" disabled={selIndex >= order.length - 1} onPress={() => apply(moveBy(order, selTile.id, TILE_COLUMNS), selTile.id)} />
              <Pressable onPress={() => apply(removeTile(order, selTile.id), selectionAfterRemove(order, selTile.id))} style={styles.remove}>
                <Text style={styles.removeText}>Kaldır</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.panelHint}>Taşımak ya da kaldırmak için yukarıdan bir kutuya dokun.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function MoveButton({ label, hint, disabled, onPress }: { label: string; hint: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.move, disabled && { opacity: 0.35 }]} accessibilityLabel={hint}>
      <Text style={styles.moveText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: spacing.md },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, alignItems: 'center', gap: 6, minHeight: 78 },
  iconBox: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  iconSel: { borderColor: colors.aura },
  iconAdd: { backgroundColor: colors.surface, borderColor: colors.border, borderStyle: 'dashed' },
  plus: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.aura, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.bg, fontSize: 15, fontWeight: '800', lineHeight: 17 },
  label: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  labelSel: { color: colors.aura },
  ghost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center', marginTop: spacing.sm },
  ghostText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  panel: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  panelTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  panelHint: { color: colors.textMuted, fontSize: 13 },
  panelRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  move: { width: 46, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  moveText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  remove: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
});
