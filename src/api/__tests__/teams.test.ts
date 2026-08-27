import { agentsInTeam, teamsFromRoster } from '@/api/teams';
import { agentInfo } from '@/test-utils/fixtures';

/**
 * The derivation that stands in for a teams endpoint. Worth its own tests
 * precisely because it is a stand-in: the day `GET /v1/teams` exists, these are
 * the behaviours the real thing has to keep.
 */
const worker = (id: string, team: string | null) =>
  agentInfo({ id, name: id, availability: team ? 'team' : 'always', team });

describe('teamsFromRoster', () => {
  it('names a team once, with every worker that claimed it', () => {
    const teams = teamsFromRoster([
      worker('planner', 'engineering'),
      worker('scribe', 'docs'),
      worker('builder', 'engineering'),
    ]);

    expect(teams.map((team) => team.name)).toEqual(['docs', 'engineering']);
    expect(teams[1].agents.map((agent) => agent.id)).toEqual(['planner', 'builder']);
  });

  it('sorts by name, so the picker does not reshuffle under the roster poll', () => {
    // `GET /v1/agents` promises no ordering, and a control that moves while you
    // are reaching for it is worse than an arbitrary order.
    const forwards = teamsFromRoster([worker('a', 'zebra'), worker('b', 'alpha')]);
    const backwards = teamsFromRoster([worker('b', 'alpha'), worker('a', 'zebra')]);

    expect(forwards.map((team) => team.name)).toEqual(['alpha', 'zebra']);
    expect(backwards.map((team) => team.name)).toEqual(forwards.map((team) => team.name));
  });

  it('is not fooled by the three spellings of "no team"', () => {
    // null is an `always` agent; the key can be absent, since the spec leaves
    // `team` out of AgentInfo.required; and '' is not a name we could send back.
    const absent = agentInfo({ id: 'ghost', name: 'ghost' });
    delete (absent as { team?: string | null }).team;

    expect(teamsFromRoster([worker('researcher', null), absent, worker('blank', '')])).toEqual([]);
  });

  it('has no teams to offer for an empty roster', () => {
    expect(teamsFromRoster([])).toEqual([]);
  });
});

describe('agentsInTeam', () => {
  const roster = [worker('researcher', null), worker('planner', 'engineering'), worker('scribe', 'docs')];

  it('reaches that team’s workers and every always-loaded agent', () => {
    expect(agentsInTeam(roster, 'engineering').map((agent) => agent.id)).toEqual(['researcher', 'planner']);
  });

  it('leaves a solo run the always-loaded agents, not nothing', () => {
    expect(agentsInTeam(roster, null).map((agent) => agent.id)).toEqual(['researcher']);
  });
});
