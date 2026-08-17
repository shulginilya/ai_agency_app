import type { Agent, AgentCommand } from '@/api/agents';

/**
 * TEMPORARY — dummy data for `/v1/agents` so the screen can be looked at before
 * the real route serves anything.
 *
 * Turn it on with `EXPO_PUBLIC_MOCK_AGENTS=1` in `.env`, then restart Metro
 * (Expo inlines EXPO_PUBLIC_* at bundle time, so a running server will not pick
 * the change up). With the flag unset — which is the default, and what CI and
 * every test run see — nothing here is reachable and the app talks to the API.
 *
 * To remove: delete this file and the three `if (MOCK_AGENTS_ENABLED)` early
 * returns in `src/api/agents.ts`. Nothing else refers to it.
 */
export const MOCK_AGENTS_ENABLED = process.env.EXPO_PUBLIC_MOCK_AGENTS === '1';

/** One per status, so every StatusPill tone and row state is on screen at once. */
const SEED: readonly Agent[] = [
  {
    id: 'a1',
    name: 'Research agent',
    status: 'running',
    description: 'Reads the brief and pulls together background on each account.',
    updated_at: '2026-08-17T07:40:00Z',
  },
  {
    id: 'a2',
    name: 'Outreach agent',
    status: 'idle',
    description: 'Drafts the first-touch email once research signs off.',
    updated_at: '2026-08-17T07:12:00Z',
  },
  {
    id: 'a3',
    name: 'Lead scoring agent',
    status: 'starting',
    description: 'Warming up its model cache.',
    updated_at: '2026-08-17T07:44:00Z',
  },
  {
    id: 'a4',
    name: 'Meeting notes agent',
    status: 'paused',
    description: 'Held while the calendar integration is reconnected.',
    updated_at: '2026-08-17T06:30:00Z',
  },
  {
    id: 'a5',
    name: 'Invoice agent',
    status: 'error',
    description: 'Last run failed: the billing API rejected the credentials.',
    updated_at: '2026-08-17T05:58:00Z',
  },
  {
    id: 'a6',
    name: 'Archive agent',
    status: 'stopped',
    description: 'Stopped by hand after the quarterly sweep finished.',
    updated_at: '2026-08-16T18:05:00Z',
  },
];

/**
 * A mutable copy, so start/pause/stop actually move a row and the screen is worth
 * clicking rather than being a screenshot. Resets on reload, which is fine.
 */
let agents: Agent[] = SEED.map((agent) => ({ ...agent }));

const STATUS_AFTER: Record<AgentCommand, Agent['status']> = {
  start: 'running',
  stop: 'stopped',
  pause: 'paused',
};

export function mockListAgents(): Agent[] {
  return agents.map((agent) => ({ ...agent }));
}

export function mockGetAgent(id: string): Agent {
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`No mock agent with id ${id}`);
  return { ...agent };
}

export function mockCommandAgent(id: string, command: AgentCommand): Agent {
  agents = agents.map((agent) =>
    agent.id === id ? { ...agent, status: STATUS_AFTER[command], updated_at: new Date().toISOString() } : agent,
  );
  return mockGetAgent(id);
}
