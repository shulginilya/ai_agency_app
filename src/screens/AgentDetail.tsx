import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { describeApiError, isApiError } from '@/api/errors';
import type { AgentInfo, AgentStatus } from '@/api/schemas';
import { Screen } from '@/components/Screen';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { useAgent } from '@/hooks/useAgents';
import { radius, spacing, useTheme } from '@/theme';

export const STATUS_TONE: Record<AgentStatus, StatusTone> = {
  idle: 'muted',
  starting: 'warning',
  running: 'success',
  paused: 'warning',
  error: 'danger',
  stopped: 'muted',
};

export type AgentDetailProps = {
  agentId: string;
  onBack?: () => void;
};

/**
 * One roster entry, in full.
 *
 * There are no controls here, and that is the point: `GET /v1/agents/{id}` is
 * the whole of this agent's API surface. Work reaches it by delegation from a
 * team run, so what is worth showing is what the manager routes on — the
 * description — and what constrains the run: model, tool allowance, turn cap.
 *
 * `invocations` rather than the timestamp is how you tell "never ran" from "ran
 * and finished": `updated_at` is set to the time the server started observing,
 * so an agent that has never run still carries a plausible-looking time.
 */
export function AgentDetail({ agentId, onBack }: AgentDetailProps) {
  const { colors } = useTheme();
  const agent = useAgent(agentId);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerTop}>
          {onBack ? (
            <Pressable
              testID="detail-back"
              accessibilityRole="button"
              accessibilityLabel="Back to agents"
              onPress={onBack}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={24} color={colors.accent} />
            </Pressable>
          ) : null}
          <View style={styles.flex}>
            <Text testID="detail-agent-name" style={[styles.h1, { color: colors.text }]} numberOfLines={1}>
              {agent.data?.name ?? agentId}
            </Text>
            <Text style={[styles.sub, { color: colors.textMuted }]}>{agentId}</Text>
          </View>
          {agent.data ? (
            <StatusPill
              testID="detail-agent-status"
              label={agent.data.status}
              tone={STATUS_TONE[agent.data.status] ?? 'muted'}
            />
          ) : null}
        </View>

        {agent.isLoading && !agent.data ? (
          <ActivityIndicator testID="detail-loading" color={colors.accent} style={styles.centered} />
        ) : agent.error && !agent.data ? (
          <View testID="detail-error" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardText, { color: colors.textMuted }]}>
              {isApiError(agent.error) && agent.error.status === 404
                ? 'No agent with that id. It may have been renamed — pull the roster again.'
                : describeApiError(agent.error, 'Could not load this agent.')}
            </Text>
          </View>
        ) : agent.data ? (
          <AgentFacts agent={agent.data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function AgentFacts({ agent }: { agent: AgentInfo }) {
  const { colors } = useTheme();
  const tools = agent.tools ?? [];

  return (
    <View style={styles.stack}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>What it is for</Text>
        <Text testID="detail-description" style={[styles.cardText, { color: colors.textMuted }]}>
          {agent.description}
        </Text>
        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          This description is what the manager routes on — it is the agent&apos;s entry in the team, not a label.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Fact label="Availability" value={agent.availability} testID="detail-availability" />
        <Fact
          label="Team"
          value={agent.team ?? 'none — loaded on every run'}
          testID="detail-team"
        />
        <Fact
          label="Model"
          value={agent.model ?? 'inherits the run’s'}
          testID="detail-model"
        />
        <Fact
          label="Turn cap"
          value={agent.max_turns === null || agent.max_turns === undefined ? 'the run’s default' : String(agent.max_turns)}
          testID="detail-max-turns"
        />
        <Fact
          label="Invocations"
          value={
            agent.invocations ? `${agent.invocations} this process` : 'never started in this process'
          }
          testID="detail-invocations"
        />
        <Fact label="Status since" value={new Date(agent.updated_at).toLocaleString()} testID="detail-updated-at" />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Tools</Text>
        {tools.length > 0 ? (
          <View style={styles.chips}>
            {tools.map((tool) => (
              <View key={tool} testID={`detail-tool-${tool}`} style={[styles.chip, { borderColor: colors.border }]}>
                <Text style={[styles.chipText, { color: colors.text }]}>{tool}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text testID="detail-tools-inherited" style={[styles.cardText, { color: colors.textMuted }]}>
            Inherits the main thread&apos;s tools.
          </Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>How to reach it</Text>
        <Text testID="detail-how-to-reach" style={[styles.cardText, { color: colors.textMuted }]}>
          {agent.availability === 'team'
            ? `Only loaded on a run as ${agent.team ?? 'a team'}. Pick ${
                agent.team ?? 'that team'
              } in the Conversation tab and its manager may delegate here.`
            : 'Loaded on every run, whichever team. A manager may delegate to it whenever the description fits the work.'}
        </Text>
        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          There is no start, pause or stop: a worker is running or it is gone.
        </Text>
      </View>
    </View>
  );
}

function Fact({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.factRow}>
      <Text style={[styles.factLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text testID={testID} style={[styles.factValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.md },
  flex: { flex: 1 },
  h1: { fontSize: 26, fontWeight: '700' },
  sub: { fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  stack: { gap: spacing.md },
  centered: { marginTop: spacing.xl },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  cardText: { fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  factRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  factLabel: { fontSize: 13 },
  factValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontFamily: 'monospace' },
});
