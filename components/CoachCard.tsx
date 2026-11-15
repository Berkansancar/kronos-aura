import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { CoachAction, CoachId, CoachMessage } from '../services/coachEngine';

const META: Record<
  CoachId,
  { name: string; role: string; glyph: string; color: string; soft: string }
> = {
  KRONOS: {
    name: 'Kronos',
    role: 'Zaman mimarı',
    glyph: 'K',
    color: colors.kronos,
    soft: colors.kronosSoft,
  },
  AURA: {
    name: 'Aura',
    role: 'Enerji ve suçluluk kalkanı',
    glyph: 'A',
    color: colors.aura,
    soft: colors.auraSoft,
  },
};

interface Props {
  message: CoachMessage;
  onAction: (action: CoachAction) => void;
  busy?: boolean;
  /** Verilirse kartta "Konuş" bağlantısı görünür */
  onTalk?: () => void;
}

export function CoachCard({ message, onAction, busy, onTalk }: Props) {
  const meta = META[message.coach];
  const isAlert = message.tone === 'ALERT';
  const chips = message.actions.filter((a) => a.id === 'LOG_DRIFT');
  const buttons = message.actions.filter((a) => a.id !== 'LOG_DRIFT');

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: meta.soft, borderColor: isAlert ? colors.warning : colors.border },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: meta.color }]}>
          <Text style={styles.avatarText}>{meta.glyph}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.name, { color: meta.color }]}>{meta.name}</Text>
          <Text style={styles.role}>{meta.role}</Text>
        </View>
        {message.source === 'AI' && (
          <Text style={[styles.badge, { color: meta.color, borderColor: meta.color }]}>AI</Text>
        )}
        {isAlert && <View style={styles.alertDot} />}
        {onTalk && (
          <Pressable onPress={onTalk} hitSlop={8}>
            <Text style={[styles.talk, { color: meta.color }]}>Konuş ›</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.headline}>{message.headline}</Text>
      <Text style={styles.body}>{message.body}</Text>

      {buttons.length > 0 && (
        <View style={styles.row}>
          {buttons.map((a) => (
            <Pressable
              key={a.id}
              disabled={busy}
              onPress={() => onAction(a)}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: meta.color, opacity: busy ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.buttonText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {chips.length > 0 && (
        <View style={styles.chipBlock}>
          {message.hint ? <Text style={styles.hint}>{message.hint}</Text> : null}
          <View style={styles.row}>
            {chips.map((a) => (
              <Pressable
                key={a.label}
                disabled={busy}
                onPress={() => onAction(a)}
                style={({ pressed }) => [
                  styles.chip,
                  { borderColor: meta.color, opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.chipText, { color: meta.color }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  headerText: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', letterSpacing: 0.4 },
  role: { fontSize: 11, color: colors.textMuted },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  talk: { fontSize: 13, fontWeight: '700' },
  headline: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: spacing.xs },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  button: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.pill },
  buttonText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  chipBlock: { marginTop: spacing.xs, gap: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
});
