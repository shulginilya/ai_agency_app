import { HttpClient } from '@/api/http';
import { createRun, promptTooLong, RUNS_PATH } from '@/api/runs';
import { MAX_PROMPT_LENGTH } from '@/api/schemas';
import { catchApiError } from '@/test-utils/expect';
import { runResponse } from '@/test-utils/fixtures';
import { fakeResponse, fetchSequence } from '@/test-utils/http';

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

const bodyOf = (fetchImpl: jest.Mock) => JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);

describe('createRun', () => {
  it('POSTs the prompt to /v1/runs', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: runResponse() })]);

    const run = await createRun({ prompt: 'rank the leads' }, { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8000${RUNS_PATH}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bodyOf(fetchImpl)).toEqual({ prompt: 'rank the leads' });
    expect(run.output).toBe('Four leads, ranked.');
  });

  it('leaves an unchosen profile out of the body entirely', async () => {
    // `extra="forbid"` server-side, and `profile: null` is not the same request
    // as an absent `profile` — one of them is a 422.
    const fetchImpl = fetchSequence([fakeResponse({ body: runResponse() })]);

    await createRun({ prompt: 'go', profile: null }, { client: clientWith(fetchImpl) });

    expect(bodyOf(fetchImpl)).toEqual({ prompt: 'go' });
  });

  it('sends profile and team when they are chosen', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: runResponse() })]);

    await createRun({ prompt: 'go', profile: 'sandboxed', team: true }, { client: clientWith(fetchImpl) });

    expect(bodyOf(fetchImpl)).toEqual({ prompt: 'go', profile: 'sandboxed', team: true });
  });

  it('treats an agent-side failure as data, not as an exception', async () => {
    // `is_error: true` arrives with a 200: the request worked, the agent did not.
    const failed = runResponse({ is_error: true, output: null, summary: 'The agent loop failed.' });
    const run = await createRun(
      { prompt: 'go' },
      { client: clientWith(fetchSequence([fakeResponse({ body: failed })])) },
    );

    expect(run.is_error).toBe(true);
    expect(run.output).toBeNull();
  });

  it('never replays a run, however transient the failure looks', async () => {
    // A retried run is a second run: it costs money and may act on the world
    // twice. POST is not in the client's idempotent set, and this is why.
    const fetchImpl = fetchSequence([fakeResponse({ status: 503, body: { detail: 'No run slot available' } })]);

    const error = await catchApiError(createRun({ prompt: 'go' }, { client: clientWith(fetchImpl) }));

    expect(error.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('holds the connection open far longer than a probe would', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: runResponse() })]);
    await createRun({ prompt: 'go' }, { client: clientWith(fetchImpl), timeoutMs: 1_000 });
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('promptTooLong', () => {
  it('holds the server-side bound rather than spending a round trip on a 422', () => {
    expect(promptTooLong('a'.repeat(MAX_PROMPT_LENGTH))).toBe(false);
    expect(promptTooLong('a'.repeat(MAX_PROMPT_LENGTH + 1))).toBe(true);
  });
});
