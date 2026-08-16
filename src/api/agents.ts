import { apiClient } from '@/api/client';
import type { HttpClient } from '@/api/http';
import { AgentListResponseSchema, AgentSchema, type Agent, type AgentStatus } from '@/api/schemas';

/**
 * The endpoints that do not exist server-side yet — this is the template for
 * every new one you add. An endpoint module should be exactly this: a path, a
 * schema, and a one-line call. All transport concerns live in `HttpClient`.
 *
 * `GET /agents` currently 404s, and the control screen renders that as
 * "not implemented yet" rather than as an error, which is also a live demo of
 * the error taxonomy.
 */
export type AgentsApiOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
};

export async function listAgents({ client = apiClient, signal }: AgentsApiOptions = {}): Promise<Agent[]> {
  const { data } = await client.get('/agents', { schema: AgentListResponseSchema, signal });
  return data;
}

export async function getAgent(id: string, { client = apiClient, signal }: AgentsApiOptions = {}): Promise<Agent> {
  const { data } = await client.get(`/agents/${encodeURIComponent(id)}`, { schema: AgentSchema, signal });
  return data;
}

export type AgentCommand = 'start' | 'stop' | 'pause';

/** Commands are POSTs: not retried automatically, by design. */
export async function commandAgent(
  id: string,
  command: AgentCommand,
  { client = apiClient, signal }: AgentsApiOptions = {},
): Promise<Agent> {
  const { data } = await client.post(`/agents/${encodeURIComponent(id)}/${command}`, undefined, {
    schema: AgentSchema,
    signal,
  });
  return data;
}

export type { Agent, AgentStatus };
