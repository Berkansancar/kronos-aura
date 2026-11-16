import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import type { MoodLog, MoodValue } from '../database/types';
import { logMood, saveMoodNote, todayMood } from '../services/habits';
import { MOODS, moodInfo, type MoodReply } from '../services/moodLogic';

interface Props {
  /** Zor gün modu şu an açık mı? Açıksa "planı hafiflet" önerilmez. */
  hardDay: boolean;
  onSuggestHardDay: () => void;
}

/** "Bugün nasılsın?" kartı: beş seçenek, isteğe bağlı kısa not, yargılamayan kısa cevap. */
export function MoodCard({ hardDay, onSuggestHardDay }: Props) {
  const db = useSQLiteContext();
  const router = useRouter();
  const [today, setToday] = useState<MoodLog | null>(null);
  const [picking, setPicking] = useState(false);
  const [reply, setReply] = useState<MoodReply | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      todayMood(db, new Date())
        .then((m) => {
          setToday(m);
          setNote(m?.note ?? '');
        })
        .catch(() => undefined);
    }, [db])
  );

  const choose = async (v: MoodValue) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await logMood(db, new Date(), v);
      setToday(r.log);
      setReply(r.reply);
      setPicking(false);
      setNoteSaved(false);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const m = await saveMoodNote(db, new Date(), note);
      if (m) {
        setToday(m);
        setNoteSaved(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const showPicker = !today || picking;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{today && !picking ? 'Bugünün ruh hali' : 'Bugün nasılsın?'}</Text>
        <Pressable onPress={() => router.push('/habits')} hitSlop={8}>
          <Text style={styles.link}>Takvim ›</Text>
        </Pressable>
      </View>

      {showPicker ? (
        <View style={styles.row}>
          {MOODS.map((m) => (
            <Pressable
              key={m.value}
              disabled={busy}
              onPress={() => choose(m.value)}
              style={[styles.mood, today?.mood === m.value && { borderColor: m.color }]}
              accessibilityLabel={m.label}
            >
              <Text style={styles.emoji}>{m.emoji}</Text>
              <Text style={styles.label}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        today && (
          <>
            <Pressable onPress={() => setPicking(true)} style={[styles.current, { borderColor: moodInfo(today.mood).color }]}>
              <Text style={styles.emoji}>{moodInfo(today.mood).emoji}</Text>
              <Text style={styles.currentText}>{moodInfo(today.mood).label}</Text>
              <Text style={styles.change}>değiştir</Text>
            </Pressable>
            {reply && <Text style={styles.reply}>{reply.text}</Text>}
            {reply?.suggestHardDay && !hardDay && (
              <Pressable onPress={onSuggestHardDay} style={styles.softBtn}>
                <Text style={styles.softBtnText}>Planı hafiflet</Text>
              </Pressable>
            )}
            <View style={styles.noteRow}>
              <TextInput
                value={note}
                onChangeText={(t) => {
                  setNote(t);
                  setNoteSaved(false);
                }}
                placeholder="Bugünden kısa bir not (isteğe bağlı)"
                placeholderTextColor={colors.textMuted}
                style={styles.noteInput}
                maxLength={280}
                returnKeyType="done"
              />
              <Pressable disabled={busy || noteSaved || note === (today.note ?? '')} onPress={saveNote} style={styles.noteBtn}>
                <Text style={styles.noteBtnText}>{noteSaved ? 'Kaydedildi' : 'Kaydet'}</Text>
              </Pressable>
            </View>
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  link: { color: colors.kronos, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.xs },
  mood: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  emoji: { fontSize: 26 },
  label: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  currentText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  change: { color: colors.textMuted, fontSize: 12 },
  reply: { color: colors.aura, fontSize: 13, lineHeight: 19 },
  softBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  softBtnText: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  noteRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  noteInput: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 13,
  },
  noteBtn: {
    borderWidth: 1,
    borderColor: colors.aura,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  noteBtnText: { color: colors.aura, fontSize: 12, fontWeight: '700' },
});
