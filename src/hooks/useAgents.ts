import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commandAgent, getAgent, listAgents, type Agent, type AgentCommand } from '@/api/agents';
import { qk } from '@/query/keys';

/** The agent list, straight from `GET /v1/agents`. */
export function useAgents({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.agents(),
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled,
  });
}

/**
 * One agent, for the chat screen's header.
 *
 * Seeded from the list you just tapped through, so the name and status are on
 * screen in the first frame instead of after a round trip — and if `GET
 * /v1/agents/{id}` turns out not to exist, that seed is still what you see
 * rather than an empty header.
 */
export function useAgent(id: string) {
  const queryClient = useQueryClient();
  // The cached row is the same object the list screen rendered, so this is a
  // reference lookup rather than a copy — stable across renders.
  const fromList = queryClient.getQueryData<Agent[]>(qk.agents())?.find((agent) => agent.id === id);

  return useQuery<Agent, Error, Agent, ReturnType<typeof qk.agent>>({
    queryKey: qk.agent(id),
    queryFn: ({ signal }) => getAgent(id, { signal }),
    enabled: Boolean(id),
    placeholderData: fromList,
  });
}

/** Sending a command should immediately re-read rather than guess at the new state. */
export function useAgentCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: AgentCommand }) => commandAgent(id, command),
    onSuccess: (agent) => {
      queryClient.setQueryData(qk.agent(agent.id), agent);
      return queryClient.invalidateQueries({ queryKey: qk.agents() });
    },
  });
}
