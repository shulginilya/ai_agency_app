import { renderHook, waitFor } from '@testing-library/react-native';
import { useAgent, useAgents } from '@/hooks/useAgents';
import { qk } from '@/query/keys';
import { agentInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';

const AGENT = agentInfo();

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
  it('loads the roster', async () => {
    stub(() => fakeResponse({ body: { agents: [AGENT], count: 1 } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useAgents(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual([AGENT]));
  });

  it('surfaces a failing route as a typed error', async () => {
    stub(() => fakeResponse({ status: 404, body: { detail: 'Not Found' } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useAgents(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toMatchObject({ kind: 'http', status: 404 });
  });

  it('does not fire while disabled', async () => {
    const fetchMock = stub(() => fakeResponse({ body: { agents: [] } }));
    const { wrapper: Wrapper } = wrapper();

    renderHook(() => useAgents({ enabled: false }), { wrapper: Wrapper });

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

describe('useAgent', () => {
  it('shows the row you tapped before the detail call answers', async () => {
    // `status` and `name` are already known from the roster, so the header does
    // not have to flash empty for a round trip.
    stub(() => fakeResponse({ body: agentInfo({ status: 'running' }) }));
    const { client, wrapper: Wrapper } = wrapper();
    client.setQueryData(qk.agents(), [agentInfo({ status: 'idle' })]);

    const { result } = renderHook(() => useAgent('researcher'), { wrapper: Wrapper });

    expect(result.current.data).toMatchObject({ status: 'idle' });
    await waitFor(() => expect(result.current.data).toMatchObject({ status: 'running' }));
  });

  it('still calls the detail route, because a stale list cannot 404', async () => {
    const fetchMock = stub(() => fakeResponse({ status: 404, body: { detail: 'No agent named ghost.' } }));
    const { client, wrapper: Wrapper } = wrapper();
    client.setQueryData(qk.agents(), [agentInfo({ id: 'ghost', name: 'ghost' })]);

    const { result } = renderHook(() => useAgent('ghost'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).toMatchObject({ status: 404 }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/agents/ghost'), expect.anything());
  });
});
