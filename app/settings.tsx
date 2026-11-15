import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../constants/theme';
import { AIError, callClaude } from '../services/ai/claudeClient';
import {
  clearApiKey,
  DEFAULT_MODEL,
  getApiKey,
  getModel,
  MODELS,
  setApiKey,
  setModel,
} from '../services/ai/settings';
import { getReviewReminderEnabled, setReviewReminderEnabled } from '../services/routineReminders';

export default function SettingsScreen() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [reviewReminder, setReviewReminder] = useState(true);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      setSaved((await getApiKey()) !== null);
      setModelState(await getModel());
      setReviewReminder(await getReviewReminderEnabled());
    })();
  }, []);

  const save = async () => {
    if (key.trim()) {
      await setApiKey(key);
      setKey('');
      setSaved(true);
    }
    await setModel(model);
    setMessage({ text: 'Kaydedildi.', ok: true });
  };

  const test = async () => {
    const apiKey = key.trim() || (await getApiKey());
    if (!apiKey) {
      setMessage({ text: 'Önce API anahtarını gir.', ok: false });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await callClaude({
        apiKey,
        model,
        system: 'Çok kısa yanıt ver.',
        messages: [{ role: 'user', content: 'Merhaba de.' }],
        maxTokens: 20,
      });
      setMessage({ text: 'Bağlantı başarılı. Koçlar yapay zekâyla çalışıyor.', ok: true });
    } catch (e) {
      setMessage({ text: e instanceof AIError ? e.message : 'Test başarısız oldu.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await clearApiKey();
    setSaved(false);
    setKey('');
    setMessage({ text: 'Anahtar silindi. Koçlar kural tabanlı çalışmaya döndü.', ok: true });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Yapay zekâ ayarları</Text>
        <Text style={styles.sub}>
          Kronos ve Aura'nın gerçek yapay zekâyla konuşabilmesi için bir Claude API anahtarı gerekir.
        </Text>

        <Text style={styles.label}>API anahtarı</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={saved ? 'Kayıtlı (değiştirmek için yenisini yapıştır)' : 'sk-ant-…'}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Model</Text>
        <View style={styles.models}>
          {MODELS.map((m) => {
            const active = m.id === model;
            return (
              <Pressable
                key={m.id}
                onPress={() => setModelState(m.id)}
                style={[styles.model, active && { borderColor: colors.kronos }]}
              >
                <Text style={[styles.modelName, active && { color: colors.kronos }]}>{m.label}</Text>
                <Text style={styles.modelHint}>{m.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        {message && (
          <Text style={[styles.message, { color: message.ok ? colors.aura : colors.warning }]}>
            {message.text}
          </Text>
        )}

        <Pressable onPress={save} style={styles.primary}>
          <Text style={styles.primaryText}>Kaydet</Text>
        </Pressable>
        <Pressable onPress={test} disabled={busy} style={[styles.secondary, busy && { opacity: 0.5 }]}>
          <Text style={styles.secondaryText}>{busy ? 'Deneniyor…' : 'Bağlantıyı test et'}</Text>
        </Pressable>
        {saved && (
          <Pressable onPress={remove} hitSlop={8} style={styles.remove}>
            <Text style={styles.removeText}>Kayıtlı anahtarı sil</Text>
          </Pressable>
        )}

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Gün sonu hatırlatması</Text>
            <Text style={styles.switchText}>
              Her akşam 21:30'da "günü birlikte değerlendirelim" bildirimi gelir. Kapatırsan
              değerlendirme ana ekrandan yine açılabilir.
            </Text>
          </View>
          <Switch
            value={reviewReminder}
            onValueChange={async (on) => {
              setReviewReminder(on);
              await setReviewReminderEnabled(on);
            }}
            trackColor={{ true: colors.aura, false: colors.border }}
          />
        </View>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>Bilmen gerekenler</Text>
          <Text style={styles.noteText}>
            • Anahtar yalnızca bu telefonun güvenli deposunda saklanır; uygulama dosyasının içine
            konmaz.{'\n'}• Her yapay zekâ mesajı API'den ücretlendirilir; Claude aboneliğinden
            ayrıdır. Anthropic Console'dan harcama sınırı belirleyebilirsin.{'\n'}• Koçlara görev
            adların, planın ve enerji kayıtların gönderilir. Göndermek istemediğin bir şeyi görev
            adına yazma. Rutinlerinin adı, bugünkü durumu ve gün sonu değerlendirmesi için günün özeti de gider. Gün analizinde paylaşımı açtıysan adım, ekran süren ve uyku tahminin de gider.{'\n'}• Anahtar yoksa ya da internet kesilirse koçlar kural tabanlı
            çalışmaya devam eder.
          </Text>
        </View>

        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
          <Text style={styles.closeText}>Kapat</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  switchTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  switchText: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.md },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  models: { gap: spacing.sm },
  model: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  modelName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modelHint: { color: colors.textMuted, fontSize: 12 },
  message: { fontSize: 14, lineHeight: 20 },
  primary: {
    backgroundColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  secondary: {
    borderWidth: 1,
    borderColor: colors.kronos,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryText: { color: colors.kronos, fontWeight: '700', fontSize: 15 },
  remove: { alignSelf: 'center' },
  removeText: { color: colors.danger, fontSize: 13 },
  note: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noteTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  noteText: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  close: { alignSelf: 'center', marginTop: spacing.md },
  closeText: { color: colors.textMuted, fontSize: 13 },
});
