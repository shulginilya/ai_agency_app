import { renderHook, waitFor } from '@testing-library/react-native';
import { requestLog } from '@/api/log';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';
import { fakeResponse } from '@/test-utils/http';

function stubApi(handler: (url: string) => Response) {
  const fetchMock = jest.fn(async (url: string) => handler(url));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderUseSystemStatus(options?: Parameters<typeof useSystemStatus>[0]) {
  const client = createTestQueryClient();
  return renderHook(() => useSystemStatus({ autoRefresh: false, ...options }), {
    wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  });
}

beforeEach(() => requestLog.clear());

describe('useSystemStatus', () => {
  it('runs every probe and reports healthy when they pass', async () => {
    const fetchMock = stubApi(() => fakeResponse({ body: { status: 'ok' } }));

    const { result } = renderUseSystemStatus();

    await waitFor(() => expect(result.current.status).toBe('healthy'));
    expect(result.current.probes).toHaveLength(2);
    expect(result.current.byName.healthz?.ok).toBe(true);
    expect(result.current.byName.readyz?.ok).toBe(true);
    expect(result.current.lastCheckedAt).toEqual(expect.any(Number));

    const calledPaths = fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname);
    expect(calledPaths.sort()).toEqual(['/healthz', '/readyz']);
  });

  it('polls by default, without needing any options', async () => {
    stubApi(() => fakeResponse({ body: { status: 'ok' } }));
    const client = createTestQueryClient();

    const { result } = renderHook(() => useSystemStatus(), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.status).toBe('healthy'));
    // Default interval is the 10s poll from config — assert it is armed, not elapsed.
    expect(client.getQueryCache().find({ queryKey: ['probes', 'healthz'] })?.observers[0].options.refetchInterval).toBe(
      10_000,
    );
  });

  it('reports degraded when liveness passes but readiness fails', async () => {
    stubApi((url) =>
      url.endsWith('/readyz') ? fakeResponse({ status: 503, body: { detail: 'warming up' } }) : fakeResponse({ body: {} }),
    );

    const { result } = renderUseSystemStatus();

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.byName.readyz?.error?.kind).toBe('http');
  });

  it('reports down when the API is unreachable', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const { result } = renderUseSystemStatus();

    await waitFor(() => expect(result.current.status).toBe('down'));
    expect(result.current.byName.healthz?.error?.message).toMatch(/Cannot reach the API/);
  });

  it('feeds the shared request log so the UI can show the raw calls', async () => {
    stubApi(() => fakeResponse({ body: { status: 'ok' } }));

    const { result } = renderUseSystemStatus();
    await waitFor(() => expect(result.current.status).toBe('healthy'));

    expect(requestLog.getSnapshot().map((entry) => entry.url.replace(/^https?:\/\/[^/]+/, '')).sort()).toEqual([
      '/healthz',
      '/readyz',
    ]);
  });

  it('re-runs the probes on demand', async () => {
    const fetchMock = stubApi(() => fakeResponse({ body: { status: 'ok' } }));
    const { result } = renderUseSystemStatus();
    await waitFor(() => expect(result.current.status).toBe('healthy'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await result.current.refresh();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
