import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Message } from '@/api/schemas';
import { useMessages, useSendMessage } from '@/hooks/useMessages';
import { qk } from '@/query/keys';
import { fakeResponse } from '@/test-utils/http';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';

const USER: Message = {
  id: 'm1',
  agent_id: 'a1',
  role: 'user',
  content: 'summarise the leads',
  created_at: '2026-08-16T09:00:00.000Z',
};

const REPLY: Message = {
  id: 'm2',
  agent_id: 'a1',
  role: 'agent',
  content: 'Four leads worth a call.',
  created_at: '2026-08-16T09:00:03.000Z',
};

function stub(handler: (_url: string, init?: RequestInit) => Response) {
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

describe('useMessages', () => {
  it('loads a thread and sorts it oldest-first', async () => {
    stub(() => fakeResponse({ body: { messages: [REPLY, USER] } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(result.current.isAwaitingReply).toBe(false);
  });

  it('polls while a reply is outstanding, and stops the moment it lands', async () => {
    let thread: Message[] = [USER];
    const fetchMock = stub(() => fakeResponse({ body: { messages: thread } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1', { pollIntervalMs: 20 }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isAwaitingReply).toBe(true));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    thread = [USER, REPLY];

    await waitFor(() => expect(result.current.isAwaitingReply).toBe(false));
    const settled = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchMock.mock.calls.length).toBe(settled);
  });

  it('does not poll an idle thread at all', async () => {
    const fetchMock = stub(() => fakeResponse({ body: { messages: [USER, REPLY] } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1', { pollIntervalMs: 20 }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout instead of polling forever', async () => {
    const fetchMock = stub(() => fakeResponse({ body: { messages: [USER] } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1', { pollIntervalMs: 20, replyTimeoutMs: 60 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.replyTimedOut).toBe(true));
    expect(result.current.isAwaitingReply).toBe(false);

    const stopped = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchMock.mock.calls.length).toBe(stopped);
  });

  it('starts waiting again when you ask it to check', async () => {
    stub(() => fakeResponse({ body: { messages: [USER] } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1', { pollIntervalMs: 20, replyTimeoutMs: 40 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.replyTimedOut).toBe(true));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.isAwaitingReply).toBe(true));
  });

  it('surfaces a missing endpoint as a typed 404 without throwing', async () => {
    stub(() => fakeResponse({ status: 404, body: { detail: 'Not Found' } }));
    const { wrapper: Wrapper } = wrapper();

    const { result } = renderHook(() => useMessages('a1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toMatchObject({ kind: 'http', status: 404 });
    expect(result.current.messages).toEqual([]);
  });

  it('does not fire without an agent id', async () => {
    const fetchMock = stub(() => fakeResponse({ body: { messages: [] } }));
    const { wrapper: Wrapper } = wrapper();

    renderHook(() => useMessages(''), { wrapper: Wrapper });

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

/**
 * Reading and sending are one screen's worth of behaviour, so the send tests
 * mount both hooks: a cache entry with nobody watching it is collected
 * immediately, which is exactly what a real screen never does.
 */
function useChat(agentId: string) {
  return { thread: useMessages(agentId), send: useSendMessage(agentId) };
}

describe('useSendMessage', () => {
  it('shows the message before the network answers', async () => {
    let resolveSend: (response: Response) => void = () => {};
    // The POST is held open, so the optimistic state is observable in between.
    const inFlight = new Promise<Response>((resolve) => {
      resolveSend = resolve;
    });
    globalThis.fetch = jest.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? inFlight : fakeResponse({ body: { messages: [] } }),
    ) as unknown as typeof fetch;

    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useChat('a1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.thread.isLoading).toBe(false));

    act(() => result.current.send.mutate('summarise the leads'));

    await waitFor(() => expect(result.current.thread.messages).toHaveLength(1));
    expect(result.current.thread.messages[0]).toMatchObject({
      role: 'user',
      content: 'summarise the leads',
      pending: true,
    });
    expect(result.current.send.isPending).toBe(true);

    await act(async () => {
      resolveSend(fakeResponse({ status: 202, body: { message: USER } }));
    });
  });

  it('takes the optimistic message back when the send fails', async () => {
    stub((_url, init) =>
      init?.method === 'POST'
        ? fakeResponse({ status: 500, body: { detail: 'nope' } })
        : fakeResponse({ body: { messages: [REPLY] } }),
    );

    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useChat('a1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.thread.messages).toHaveLength(1));

    act(() => result.current.send.mutate('summarise the leads'));

    await waitFor(() => expect(result.current.send.isError).toBe(true));
    await waitFor(() => expect(result.current.thread.messages).toEqual([REPLY]));
    expect(result.current.thread.messages.some((message) => message.pending)).toBe(false);
  });

  it('re-reads the thread from the server once the send settles', async () => {
    const fetchMock = stub((_url, init) =>
      init?.method === 'POST'
        ? fakeResponse({ status: 202, body: { message: USER } })
        : fakeResponse({ body: { messages: [USER] } }),
    );

    const { client, wrapper: Wrapper } = wrapper();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSendMessage('a1'), { wrapper: Wrapper });
    act(() => result.current.mutate('summarise the leads'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agents/a1/messages'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agents', 'a1', 'messages'] });
  });
});
