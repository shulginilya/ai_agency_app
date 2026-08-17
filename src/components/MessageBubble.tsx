import { StyleSheet, Text, View } from 'react-native';
import type { Message } from '@/api/schemas';
import { radius, spacing, useTheme } from '@/theme';

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * One turn in the thread.
 *
 * Three roles, three treatments: what you said sits right and filled, what the
 * agent said sits left on a card, and what the control plane said runs centred
 * and quiet — an event, not a voice.
 */
export function MessageBubble({ message }: { message: Message }) {
  const { colors } = useTheme();
  const time = formatTime(message.created_at);

  if (message.role === 'system') {
    return (
      <View testID={`message-${message.id}`} style={styles.systemRow}>
        <Text style={[styles.systemText, { color: colors.textMuted }]}>{message.content}</Text>
      </View>
    );
  }

  const mine = message.role === 'user';

  return (
    <View
      testID={`message-${message.id}`}
      accessibilityRole="text"
      accessibilityLabel={`${mine ? 'You' : 'Agent'}: ${message.content}`}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.accent, borderColor: colors.accent, borderBottomRightRadius: radius.sm }
            : { backgroundColor: colors.card, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
        ]}
      >
        <Text style={[styles.content, { color: mine ? '#fff' : colors.text }]}>{message.content}</Text>
        <View style={styles.meta}>
          {time ? (
            <Text style={[styles.time, { color: mine ? '#FFFFFFB3' : colors.textMuted }]}>{time}</Text>
          ) : null}
          {message.pending ? (
            <Text testID={`message-pending-${message.id}`} style={[styles.time, { color: mine ? '#FFFFFFB3' : colors.textMuted }]}>
              sending…
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: spacing.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  content: { fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'flex-end' },
  time: { fontSize: 11 },
  systemRow: { alignItems: 'center', paddingVertical: spacing.sm },
  systemText: { fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
});
