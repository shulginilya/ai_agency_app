/**
 * @jest-environment jsdom
 *
 * The teardown listeners are web-only — `pagehide` and `visibilitychange` are
 * page lifecycle events, and the hook checks for `document` before touching
 * them. The default (native) environment has no DOM to dispatch into, so these
 * live in their own file with a jsdom environment rather than in the main
 * `useConversation` suite.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConversation } from '@/hooks/useConversation';
import { messageResponse, sessionInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { createTestQueryClient, QueryWrapper } from '@/test-utils/render';

function stub() {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/v1/sessions' && init?.method === 'POST') {
      return fakeResponse({ status: 201, body: sessionInfo() });
    }
    if (path.endsWith('/messages')) return fakeResponse({ body: messageResponse() });
    if (init?.method === 'DELETE') return fakeResponse({ status: 204 });
    return fakeResponse({ status: 404, body: { detail: 'Not Found' } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function wrapper(client = createTestQueryClient()) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryWrapper client={client}>{children}</QueryWrapper>
  );
}

const deletes = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE');

const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

describe('useConversation teardown listeners', () => {
  afterEach(() => setVisibility('visible'));

  async function openedSession() {
    const fetchMock = stub();
    const { result } = renderHook(() => useConversation(), { wrapper: wrapper() });

    act(() => result.current.send('go'));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    return { fetchMock, result };
  }

  it('closes the session when the page is going away', async () => {
    const { fetchMock, result } = await openedSession();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    expect(deletes(fetchMock)[0][1]).toMatchObject({ method: 'DELETE', keepalive: true });
    // The handle is dropped locally too: a tab that does come back opens a
    // fresh session on its next message rather than spending one on a 404.
    await waitFor(() => expect(result.current.session).toBeNull());
  });

  it('closes the session when the tab is hidden, but not when it comes back', async () => {
    const { fetchMock } = await openedSession();

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(deletes(fetchMock)).toHaveLength(0);

    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
  });

  it('does nothing when there is no session to hand back', async () => {
    const fetchMock = stub();
    renderHook(() => useConversation(), { wrapper: wrapper() });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const fetchMock = stub();
    const view = renderHook(() => useConversation(), { wrapper: wrapper() });

    act(() => view.result.current.send('go'));
    await waitFor(() => expect(view.result.current.session).not.toBeNull());

    view.unmount();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(deletes(fetchMock)).toHaveLength(0);
  });
});
