import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadTasks, saveTasks } from '@/storage/tasks';
import type { Task } from '@/types';

export type Filter = 'all' | 'active' | 'done';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount.
  useEffect(() => {
    let cancelled = false;
    loadTasks().then((stored) => {
      if (!cancelled) {
        setTasks(stored);
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every change (after hydration, so we don't wipe storage on boot).
  useEffect(() => {
    if (hydrated) void saveTasks(tasks);
  }, [tasks, hydrated]);

  const addTask = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTasks((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: trimmed, done: false, createdAt: Date.now() },
      ...prev,
    ]);
  }, []);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearDone = useCallback(() => {
    setTasks((prev) => prev.filter((t) => !t.done));
  }, []);

  const visibleTasks = useMemo(() => {
    if (filter === 'active') return tasks.filter((t) => !t.done);
    if (filter === 'done') return tasks.filter((t) => t.done);
    return tasks;
  }, [tasks, filter]);

  const remaining = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

  return { tasks, visibleTasks, remaining, filter, setFilter, addTask, toggleTask, removeTask, clearDone, hydrated };
}
