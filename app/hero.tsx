import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { addGameReward, buyGameReward, deleteGameReward, loadGame, refundGamePurchase, type GameData } from '../services/game';
import { REWARD_SUGGESTIONS, GameError } from '../services/gameLogic';
import { questLine } from '../services/questsLogic';
import { getGoalBundle } from '../services/goalsSettings';
import { getLanguageSettings } from '../services/language';
import type { GameGoals } from '../services/gameLogic';

export default function HeroScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GameData | null>(null);
  const [goals, setGoals] = useState<GameGoals>({ waterGoalMl: null, languageGoalMin: null });
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [showAllBadges, setShowAllBadges] = useState(false);

  const load = useCallback(async () => {
    try {
      const bundle = await getGoalBundle();
      const lang = await getLanguageSettings(db).catch(() => null);
      const g: GameGoals = { waterGoalMl: bundle.waterGoalMl, languageGoalMin: lang ? lang.goalMin : null };
      setGoals(g);
      setData(await loadGame(db, new Date(), g));
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const fail = (e: unknown) => setMessage({ text: e instanceof GameError || e instanceof Error ? e.message : String(e), ok: false });

  const add = async (t: string, p: number) => {
    try {
      await addGameReward(db, t, p);
      setTitle('');
      setPrice('');
      setMessage({ text: `"${t.trim()}" ödül listene eklendi.`, ok: true });
      await load();
    } catch (e) {
      fail(e);
    }
  };

  const buy = async (id: string, name: string) => {
    try {
      const next = await buyGameReward(db, id, new Date(), goals);
      setData(next);
      setMessage({ text: `Keyfini çıkar: ${name} 🎉`, ok: true });
    } catch (e) {
      fail(e);
    }
  };

  const confirmDelete = (id: string, name: string) =>
    Alert.alert('Ödülü sil', `"${name}" listeden kalksın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await deleteGameReward(db, id).catch(() => undefined);
          await load();
        },
      },
    ]);

  const sum = data?.summary;
  const state = data?.state;
  const badges = sum ? (showAllBadges ? sum.badges : sum.badges.filter((b) => b.earned).concat(sum.badges.filter((b) => !b.earned).slice(0, 3))) : [];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Kahraman</Text>

        {loading || !sum || !state ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.heroRow}>
                <Text style={styles.avatar}>{sum.rank.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.big}>Seviye {sum.level}</Text>
                  <Text style={styles.muted}>{sum.rank.title}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.gold}>🪙 {sum.gold}</Text>
                  <Text style={styles.muted}>altın</Text>
                </View>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(sum.levelInfo.ratio * 100)}%` }]} />
              </View>
              <Text style={styles.muted}>
                {sum.levelInfo.into} / {sum.levelInfo.needed} XP · sonraki seviyeye {sum.levelInfo.needed - sum.levelInfo.into} XP
              </Text>
              <View style={styles.statRow}>
                <Stat label="Seri" value={sum.streak.current > 0 ? `🔥 ${sum.streak.current}` : '–'} />
                <Stat label="En uzun" value={sum.streak.best > 0 ? `${sum.streak.best}` : '–'} />
                <Stat label="Bu hafta" value={`${sum.weekXp} XP`} />
                <Stat label="Bitirilen" value={`${sum.tasksTotal} iş`} />
              </View>
            </View>

            {data && (
              <>
                <Text style={styles.section}>Haftalık görevler</Text>
                <View style={styles.card}>
                  {data.quests.current.quests.map((q) => (
                    <View key={q.id} style={styles.questRow}>
                      <Text style={styles.questIcon}>{q.done ? '✅' : q.icon}</Text>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.questTitle, q.done && { color: colors.aura }]}>{q.title}</Text>
                        <View style={styles.track}>
                          <View style={[styles.fill, { width: `${Math.round(q.ratio * 100)}%` }]} />
                        </View>
                        <Text style={styles.muted}>
                          {Math.min(q.progress, q.target)} / {q.target} {q.unit} · {q.done ? `+${q.xp} XP kazandın` : `+${q.xp} XP`}
                        </Text>
                      </View>
                    </View>
                  ))}
                  <Text style={styles.muted}>
                    {questLine(data.quests.current, new Date().getDay() === 0)}
                  </Text>
                  <Text style={styles.muted}>
                    Görevler her Pazartesi yenilenir. Tamamlamazsan puan düşmez. Toplam {data.quests.totalCompleted} görev · +{data.quests.totalXp} XP.
                  </Text>
                </View>
              </>
            )}

            <Text style={styles.section}>Bugün</Text>
            <View style={styles.card}>
              {sum.today.parts.length === 0 ? (
                <Text style={styles.body}>Bugün henüz puan yok. Bir iş bitirince, su hedefini tamamlayınca ya da dil çalışınca puan gelir.</Text>
              ) : (
                <>
                  <Text style={styles.big}>+{sum.today.xp} XP</Text>
                  {sum.today.parts.map((p) => (
                    <View key={p.label} style={styles.row}>
                      <Text style={styles.rowLabel}>{p.label}</Text>
                      <Text style={styles.rowValue}>+{p.xp}</Text>
                    </View>
                  ))}
                </>
              )}
              <Text style={styles.muted}>Puan düşmez, ceza yok. Seri, bir günlük boşlukla bozulmaz (dinlenme günü).</Text>
            </View>

            <Text style={styles.section}>Ödüller</Text>
            <View style={styles.card}>
              <Text style={styles.muted}>Kazandığın altınla kendine koyduğun ödülleri "satın alırsın". Ödülü sen belirlersin.</Text>
              {state.rewards.length === 0 && <Text style={styles.body}>Henüz ödül yok. Aşağıdan ekle.</Text>}
              {state.rewards.map((r) => {
                const can = sum.gold >= r.price;
                return (
                  <View key={r.id} style={styles.rewardRow}>
                    <Pressable onLongPress={() => confirmDelete(r.id, r.title)} style={{ flex: 1 }}>
                      <Text style={styles.rewardTitle} numberOfLines={2}>
                        {r.title}
                      </Text>
                      <Text style={styles.muted}>🪙 {r.price} · silmek için basılı tut</Text>
                    </Pressable>
                    <Pressable disabled={!can} onPress={() => buy(r.id, r.title)} style={[styles.buyBtn, !can && { opacity: 0.4 }]}>
                      <Text style={styles.buyText}>Al</Text>
                    </Pressable>
                  </View>
                );
              })}
              <Text style={styles.label}>Yeni ödül</Text>
              <View style={styles.chipRow}>
                {REWARD_SUGGESTIONS.filter((s) => !state.rewards.some((r) => r.title === s.title)).map((s) => (
                  <Pressable key={s.title} onPress={() => add(s.title, s.price)} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {s.title} · 🪙 {s.price}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.customRow}>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Ödülün adı"
                  placeholderTextColor={colors.textMuted}
                  maxLength={40}
                  style={[styles.input, { flex: 1 }]}
                />
                <TextInput
                  value={price}
                  onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))}
                  placeholder="Altın"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  maxLength={4}
                  style={[styles.input, { width: 76 }]}
                />
                <Pressable onPress={() => add(title, Number(price))} style={styles.addBtn}>
                  <Text style={styles.addText}>Ekle</Text>
                </Pressable>
              </View>
              {message && <Text style={[styles.message, { color: message.ok ? colors.aura : colors.danger }]}>{message.text}</Text>}
            </View>

            {state.purchases.length > 0 && (
              <>
                <Text style={styles.section}>Son aldıkların</Text>
                <View style={styles.card}>
                  {[...state.purchases].reverse().slice(0, 5).map((p) => (
                    <View key={p.id} style={styles.row}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {p.title} · 🪙 {p.price}
                      </Text>
                      <Pressable
                        onPress={async () => {
                          await refundGamePurchase(db, p.id).catch(() => undefined);
                          await load();
                        }}
                        hitSlop={8}
                      >
                        <Text style={styles.muted}>Geri al</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.section}>
              Rozetler · {sum.earnedBadges} / {sum.badges.length}
            </Text>
            <View style={styles.card}>
              <View style={styles.badgeGrid}>
                {badges.map((b) => (
                  <View key={b.id} style={[styles.badge, !b.earned && { opacity: 0.45 }]}>
                    <Text style={styles.badgeIcon}>{b.earned ? b.icon : '🔒'}</Text>
                    <Text style={styles.badgeTitle}>{b.title}</Text>
                    <Text style={styles.badgeHint}>{b.earned ? 'Kazandın' : b.hint}</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={() => setShowAllBadges((v) => !v)} hitSlop={8}>
                <Text style={styles.link}>{showAllBadges ? 'Daha az göster' : 'Tüm rozetleri göster'}</Text>
              </Pressable>
            </View>
            <Text style={styles.footnote}>
              Puanlar kayıtlarından hesaplanır: bir işi geri alırsan puanı da geri gider. İş: 10 XP + her 5 dakika için 1, rutin 5, su hedefi 10,
              dil çalışması 2 dakikada 1 (hedefi tamamlarsan +10). Altın, XP'nin yarısıdır.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { fontSize: 44 },
  big: { color: colors.text, fontSize: 24, fontWeight: '800' },
  gold: { color: colors.text, fontSize: 22, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.aura },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 11 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  rowLabel: { flex: 1, color: colors.text, fontSize: 14 },
  rowValue: { color: colors.aura, fontSize: 14, fontWeight: '800' },
  questRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  questIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  questTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rewardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  buyBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    backgroundColor: colors.auraSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  buyText: { color: colors.aura, fontWeight: '800', fontSize: 14 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
  },
  addBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  addText: { color: colors.aura, fontWeight: '800', fontSize: 14 },
  message: { fontSize: 13, lineHeight: 19 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    width: '31%',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
  },
  badgeIcon: { fontSize: 26 },
  badgeTitle: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  badgeHint: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  link: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
