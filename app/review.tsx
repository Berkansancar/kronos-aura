import { useCallback, useRef, useState } from 'react';
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { listRoutines } from '../database/repository';
import type { DayReview, Routine, RoutineIdea, ScreenAlternative } from '../database/types';
import { isSharingWithAi } from '../services/activity';
import { getFreeConfig } from '../services/ai/freeSettings';
import { getAiConfig } from '../services/ai/settings';
import { getNutritionOptions } from '../services/nutritionSettings';
import {
  addIdeaAsRoutine,
  buildAllDaysManualPrompt,
  buildManualReviewPrompt,
  describePeriod,
  loadOrCreateReview,
  planForTomorrow,
  reviewAvailable,
  reviewDayOf,
  saveManualReview,
  skipForTomorrow,
  tomorrowAnswers,
  type TomorrowAnswer,
} from '../services/dayReview';
import { loadPeriodReviews } from '../services/periodReview';
import { dayShortLabel, periodRangeLabel, type StoredPeriodReview } from '../services/periodLogic';
import { factChips, type DayFacts } from '../services/dayReviewLogic';
import { formatDayTitle, formatDuration } from '../services/format';
import { addTask } from '../services/taskFlow';
import { refreshReminders } from '../services/reminderSync';
import { retireRoutine } from '../services/routineFlow';
import { screenSessions } from '../services/locationTracking';
import { isRoutineDay } from '../services/routineDaysLogic';
import { formatAskTime } from '../services/routineLogic';
import { askNotificationPermission, hasNotificationPermission } from '../services/routineReminders';

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

