import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import AgentsScreen from '../app/(tabs)/agents';
import { requestLog } from '@/api/log';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

/**
 * Integration test for the proof of concept: the real screen, real hooks, real
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

const HEALTHY: Routes = {
  '/healthz': () => fakeResponse({ body: { status: 'ok', version: '0.1.0' } }),
  '/readyz': () => fakeResponse({ body: { status: 'ready' } }),
  '/v1/agents': () => fakeResponse({ body: [{ id: 'a1', name: 'Research agent', status: 'running' }] }),
};

beforeEach(() => requestLog.clear());

describe('Agents control screen', () => {
  it('shows which API it is talking to', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<AgentsScreen />);

    expect(screen.getByTestId('api-base-url')).toHaveTextContent(/^https?:\/\/.+:8000$/);
    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
  });

  it('reports healthy and renders every probe result', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
    expect(screen.getByTestId('probe-status-healthz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-status-readyz')).toHaveTextContent('up');
    expect(screen.queryByTestId('probe-status-agents')).toBeNull();
    expect(screen.getByTestId('probe-http-healthz')).toHaveTextContent('HTTP 200');
    expect(screen.getByTestId('probe-body-healthz')).toHaveTextContent(/0\.1\.0/);
    expect(screen.getByTestId('last-checked')).toBeTruthy();
  });

  it('degrades when readiness fails, without losing liveness', async () => {
    stubApi({
      ...HEALTHY,
      '/readyz': () => fakeResponse({ status: 503, body: { detail: 'db not ready' } }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('degraded'));
    expect(screen.getByTestId('probe-status-healthz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-error-readyz')).toHaveTextContent(/503/);
  });

  it('goes down when the API is unreachable', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('down'));
    expect(screen.getByTestId('probe-error-healthz')).toHaveTextContent(/Cannot reach the API/);
  });

  it('lists the agents GET /v1/agents answers with', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-a1')).toBeTruthy());
    expect(screen.getByTestId('agent-status-a1')).toHaveTextContent('running');
    expect(screen.queryByTestId('agents-error')).toBeNull();
  });

  it('surfaces a failing agent list as an error, not as an empty list', async () => {
    stubApi({
      ...HEALTHY,
      '/v1/agents': () => fakeResponse({ status: 500, body: { detail: 'boom' } }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agents-error')).toBeTruthy());
    expect(screen.queryByTestId('agent-row-a1')).toBeNull();
  });

  it('opens the chat for the agent you tap', async () => {
    stubApi({
      ...HEALTHY,
      '/v1/agents': () => fakeResponse({ body: [{ id: 'a 1', name: 'Research agent', status: 'running' }] }),
    });
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getByTestId('agent-row-a 1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('agent-row-a 1'));

    expect(router.push).toHaveBeenCalledWith('/agent/a%201');
  });

  it('re-runs the probes when "Run checks" is pressed', async () => {
    const fetchMock = stubApi(HEALTHY);
    renderWithQuery(<AgentsScreen />);
    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
    const before = fetchMock.mock.calls.length;

    fireEvent.press(screen.getByTestId('run-checks'));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows every call it made in the request log, and can clear it', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<AgentsScreen />);

    await waitFor(() => expect(screen.getAllByTestId('request-log-row').length).toBeGreaterThanOrEqual(2));

    fireEvent.press(screen.getByTestId('clear-log'));

    await waitFor(() => expect(screen.queryAllByTestId('request-log-row')).toHaveLength(0));
  });
});
