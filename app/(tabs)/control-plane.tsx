import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { apiClient } from '@/api/client';
import { describeApiError } from '@/api/errors';
import { requestLog } from '@/api/log';
import { ReadinessSchema, type SessionInfo } from '@/api/schemas';
import { PROBE_NAMES } from '@/api/system';
import { ProbeCard } from '@/components/ProbeCard';
import { RequestLogRow } from '@/components/RequestLogRow';
import { Screen } from '@/components/Screen';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { useRequestLog } from '@/hooks/useRequestLog';
import { useCloseSession, useSessions } from '@/hooks/useSessions';
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
 * What this box is doing.
 *
 * Three questions, in the order you ask them when something is wrong: is it up
 * (the probes), will it take my work (the capacity readiness reports), and what
 * is it already holding (the open sessions). The request log underneath is the
 * network layer made visible rather than magic.
 *
 * Sessions live here rather than on the Conversation tab because
 * `GET /v1/sessions` is per-process and operational — it answers "what is this
 * server holding open", not "what have I been talking about".
 */
export default function ControlPlaneScreen() {
  const { colors } = useTheme();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { status, byName, isFetching, lastCheckedAt, refresh } = useSystemStatus({ autoRefresh });
  const sessions = useSessions({ pollIntervalMs: autoRefresh ? undefined : false });
  const closeSession = useCloseSession();
  const log = useRequestLog();

  // The probe body is parsed permissively (any route may become a probe), so the
  // readiness shape is checked here rather than assumed. `capacity` is the one
  // number that says whether a prompt will be accepted right now.
  const readiness = ReadinessSchema.safeParse(byName.readyz?.body);
  const capacity = readiness.success ? Object.entries(readiness.data.capacity) : [];

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

          {capacity.length > 0 ? (
            <View testID="capacity-strip" style={styles.capacityRow}>
              {capacity.map(([name, free]) => (
                <View key={name} testID={`capacity-${name}`} style={[styles.capacity, { borderColor: colors.border }]}>
                  <Text style={[styles.capacityValue, { color: free > 0 ? colors.text : colors.warning }]}>{free}</Text>
                  <Text style={[styles.capacityLabel, { color: colors.textMuted }]}>{name}</Text>
                </View>
              ))}
            </View>
          ) : null}

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

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Open sessions</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {sessions.isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : sessions.error ? (
            <Text testID="sessions-error" style={[styles.cardText, { color: colors.textMuted }]}>
              {describeApiError(sessions.error, 'Could not list sessions.')}
            </Text>
          ) : sessions.data && sessions.data.length > 0 ? (
            sessions.data.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                busy={closeSession.isPending && closeSession.variables === session.id}
                onClose={() => closeSession.mutate(session.id)}
              />
            ))
          ) : (
            <Text testID="sessions-empty" style={[styles.cardText, { color: colors.textMuted }]}>
              Nothing open. A conversation opens one on its first message.
            </Text>
          )}
          {closeSession.error ? (
            <Text testID="session-close-error" style={[styles.cardText, { color: colors.danger }]}>
              {describeApiError(closeSession.error, 'That session did not close.')}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          Per-process: with several uvicorn workers each one lists only its own.
        </Text>

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

function SessionRow({
  session,
  busy,
  onClose,
}: {
  session: SessionInfo;
  busy: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View testID={`session-row-${session.id}`} style={styles.sessionRow}>
      <View style={styles.flex}>
        <Text style={[styles.sessionId, { color: colors.text }]} numberOfLines={1}>
          {session.id}
        </Text>
        <Text testID={`session-meta-${session.id}`} style={[styles.sessionMeta, { color: colors.textMuted }]}>
          {[
            session.profile,
            // The team's name, or `solo`. A bare "team" stopped being an answer
            // when the server grew more than one.
            session.team ?? 'solo',
            `${session.turns} turn${session.turns === 1 ? '' : 's'}`,
            `active ${new Date(session.last_active_at).toLocaleTimeString()}`,
          ].join(' · ')}
        </Text>
      </View>
      <StatusPill
        testID={`session-status-${session.id}`}
        label={session.status}
        tone={session.status === 'busy' ? 'warning' : 'muted'}
      />
      <Pressable
        testID={`session-close-${session.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Close session ${session.id}`}
        // A busy session refuses to close (409) rather than being torn out
        // mid-turn — so the button says so instead of inviting the error.
        accessibilityState={{ disabled: busy || session.status === 'busy' }}
        disabled={busy || session.status === 'busy'}
        onPress={onClose}
        hitSlop={8}
      >
        <Text
          style={[
            styles.clear,
            { color: session.status === 'busy' ? colors.textMuted : colors.accent, opacity: busy ? 0.5 : 1 },
          ]}
        >
          {busy ? 'Closing…' : 'Close'}
        </Text>
      </Pressable>
    </View>
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
  capacityRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  capacity: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    minWidth: 84,
  },
  capacityValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  capacityLabel: { fontSize: 11 },
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
    gap: spacing.md,
  },
  cardText: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 12, marginTop: spacing.sm },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sessionId: { fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  sessionMeta: { fontSize: 11, marginTop: 2 },
  logHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  clear: { fontSize: 13 },
});
