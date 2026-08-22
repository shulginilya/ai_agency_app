import type { ProbeName } from '@/api/system';

/**
 * Every cache key in one place, so invalidating is never a guessing game.
 * `qk.probes()` invalidates both probes; `qk.probe('readyz')` just one.
 *
 * There is no key for a conversation: the server does not store one, so the
 * transcript is component state rather than cached server data. Putting it in
 * the query cache would imply it could be refetched, and it cannot.
 */
export const qk = {
  probes: () => ['probes'] as const,
  probe: (name: ProbeName) => ['probes', name] as const,
  agents: () => ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
  sessions: () => ['sessions'] as const,
  session: (id: string) => ['sessions', id] as const,
};
