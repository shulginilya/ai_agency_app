import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import AgentsScreen from '../app/(tabs)/index';
import { requestLog } from '@/api/log';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

/**
 * Integration test for the agent roster: the real screen, real hooks, real
 * client — only `fetch` is stubbed. This is the test that would catch a
 * broken wiring between any two of those layers.
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

const AGENTS: Routes = {
  '/v1/agents': () => fakeResponse({ body: [{ id: 'a1', name: 'Research agent', status: 'running' }] }),
};

beforeEach(() => requestLog.clear());

describe('Agents screen', () => {
  it('lists the agents GET /v1/agents answers with', async () => {
    stubApi(AGENTS);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-a1')).toBeTruthy());
    expect(screen.getByTestId('agent-status-a1')).toHaveTextContent('running');
    expect(screen.queryByTestId('agents-error')).toBeNull();
  });

  it('shows an empty state when there are no agents', async () => {
    stubApi({ '/v1/agents': () => fakeResponse({ body: [] }) });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agents-empty')).toBeTruthy());
  });

  it('surfaces a failing agent list as an error, not as an empty list', async () => {
    stubApi({
      '/v1/agents': () => fakeResponse({ status: 500, body: { detail: 'boom' } }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agents-error')).toBeTruthy());
    expect(screen.queryByTestId('agent-row-a1')).toBeNull();
  });

  it('opens the chat for the agent you tap', async () => {
    stubApi({
      '/v1/agents': () => fakeResponse({ body: [{ id: 'a 1', name: 'Research agent', status: 'running' }] }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-a 1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('agent-row-a 1'));

    expect(router.push).toHaveBeenCalledWith('/agent/a%201');
  });
});
