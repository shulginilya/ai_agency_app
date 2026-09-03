import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RUN_PROFILES, type RunProfile } from '@/api/schemas';
import { BottomSheet } from '@/components/BottomSheet';
import { radius, spacing, useTheme } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  selected: RunProfile | null;
  onSelect: (profile: RunProfile | null) => void;
  /** A session fixed its profile when it connected; the rows say so and lock. */
  locked: boolean;
};

/**
 * The profile picker.
 *
 * Deliberately thin on prose: the server publishes the three names in the
 * OpenAPI enum and nothing else — no description, no default. Inventing a
 * sentence about what `sandboxed` does would be the UI making a promise the
 * API never made, so the sheet says only what is true: it is sent as
 * `profile`, and leaving it unset lets the server decide.
 */
export function ProfileSheet({ visible, onClose, selected, onSelect, locked }: Props) {
  const { colors } = useTheme();

  const choose = (profile: RunProfile | null) => {
    onSelect(profile);
    onClose();
  };

  const options: { value: RunProfile | null; label: string; meta: string }[] = [
    { value: null, label: 'Server default', meta: 'profile is left off the request entirely.' },
    ...RUN_PROFILES.map((value) => ({
      value,
      label: value,
      meta: `sent as profile: "${value}".`,
    })),
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      testID="profile-sheet"
      title="Profile"
      subtitle={
        locked
          ? 'This session connected with a profile and the server fixed it there. Close the session to choose another.'
          : 'The server publishes these three names and no description of them.'
      }
    >
      {options.map(({ value, label, meta }) => {
        const active = selected === value;
        return (
          <Pressable
            key={value ?? 'default'}
            testID={`profile-${value ?? 'default'}`}
            accessibilityRole="button"
            accessibilityLabel={value ? `Profile ${value}` : 'Server default profile'}
            accessibilityState={{ selected: active, disabled: locked }}
            disabled={locked}
            onPress={() => choose(value)}
            style={[
              styles.row,
              {
                backgroundColor: colors.background,
                borderColor: active ? colors.accent : colors.border,
                opacity: locked ? 0.5 : 1,
              },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.label, { color: active ? colors.accent : colors.text }]}>{label}</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{meta}</Text>
            </View>
            {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  label: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
});
