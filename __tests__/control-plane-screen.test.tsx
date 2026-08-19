import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ControlPlaneScreen from '../app/(tabs)/control-plane';
import { requestLog } from '@/api/log';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

/**
 * Integration test for the control plane: the real screen, real hooks, real
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

const HEALTHY: Routes = {
  '/healthz': () => fakeResponse({ body: { status: 'ok', version: '0.1.0' } }),
  '/readyz': () => fakeResponse({ body: { status: 'ready' } }),
};

beforeEach(() => requestLog.clear());

describe('Control plane screen', () => {
  it('shows which API it is talking to', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<ControlPlaneScreen />);

    expect(screen.getByTestId('api-base-url')).toHaveTextContent(/^https?:\/\/.+:8000$/);
    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
  });

  it('reports healthy and renders every probe result', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<ControlPlaneScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
    expect(screen.getByTestId('probe-status-healthz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-status-readyz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-http-healthz')).toHaveTextContent('HTTP 200');
    expect(screen.getByTestId('probe-body-healthz')).toHaveTextContent(/0\.1\.0/);
    expect(screen.getByTestId('last-checked')).toBeTruthy();
  });

  it('degrades when readiness fails, without losing liveness', async () => {
    stubApi({
      ...HEALTHY,
      '/readyz': () => fakeResponse({ status: 503, body: { detail: 'db not ready' } }),
    });
    renderWithQuery(<ControlPlaneScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('degraded'));
    expect(screen.getByTestId('probe-status-healthz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-error-readyz')).toHaveTextContent(/503/);
  });

  it('goes down when the API is unreachable', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    renderWithQuery(<ControlPlaneScreen />);

    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('down'));
    expect(screen.getByTestId('probe-error-healthz')).toHaveTextContent(/Cannot reach the API/);
  });

  it('re-runs the probes when "Run checks" is pressed', async () => {
    const fetchMock = stubApi(HEALTHY);
    renderWithQuery(<ControlPlaneScreen />);
    await waitFor(() => expect(screen.getByTestId('system-status')).toHaveTextContent('healthy'));
    const before = fetchMock.mock.calls.length;

    fireEvent.press(screen.getByTestId('run-checks'));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows every call it made in the request log, and can clear it', async () => {
    stubApi(HEALTHY);
    renderWithQuery(<ControlPlaneScreen />);

    await waitFor(() => expect(screen.getAllByTestId('request-log-row').length).toBeGreaterThanOrEqual(2));

    fireEvent.press(screen.getByTestId('clear-log'));

    await waitFor(() => expect(screen.queryAllByTestId('request-log-row')).toHaveLength(0));
  });
});
