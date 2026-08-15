import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commandAgent, listAgents, type AgentCommand } from '@/api/agents';
import { qk } from '@/query/keys';

/**
 * `/agents` is not implemented server-side yet. The hook is written as if it
 * were: when the endpoint ships, the screen lights up with zero changes here.
 */
export function useAgents({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.agents(),
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled,
  });
}

/** Sending a command should immediately re-read the list rather than guess. */
export function useAgentCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: AgentCommand }) => commandAgent(id, command),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.agents() }),
  });
}
