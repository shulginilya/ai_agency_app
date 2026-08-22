import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAgent, listAgents, type AgentInfo } from '@/api/agents';
import { qk } from '@/query/keys';

/** How often the roster re-reads itself. `status` moves while a run is in flight. */
export const DEFAULT_ROSTER_POLL_MS = 5_000;

export type UseAgentsOptions = {
  enabled?: boolean;
  /** Off by default; the roster screen turns it on while it is being looked at. */
  pollIntervalMs?: number | false;
};

/**
 * The agent roster, straight from `GET /v1/agents`.
 *
 * `status` is live and per-process, so it changes under you while the server is
 * invoking an agent — which is exactly when someone is looking at this screen.
 * Hence the poll, rather than a fetch-once-and-hope.
 */
export function useAgents({ enabled = true, pollIntervalMs = false }: UseAgentsOptions = {}) {
  return useQuery({
    queryKey: qk.agents(),
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled,
    refetchInterval: pollIntervalMs === false ? false : pollIntervalMs,
    refetchIntervalInBackground: false,
  });
}

/**
 * One agent, for the detail screen.
 *
 * Seeded from the row you just tapped, so the name and status are on screen in
 * the first frame instead of after a round trip. The detail call is still made:
 * it carries the same data, but a 404 from it is the honest answer to "does this
 * id still exist", which a stale list cannot give you.
 */
export function useAgent(id: string) {
  const queryClient = useQueryClient();
  // The cached row is the same object the roster rendered, so this is a
  // reference lookup rather than a copy — stable across renders.
  const fromList = queryClient.getQueryData<AgentInfo[]>(qk.agents())?.find((agent) => agent.id === id);

  return useQuery<AgentInfo, Error, AgentInfo, ReturnType<typeof qk.agent>>({
    queryKey: qk.agent(id),
    queryFn: ({ signal }) => getAgent(id, { signal }),
    enabled: Boolean(id),
    placeholderData: fromList,
  });
}
