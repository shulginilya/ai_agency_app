import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isApiError } from '@/api/errors';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { useAgents } from '@/hooks/useAgents';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The agent roster. Lists the agents from `GET /v1/agents` and opens a chat
 * thread when you tap one.
 *
 * Status, probes and the request log live on the Control plane tab — this
 * screen is just "which agents exist and what are they doing right now."
 */
export default function AgentsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const agents = useAgents();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.h1, { color: colors.text }]}>Agents</Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>Tap an agent to open its chat.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {agents.isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : agents.error ? (
            <Text testID="agents-error" style={[styles.cardText, { color: colors.textMuted }]}>
              {isApiError(agents.error) ? agents.error.userMessage : 'Could not load agents.'}
            </Text>
          ) : agents.data && agents.data.length > 0 ? (
            agents.data.map((agent) => (
              <Pressable
                key={agent.id}
                testID={`agent-row-${agent.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open chat with ${agent.name}`}
                onPress={() => router.push(`/agent/${encodeURIComponent(agent.id)}`)}
                style={styles.agentRow}
              >
                <View style={styles.flex}>
                  <Text style={[styles.agentName, { color: colors.text }]}>{agent.name}</Text>
                  <Text style={[styles.agentId, { color: colors.textMuted }]}>{agent.id}</Text>
                </View>
                <StatusPill
                  testID={`agent-status-${agent.id}`}
                  label={agent.status}
                  tone={agent.status === 'error' ? 'danger' : agent.status === 'running' ? 'success' : 'muted'}
                />
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))
          ) : (
            <Text testID="agents-empty" style={[styles.cardText, { color: colors.textMuted }]}>
              No agents registered yet.
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2 },
  flex: { flex: 1 },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  cardText: { fontSize: 13, lineHeight: 18 },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  agentName: { fontSize: 15, fontWeight: '600' },
  agentId: { fontSize: 12, fontFamily: 'monospace' },
});
