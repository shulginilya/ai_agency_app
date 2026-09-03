import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. Say what the choice actually does on the wire. */
  subtitle?: string;
  testID?: string;
  children: ReactNode;
};

/**
 * A modal sheet anchored to the bottom of the screen.
 *
 * The header controls moved in here because there are now three of them and
 * each has more to say than fits on a chip. A sheet buys the room without
 * pushing the transcript off the screen — the thread is what the tab is for.
 *
 * The backdrop is a pressable, and so is the ✕: dismissing has to work for a
 * thumb reaching from the bottom and for a pointer at the top, and on Android
 * `onRequestClose` catches the back button.
 */
export function BottomSheet({ visible, onClose, title, subtitle, testID, children }: Props) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          testID={testID}
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.grabber}>
            <View style={[styles.grabberBar, { backgroundColor: colors.border }]} />
          </View>
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
            </View>
            <Pressable
              testID={testID ? `${testID}-close` : undefined}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  flex: { flex: 1 },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.lg,
  },
  grabber: { alignItems: 'center', paddingTop: spacing.sm },
  grabberBar: { width: 36, height: 4, borderRadius: radius.pill },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
});
