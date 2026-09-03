import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Spoken by a screen reader in place of the label, when the label is terse. */
  accessibilityLabel?: string;
};

type Props<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Each segment gets `${testIDPrefix}-${value}`. */
  testIDPrefix: string;
};

/**
 * A real segmented control: one track, N segments, exactly one selected.
 *
 * The shape carries the meaning that a row of independent chips could not —
 * these options are mutually exclusive and one of them is always on, which is
 * true of the mode and false of the team (which has a "none" state) and the
 * profile (which does too). Those get buttons, not segments.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  testIDPrefix,
}: Props<T>) {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.track, { backgroundColor: colors.background, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testIDPrefix}-${option.value}`}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              active && { backgroundColor: colors.card, borderColor: colors.accent },
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.accent : colors.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  label: { fontSize: 13, fontWeight: '600' },
});
