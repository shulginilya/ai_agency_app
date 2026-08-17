import { apiClient } from '@/api/client';
import type { HttpClient } from '@/api/http';
import { AgentListResponseSchema, AgentSchema, type Agent, type AgentStatus } from '@/api/schemas';

/**
 * The agent endpoints — and the template for every new one you add. An endpoint
 * module should be exactly this: a path, a schema, and a one-line call. All
 * transport concerns live in `HttpClient`.
 *
 * Everything hangs off `/v1/agents`. The version prefix lives in the path and
 * nowhere else — not in the base URL, not in a per-call option — so a `/v2`
 * route can sit beside a `/v1` one without a flag day.
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

export async function listAgents({ client = apiClient, signal }: AgentsApiOptions = {}): Promise<Agent[]> {
  const { data } = await client.get(AGENTS_PATH, { schema: AgentListResponseSchema, signal });
  return data;
}

export async function getAgent(id: string, { client = apiClient, signal }: AgentsApiOptions = {}): Promise<Agent> {
  const { data } = await client.get(agentPath(id), { schema: AgentSchema, signal });
  return data;
}

export type AgentCommand = 'start' | 'stop' | 'pause';

/** Commands are POSTs: not retried automatically, by design. */
export async function commandAgent(
  id: string,
  command: AgentCommand,
  { client = apiClient, signal }: AgentsApiOptions = {},
): Promise<Agent> {
  const { data } = await client.post(agentPath(id, command), undefined, {
    schema: AgentSchema,
    signal,
  });
  return data;
}

export type { Agent, AgentStatus };
