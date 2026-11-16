import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import type { VocabCard } from '../database/types';
import { addVocab, answerVocab, editVocab, loadVocab, logVocabSession, removeVocab, type VocabScreenData } from '../services/vocab';
import {
  MAX_MEANING,
  MAX_NOTE,
  MAX_WORD,
  boxDots,
  isLearned,
  sessionAnswer,
  sessionCurrent,
  sessionDone,
  startSession,
  type SessionState,
} from '../services/vocabLogic';

type Mode = 'HOME' | 'SESSION';

export default function VocabScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [data, setData] = useState<VocabScreenData | null>(null);
  const [mode, setMode] = useState<Mode>('HOME');
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loggedMin, setLoggedMin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const wordInput = useRef<TextInput>(null);

  const load = useCallback(async () => {
    setData(await loadVocab(db, new Date()));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load])
  );

  const byId = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);

  const resetForm = () => {
    setWord('');
    setMeaning('');
    setNote('');
    setEditingId(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = editingId
        ? await editVocab(db, editingId, word, meaning, note)
        : await addVocab(db, word, meaning, note, new Date());
      if (!res.ok) {
        setMessage({ text: res.error, ok: false });
        return;
      }
      setMessage({ text: editingId ? 'Güncellendi.' : `"${res.card.word}" eklendi.`, ok: true });
      const wasEditing = editingId !== null;
      resetForm();
      await load();
      // Yol üstünde hızlı ekleme: bir sonraki kelimeye hemen geç
      if (!wasEditing) setTimeout(() => wordInput.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c: VocabCard) => {
    setEditingId(c.id);
    setWord(c.word);
    setMeaning(c.meaning);
    setNote(c.note ?? '');
    setMessage(null);
  };

  const confirmRemove = (c: VocabCard) => {
    Alert.alert('Kelimeyi sil', `"${c.word}" defterden silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await removeVocab(db, c.id);
          if (editingId === c.id) resetForm();
          await load();
        },
      },
    ]);
  };

  const startReview = () => {
    if (!data) return;
    const s = startSession(data.cards, data.today);
    if (s.queue.length === 0) return;
    setSession(s);
    setRevealed(false);
    setLoggedMin(null);
    startedAt.current = Date.now();
    setMode('SESSION');
  };

  const answer = async (known: boolean) => {
    if (!session || busy) return;
    const id = sessionCurrent(session);
    if (!id) return;
    setBusy(true);
    try {
      await answerVocab(db, id, known, new Date());
      const next = sessionAnswer(session, known);
      setSession(next);
      setRevealed(false);
      if (sessionDone(next)) {
        const answered = next.knownCount + next.againCount;
        const min = await logVocabSession(db, answered, startedAt.current, Date.now(), new Date());
        setLoggedMin(min > 0 ? min : null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const leaveSession = async () => {
    setMode('HOME');
    setSession(null);
    await load();
  };

  // ───────── Tekrar seansı ─────────
  if (mode === 'SESSION' && session) {
    const done = sessionDone(session);
    const current = done ? null : byId.get(sessionCurrent(session) as string) ?? null;
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable onPress={leaveSession} hitSlop={10}>
            <Text style={styles.back}>‹ Defter</Text>
          </Pressable>
          {done ? (
            <View style={styles.card}>
              <Text style={styles.heading}>Seans bitti 🎉</Text>
              <Text style={styles.body}>
                {session.knownCount} kez "biliyordum" dedin
                {session.againCount > 0 ? `, ${session.againCount} kelime de tekrar görülecek` : ''}. Tekrar görülecek
                kelimeler öğrenmenin normal parçası; zamanı gelince karşına çıkacaklar.
              </Text>
              {loggedMin !== null && (
                <Text style={styles.muted}>{loggedMin} dk dil çalışması olarak kaydedildi.</Text>
              )}
              <Pressable onPress={leaveSession} style={styles.primary}>
                <Text style={styles.primaryText}>Tamam</Text>
              </Pressable>
            </View>
          ) : current ? (
            <>
              <Text style={styles.muted}>
                {Math.min(session.index + 1, session.queue.length)} / {session.queue.length}
              </Text>
              <Pressable onPress={() => setRevealed(true)} style={styles.flash}>
                <Text style={styles.flashWord}>{current.word}</Text>
                {revealed ? (
                  <>
                    <Text style={styles.flashMeaning}>{current.meaning}</Text>
                    {current.note ? <Text style={styles.muted}>{current.note}</Text> : null}
                  </>
                ) : (
                  <Text style={styles.muted}>Anlamını düşün, sonra dokun</Text>
                )}
              </Pressable>
              {revealed ? (
                <View style={styles.answerRow}>
                  <Pressable disabled={busy} onPress={() => answer(false)} style={[styles.answerBtn, { borderColor: colors.kronos }]}>
                    <Text style={[styles.answerText, { color: colors.kronos }]}>Tekrar göreceğim</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => answer(true)} style={[styles.answerBtn, { borderColor: colors.aura }]}>
                    <Text style={[styles.answerText, { color: colors.aura }]}>Biliyordum ✓</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setRevealed(true)} style={styles.primary}>
                  <Text style={styles.primaryText}>Anlamı göster</Text>
                </Pressable>
              )}
            </>
          ) : (
            <Text style={styles.muted}>Kart bulunamadı.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ───────── Defter ─────────
  const stats = data?.stats;
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Kelime defteri</Text>
        <Text style={styles.sub}>
          Yolda ya da işte gördüğün kelimeyi hemen yaz; tekrarlar kendiliğinden doğru aralıklarla karşına çıkar.
        </Text>

        {!data || !stats ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aura} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.statRow}>
                <Stat value={stats.due} label="bugün tekrar" />
                <Stat value={stats.inProgress} label="öğreniyorum" />
                <Stat value={stats.learned} label="öğrendim" />
              </View>
              <Pressable
                disabled={stats.due === 0}
                onPress={startReview}
                style={[styles.primary, stats.due === 0 && { opacity: 0.45 }]}
              >
                <Text style={styles.primaryText}>
                  {stats.due === 0 ? 'Bugünlük tekrar yok' : `Tekrara başla (${Math.min(stats.due, 12)} kart)`}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.section}>{editingId ? 'Kelimeyi düzenle' : 'Yeni kelime'}</Text>
            <View style={styles.card}>
              <TextInput
                ref={wordInput}
                value={word}
                onChangeText={setWord}
                placeholder="Kelime"
                placeholderTextColor={colors.textMuted}
                maxLength={MAX_WORD}
                autoCapitalize="none"
                style={styles.input}
              />
              <TextInput
                value={meaning}
                onChangeText={setMeaning}
                placeholder="Anlamı"
                placeholderTextColor={colors.textMuted}
                maxLength={MAX_MEANING}
                style={styles.input}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Not / örnek cümle (isteğe bağlı)"
                placeholderTextColor={colors.textMuted}
                maxLength={MAX_NOTE}
                style={styles.input}
              />
              <View style={styles.formRow}>
                <Pressable disabled={busy} onPress={submit} style={[styles.primary, { flex: 1 }]}>
                  <Text style={styles.primaryText}>{editingId ? 'Kaydet' : 'Ekle'}</Text>
                </Pressable>
                {editingId && (
                  <Pressable
                    onPress={() => {
                      resetForm();
                      setMessage(null);
                    }}
                    style={styles.ghost}
                  >
                    <Text style={styles.ghostText}>Vazgeç</Text>
                  </Pressable>
                )}
              </View>
              {message && <Text style={[styles.message, { color: message.ok ? colors.aura : colors.danger }]}>{message.text}</Text>}
            </View>

            <Text style={styles.section}>Kelimelerim ({stats.total})</Text>
            {data.cards.length === 0 ? (
              <Text style={styles.muted}>Henüz kelime yok. İlk kelimeni yukarıdan ekle.</Text>
            ) : (
              <View style={styles.card}>
                {data.cards.map((c) => (
                  <View key={c.id} style={styles.wordRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.wordText}>
                        {c.word} <Text style={styles.wordMeaning}>· {c.meaning}</Text>
                      </Text>
                      <Text style={styles.muted}>
                        {isLearned(c) ? 'öğrenildi ✓' : boxDots(c.box)}
                        {c.dueDay <= data.today && !isLearned(c) ? ' · bugün tekrar' : ''}
                      </Text>
                    </View>
                    <Pressable onPress={() => startEdit(c)} hitSlop={8}>
                      <Text style={styles.action}>✎</Text>
                    </Pressable>
                    <Pressable onPress={() => confirmRemove(c)} hitSlop={8}>
                      <Text style={styles.action}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  back: { color: colors.aura, fontSize: 15, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
    gap: spacing.md,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
  },
  formRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  primary: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.aura,
    backgroundColor: colors.auraSoft,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  primaryText: { color: colors.aura, fontWeight: '800', fontSize: 15 },
  ghost: { paddingHorizontal: spacing.md, paddingVertical: 12 },
  ghostText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  message: { fontSize: 13, lineHeight: 19 },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  wordText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  wordMeaning: { color: colors.textMuted, fontWeight: '500' },
  action: { color: colors.textMuted, fontSize: 18, paddingHorizontal: 4 },
  flash: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  flashWord: { color: colors.text, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  flashMeaning: { color: colors.aura, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  answerRow: { flexDirection: 'row', gap: spacing.md },
  answerBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  answerText: { fontSize: 14, fontWeight: '800' },
});
