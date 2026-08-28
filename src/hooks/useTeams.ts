import { useMemo } from 'react';
import { teamsFromRoster, type TeamSummary } from '@/api/teams';
import { useAgents, type UseAgentsOptions } from '@/hooks/useAgents';

/**
 * The teams this server can run as.
 *
 * Deliberately not its own query: there is no team endpoint, so this is the
 * roster read a second way. Sharing `qk.agents()` means the picker costs no
 * extra request, refreshes on the roster's own poll, and can never disagree
 * with the Agents tab about which workers a team has.
 *
 * `useMemo` over `select` so the identity is stable per roster object — a
 * `select` that builds a new array each render would restart the effects of
 * anything holding the result.
 */
export function useTeams(options: UseAgentsOptions = {}) {
  const agents = useAgents(options);
  const teams = useMemo<TeamSummary[]>(
    () => (agents.data ? teamsFromRoster(agents.data) : []),
    [agents.data],
  );

  return {
    teams,
    agents: agents.data,
    isLoading: agents.isLoading,
    error: agents.error,
  };
}