export default function ReviewScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  // Ana ekrandaki "Yapay zekâya kopyala" kartı doğrudan elle yol bölümüne indirir
  const { manual } = useLocalSearchParams<{ manual?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const manualY = useRef<number | null>(null);
  const openedAt = useRef(Date.now());
  // Yalnızca açılıştaki ilk birkaç saniyede iner; sonra yukarıdaki içerik değişse de sayfayı oynatmaz
  const goManual = () => {
    if (manual === '1' && manualY.current !== null && Date.now() - openedAt.current < 4000) {
      scrollRef.current?.scrollTo({ y: Math.max(0, manualY.current - 12), animated: false });
    }
  };

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
  const [copiedAll, setCopiedAll] = useState(false);
  const [span, setSpan] = useState<{ days: number; enough: boolean; capped: boolean } | null>(null);
  const [periods, setPeriods] = useState<StoredPeriodReview[]>([]);
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const loadLists = useCallback(async () => {
    const n = new Date();
    setRoutines(await listRoutines(db, 'ACTIVE'));
    setAnswers(await tomorrowAnswers(db, n));
    try {
      const d = await describePeriod(db, n);
      setSpan({ days: d.days, enough: d.enough, capped: d.capped });
      const list = await loadPeriodReviews(db);
      setPeriods(list);
      setOpenPeriod((cur) => cur ?? list[0]?.to ?? null);
    } catch {
      // dönem özeti okunamazsa gün sonu ekranı yine de açılır
    }
  }, [db]);

  const generate = useCallback(
    async (force: boolean) => {
      const n = new Date();
      setNow(n);
      setLoading(true);
      setAiError(null);
      try {
        const cfg = await getAiConfig();
        const free = await getFreeConfig();
        setHasKey(cfg !== null || free !== null);
        const share = await isSharingWithAi();
        const nutritionOpts = await getNutritionOptions();
        const result = await loadOrCreateReview(db, n, { cfg, free, shareActivity: share, force, nutritionOpts });
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
        // Gün bitmeden otomatik yorum yazılmaz; ama elle (kopyala-yapıştır) yol ve rutin listesi açık kalır
        setLoading(false);
        void loadLists();
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

  // Ekran yerine önerilen bir şeyi yarının planına ekler (iş vaktinde yapılmaz, hafif)
  const [addedAlts, setAddedAlts] = useState<Set<string>>(new Set());
  const addAlternative = (a: ScreenAlternative) =>
    run(async () => {
      await addTask(db, { title: a.title, estimatedDuration: a.minutes, cognitiveWeight: 'LOW', workOk: false });
      setAddedAlts((prev) => new Set(prev).add(norm(a.title)));
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
      const text = await buildManualReviewPrompt(db, new Date(), await getNutritionOptions());
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

  // "Tüm günler": uygulamayı kullanmaya başladığın günden bugüne gün gün özet ve komut
  const copyAllPrompt = async () => {
    setManualMsg(null);
    try {
      const { text } = await buildAllDaysManualPrompt(db, new Date(), await getNutritionOptions(), screenSessions);
      try {
        await Clipboard.setStringAsync(text);
        setCopiedAll(true);
      } catch {
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
      const saved = await saveManualReview(db, new Date(), manualText, await getNutritionOptions(), screenSessions);
      setReview(saved);
      setAiError(null);
      setManualText('');
      setCopied(false);
      setCopiedAll(false);
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
  // Belirli günlere bağlı rutinler yalnızca o gün için sorulur
  const tomorrowDate = new Date(reviewDay.getFullYear(), reviewDay.getMonth(), reviewDay.getDate() + 1);
  const tomorrowRoutines = routines.filter((r) => isRoutineDay(r, tomorrowDate));
  const ideas = review?.payload.ideas ?? [];
  const freshIdeas = ideas.filter((i) => !existing.has(norm(i.title)));

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Gün sonu</Text>
        <Text style={styles.sub}>{formatDayTitle(reviewDay)}</Text>

        {!reviewAvailable(now) && (
          <View style={styles.card}>
            <Text style={styles.cardText}>
              Gün henüz bitmedi, o yüzden yorumu kendiliğinden yazmıyorum; akşam 20:00'den sonra hazır olur. İstersen
              şimdiden aşağıdaki kopyala-yapıştır yolunu kullanabilirsin: yorum şimdiye kadarki verilere göre olur.
              Akşam yeniden hazırlamak istersen en alttaki "Yeniden hazırla"ya bas.
            </Text>
          </View>
        )}
        {loading && !review ? (
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
                    : review.payload.source === 'FREE'
                      ? 'Ücretsiz yapay zekâ yazdı'
                      : review.payload.source === 'MANUAL'
                        ? 'Senin yapıştırdığın yapay zekâ cevabından'
                        : 'Hazır kurallarla hazırlandı'}
                </Text>
              </>
            )}

            {review && (Boolean(review.payload.timeUse) || (facts?.timeUse?.chips.length ?? 0) > 0) && (
              <>
                <Text style={styles.section}>Zaman nereye gitti?</Text>
                <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
                  <Text style={[styles.coachName, { color: colors.aura }]}>AURA · zaman</Text>
                  {review.payload.timeUse ? <Text style={styles.coachText}>{review.payload.timeUse}</Text> : null}
                  {facts?.timeUse && facts.timeUse.chips.length > 0 && (
                    <View style={styles.chips}>
                      {facts.timeUse.chips.map((c) => (
                        <View key={c} style={styles.chip}>
                          <Text style={styles.chipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </>
            )}

            {review && review.payload.screenAlternatives && review.payload.screenAlternatives.length > 0 && (
              <>
                <Text style={styles.section}>Ekran yerine</Text>
                {review.payload.screenNote ? <Text style={styles.hint}>{review.payload.screenNote}</Text> : null}
                {review.payload.screenAlternatives.map((a) => {
                  const added = addedAlts.has(norm(a.title));
                  return (
                    <View key={a.title} style={styles.card}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.cardTitle}>{a.title}</Text>
                        <Text style={styles.time}>{formatDuration(a.minutes)}</Text>
                      </View>
                      <Text style={styles.cardText}>{a.why}</Text>
                      {a.kind === 'IDEA' && (
                        <Pressable
                          disabled={added || busy}
                          onPress={() => addAlternative(a)}
                          style={[styles.addBtn, added && styles.addBtnDone]}
                        >
                          <Text style={[styles.addBtnText, added && { color: colors.textMuted }]}>
                            {added ? 'Plana eklendi' : 'Yarın plana ekle'}
                          </Text>
                        </Pressable>
                      )}
                      {a.kind === 'TASK' && <Text style={styles.hint}>Bu iş zaten listende; yarın plana döner.</Text>}
                    </View>
                  );
                })}
              </>
            )}

            <Pressable onPress={() => router.push('/mark')} hitSlop={6}>
              <Text style={styles.hint}>Gündüz işaretleyemediğin işler mi var? Günü işaretle ›</Text>
            </Pressable>

            {aiError && (
              <Text style={styles.warn}>
                Yapay zekâ şu an yanıt vermedi ({aiError}). Hazır kurallarla gösteriyorum; aşağıdan tekrar
                deneyebilirsin.
              </Text>
            )}
            {!hasKey && (
              <Pressable onPress={() => router.push('/settings')}>
                <Text style={styles.hint}>
                  Kopyala-yapıştır yeterli. İstersen Ayarlar'dan ücretsiz bir anahtar ekle; yorum ve fikirler
                  kendiliğinden gelsin ›
                </Text>
              </Pressable>
            )}

            <Text style={styles.section}>Yarın ({tomorrowTitle}) için rutinlerin</Text>
            {tomorrowRoutines.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardText}>
                  {routines.length === 0
                    ? 'Henüz rutinin yok. Aşağıdaki fikirlerden ekleyebilir ya da Rutinlerim sayfasından seçebilirsin.'
                    : 'Yarın için planlı rutinin yok. İstediğin gün Rutinlerim sayfasından günlerini değiştirebilirsin.'}
                </Text>
              </View>
            ) : (
              tomorrowRoutines.map((r) => {
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
            {tomorrowRoutines.length > 0 && (
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

            {periods.length > 0 && (
              <>
                <Text style={styles.section}>Tüm günlerin değerlendirmesi</Text>
                {periods.map((p) => {
                  const open = openPeriod === p.to;
                  return (
                    <View key={p.to} style={styles.card}>
                      <Pressable onPress={() => setOpenPeriod(open ? null : p.to)} style={styles.rowBetween}>
                        <Text style={styles.cardTitle}>
                          Son {p.days} gün · {periodRangeLabel(p.from, p.to)}
                        </Text>
                        <Text style={styles.time}>{open ? '▲' : '▼'}</Text>
                      </Pressable>
                      {open && (
                        <>
                          <View style={styles.chips}>
                            {p.stats.map((c) => (
                              <View key={c} style={styles.chip}>
                                <Text style={styles.chipText}>{c}</Text>
                              </View>
                            ))}
                          </View>
                          <View style={[styles.coach, { borderColor: colors.aura, backgroundColor: colors.auraSoft }]}>
                            <Text style={[styles.coachName, { color: colors.aura }]}>AURA · {p.days} günün özeti</Text>
                            <Text style={styles.coachText}>{p.summary}</Text>
                          </View>
                          {p.patterns.length > 0 && (
                            <View style={{ gap: 4 }}>
                              <Text style={styles.cardTitle}>Örüntüler</Text>
                              {p.patterns.map((t) => (
                                <Text key={t} style={styles.cardText}>
                                  • {t}
                                </Text>
                              ))}
                            </View>
                          )}
                          {p.next ? (
                            <View style={[styles.coach, { borderColor: colors.kronos, backgroundColor: colors.kronosSoft }]}>
                              <Text style={[styles.coachName, { color: colors.kronos }]}>KRONOS · önümüzdeki günler</Text>
                              <Text style={styles.coachText}>{p.next}</Text>
                            </View>
                          ) : null}
                          {p.dayNotes.length > 0 && (
                            <>
                              <Pressable onPress={() => setShowNotes((v) => !v)} hitSlop={8}>
                                <Text style={styles.addBtnText}>
                                  {showNotes ? 'Gün notlarını gizle' : `Gün gün notlar (${p.dayNotes.length})`}
                                </Text>
                              </Pressable>
                              {showNotes &&
                                p.dayNotes.map((n) => (
                                  <View key={n.day} style={{ gap: 2 }}>
                                    <Text style={styles.cardTitle}>{dayShortLabel(n.day)}</Text>
                                    <Text style={styles.cardText}>{n.note}</Text>
                                  </View>
                                ))}
                            </>
                          )}
                        </>
                      )}
                    </View>
                  );
                })}
                <Text style={styles.hint}>
                  Sayılar uygulamanın kayıtlarından hesaplanır; yorumları senin yapıştırdığın yapay zekâ cevabı yazar.
                </Text>
              </>
            )}

            <Text
              style={styles.section}
              onLayout={(e) => {
                manualY.current = e.nativeEvent.layout.y;
                goManual();
              }}
            >
              Ücretsiz yapay zekâyla (elle)
            </Text>
            <View style={styles.card}>
              <Text style={styles.cardText}>
                1. Bugünün özetini ya da tüm günleri kopyala.{'\n'}2. Gemini, ChatGPT ya da Claude uygulamasını aç,
                yapıştırıp gönder.{'\n'}3. Gelen cevabı (kod bloğuyla birlikte) kopyala, buraya yapıştır ve "Cevabı
                ekle"ye bas.
              </Text>
              <Pressable disabled={busy} onPress={copyPrompt} style={styles.addBtn}>
                <Text style={styles.addBtnText}>{copied ? 'Kopyalandı ✓ (tekrar kopyala)' : 'Bugünün özetini kopyala'}</Text>
              </Pressable>
              {span?.enough ? (
                <Pressable disabled={busy} onPress={copyAllPrompt} style={styles.addBtn}>
                  <Text style={styles.addBtnText}>
                    {copiedAll ? 'Kopyalandı ✓ (tekrar kopyala)' : `Tüm günleri kopyala (${span.days} gün)`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.hint}>Tüm günler için en az iki günlük kayıt gerekir.</Text>
              )}
              {span?.enough ? (
                <Text style={styles.hint}>
                  "Tüm günleri kopyala": uygulamayı kullanmaya başladığın günden bugüne{span.capped ? ' (son 60 gün)' : ''} gün gün
                  kayıtların, "şu kadar günde böyle" toplamları ve bugünün özeti tek komutta gider. Cevapta dönem yorumu, her
                  güne bir not, örüntüler ve yeni rutin fikirleri gelir.
                </Text>
              ) : null}
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
                Kopyalanan metinde görev ve rutin adların ile adım, ekran süresi, uyku bilgin, su, sigara sayacı, yolda ve iş yerinde geçen süre ve seçtiğin ruh hali (notun değil) var; günlük yazıların ve kilon yok; konum açıksa yalnızca evde, yolda ve durakta geçen dakika toplamları (adres ve koordinat değil) var. Ücretsiz
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
              <Text style={styles.doneText}>{reviewAvailable(now) ? 'Tamam, iyi geceler' : 'Tamam'}</Text>
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
