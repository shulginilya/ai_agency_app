import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';

export type MessageComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Disabled while a send is in flight, or when there is no agent to talk to. */
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
};

/**
 * The input row. Deliberately dumb — it owns no state and knows nothing about
 * the network, so the screen decides what "send" means and the tests can drive
 * it directly.
 *
 * Enter sends on web (`submitEditing`); on a phone the button is the affordance
 * and Enter inserts a newline, which is what you want when dictating a task.
 */
export function MessageComposer({
  value,
  onChangeText,
  onSend,
  disabled = false,
  busy = false,
  placeholder = 'Send the agent an instruction…',
}: MessageComposerProps) {
  const { colors } = useTheme();
  const canSend = value.trim().length > 0 && !disabled && !busy;

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <TextInput
        testID="composer-input"
        accessibilityLabel="Message"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        editable={!disabled}
        multiline={Platform.OS !== 'web'}
        onSubmitEditing={() => canSend && onSend()}
        blurOnSubmit={false}
        returnKeyType="send"
        style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
      />
      <Pressable
        testID="composer-send"
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={onSend}
        style={[styles.send, { backgroundColor: canSend ? colors.accent : colors.border }]}
      >
        {busy ? (
          <ActivityIndicator testID="composer-busy" color="#fff" size="small" />
        ) : (
          <Ionicons name="arrow-up" size={18} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
