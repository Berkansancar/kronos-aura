import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { listRoutines } from '../database/repository';
import type { DayReview, Routine, RoutineIdea } from '../database/types';
import { isSharingWithAi } from '../services/activity';
import { getAiConfig } from '../services/ai/settings';
import {
  addIdeaAsRoutine,
  buildManualReviewPrompt,
  loadOrCreateReview,
  planForTomorrow,
  reviewAvailable,
  reviewDayOf,
  saveManualReview,
  skipForTomorrow,
  tomorrowAnswers,
  type TomorrowAnswer,
} from '../services/dayReview';
import { factChips, type DayFacts } from '../services/dayReviewLogic';
import { formatDayTitle } from '../services/format';
import { refreshReminders } from '../services/reminderSync';
import { retireRoutine } from '../services/routineFlow';
import { formatAskTime } from '../services/routineLogic';
import { askNotificationPermission, hasNotificationPermission } from '../services/routineReminders';

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

export default function ReviewScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [facts, setFacts] = useState<DayFacts | null>(null);
  const [review, setReview] = useState<DayReview | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [answers, setAnswers] = useState<Map<string, TomorrowAnswer>>(new Map());
  const [busy, setBusy] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualMsg, setManualMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLists = useCallback(async () => {
    const n = new Date();
    setRoutines(await listRoutines(db, 'ACTIVE'));
    setAnswers(await tomorrowAnswers(db, n));
  }, [db]);

  const generate = useCallback(
    async (force: boolean) => {
      const n = new Date();
      setNow(n);
      setLoading(true);
      setAiError(null);
      try {
        const cfg = await getAiConfig();
        setHasKey(cfg !== null);
        const share = await isSharingWithAi();
        const result = await loadOrCreateReview(db, n, { cfg, shareActivity: share, force });
        setFacts(result.facts);
        setReview(result.review);
        setAiError(result.aiError);
        await loadLists();
        await refreshReminders(db, n).catch(() => undefined);
      } catch (e) {
        Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [db, loadLists]
  );

  useFocusEffect(
    useCallback(() => {
      const n = new Date();
      setNow(n);
      if (!reviewAvailable(n)) {
        setLoading(false);
        return;
      }
      generate(false);
    }, [generate])
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await loadLists();
      await refreshReminders(db).catch(() => undefined);
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const permissionPrompt = async () => {
    if (!(await hasNotificationPermission())) await askNotificationPermission();
  };

  const answer = (r: Routine, a: TomorrowAnswer) =>
    run(async () => {
      if (a === 'ACCEPTED') await planForTomorrow(db, r, new Date());
      else await skipForTomorrow(db, r, new Date());
    });

  const confirmRetire = (r: Routine) =>
    Alert.alert('Bir daha yapmayacak mısın?', `"${r.title}" listenden kalkar. Geri alabilirsin.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Evet, bırak', style: 'destructive', onPress: () => run(() => retireRoutine(db, r)) },
    ]);

  const addIdea = (idea: RoutineIdea) =>
    run(async () => {
      await addIdeaAsRoutine(db, idea);
      await permissionPrompt();
    });

  const addAll = (ideas: RoutineIdea[]) =>
    run(async () => {
      for (const idea of ideas) await addIdeaAsRoutine(db, idea);
      await permissionPrompt();
    });

  // Elle yol: ücretsiz bir sohbet uygulamasına yapıştırılacak özeti kopyala
  const copyPrompt = async () => {
    setManualMsg(null);
    try {
      const text = await buildManualReviewPrompt(db, new Date());
      try {
        await Clipboard.setStringAsync(text);
        setCopied(true);
      } catch {
        // Pano açılamazsa paylaşım menüsü (içinde "Kopyala" da var) yedek olur.
        await Share.share({ message: text });
      }
    } catch (e) {
      setManualMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  };

  const pasteAnswer = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        setManualMsg({ text: 'Panoda metin yok. Önce yapay zekânın cevabını kopyala.', ok: false });
        return;
      }
      setManualText(text);
      setManualMsg(null);
    } catch {
      setManualMsg({ text: 'Panoya erişilemedi. Kutuya basılı tutup "Yapıştır"ı seçebilirsin.', ok: false });
    }
  };

  const applyManual = async () => {
    setBusy(true);
    setManualMsg(null);
    try {
      const saved = await saveManualReview(db, new Date(), manualText);
      setReview(saved);
      setAiError(null);
      setManualText('');
      setCopied(false);
      setManualMsg({ text: 'Eklendi. Yorum ve fikirler yukarıda.', ok: true });
      await loadLists();
      await refreshReminders(db).catch(() => undefined);
    } catch (e) {
      setManualMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const reviewDay = reviewDayOf(now);
  const tomorrowTitle = formatDayTitle(new Date(reviewDay.getFullYear(), reviewDay.getMonth(), reviewDay.getDate() + 1));
  const existing = new Set(routines.map((r) => norm(r.title)));
  const ideas = review?.payload.ideas ?? [];
  const freshIdeas = ideas.filter((i) => !existing.has(norm(i.title)));

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün sonu</Text>
        <Text style={styles.sub}>{formatDayTitle(reviewDay)}</Text>

        {!reviewAvailable(now) ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>
              Gün sonu değerlendirmesi akşam 20:00'den sonra açılır; gün bitmeden yorumlamak eksik kalır.
              Akşam tekrar bak.
            </Text>
          </View>
        ) : loading && !review ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
            <Text style={styles.cardText}>Günü değerlendiriyorum…</Text>
          </View>
        ) : (
          <>
            {facts && (
              <View style={styles.chips}>
                {factChips(facts).map((c) => (
                  <View key={c} style={styles.chip}>
                    <Text style={styles.chipText}>{c}</Text>
                  </View>
                ))}
              </View>
            )}

            {review && (
              <>
                <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
                  <Text style={[styles.coachName, { color: colors.aura }]}>AURA · bugün</Text>
                  <Text style={styles.coachText}>{review.payload.reflection}</Text>
                </View>
                <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
                  <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS · yarın</Text>
                  <Text style={styles.coachText}>{review.payload.tomorrow}</Text>
                </View>
                <Text style={styles.source}>
                  {review.payload.source === 'AI'
                    ? 'Yapay zekâ yazdı'
                    : review.payload.source === 'MANUAL'
                      ? 'Senin yapıştırdığın yapay zekâ cevabından'
                      : 'Hazır kurallarla hazırlandı'}
                </Text>
              </>
            )}

            {aiError && (
              <Text style={styles.warn}>
                Yapay zekâ şu an yanıt vermedi ({aiError}). Hazır kurallarla gösteriyorum; aşağıdan tekrar
                deneyebilirsin.
              </Text>
            )}
            {!hasKey && (
              <Pressable onPress={() => router.push('/settings')}>
                <Text style={styles.hint}>
                  Daha kişisel bir yorum ve "başka neler yapabilirsin" fikirleri için API anahtarını ekle ›
                </Text>
              </Pressable>
            )}

            <Text style={styles.section}>Yarın ({tomorrowTitle}) için rutinlerin</Text>
            {routines.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardText}>
                  Henüz rutinin yok. Aşağıdaki fikirlerden ekleyebilir ya da Rutinlerim sayfasından seçebilirsin.
                </Text>
              </View>
            ) : (
              routines.map((r) => {
                const a = answers.get(r.id);
                return (
                  <View key={r.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{r.title}</Text>
                      <Text style={styles.time}>{formatAskTime(r)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Pressable
                        disabled={busy}
                        onPress={() => answer(r, 'ACCEPTED')}
                        style={[styles.choice, a === 'ACCEPTED' && styles.choiceOn]}
                      >
                        <Text style={[styles.choiceText, a === 'ACCEPTED' && styles.choiceTextOn]}>
                          Yarın yapacağım
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() => answer(r, 'SKIPPED')}
                        style={[styles.choice, a === 'SKIPPED' && styles.choiceOff]}
                      >
                        <Text style={[styles.choiceText, a === 'SKIPPED' && styles.choiceTextOn]}>
                          Yarın değil
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={() => confirmRetire(r)} hitSlop={6}>
                      <Text style={styles.retire}>Bir daha yapmam</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
            {routines.length > 0 && (
              <Text style={styles.hint}>
                "Yarın yapacağım" dediklerini sabah plana yerleştiririm; cevap vermediklerini her zamanki
                saatinde yine sorarım.
              </Text>
            )}

            {ideas.length > 0 && (
              <>
                <Text style={styles.section}>Başka neler yapabilirsin?</Text>
                {ideas.map((idea) => {
                  const added = existing.has(norm(idea.title));
                  return (
                    <View key={idea.title} style={styles.card}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.cardTitle}>{idea.title}</Text>
                        <Text style={styles.time}>
                          {String(idea.hour).padStart(2, '0')}:{String(idea.minute).padStart(2, '0')} ·{' '}
                          {idea.minutes} dk
                        </Text>
                      </View>
                      <Text style={styles.cardText}>{idea.why}</Text>
                      <Pressable
                        disabled={added || busy}
                        onPress={() => addIdea(idea)}
                        style={[styles.addBtn, added && styles.addBtnDone]}
                      >
                        <Text style={[styles.addBtnText, added && { color: colors.textMuted }]}>
                          {added ? 'Eklendi' : 'Rutin olarak ekle'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
                {freshIdeas.length > 1 && (
                  <Pressable
                    disabled={busy}
                    onPress={() => addAll(freshIdeas)}
                    style={[styles.primary, busy && { opacity: 0.5 }]}
                  >
                    <Text style={styles.primaryText}>Hepsini ekle ({freshIdeas.length})</Text>
                  </Pressable>
                )}
              </>
            )}

            <Text style={styles.section}>Ücretsiz yapay zekâyla (elle)</Text>
            <View style={styles.card}>
              <Text style={styles.cardText}>
                1. "Özeti kopyala"ya bas.{'\n'}2. Gemini, ChatGPT ya da Claude uygulamasını aç, yapıştırıp
                gönder.{'\n'}3. Gelen cevabı (kod bloğuyla birlikte) kopyala, buraya yapıştır ve "Cevabı ekle"ye
                bas.
              </Text>
              <Pressable disabled={busy} onPress={copyPrompt} style={styles.addBtn}>
                <Text style={styles.addBtnText}>{copied ? 'Kopyalandı ✓ (tekrar kopyala)' : 'Özeti kopyala'}</Text>
              </Pressable>
              <TextInput
                value={manualText}
                onChangeText={setManualText}
                placeholder="Yapay zekânın cevabını buraya yapıştır"
                placeholderTextColor={colors.textMuted}
                style={styles.pasteBox}
                multiline
                textAlignVertical="top"
                autoCorrect={false}
                autoCapitalize="none"
              />
              <View style={styles.row}>
                <Pressable disabled={busy} onPress={pasteAnswer} style={styles.choice}>
                  <Text style={styles.choiceText}>Panodan yapıştır</Text>
                </Pressable>
                <Pressable
                  disabled={busy || manualText.trim().length === 0}
                  onPress={applyManual}
                  style={[styles.choice, styles.choiceOn, (busy || manualText.trim().length === 0) && { opacity: 0.5 }]}
                >
                  <Text style={[styles.choiceText, styles.choiceTextOn]}>Cevabı ekle</Text>
                </Pressable>
              </View>
              {manualMsg && (
                <Text style={[styles.manualMsg, { color: manualMsg.ok ? colors.aura : colors.warning }]}>
                  {manualMsg.text}
                </Text>
              )}
              <Text style={styles.hint}>
                Kopyalanan metinde görev ve rutin adların ile adım, ekran süresi ve uyku bilgin var. Ücretsiz
                sohbet uygulamaları konuşmaları kendi ürünlerini geliştirmek için kullanabilir; istemediğin bir
                şey varsa yapıştırmadan önce metinden sil.
              </Text>
            </View>

            <Pressable
              disabled={loading || busy}
              onPress={() => generate(true)}
              style={[styles.secondary, (loading || busy) && { opacity: 0.5 }]}
            >
              <Text style={styles.secondaryText}>
                {loading ? 'Yazılıyor…' : hasKey ? 'Yapay zekâyla yeniden yaz' : 'Yeniden hazırla'}
              </Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.done}>
              <Text style={styles.doneText}>Tamam, iyi geceler</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  back: { color: colors.kronos, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  coach: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  coachName: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  coachText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  source: { color: colors.textMuted, fontSize: 11 },
  warn: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  cardText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  time: { color: colors.aura, fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', gap: spacing.sm },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  choiceOn: { backgroundColor: colors.aura, borderColor: colors.aura },
  choiceOff: { backgroundColor: colors.textMuted, borderColor: colors.textMuted },
  choiceText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  choiceTextOn: { color: colors.bg },
  retire: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  addBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  addBtnDone: { borderColor: colors.border },
  addBtnText: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  primary: {
    backgroundColor: colors.aura,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: '800' },
  secondary: {
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  secondaryText: { color: colors.kronos, fontSize: 14, fontWeight: '700' },
  pasteBox: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13,
    minHeight: 90,
    maxHeight: 180,
  },
  manualMsg: { fontSize: 13, lineHeight: 19 },
  done: { alignItems: 'center', paddingVertical: spacing.md },
  doneText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
