import type { ProbeName } from '@/api/system';

/**
 * Every cache key in one place, so invalidating is never a guessing game.
 * `qk.probes()` invalidates both probes; `qk.probe('readyz')` just one.
 */
export const qk = {
  probes: () => ['probes'] as const,
  probe: (name: ProbeName) => ['probes', name] as const,
  agents: () => ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
};
