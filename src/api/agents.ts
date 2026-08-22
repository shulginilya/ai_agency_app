import { apiClient } from '@/api/client';
import { MOCK_AGENTS_ENABLED, mockGetAgent, mockListAgents } from '@/api/fixtures/agents';
import type { HttpClient } from '@/api/http';
import {
  AgentInfoSchema,
  AgentsResponseSchema,
  type AgentAvailability,
  type AgentInfo,
  type AgentStatus,
} from '@/api/schemas';

/**
 * The agent endpoints — and the template for every new one you add. An endpoint
 * module should be exactly this: a path, a schema, and a one-line call. All
 * transport concerns live in `HttpClient`.
 *
 * The roster is **read-only**, and that is the server's design rather than an
 * unfinished feature. There is no `POST /v1/agents/{id}/start|stop|pause`: the
 * SDK exposes `interrupt()` on the main session, not on individual workers, so a
 * worker is never paused or stopped as a distinct state — it is running or it is
 * gone. Work reaches an agent by being delegated to it from a team run
 * (`POST /v1/runs` or a session opened with `team: true`), not by being pushed
 * at it. The client used to carry those three command routes; the contract test
 * is what finally proved they had never existed.
 *
 * The version prefix lives in the path and nowhere else — not in the base URL,
 * not in a per-call option — so a `/v2` route can sit beside a `/v1` one without
 * a flag day.
 */
export const AGENTS_PATH = '/v1/agents';

/**
 * `/v1/agents/{id}` plus any trailing segments, with the id escaped: ids are
 * server-chosen strings and a `/` in one must not invent a new route.
 */
export function agentPath(id: string, ...segments: string[]): string {
  return [AGENTS_PATH, encodeURIComponent(id), ...segments].join('/');
}

export type AgentsApiOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
};

export async function listAgents({ client = apiClient, signal }: AgentsApiOptions = {}): Promise<AgentInfo[]> {
  // TEMPORARY: see src/api/fixtures/agents.ts. Off unless EXPO_PUBLIC_MOCK_AGENTS=1.
  // No request is made, so mocked calls do not show up in the request log either.
  if (MOCK_AGENTS_ENABLED) return mockListAgents();
  const { data } = await client.get(AGENTS_PATH, { schema: AgentsResponseSchema, signal });
  return data;
}

/** 404 for an unknown id, by design — an empty 200 would let a typo survive to `POST /v1/runs`. */
export async function getAgent(id: string, { client = apiClient, signal }: AgentsApiOptions = {}): Promise<AgentInfo> {
  if (MOCK_AGENTS_ENABLED) return mockGetAgent(id);
  const { data } = await client.get(agentPath(id), { schema: AgentInfoSchema, signal });
  return data;
}

/** True when this agent is only loaded for a team run — worth saying on the roster. */
export function isTeamOnly(agent: AgentInfo): boolean {
  return agent.availability === 'team';
}

export type { AgentAvailability, AgentInfo, AgentStatus };
