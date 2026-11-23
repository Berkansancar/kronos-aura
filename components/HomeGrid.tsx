import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import {
  HOME_TILES,
  ICON_AURA,
  ICON_DAMACANA,
  ICON_KRONOS,
  LONG_PRESS_MS,
  TILE_COLUMNS,
  chunkTiles,
  isSpecialIcon,
  taskPeek,
  type HomeTileDef,
  type TileGroup,
} from '../services/homeGrid';
import { Damacana } from './Damacana';

interface Props {
  title: string;
  subtitle: string;
  /** "ŞİMDİ" kartı (rehberden); yoksa kart görünmez */
  nowText: string | null;
  nowNote: string | null;
  onNow: () => void;
  /** Su kutusundaki damacananın doluluğu (0-1) */
  waterRatio: number;
  openCount: number;
  openTitles: string[];
  /** Görev satırlarına dokunulunca tam listeye geçilir */
  onTasks: () => void;
  onSettings: () => void;
  /** Kısa dokunuş: hızlı işlem yapar ve ekranda gösterilecek kısa mesajı döndürür */
  onTap: (tile: HomeTileDef) => Promise<string | null> | string | null;
  /** Basılı tutma: ilgili ekranı açar */
  onOpen: (tile: HomeTileDef) => void;
}

const TINT: Record<TileGroup, string> = {
  health: 'rgba(95,214,180,0.16)',
  plan: 'rgba(124,156,255,0.16)',
  coach: colors.surfaceAlt,
};

/** Ana ekranın ilk sayfası: simgeli kutular. Kısa dokunuş hızlı işlem, basılı tutma detay ekranı. */
export function HomeGrid(p: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const flash = (m: string | null) => {
    if (!m) return;
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 1800);
  };

  const peek = taskPeek(p.openTitles);
  const rows = chunkTiles(HOME_TILES, TILE_COLUMNS);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.date}>{p.title}</Text>
            <Text style={styles.subtitle}>{p.subtitle}</Text>
          </View>
          <Pressable onPress={p.onSettings} hitSlop={12} accessibilityLabel="Ayarlar">
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>Basılı tut: detay · Yana kaydır: tüm akış ›</Text>

        {p.nowText && (
          <Pressable onPress={p.onNow} style={styles.nowCard}>
            <Text style={styles.nowLabel}>ŞİMDİ</Text>
            <Text style={styles.nowText} numberOfLines={2}>
              {p.nowText}
            </Text>
            {p.nowNote ? (
              <Text style={styles.nowNote} numberOfLines={2}>
                {p.nowNote}
              </Text>
            ) : null}
          </Pressable>
        )}

        <View style={styles.grid}>
          {rows.map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((tile) => (
                <Pressable
                  key={tile.id}
                  delayLongPress={LONG_PRESS_MS}
                  onPress={() => void Promise.resolve(p.onTap(tile)).then(flash, () => undefined)}
                  onLongPress={() => p.onOpen(tile)}
                  style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={tile.label}
                  accessibilityHint="Basılı tutarak ayrıntılarını aç"
                >
                  <View style={[styles.iconBox, { backgroundColor: TINT[tile.group] }]}>
                    <TileIcon tile={tile} waterRatio={p.waterRatio} />
                  </View>
                  <Text style={styles.label} numberOfLines={1}>
                    {tile.label}
                  </Text>
                </Pressable>
              ))}
              {/* son satır eksikse sütunlar hizalı kalsın */}
              {row.length < TILE_COLUMNS && Array.from({ length: TILE_COLUMNS - row.length }).map((_, k) => <View key={`s${k}`} style={styles.tile} />)}
            </View>
          ))}
        </View>

        <Pressable onPress={p.onTasks} style={styles.tasks}>
          <View style={styles.tasksHead}>
            <Text style={styles.tasksTitle}>Görevler</Text>
            <Text style={styles.tasksCount}>{p.openCount > 0 ? `${p.openCount} açık ›` : 'tam liste ›'}</Text>
          </View>
          {peek.shown.length === 0 ? (
            <Text style={styles.taskEmpty}>Açık görev yok. Aşağıdaki + ile ekleyebilirsin.</Text>
          ) : (
            peek.shown.map((t, i) => (
              <Text key={i} style={styles.taskRow} numberOfLines={1}>
                ○  {t}
              </Text>
            ))
          )}
          {peek.more > 0 && <Text style={styles.taskMore}>+{peek.more} görev daha</Text>}
        </Pressable>
      </ScrollView>

      {message && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{message}</Text>
        </View>
      )}
    </View>
  );
}

function TileIcon({ tile, waterRatio }: { tile: HomeTileDef; waterRatio: number }) {
  if (tile.icon === ICON_DAMACANA) return <Damacana ratio={waterRatio} size={40} />;
  if (tile.icon === ICON_KRONOS || tile.icon === ICON_AURA) {
    const kronos = tile.icon === ICON_KRONOS;
    return (
      <View style={[styles.coachDot, { backgroundColor: kronos ? colors.kronos : colors.aura }]}>
        <Text style={styles.coachLetter}>{kronos ? 'K' : 'A'}</Text>
      </View>
    );
  }
  return <Text style={styles.emoji}>{isSpecialIcon(tile.icon) ? '' : tile.icon}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  gear: { color: colors.textMuted, fontSize: 22 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  nowCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  nowLabel: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  nowText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  nowNote: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, alignItems: 'center', gap: 6, minHeight: 78 },
  iconBox: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
  coachDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  coachLetter: { color: colors.bg, fontSize: 18, fontWeight: '800' },
  label: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  tasks: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  tasksHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tasksTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tasksCount: { color: colors.textMuted, fontSize: 12 },
  taskRow: { color: colors.text, fontSize: 14 },
  taskMore: { color: colors.textMuted, fontSize: 12 },
  taskEmpty: { color: colors.textMuted, fontSize: 13 },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 84,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  toastText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
});
