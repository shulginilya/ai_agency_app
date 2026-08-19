import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task } from '@/types';

const KEY = 'tasks:v1';

export async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    // Corrupt / unreadable storage should never crash the app.
    return [];
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(tasks));
  } catch {
    // Ignore write failures (e.g. device out of space).
  }
}
