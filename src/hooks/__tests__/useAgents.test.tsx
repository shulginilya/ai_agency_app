import { renderHook, waitFor } from '@testing-library/react-native';
import { useAgentCommand, useAgents } from '@/hooks/useAgents';
import { fakeResponse } from '@/test-utils/http';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';

const AGENT = { id: 'a1', name: 'Research agent', status: 'running' };

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => handler(url, init));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function wrapper(client = createTestQueryClient()) {
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  };
}

describe('useAgents', () => {
  it('loads the agent list', async () => {
    stub(() => fakeResponse({ body: [AGENT] }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useAgents(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual([AGENT]));
  });

  it('surfaces the not-implemented endpoint as a typed 404', async () => {
    stub(() => fakeResponse({ status: 404, body: { detail: 'Not Found' } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useAgents(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toMatchObject({ kind: 'http', status: 404 });
  });

  it('does not fire while disabled', async () => {
    const fetchMock = stub(() => fakeResponse({ body: [] }));
    const { wrapper: Wrapper } = wrapper();

    renderHook(() => useAgents({ enabled: false }), { wrapper: Wrapper });

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

describe('useAgentCommand', () => {
  it('POSTs the command and refetches the list afterwards', async () => {
    const fetchMock = stub((url) =>
      url.endsWith('/stop') ? fakeResponse({ body: { ...AGENT, status: 'stopped' } }) : fakeResponse({ body: [AGENT] }),
    );
    const { client, wrapper: Wrapper } = wrapper();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAgentCommand(), { wrapper: Wrapper });
    result.current.mutate({ id: 'a1', command: 'stop' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agents/a1/stop'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agents'] });
  });
});
