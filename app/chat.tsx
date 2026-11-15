import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, radius, spacing } from '../constants/theme';
import { addChatMessage, clearChat, listChatMessages } from '../database/repository';
import type { ChatMessage, CoachId } from '../database/types';
import { AIError } from '../services/ai/claudeClient';
import { chatReply } from '../services/ai/coachAI';
import { PERSONAS } from '../services/ai/personas';
import { getAiConfig } from '../services/ai/settings';
import { loadCoachContext } from '../services/coachContext';

const META: Record<CoachId, { name: string; role: string; color: string; soft: string }> = {
  KRONOS: { name: 'Kronos', role: 'Zaman mimarı', color: colors.kronos, soft: colors.kronosSoft },
  AURA: { name: 'Aura', role: 'Enerji ve suçluluk kalkanı', color: colors.aura, soft: colors.auraSoft },
};

export default function ChatScreen() {
  const { coach: coachParam } = useLocalSearchParams<{ coach?: string }>();
  const coach: CoachId = coachParam === 'AURA' ? 'AURA' : 'KRONOS';
  const meta = META[coach];
  const db = useSQLiteContext();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setMessages(await listChatMessages(db, coach));
        setHasKey((await getAiConfig()) !== null);
      })();
    }, [db, coach])
  );

  const scrollDown = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    const cfg = await getAiConfig();
    if (!cfg) {
      setHasKey(false);
      return;
    }

    setInput('');
    setNotice(null);
    setSending(true);
    try {
      const userMsg = await addChatMessage(db, coach, 'user', text);
      const history = [...messages, userMsg];
      setMessages(history);
      scrollDown();

      const ctx = await loadCoachContext(db, new Date());
      const reply = await chatReply(
        coach,
        ctx,
        history.map((m) => ({ role: m.role, content: m.content })),
        cfg
      );
      const botMsg = await addChatMessage(db, coach, 'assistant', reply);
      setMessages([...history, botMsg]);
      scrollDown();
    } catch (e) {
      setNotice(e instanceof AIError ? e.message : 'Bir sorun oldu. Biraz sonra tekrar dene.');
    } finally {
      setSending(false);
    }
  };

  const confirmClear = () =>
    Alert.alert('Sohbeti temizle', `${meta.name} ile olan sohbet geçmişi silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await clearChat(db, coach);
          setMessages([]);
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Geri</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.name, { color: meta.color }]}>{meta.name}</Text>
          <Text style={styles.role}>{meta.role}</Text>
        </View>
        <Pressable onPress={confirmClear} hitSlop={10}>
          <Text style={styles.clear}>Temizle</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {hasKey === false && (
          <Pressable onPress={() => router.push('/settings')} style={styles.banner}>
            <Text style={styles.bannerText}>
              Sohbet için önce Ayarlar'dan API anahtarını eklemelisin. Eklemek için dokun ›
            </Text>
          </Pressable>
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{meta.name} ile konuş</Text>
              <Text style={styles.emptyText}>
                Bugünkü görevlerini ve enerji durumunu biliyor. Aşağıdan başla ya da kendi
                cümleni yaz.
              </Text>
              <View style={styles.starters}>
                {PERSONAS[coach].starters.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    style={[styles.starter, { borderColor: meta.color }]}
                  >
                    <Text style={[styles.starterText, { color: meta.color }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.role === 'user';
            return (
              <View
                style={[
                  styles.bubble,
                  mine
                    ? styles.bubbleMine
                    : { backgroundColor: meta.soft, borderColor: colors.border, alignSelf: 'flex-start' },
                ]}
              >
                <Text style={styles.bubbleText}>{item.content}</Text>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View style={[styles.bubble, { backgroundColor: meta.soft, alignSelf: 'flex-start' }]}>
                <Text style={[styles.bubbleText, { color: colors.textMuted }]}>
                  {meta.name} yazıyor…
                </Text>
              </View>
            ) : null
          }
        />

        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`${meta.name}'a yaz…`}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={() => send(input)}
            disabled={sending || !input.trim()}
            style={[
              styles.send,
              { backgroundColor: meta.color, opacity: sending || !input.trim() ? 0.4 : 1 },
            ]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.textMuted, fontSize: 15, minWidth: 56 },
  headerCenter: { alignItems: 'center' },
  name: { fontSize: 17, fontWeight: '800' },
  role: { color: colors.textMuted, fontSize: 11 },
  clear: { color: colors.textMuted, fontSize: 13, minWidth: 56, textAlign: 'right' },
  banner: {
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning,
    padding: spacing.md,
  },
  bannerText: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  empty: { gap: spacing.md, paddingTop: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  starters: { gap: spacing.sm, marginTop: spacing.sm },
  starter: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: spacing.lg },
  starterText: { fontSize: 14, fontWeight: '600' },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.surfaceAlt },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  notice: { color: colors.warning, fontSize: 13, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.bg, fontSize: 22, fontWeight: '800' },
});
