import { StyleSheet, Text, View } from 'react-native';
import type { RequestLogEntry } from '@/api/log';
import { spacing, useTheme } from '@/theme';

/** Shows the path only — the base URL is already displayed once at the top. */
export function pathOf(url: string): string {
  const match = /^https?:\/\/[^/]+(\/.*)?$/.exec(url);
  return match?.[1] ?? url;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function RequestLogRow({ entry }: { entry: RequestLogEntry }) {
  const { colors } = useTheme();
  const color = entry.ok ? colors.success : colors.danger;
  const outcome = entry.ok ? String(entry.status) : (entry.errorKind ?? 'error');

  return (
    <View testID="request-log-row" style={styles.row}>
      <Text style={[styles.time, { color: colors.textMuted }]}>{formatTime(entry.startedAt)}</Text>
      <Text style={[styles.method, { color: colors.textMuted }]}>{entry.method}</Text>
      <Text numberOfLines={1} style={[styles.path, { color: colors.text }]}>
        {pathOf(entry.url)}
        {entry.attempt > 1 ? ` (retry ${entry.attempt - 1})` : ''}
      </Text>
      <Text style={[styles.latency, { color: colors.textMuted }]}>{entry.latencyMs}ms</Text>
      <Text style={[styles.status, { color }]}>{outcome}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  time: { fontSize: 11, fontFamily: 'monospace' },
  method: { fontSize: 11, fontWeight: '700', width: 34 },
  path: { flex: 1, fontSize: 12, fontFamily: 'monospace' },
  latency: { fontSize: 11, fontVariant: ['tabular-nums'] },
  status: { fontSize: 11, fontWeight: '700' },
});
