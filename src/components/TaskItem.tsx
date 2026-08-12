import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';
import type { Task } from '@/types';

type Props = {
  task: Task;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
};

export function TaskItem({ task, onToggle, onRemove }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.done }}
        accessibilityLabel={task.title}
        onPress={() => onToggle(task.id)}
        hitSlop={8}
        style={styles.main}
      >
        <Ionicons
          name={task.done ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={task.done ? colors.success : colors.textMuted}
        />
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            { color: task.done ? colors.textMuted : colors.text },
            task.done && styles.done,
          ]}
        >
          {task.title}
        </Text>
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Delete task" onPress={() => onRemove(task.id)} hitSlop={8}>
        <Ionicons name="trash-outline" size={20} color={colors.danger} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1, fontSize: 16 },
  done: { textDecorationLine: 'line-through' },
});
