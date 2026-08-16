import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';

export type StatusTone = 'success' | 'danger' | 'warning' | 'muted';

type Props = {
  label: string;
  tone: StatusTone;
  testID?: string;
};

/** Colour is never the only signal — the label always spells the state out. */
export function StatusPill({ label, tone, testID }: Props) {
  const { colors } = useTheme();
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : colors.textMuted;

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      style={[styles.pill, { borderColor: color, backgroundColor: `${color}1A` }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
});
