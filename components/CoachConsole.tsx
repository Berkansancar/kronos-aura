import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import type { CoachAction, CoachId, CoachMessage } from '../services/coachEngine';
import { CoachCard } from './CoachCard';

interface Props {
  kronos: CoachMessage;
  aura: CoachMessage;
  onAction: (action: CoachAction) => void;
  busy?: boolean;
  /** Koçla sohbet etmek için */
  onTalk?: (coach: CoachId) => void;
}

/** Ana ekranın üstündeki "Koç Konsolu": iki koçun o anki durum mesajları. */
export function CoachConsole({ kronos, aura, onAction, busy, onTalk }: Props) {
  return (
    <View style={styles.console}>
      <View style={styles.header}>
        <View style={styles.liveDot} />
        <Text style={styles.title}>Koç Konsolu</Text>
      </View>
      <CoachCard
        message={kronos}
        onAction={onAction}
        busy={busy}
        onTalk={onTalk ? () => onTalk('KRONOS') : undefined}
      />
      <CoachCard
        message={aura}
        onAction={onAction}
        busy={busy}
        onTalk={onTalk ? () => onTalk('AURA') : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  console: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.aura },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
