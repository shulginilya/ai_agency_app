import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { TaskItem } from '@/components/TaskItem';
import { type Filter, useTasks } from '@/hooks/useTasks';
import { radius, spacing, useTheme } from '@/theme';

const FILTERS: Filter[] = ['all', 'active', 'done'];

export default function TasksScreen() {
  const { colors } = useTheme();
  const { visibleTasks, remaining, filter, setFilter, addTask, toggleTask, removeTask, clearDone } = useTasks();
  const [draft, setDraft] = useState('');

  const submit = () => {
    addTask(draft);
    setDraft('');
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.header}>
          <Text style={[styles.h1, { color: colors.text }]}>Tasks</Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>
            {remaining === 0 ? 'All clear' : `${remaining} remaining`}
          </Text>
        </View>

        <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            placeholder="What needs doing?"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            style={[styles.input, { color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add task"
            onPress={submit}
            style={[styles.addBtn, { backgroundColor: colors.accent, opacity: draft.trim() ? 1 : 0.4 }]}
            disabled={!draft.trim()}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.filters}>
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: active ? colors.accent : 'transparent' },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.textMuted }]}>{f}</Text>
              </Pressable>
            );
          })}
          <View style={styles.flex} />
          <Pressable onPress={clearDone} hitSlop={8}>
            <Text style={[styles.clear, { color: colors.textMuted }]}>Clear done</Text>
          </Pressable>
        </View>

        <FlatList
          data={visibleTasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <TaskItem task={item} onToggle={toggleTask} onRemove={removeTask} />}
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-outline"
              title="Nothing here yet"
              subtitle="Add a task above. It's saved on the device, so it survives an app restart."
            />
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14, marginTop: 2 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 16, paddingHorizontal: spacing.sm, paddingVertical: Platform.OS === 'ios' ? 8 : 4 },
  addBtn: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13, textTransform: 'capitalize', fontWeight: '600' },
  clear: { fontSize: 13 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
});
