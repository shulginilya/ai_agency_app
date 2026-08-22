import { HttpClient } from '@/api/http';
import {
  closeSession,
  getSession,
  listSessions,
  openSession,
  sendSessionMessage,
  sessionIsGone,
  SESSIONS_PATH,
} from '@/api/sessions';
import { catchApiError } from '@/test-utils/expect';
import { messageResponse, sessionInfo } from '@/test-utils/fixtures';
import { fakeResponse, fetchSequence } from '@/test-utils/http';

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

const bodyOf = (fetchImpl: jest.Mock) => JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);

describe('openSession', () => {
  it('POSTs to /v1/sessions and returns the handle', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 201, body: sessionInfo() })]);

    const session = await openSession({}, { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8000${SESSIONS_PATH}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(session.id).toBe('sess_1');
  });

  it('sends an empty body when nothing was chosen', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 201, body: sessionInfo() })]);
    await openSession({}, { client: clientWith(fetchImpl) });
    expect(bodyOf(fetchImpl)).toEqual({});
  });

  it('pins profile and team at open time', async () => {
    const fetchImpl = fetchSequence([
      fakeResponse({ status: 201, body: sessionInfo({ profile: 'eval', team: true }) }),
    ]);

    const session = await openSession({ profile: 'eval', team: true }, { client: clientWith(fetchImpl) });

    expect(bodyOf(fetchImpl)).toEqual({ profile: 'eval', team: true });
    expect(session).toMatchObject({ profile: 'eval', team: true });
  });

  it('surfaces "no session slot" as the retryable thing it is', async () => {
    const error = await catchApiError(
      openSession(
        {},
        { client: clientWith(fetchSequence([fakeResponse({ status: 503, body: { detail: 'Too many open' } })])) },
      ),
    );

    expect(error.status).toBe(503);
    expect(error.isRetryable).toBe(true);
  });
});

describe('listSessions', () => {
  it('unwraps the { sessions: [...] } envelope', async () => {
    const sessions = await listSessions({
      client: clientWith(fetchSequence([fakeResponse({ body: { sessions: [sessionInfo()], count: 1 } })])),
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('sess_1');
  });

  it('takes a null expiry, which is how the server spells "TTL disabled"', async () => {
    const sessions = await listSessions({
      client: clientWith(fetchSequence([fakeResponse({ body: { sessions: [sessionInfo({ expires_at: null })] } })])),
    });

    expect(sessions[0].expires_at).toBeNull();
  });
});

describe('getSession', () => {
  it('reads one handle back', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: sessionInfo({ status: 'busy', turns: 3 }) })]);

    const session = await getSession('sess_1', { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(`http://localhost:8000${SESSIONS_PATH}/sess_1`, expect.anything());
    expect(session).toMatchObject({ status: 'busy', turns: 3 });
  });
});

describe('closeSession', () => {
  it('DELETEs the handle and reads no body', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 204 })]);

    await expect(closeSession('sess_1', { client: clientWith(fetchImpl) })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8000${SESSIONS_PATH}/sess_1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('does not retry, so a lost 204 cannot be replayed into a 404', async () => {
    // DELETE is nominally idempotent and the client would retry it by default.
    // Here that would turn a close that worked into a failure report.
    const fetchImpl = fetchSequence([fakeResponse({ status: 502, body: { detail: 'bad gateway' } })]);

    await catchApiError(closeSession('sess_1', { client: clientWith(fetchImpl) }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes a 409 through: a turn is still running and the session is still ours', async () => {
    const error = await catchApiError(
      closeSession('sess_1', {
        client: clientWith(fetchSequence([fakeResponse({ status: 409, body: { detail: 'A turn is in flight' } })])),
      }),
    );

    expect(error.status).toBe(409);
  });
});

describe('sendSessionMessage', () => {
  it('POSTs only the prompt — profile and team were fixed at open time', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: messageResponse() })]);

    const response = await sendSessionMessage('sess_1', 'next please', { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8000${SESSIONS_PATH}/sess_1/messages`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bodyOf(fetchImpl)).toEqual({ prompt: 'next please' });
    expect(response).toMatchObject({ session_id: 'sess_1', turn: 1 });
    expect(response.run.output).toBe('Four leads, ranked.');
  });

  it('escapes an id rather than letting it invent a route', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: messageResponse() })]);
    await sendSessionMessage('a/b', 'go', { client: clientWith(fetchImpl) });
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8000${SESSIONS_PATH}/a%2Fb/messages`,
      expect.anything(),
    );
  });

  it('reports a busy session as a 409 instead of queueing behind the turn', async () => {
    const error = await catchApiError(
      sendSessionMessage('sess_1', 'go', {
        client: clientWith(fetchSequence([fakeResponse({ status: 409, body: { detail: 'turn in flight' } })])),
      }),
    );

    expect(error.status).toBe(409);
  });
});

/**
 * Called with no options at all, the way every hook calls them: the endpoint
 * functions fall back to the app-wide `apiClient`, and only the global `fetch`
 * stub stands between the test and a real socket.
 */
describe('the app-wide client is the default', () => {
  function stubGlobalFetch(response: Response) {
    const fetchMock = jest.fn(async () => response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('opens, lists, reads and closes without being handed a client', async () => {
    const created = stubGlobalFetch(fakeResponse({ status: 201, body: sessionInfo() }));
    await expect(openSession()).resolves.toMatchObject({ id: 'sess_1' });
    expect(created).toHaveBeenCalledWith(expect.stringContaining('/v1/sessions'), expect.anything());

    stubGlobalFetch(fakeResponse({ body: { sessions: [sessionInfo()], count: 1 } }));
    await expect(listSessions()).resolves.toHaveLength(1);

    stubGlobalFetch(fakeResponse({ body: sessionInfo() }));
    await expect(getSession('sess_1')).resolves.toMatchObject({ id: 'sess_1' });

    stubGlobalFetch(fakeResponse({ status: 204 }));
    await expect(closeSession('sess_1')).resolves.toBeUndefined();

    stubGlobalFetch(fakeResponse({ body: messageResponse() }));
    await expect(sendSessionMessage('sess_1', 'go')).resolves.toMatchObject({ turn: 1 });
  });
});

describe('sessionIsGone', () => {
  it('knows which failures mean the handle is dead rather than busy', () => {
    // The server closes the session on its way out of a 502 or a 504, so
    // retrying the same id after either is the obvious and wrong move.
    expect(sessionIsGone(404)).toBe(true);
    expect(sessionIsGone(502)).toBe(true);
    expect(sessionIsGone(504)).toBe(true);
    expect(sessionIsGone(409)).toBe(false);
    expect(sessionIsGone(503)).toBe(false);
    expect(sessionIsGone(undefined)).toBe(false);
  });
});
