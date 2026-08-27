import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import AgentsScreen from '../app/(tabs)/index';
import { requestLog } from '@/api/log';
import { agentInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

/**
 * Integration test for the agent roster: the real screen, real hooks, real
 * client — only `fetch` is stubbed. This is the test that would catch a broken
 * wiring between any two of those layers.
 */
type Routes = Record<string, () => Response>;

function stubApi(routes: Routes) {
  const fetchMock = jest.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) return fakeResponse({ status: 404, body: { detail: 'Not Found' } });
    return handler();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const ROSTER: Routes = {
  '/v1/agents': () =>
    fakeResponse({
      body: {
        agents: [
          agentInfo({ status: 'running' }),
          agentInfo({ id: 'planner', name: 'planner', availability: 'team', team: 'engineering' }),
          agentInfo({ id: 'scribe', name: 'scribe', availability: 'team', team: 'docs' }),
        ],
        count: 3,
      },
    }),
};

beforeEach(() => requestLog.clear());

describe('Agents screen', () => {
  it('lists the roster GET /v1/agents answers with', async () => {
    stubApi(ROSTER);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-researcher')).toBeTruthy());
    expect(screen.getByTestId('agent-status-researcher')).toHaveTextContent('running');
    expect(screen.queryByTestId('agents-error')).toBeNull();
  });

  it('shows what decides whether the manager will route work here', async () => {
    stubApi(ROSTER);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-meta-researcher')).toBeTruthy());
    expect(screen.getByTestId('agent-meta-researcher')).toHaveTextContent(/sonnet/);
    expect(screen.getByTestId('agent-meta-researcher')).toHaveTextContent(/2 tools/);
    expect(screen.getByTestId('agent-meta-researcher')).toHaveTextContent(/3 invocations/);
  });

  it('marks the agents a solo run will never reach, by the team that loads them', async () => {
    stubApi(ROSTER);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-team-planner')).toBeTruthy());
    // The name, not the word "team" — with more than one, "team" no longer says
    // which run would reach this agent.
    expect(screen.getByTestId('agent-team-planner')).toHaveTextContent('engineering');
    expect(screen.queryByTestId('agent-team-researcher')).toBeNull();
  });

  it('groups the roster by team, with the always-loaded agents above the split', async () => {
    stubApi(ROSTER);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('team-section-engineering')).toBeTruthy());
    expect(screen.getByTestId('team-section-docs')).toBeTruthy();
    expect(screen.getByTestId('team-section-always')).toBeTruthy();
  });

  it('shows an empty state when the server has no agents', async () => {
    stubApi({ '/v1/agents': () => fakeResponse({ body: { agents: [], count: 0 } }) });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agents-empty')).toBeTruthy());
  });

  it('surfaces a failing roster as an error, not as an empty list', async () => {
    stubApi({ '/v1/agents': () => fakeResponse({ status: 500, body: { detail: 'boom' } }) });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agents-error')).toBeTruthy());
    expect(screen.getByTestId('agents-error')).toHaveTextContent(/boom/);
    expect(screen.queryByTestId('agent-row-researcher')).toBeNull();
  });

  it('opens the detail screen for the agent you tap', async () => {
    stubApi({
      '/v1/agents': () => fakeResponse({ body: { agents: [agentInfo({ id: 'a 1', name: 'a 1' })], count: 1 } }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-a 1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('agent-row-a 1'));

    expect(router.push).toHaveBeenCalledWith('/agent/a%201');
  });
});
