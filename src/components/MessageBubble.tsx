import { StyleSheet, Text, View } from 'react-native';
import { blockedEvents, runHeadline, toolsUsed, type TranscriptEntry } from '@/chat/transcript';
import { radius, spacing, useTheme } from '@/theme';

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * One line of the conversation.
 *
 * Three roles, three treatments: what you said sits right and filled, what the
 * agent said sits left on a card, and what the control plane said runs centred
 * and quiet — an event, not a voice.
 *
 * An agent line carries its run underneath it: turns, wall time, cost, model,
 * who it delegated to, and which tools it touched. That is the part a one-shot
 * `POST /v1/runs` and a session turn have in common, and it is most of the
 * reason to look at this screen rather than run the CLI.
 */
export function MessageBubble({ entry }: { entry: TranscriptEntry }) {
  const { colors } = useTheme();
  const time = formatTime(entry.created_at);

  if (entry.role === 'system') {
    return (
      <View testID={`message-${entry.id}`} style={styles.systemRow}>
        <Text style={[styles.systemText, { color: colors.textMuted }]}>{entry.content}</Text>
      </View>
    );
  }

  const mine = entry.role === 'user';
  const tools = entry.run ? toolsUsed(entry.run) : [];
  const blocked = entry.run ? blockedEvents(entry.run) : [];

  return (
    <View
      testID={`message-${entry.id}`}
      accessibilityRole="text"
      accessibilityLabel={`${mine ? 'You' : 'Agent'}: ${entry.content}`}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.accent, borderColor: colors.accent, borderBottomRightRadius: radius.sm }
            : {
                backgroundColor: colors.card,
                borderColor: entry.failed ? colors.danger : colors.border,
                borderBottomLeftRadius: radius.sm,
              },
        ]}
      >
        {entry.failed ? (
          <Text testID={`message-failed-${entry.id}`} style={[styles.failed, { color: colors.danger }]}>
            The agent reported an error
          </Text>
        ) : null}

        <Text style={[styles.content, { color: mine ? '#fff' : colors.text }]}>{entry.content}</Text>

        {entry.run ? (
          <View style={[styles.trace, { borderTopColor: colors.border }]}>
            <Text testID={`run-headline-${entry.id}`} style={[styles.traceText, { color: colors.textMuted }]}>
              {runHeadline(entry.run)}
            </Text>
            {tools.length > 0 ? (
              <Text testID={`run-tools-${entry.id}`} style={[styles.traceText, { color: colors.textMuted }]}>
                tools: {tools.join(', ')}
              </Text>
            ) : null}
            {blocked.length > 0 ? (
              <Text testID={`run-blocked-${entry.id}`} style={[styles.traceText, { color: colors.warning }]}>
                {blocked.map((event) => `${event.tool} ${event.phase}`).join(', ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.meta}>
          {entry.turn !== undefined ? (
            <Text style={[styles.time, { color: mine ? '#FFFFFFB3' : colors.textMuted }]}>turn {entry.turn}</Text>
          ) : null}
          {time ? <Text style={[styles.time, { color: mine ? '#FFFFFFB3' : colors.textMuted }]}>{time}</Text> : null}
          {entry.pending ? (
            <Text
              testID={`message-pending-${entry.id}`}
              style={[styles.time, { color: mine ? '#FFFFFFB3' : colors.textMuted }]}
            >
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
  failed: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  content: { fontSize: 15, lineHeight: 21 },
  trace: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.xs, gap: 2 },
  traceText: { fontSize: 11, fontFamily: 'monospace' },
  meta: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'flex-end' },
  time: { fontSize: 11 },
  systemRow: { alignItems: 'center', paddingVertical: spacing.sm },
  systemText: { fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
});
