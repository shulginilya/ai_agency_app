import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { apiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { requestLog } from '@/api/log';
import { PROBE_NAMES } from '@/api/system';
import { ProbeCard } from '@/components/ProbeCard';
import { RequestLogRow } from '@/components/RequestLogRow';
import { Screen } from '@/components/Screen';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { useAgents } from '@/hooks/useAgents';
import { useRequestLog } from '@/hooks/useRequestLog';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { radius, spacing, useTheme } from '@/theme';

const STATUS_TONE: Record<string, StatusTone> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'muted',
};

const STATUS_COPY: Record<string, string> = {
  healthy: 'Every probe answered. The control API is serving.',
  degraded: 'The API is alive but not ready — a dependency is still coming up.',
  down: 'No probe answered. The API is unreachable from this device.',
  unknown: 'Running the first check…',
};

/**
 * Proof of concept for the agent control plane.
 *
 * It does three things: probes the two health checks and shows what came back,
 * lists the agents from `GET /v1/agents`, and exposes the raw request log so the
 * network layer is visible rather than magic.
 */
export default function AgentsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { status, byName, isFetching, lastCheckedAt, refresh } = useSystemStatus({ autoRefresh });
  const agents = useAgents();
  const log = useRequestLog();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.h1, { color: colors.text }]}>Control plane</Text>
          <Text testID="api-base-url" style={[styles.sub, { color: colors.textMuted }]}>
            {apiClient.baseUrl}
          </Text>
        </View>

        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryTop}>
            <StatusPill testID="system-status" label={status} tone={STATUS_TONE[status] ?? 'muted'} />
            {isFetching ? <ActivityIndicator testID="status-spinner" color={colors.accent} /> : null}
          </View>
          <Text style={[styles.summaryText, { color: colors.textMuted }]}>{STATUS_COPY[status]}</Text>

          <View style={styles.controls}>
            <Pressable
              testID="run-checks"
              accessibilityRole="button"
              accessibilityLabel="Run checks now"
              onPress={() => void refresh()}
              style={[styles.button, { backgroundColor: colors.accent }]}
            >
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.buttonText}>Run checks</Text>
            </Pressable>

            <View style={styles.flex} />

            <Text style={[styles.switchLabel, { color: colors.textMuted }]}>Auto</Text>
            <Switch
              testID="auto-refresh"
              value={autoRefresh}
              onValueChange={setAutoRefresh}
              accessibilityLabel="Auto refresh"
            />
          </View>

          {lastCheckedAt ? (
            <Text testID="last-checked" style={[styles.timestamp, { color: colors.textMuted }]}>
              Last check {new Date(lastCheckedAt).toLocaleTimeString()}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Probes</Text>
        {PROBE_NAMES.map((name) => (
          <ProbeCard key={name} name={name} result={byName[name]} isFetching={isFetching} />
        ))}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Agents</Text>
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

        <View style={styles.logHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Request log</Text>
          <Pressable testID="clear-log" onPress={requestLog.clear} hitSlop={8}>
            <Text style={[styles.clear, { color: colors.textMuted }]}>Clear</Text>
          </Pressable>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {log.length === 0 ? (
            <Text style={[styles.cardText, { color: colors.textMuted }]}>No calls yet.</Text>
          ) : (
            log.slice(0, 12).map((entry) => <RequestLogRow key={entry.id} entry={entry} />)
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
  sub: { fontSize: 13, marginTop: 2, fontFamily: 'monospace' },
  summary: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryText: { fontSize: 13, lineHeight: 18 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  switchLabel: { fontSize: 13 },
  timestamp: { fontSize: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.sm },
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
  logHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  clear: { fontSize: 13 },
});
