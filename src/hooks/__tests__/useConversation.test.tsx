import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConversation } from '@/hooks/useConversation';
import { messageResponse, runResponse, sessionInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';

type Handler = (url: string, init?: RequestInit) => Response;

function stub(handler: Handler) {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => handler(url, init));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** The happy path: open on the first message, then a turn per message. */
function sessionApi(turnResponse: () => Response = () => fakeResponse({ body: messageResponse() })): Handler {
  return (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/v1/sessions' && init?.method === 'POST') {
      return fakeResponse({ status: 201, body: sessionInfo() });
    }
    if (path.endsWith('/messages')) return turnResponse();
    if (init?.method === 'DELETE') return fakeResponse({ status: 204 });
    return fakeResponse({ status: 404, body: { detail: 'Not Found' } });
  };
}

function wrapper(client = createTestQueryClient()) {
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  };
}

describe('useConversation in session mode', () => {
  it('opens a session on the first message and reuses it on the second', async () => {
    const fetchMock = stub(sessionApi());
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('rank the leads'));
    await waitFor(() => expect(result.current.session).toMatchObject({ id: 'sess_1' }));
    await waitFor(() => expect(result.current.isSending).toBe(false));

    act(() => result.current.send('and again'));
    await waitFor(() => expect(result.current.isSending).toBe(false));

    const opens = fetchMock.mock.calls.filter(
      ([url, init]) => new URL(url as string).pathname === '/v1/sessions' && (init as RequestInit)?.method === 'POST',
    );
    expect(opens).toHaveLength(1);
  });

  it('shows your line straight away and the finished run underneath it', async () => {
    stub(sessionApi());
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('rank the leads'));
    await waitFor(() => expect(result.current.entries.some((entry) => entry.role === 'agent')).toBe(true));

    // Chronological, which is why the "session opened" line sits *after* your
    // message: sending is what opened the session.
    const roles = result.current.entries.map((entry) => entry.role);
    expect(roles).toEqual(['user', 'system', 'agent']);
    const reply = result.current.entries.find((entry) => entry.role === 'agent');
    expect(reply).toMatchObject({ content: 'Four leads, ranked.', turn: 1 });
    expect(result.current.entries.find((entry) => entry.role === 'user')?.pending).toBe(false);
  });

  it('rolls your line back out of the thread when the send fails', async () => {
    stub((url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
      return fakeResponse({ status: 409, body: { detail: 'A turn is already in flight' } });
    });
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('rank the leads'));

    await waitFor(() => expect(result.current.sendError).toBeTruthy());
    expect(result.current.entries.some((entry) => entry.role === 'user')).toBe(false);
    // A 409 is the session being busy, not the session being gone.
    expect(result.current.session).toMatchObject({ id: 'sess_1' });
  });

  it('drops the handle when the server closes the session under it', async () => {
    // 502 and 504 leave the SDK client indeterminate, so the server closes the
    // session on the way out. Reusing the id would be the obvious wrong move.
    let turns = 0;
    stub((url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
      turns += 1;
      return fakeResponse({ status: 502, body: { detail: 'The agent loop failed.' } });
    });
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('go'));

    await waitFor(() => expect(result.current.session).toBeNull());
    expect(turns).toBe(1);
    expect(result.current.entries.at(-1)).toMatchObject({ role: 'system' });
    expect(result.current.entries.at(-1)?.content).toMatch(/closed this session/);
  });

  it('closes the session and says so in the thread', async () => {
    stub(sessionApi());
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('go'));
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => result.current.close());

    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.entries.at(-1)?.content).toBe('Session closed.');
  });

  it('keeps the session when closing is refused mid-turn', async () => {
    stub((url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
      if (init?.method === 'DELETE') return fakeResponse({ status: 409, body: { detail: 'A turn is in flight' } });
      return fakeResponse({ body: messageResponse() });
    });
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation(), { wrapper: Wrapper });

    act(() => result.current.send('go'));
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => result.current.close());

    await waitFor(() => expect(result.current.closeError).toBeTruthy());
    expect(result.current.session).toMatchObject({ id: 'sess_1' });
  });
});

describe('useConversation in run mode', () => {
  it('goes straight to /v1/runs and opens nothing', async () => {
    const fetchMock = stub(() => fakeResponse({ body: runResponse() }));
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation({ mode: 'run', team: true }), { wrapper: Wrapper });

    act(() => result.current.send('one piece of work'));

    await waitFor(() => expect(result.current.entries.some((entry) => entry.role === 'agent')).toBe(true));
    expect(result.current.session).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/runs'), expect.anything());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ team: true });
    // No session was opened, so there is no "session opened" line either.
    expect(result.current.entries.map((entry) => entry.role)).toEqual(['user', 'agent']);
  });

  it('renders an agent-side failure as a failed reply, not as a thrown error', async () => {
    stub(() => fakeResponse({ body: runResponse({ is_error: true, output: null, summary: 'Tool call denied.' }) }));
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation({ mode: 'run' }), { wrapper: Wrapper });

    act(() => result.current.send('go'));

    await waitFor(() => expect(result.current.entries.at(-1)).toMatchObject({ role: 'agent', failed: true }));
    expect(result.current.sendError).toBeNull();
    expect(result.current.entries.at(-1)?.content).toBe('Tool call denied.');
  });

  it('clears the thread without touching the server', async () => {
    stub(() => fakeResponse({ body: runResponse() }));
    const { wrapper: Wrapper } = wrapper();
    const { result } = renderHook(() => useConversation({ mode: 'run' }), { wrapper: Wrapper });

    act(() => result.current.send('go'));
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => result.current.clear());

    expect(result.current.entries).toEqual([]);
  });
});
