import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { describeApiError } from '@/api/errors';
import type { AgentInfo } from '@/api/schemas';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { DEFAULT_ROSTER_POLL_MS, useAgents } from '@/hooks/useAgents';
import { STATUS_TONE } from '@/screens/AgentDetail';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The roster: every subagent this server can invoke, from `GET /v1/agents`.
 *
 * Read-only, because that is all the API offers — there is no start, pause or
 * stop, and pretending otherwise is what the contract test finally caught. What
 * a row is worth showing is what decides whether the manager will route work
 * here: the description, whether the agent is loaded on every run or only on a
 * team run, and its live status in this process.
 *
 * Polled, because `status` moves while a run is in flight and this screen is
 * exactly where someone watches that happen.
 */
export default function AgentsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const agents = useAgents({ pollIntervalMs: DEFAULT_ROSTER_POLL_MS });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.h1, { color: colors.text }]}>Agents</Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>
            Subagents the manager can delegate to. Tap one for its model, tools and turn cap.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {agents.isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : agents.error ? (
            <Text testID="agents-error" style={[styles.cardText, { color: colors.textMuted }]}>
              {describeApiError(agents.error, 'Could not load agents.')}
            </Text>
          ) : agents.data && agents.data.length > 0 ? (
            agents.data.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onPress={() => router.push(`/agent/${encodeURIComponent(agent.id)}`)}
              />
            ))
          ) : (
            <Text testID="agents-empty" style={[styles.cardText, { color: colors.textMuted }]}>
              No agents registered on this server.
            </Text>
          )}
        </View>

        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          The manager itself is not on this list — it is the thread you talk to on the Conversation tab. Turn Team on
          there and it may delegate to the agents marked <Text style={styles.code}>team</Text>.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function AgentRow({ agent, onPress }: { agent: AgentInfo; onPress: () => void }) {
  const { colors } = useTheme();

  return (
    <Pressable
      testID={`agent-row-${agent.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
      onPress={onPress}
      style={styles.agentRow}
    >
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text style={[styles.agentName, { color: colors.text }]}>{agent.name}</Text>
          {agent.availability === 'team' ? (
            <View testID={`agent-team-${agent.id}`} style={[styles.tag, { borderColor: colors.border }]}>
              <Text style={[styles.tagText, { color: colors.textMuted }]}>team</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.agentDescription, { color: colors.textMuted }]} numberOfLines={2}>
          {agent.description}
        </Text>
        <Text testID={`agent-meta-${agent.id}`} style={[styles.agentMeta, { color: colors.textMuted }]}>
          {[
            agent.model ?? 'inherited model',
            agent.tools ? `${agent.tools.length} tools` : 'inherited tools',
            `${agent.invocations ?? 0} invocations`,
          ].join(' · ')}
        </Text>
      </View>
      <StatusPill
        testID={`agent-status-${agent.id}`}
        label={agent.status}
        tone={STATUS_TONE[agent.status] ?? 'muted'}
      />
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  flex: { flex: 1 },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
  },
  cardText: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 18, marginTop: spacing.lg },
  code: { fontFamily: 'monospace' },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  agentName: { fontSize: 15, fontWeight: '600' },
  agentDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  agentMeta: { fontSize: 11, fontFamily: 'monospace', marginTop: 4 },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
});
