import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, useTheme } from '@/theme';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon = 'sparkles-outline', title, subtitle }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.root}>
      <Ionicons name={icon} size={44} color={colors.textMuted} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl * 2, gap: spacing.sm },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 14, textAlign: 'center', paddingHorizontal: spacing.xl },
});
