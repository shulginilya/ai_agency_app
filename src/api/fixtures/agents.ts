import type { AgentInfo } from '@/api/schemas';

/**
 * TEMPORARY — dummy data for `/v1/agents` so the roster can be looked at without
 * a server running.
 *
 * Turn it on with `EXPO_PUBLIC_MOCK_AGENTS=1` in `.env`, then restart Metro
 * (Expo inlines EXPO_PUBLIC_* at bundle time, so a running server will not pick
 * the change up). With the flag unset — which is the default, and what CI and
 * every test run see — nothing here is reachable and the app talks to the API.
 *
 * The shape is `AgentInfo` from the spec, statuses included: the roster is
 * read-only, so unlike the earlier version of this file nothing here mutates.
 *
 * To remove: delete this file and the two `if (MOCK_AGENTS_ENABLED)` early
 * returns in `src/api/agents.ts`. Nothing else refers to it.
 */
export const MOCK_AGENTS_ENABLED = process.env.EXPO_PUBLIC_MOCK_AGENTS === '1';

/** One per status, so every StatusPill tone and row state is on screen at once. */
const SEED: readonly AgentInfo[] = [
  {
    id: 'researcher',
    name: 'researcher',
    status: 'running',
    description: 'Reads the brief and pulls together background on each account.',
    availability: 'always',
    updated_at: '2026-08-21T07:40:00Z',
    model: 'sonnet',
    tools: ['Read', 'Grep', 'WebSearch'],
    max_turns: 12,
    invocations: 4,
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    status: 'idle',
    description: 'Reviews a diff and reports what would break.',
    availability: 'always',
    updated_at: '2026-08-21T07:12:00Z',
    model: 'opus',
    tools: ['Read', 'Grep'],
    max_turns: null,
    invocations: 2,
  },
  {
    id: 'planner',
    name: 'planner',
    status: 'starting',
    description: 'Turns a goal into an ordered plan before anyone writes code.',
    availability: 'team',
    updated_at: '2026-08-21T07:44:00Z',
    model: null,
    tools: null,
    max_turns: 6,
    invocations: 0,
  },
  {
    id: 'scribe',
    name: 'scribe',
    status: 'paused',
    description: 'Writes the run up afterwards, for people who were not watching.',
    availability: 'team',
    updated_at: '2026-08-21T06:30:00Z',
    model: 'haiku',
    tools: ['Read', 'Write'],
    max_turns: 4,
    invocations: 1,
  },
  {
    id: 'builder',
    name: 'builder',
    status: 'error',
    description: 'Applies the plan. Last delegation failed inside the tool call.',
    availability: 'team',
    updated_at: '2026-08-21T05:58:00Z',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Bash'],
    max_turns: 20,
    invocations: 7,
  },
  {
    id: 'archivist',
    name: 'archivist',
    status: 'stopped',
    description: 'Sweeps finished runs into the archive.',
    availability: 'team',
    updated_at: '2026-08-20T18:05:00Z',
    model: 'haiku',
    tools: ['Read'],
    max_turns: null,
    invocations: 0,
  },
];

export function mockListAgents(): AgentInfo[] {
  return SEED.map((agent) => ({ ...agent }));
}

export function mockGetAgent(id: string): AgentInfo {
  const agent = SEED.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`No mock agent with id ${id}`);
  return { ...agent };
}
