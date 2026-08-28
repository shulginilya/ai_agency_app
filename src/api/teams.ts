import type { AgentInfo } from '@/api/schemas';

/**
 * Teams, derived from the roster.
 *
 * There is no `GET /v1/teams`. The only place the server publishes the set of
 * teams is `AgentInfo.team` on `GET /v1/agents`, so this module reads them back
 * out of the roster the app already holds. That is why these are pure functions
 * over `AgentInfo[]` rather than another endpoint module: nothing here makes a
 * request, and `useTeams` rides the roster query that was going to run anyway.
 *
 * Two things the derivation cannot know, both waiting on the server:
 *
 * - a team with no workers is invisible, because a team only exists here as a
 *   value some worker carries;
 * - a team has no description and no display name — the picker can show the key
 *   and the worker count and nothing else.
 *
 * Both are why this is one module with one seam. If `GET /v1/teams` lands,
 * replace the body of `teamsFromRoster` with a query and the callers do not
 * move.
 */
export type TeamSummary = {
  /** The value to send as `team` on a run or a session. */
  name: string;
  /** The workers that named this team, in roster order. */
  agents: AgentInfo[];
};

/** The value that means "no team" everywhere in the client: the solo agent. */
export const SOLO_TEAM = null;

/**
 * Every distinct team named by a worker, sorted by name.
 *
 * Sorted rather than left in roster order so the picker does not reshuffle
 * itself under the 5s poll — `GET /v1/agents` makes no ordering promise, and a
 * control that moves while you are reaching for it is worse than an arbitrary
 * order.
 */
export function teamsFromRoster(agents: AgentInfo[]): TeamSummary[] {
  const byName = new Map<string, AgentInfo[]>();

  for (const agent of agents) {
    // `null` is an `always` agent — loaded on every run, belonging to no team.
    // An absent key means the same thing; an empty string is not a name we
    // could send back, so it is not a team either.
    if (!agent.team) continue;
    const members = byName.get(agent.team);
    if (members) members.push(agent);
    else byName.set(agent.team, [agent]);
  }

  return [...byName.entries()]
    .map(([name, members]) => ({ name, agents: members }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The agents a run as `team` can reach: that team's workers, plus every
 * `always` agent, which is loaded whatever the run.
 *
 * `null` (solo) is not "no agents" — the `always` ones are still there.
 */
export function agentsInTeam(agents: AgentInfo[], team: string | null): AgentInfo[] {
  return agents.filter((agent) => !agent.team || agent.team === team);
}
