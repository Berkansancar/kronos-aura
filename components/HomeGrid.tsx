import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { formatClock, formatFullDate, formatWeekday } from '../services/format';
import type { HomeStatCard } from '../services/homeStats';
import {
  HOME_FAVORITE_COUNT,
  addTile,
  availableTiles,
  favoriteTiles,
  isDefaultOrder,
  moveBy,
  positionLabel,
  removeTile,
  selectionAfterRemove,
  tilesFor,
} from '../services/homeLayout';
import {
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
  /** "Bugünün akışı" / "Yarın için plan" */
  subtitle: string;
  /** Görünen kutuların kimlikleri, sırayla (kullanıcının düzeni) */
  order: string[];
  /** Düzen değişti (taşıma, kaldırma, ekleme): üst katman kaydeder */
  onOrder: (next: string[]) => void;
  /** Varsayılan düzene dön */
  onResetOrder: () => void;
  /** Bugünkü üç sayı kartı: adım, su, dil */
  stats: HomeStatCard[];
  /** "Ayrıntılı analiz ve sürgü ›": tam analiz ekranı */
  onAnalysisDetail: () => void;
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

export const TINT: Record<TileGroup, string> = {
  health: 'rgba(95,214,180,0.16)',
  plan: 'rgba(124,156,255,0.16)',
  coach: colors.surfaceAlt,
};

/**
 * Ana ekranın ilk sayfası (sade düzen): gün-tarih-saat, ŞİMDİ kartı, bugünkü üç sayı, "sık kullanılanlar" (düzendeki ilk 5 kutu) ve "Tüm menü".
 * Kısa dokunuş hızlı işlem, basılı tutma detay ekranı. "Düzenle" ile kutular burada seçilir, taşınır, kaldırılır, eklenir.
 */
export function HomeGrid(p: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Saat dakika dakika doğru kalsın
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(id);
  }, []);

  const flash = (m: string | null) => {
    if (!m) return;
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 1800);
  };

  const peek = taskPeek(p.openTitles);
  const all = tilesFor(p.order);
  const favorites = favoriteTiles(p.order);
  const extra = availableTiles(p.order);
  const sel = selected && p.order.includes(selected) ? selected : null;
  const selTile = sel ? all.find((t) => t.id === sel) ?? null : null;
  const selIndex = sel ? p.order.indexOf(sel) : -1;
  const fullGrid = editing || menuOpen;

  const change = (next: string[], select: string | null) => {
    p.onOrder(next);
    setSelected(select);
  };
  const finishEditing = () => {
    setEditing(false);
    setSelected(null);
  };

  /** Bir kutu: düzenlerken seçer, değilse kısa dokunuşla hızlı işlem, basılı tutunca ekranı açar. */
  const renderTile = (tile: HomeTileDef, index: number) => (
    <Pressable
      key={tile.id}
      delayLongPress={LONG_PRESS_MS}
      onPress={() => (editing ? setSelected(sel === tile.id ? null : tile.id) : void Promise.resolve(p.onTap(tile)).then(flash, () => undefined))}
      onLongPress={() => (editing ? undefined : p.onOpen(tile))}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={tile.label}
      accessibilityHint={editing ? 'Taşımak ya da kaldırmak için seç' : 'Basılı tutarak ayrıntılarını aç'}
    >
      <View style={[styles.iconBox, { backgroundColor: TINT[tile.group] }, editing && styles.iconBoxEdit, sel === tile.id && styles.iconBoxSel]}>
        <TileIcon tile={tile} waterRatio={p.waterRatio} />
        {editing && index < HOME_FAVORITE_COUNT && (
          <View style={styles.star}>
            <Text style={styles.starText}>★</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, sel === tile.id && styles.labelSel]} numberOfLines={1}>
        {tile.label}
      </Text>
    </Pressable>
  );

  const renderRows = (list: HomeTileDef[], tail?: React.ReactNode) => {
    const items: React.ReactNode[] = list.map((t, i) => renderTile(t, i));
    if (tail) items.push(tail);
    const rows: React.ReactNode[][] = [];
    for (let i = 0; i < items.length; i += TILE_COLUMNS) rows.push(items.slice(i, i + TILE_COLUMNS));
    return (
      <View style={styles.grid}>
        {rows.map((row, i) => (
          <View key={i} style={styles.row}>
            {row}
            {row.length < TILE_COLUMNS && Array.from({ length: TILE_COLUMNS - row.length }).map((_, k) => <View key={`s${k}`} style={styles.tile} />)}
          </View>
        ))}
      </View>
    );
  };

  const menuTile = (
    <Pressable key="__menu" onPress={() => setMenuOpen(true)} style={styles.tile} accessibilityRole="button" accessibilityLabel="Tüm menü">
      <View style={[styles.iconBox, styles.menuBox]}>
        <Text style={styles.menuGlyph}>▦</Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        Tüm menü
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, editing && { paddingBottom: 170 }]} showsVerticalScrollIndicator={false}>
        {/* Üst satır: ana ekranda gün-tarih-saat; menüde ve düzenlerken başlık */}
        <View style={styles.header}>
          {fullGrid ? (
            <View style={{ flex: 1 }}>
              {menuOpen && !editing ? (
                <Pressable onPress={() => setMenuOpen(false)} hitSlop={10}>
                  <Text style={styles.back}>‹ Geri</Text>
                </Pressable>
              ) : null}
              <Text style={styles.menuTitle}>{editing ? 'Ana ekranı düzenle' : 'Tüm menü'}</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.clock}>{formatClock(now)}</Text>
              <Text style={styles.date}>
                {formatWeekday(now)} · {formatFullDate(now)}
              </Text>
              <Text style={styles.subtitle}>{p.subtitle}</Text>
            </View>
          )}
          <Pressable
            onPress={editing ? finishEditing : () => setEditing(true)}
            hitSlop={10}
            style={[styles.editChip, editing && styles.editChipOn]}
            accessibilityLabel={editing ? 'Düzenlemeyi bitir' : 'Ana ekranı düzenle'}
          >
            <Text style={[styles.editText, editing && styles.editTextOn]}>{editing ? '✓ Bitti' : 'Düzenle'}</Text>
          </Pressable>
          <Pressable onPress={p.onSettings} hitSlop={12} accessibilityLabel="Ayarlar">
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
        </View>

        {editing && (
          <Text style={styles.hint}>
            ★ işaretli ilk {HOME_FAVORITE_COUNT} kutu ana ekranda görünür, diğerleri "Tüm menü"dedir. Bir kutuya dokun, alttaki oklarla yerini değiştir ya da kaldır. Değişiklikler kendiliğinden kaydedilir.
          </Text>
        )}

        {/* Ana ekran */}
        {!fullGrid && (
          <>
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

            <View style={styles.statRow}>
              {p.stats.map((c) => (
                <Pressable key={c.key} onPress={p.onAnalysisDetail} style={styles.statCard} accessibilityLabel={`${c.title}: ${c.value}, ${c.sub}`}>
                  <Text style={styles.statTitle}>{c.title}</Text>
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                    {c.value}
                  </Text>
                  <Text style={styles.statSub} numberOfLines={1}>
                    {c.sub}
                  </Text>
                  {c.ratio !== null && (
                    <View style={styles.statTrack}>
                      <View style={[styles.statFill, { width: `${Math.round(c.ratio * 100)}%`, backgroundColor: c.tone === 'kronos' ? colors.kronos : colors.aura }]} />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
            <Pressable onPress={p.onAnalysisDetail} hitSlop={8} style={styles.detailLink}>
              <Text style={styles.detailText}>Ayrıntılı analiz ve sürgü ›</Text>
            </Pressable>

            <View style={styles.sectionRow}>
              <Text style={styles.section}>Sık kullanılanlar</Text>
              <Text style={styles.sectionNote}>basılı tut: ekranı aç</Text>
            </View>
            {favorites.length === 0 && <Text style={styles.empty}>Sık kullanılan kutu yok. "Düzenle"ye dokunup ekleyebilirsin.</Text>}
            {renderRows(favorites, menuTile)}

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
          </>
        )}

        {/* Tüm menü ve düzenleme: bütün kutular, düzendeki sırayla */}
        {fullGrid && (
          <>
            {all.length === 0 && <Text style={styles.empty}>Kutu yok. "Düzenle"ye dokunup istediğini ekleyebilirsin.</Text>}
            {renderRows(all)}
          </>
        )}

        {editing && (
          <>
            <Text style={styles.section}>Eklenebilir ({extra.length})</Text>
            {extra.length === 0 ? (
              <Text style={styles.empty}>Hepsi ana ekranda ya da menüde.</Text>
            ) : (
              <View style={styles.grid}>
                {chunkTiles<HomeTileDef>(extra, TILE_COLUMNS).map((row, i) => (
                  <View key={i} style={styles.row}>
                    {row.map((tile) => (
                      <Pressable key={tile.id} onPress={() => change(addTile(p.order, tile.id), tile.id)} style={styles.tile} accessibilityLabel={`${tile.label} ekle`}>
                        <View style={[styles.iconBox, styles.iconBoxAdd]}>
                          <TileIcon tile={tile} waterRatio={p.waterRatio} />
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
            {!isDefaultOrder(p.order) && (
              <Pressable onPress={p.onResetOrder} style={styles.ghost}>
                <Text style={styles.ghostText}>Varsayılan düzene dön</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {/* Düzenleme paneli: seçili kutuyu taşı ya da kaldır (ekranın altında sabit) */}
      {editing && (
        <View style={styles.panel}>
          {selTile ? (
            <>
              <Text style={styles.panelTitle}>
                {selTile.label} · {positionLabel(selIndex)}
                {selIndex < HOME_FAVORITE_COUNT ? ' · ana ekranda' : ' · Tüm menü'}
              </Text>
              <View style={styles.panelRow}>
                <MoveButton label="◀" hint="Sola" disabled={selIndex <= 0} onPress={() => change(moveBy(p.order, selTile.id, -1), selTile.id)} />
                <MoveButton label="▶" hint="Sağa" disabled={selIndex >= p.order.length - 1} onPress={() => change(moveBy(p.order, selTile.id, 1), selTile.id)} />
                <MoveButton label="▲" hint="Yukarı" disabled={selIndex <= 0} onPress={() => change(moveBy(p.order, selTile.id, -TILE_COLUMNS), selTile.id)} />
                <MoveButton label="▼" hint="Aşağı" disabled={selIndex >= p.order.length - 1} onPress={() => change(moveBy(p.order, selTile.id, TILE_COLUMNS), selTile.id)} />
                <Pressable onPress={() => change(removeTile(p.order, selTile.id), selectionAfterRemove(p.order, selTile.id))} style={styles.remove}>
                  <Text style={styles.removeText}>Kaldır</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.panelHint}>Taşımak ya da kaldırmak için yukarıdan bir kutuya dokun.</Text>
          )}
        </View>
      )}

      {message && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{message}</Text>
        </View>
      )}
    </View>
  );
}

function MoveButton({ label, hint, disabled, onPress }: { label: string; hint: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.move, disabled && { opacity: 0.35 }]} accessibilityLabel={hint}>
      <Text style={styles.moveText}>{label}</Text>
    </Pressable>
  );
}

export function TileIcon({ tile, waterRatio }: { tile: HomeTileDef; waterRatio: number }) {
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
  clock: { color: colors.text, fontSize: 46, fontWeight: '800', lineHeight: 50 },
  date: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  gear: { color: colors.textMuted, fontSize: 22 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  menuTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  statSub: { color: colors.textMuted, fontSize: 11 },
  statTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6 },
  statFill: { height: 4, borderRadius: 2 },
  detailLink: { alignSelf: 'flex-end', minHeight: 24, justifyContent: 'center' },
  detailText: { color: colors.aura, fontSize: 12, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionNote: { color: colors.textMuted, fontSize: 11 },
  menuBox: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  menuGlyph: { color: colors.text, fontSize: 24 },
  star: { position: 'absolute', right: -5, top: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.aura, alignItems: 'center', justifyContent: 'center' },
  starText: { color: colors.bg, fontSize: 11, fontWeight: '800', lineHeight: 13 },
  editChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  editChipOn: { borderColor: colors.aura, backgroundColor: colors.aura },
  editText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  editTextOn: { color: colors.bg },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  iconBoxEdit: { borderWidth: 2, borderColor: 'transparent' },
  iconBoxSel: { borderColor: colors.aura },
  iconBoxAdd: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed' },
  plus: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.aura, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.bg, fontSize: 15, fontWeight: '800', lineHeight: 17 },
  labelSel: { color: colors.aura },
  ghost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  ghostText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 56, gap: spacing.sm },
  panelTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  panelHint: { color: colors.textMuted, fontSize: 13 },
  panelRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  move: { width: 46, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  moveText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  remove: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  empty: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
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
