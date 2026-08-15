import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PROBES, type ProbeName, type ProbeResult } from '@/api/system';
import { StatusPill } from '@/components/StatusPill';
import { radius, spacing, useTheme } from '@/theme';

type Props = {
  name: ProbeName;
  result?: ProbeResult;
  isFetching?: boolean;
};

/** One endpoint: what it means, whether it answered, how fast, and what it said. */
export function ProbeCard({ name, result, isFetching = false }: Props) {
  const { colors } = useTheme();
  const meta = PROBES[name];
  const tone = result === undefined ? 'muted' : result.ok ? 'success' : 'danger';
  const label = result === undefined ? 'checking' : result.ok ? 'up' : 'down';

  return (
    <View
      testID={`probe-card-${name}`}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.text }]}>{meta.label}</Text>
          <Text testID={`probe-path-${name}`} style={[styles.path, { color: colors.textMuted }]}>
            GET {meta.path}
          </Text>
        </View>
        {isFetching && result === undefined ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <StatusPill testID={`probe-status-${name}`} label={label} tone={tone} />
        )}
      </View>

      <Text style={[styles.hint, { color: colors.textMuted }]}>{meta.hint}</Text>

      {result ? (
        <View style={styles.metaRow}>
          <Text testID={`probe-http-${name}`} style={[styles.meta, { color: colors.textMuted }]}>
            HTTP {result.httpStatus ?? '—'}
          </Text>
          <Text testID={`probe-latency-${name}`} style={[styles.meta, { color: colors.textMuted }]}>
            {result.latencyMs} ms
          </Text>
        </View>
      ) : null}

      {result?.error ? (
        <Text testID={`probe-error-${name}`} style={[styles.error, { color: colors.danger }]}>
          {result.error.message}
        </Text>
      ) : null}

      {result?.ok && result.body ? (
        <View style={[styles.body, { borderColor: colors.border }]}>
          <Text testID={`probe-body-${name}`} style={[styles.bodyText, { color: colors.textMuted }]}>
            {JSON.stringify(result.body)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { fontSize: 16, fontWeight: '700' },
  path: { fontSize: 13, fontFamily: 'monospace', marginTop: 2 },
  hint: { fontSize: 13 },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  meta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  error: { fontSize: 13, marginTop: spacing.xs },
  body: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.xs },
  bodyText: { fontSize: 12, fontFamily: 'monospace' },
});
