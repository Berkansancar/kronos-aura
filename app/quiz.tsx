import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { refreshReminders } from '../services/reminderSync';
import { addRoutinePack } from '../services/routineFlow';
import { askNotificationPermission, hasNotificationPermission } from '../services/routineReminders';
import { getPack } from '../services/routineTemplates';
import { scoreQuiz, STYLE_QUIZ } from '../services/styleQuizLogic';

export default function QuizScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [answers, setAnswers] = useState<(number | null)[]>(() => STYLE_QUIZ.map(() => null));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const finished = step >= STYLE_QUIZ.length;
  const q = STYLE_QUIZ[Math.min(step, STYLE_QUIZ.length - 1)];

  const choose = (i: number) => {
    const next = [...answers];
    next[step] = i;
    setAnswers(next);
    setStep(step + 1);
  };

  const result = finished ? scoreQuiz(answers) : null;

  const add = async (packId: string) => {
    setBusy(true);
    try {
      const r = await addRoutinePack(db, packId);
      if (!(await hasNotificationPermission())) await askNotificationPermission();
      await refreshReminders(db, new Date()).catch(() => undefined);
      setAdded((prev) => new Set(prev).add(packId));
      Alert.alert(
        r.added > 0 ? 'Paket eklendi' : 'Zaten ekli',
        r.added > 0 ? `${r.added} rutin eklendi. Saatleri Rutinlerim ekranından değiştirebilirsin.` : 'Bu paketteki rutinler zaten listende.'
      );
    } catch (e) {
      Alert.alert('Bir sorun oldu', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.heading}>Rutin tarzı testi</Text>
        <Text style={styles.sub}>
          Altı kısa soru. Doğru ya da yanlış cevap yok; sana uygun bir başlangıç paketi bulmama yardım eder.
        </Text>

        {!finished ? (
          <>
            <Text style={styles.progress}>
              Soru {step + 1} / {STYLE_QUIZ.length}
            </Text>
            <View style={styles.card}>
              <Text style={styles.question}>{q.text}</Text>
              {q.options.map((o, i) => (
                <Pressable key={o.label} onPress={() => choose(i)} style={styles.option}>
                  <Text style={styles.optionText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            {step > 0 && (
              <Pressable onPress={() => setStep(step - 1)} hitSlop={8}>
                <Text style={styles.link}>‹ Önceki soru</Text>
              </Pressable>
            )}
          </>
        ) : (
          result && (
            <>
              <View style={[styles.card, { borderColor: colors.aura }]}>
                <Text style={styles.resultLabel}>SENİN TARZIN</Text>
                <Text style={styles.resultTitle}>{result.title}</Text>
                <Text style={styles.resultText}>{result.text}</Text>
              </View>
              <Text style={styles.sectionTitle}>Sana önerdiğim paketler</Text>
              {result.packs.map((id) => {
                const p = getPack(id);
                if (!p) return null;
                const done = added.has(id);
                return (
                  <View key={id} style={styles.pack}>
                    <Text style={styles.packIcon}>{p.icon}</Text>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.packTitle}>{p.title}</Text>
                      <Text style={styles.packAbout}>{p.about}</Text>
                    </View>
                    <Pressable
                      disabled={busy || done}
                      onPress={() => add(id)}
                      style={[styles.addBtn, done && { borderColor: colors.border }]}
                    >
                      <Text style={[styles.addText, done && { color: colors.textMuted }]}>{done ? 'Eklendi' : 'Ekle'}</Text>
                    </Pressable>
                  </View>
                );
              })}
              <Pressable
                onPress={() => {
                  setAnswers(STYLE_QUIZ.map(() => null));
                  setStep(0);
                  setAdded(new Set());
                }}
                hitSlop={8}
              >
                <Text style={styles.link}>Testi yeniden çöz</Text>
              </Pressable>
              <Pressable onPress={() => router.replace('/routines')} style={styles.done}>
                <Text style={styles.doneText}>Rutinlerime git</Text>
              </Pressable>
            </>
          )
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
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  progress: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  question: { color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 25 },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceAlt,
  },
  optionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { color: colors.kronos, fontSize: 14, fontWeight: '600' },
  resultLabel: { color: colors.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  resultTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  resultText: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  packIcon: { fontSize: 28 },
  packTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  packAbout: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  addBtn: { borderWidth: 1, borderColor: colors.aura, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  addText: { color: colors.aura, fontSize: 13, fontWeight: '700' },
  done: { backgroundColor: colors.aura, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  doneText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
});
