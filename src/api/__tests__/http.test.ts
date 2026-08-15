import { z } from 'zod';
import { ApiError } from '@/api/errors';
import { buildUrl, HttpClient } from '@/api/http';
import type { RequestLogEntry } from '@/api/log';
import { catchApiError } from '@/test-utils/expect';
import { failingFetch, fakeResponse, fetchSequence, hangingFetch } from '@/test-utils/http';

const BASE = 'http://localhost:8000';

function makeClient(fetchImpl: jest.Mock, overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const logs: RequestLogEntry[] = [];
  const client = new HttpClient({
    baseUrl: BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    // No real waiting in tests — backoff timing is asserted separately.
    sleep: async () => {},
    onLog: (entry) => logs.push(entry),
    ...overrides,
  });
  return { client, logs };
}

describe('buildUrl', () => {
  it('joins base and path regardless of slashes', () => {
    expect(buildUrl('http://x/', 'healthz')).toBe('http://x/healthz');
    expect(buildUrl('http://x', '/healthz')).toBe('http://x/healthz');
  });

  it('encodes query params and drops empty ones', () => {
    expect(buildUrl(BASE, '/agents', { status: 'running', limit: 10, cursor: undefined, q: null, empty: '' })).toBe(
      `${BASE}/agents?status=running&limit=10`,
    );
    expect(buildUrl(BASE, '/agents', { q: 'a b&c' })).toBe(`${BASE}/agents?q=a%20b%26c`);
  });
});

describe('HttpClient success path', () => {
  it('returns parsed, schema-validated data with a latency measurement', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { status: 'ok' } })]);
    let clock = 1_000;
    const { client } = makeClient(fetchImpl, { now: () => (clock += 25) });

    const response = await client.get('/healthz', { schema: z.object({ status: z.string() }) });

    expect(response.data).toEqual({ status: 'ok' });
    expect(response.status).toBe(200);
    expect(response.latencyMs).toBe(25);
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/healthz`, expect.objectContaining({ method: 'GET' }));
  });

  it('treats an empty body as undefined instead of a parse error', async () => {
    const { client } = makeClient(fetchSequence([fakeResponse({ status: 204, text: '' })]));
    await expect(client.get('/healthz')).resolves.toMatchObject({ status: 204, data: undefined });
  });

  it('sends JSON headers and a serialized body on POST', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { ok: true } })]);
    const { client } = makeClient(fetchImpl);

    await client.post('/agents/a1/start', { force: true });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"force":true}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
  });

  it('attaches a bearer token when the provider returns one', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: {} })]);
    const { client } = makeClient(fetchImpl, { getAuthToken: async () => 'secret-token' });

    await client.get('/agents');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: {} })]);
    const { client } = makeClient(fetchImpl, { getAuthToken: () => null });

    await client.get('/agents');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});

describe('HttpClient failure taxonomy', () => {
  it('maps a non-2xx response to an http error carrying the body', async () => {
    const { client } = makeClient(fetchSequence([fakeResponse({ status: 404, body: { detail: 'Not Found' } })]), {
      retries: 0,
    });

    const error = await catchApiError(client.get('/agents'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(404);
    expect(error.responseBody).toContain('Not Found');
    expect(error.isRetryable).toBe(false);
    expect(error.userMessage).toMatch(/does not exist yet/);
  });

  it('maps an unreachable server to a network error', async () => {
    const { client } = makeClient(failingFetch(), { retries: 0 });

    const error = await catchApiError(client.get('/healthz'));

    expect(error.kind).toBe('network');
    expect(error.isRetryable).toBe(true);
  });

  it('times out a request that never answers', async () => {
    const { client } = makeClient(hangingFetch(), { retries: 0 });

    const error = await catchApiError(client.get('/healthz', { timeoutMs: 20 }));

    expect(error.kind).toBe('timeout');
    expect(error.message).toMatch(/timed out after 20ms/);
  });

  it('reports caller cancellation as aborted, not as a failure', async () => {
    const controller = new AbortController();
    const { client } = makeClient(hangingFetch(), { retries: 0 });

    const promise = client.get('/healthz', { signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = makeClient(hangingFetch(), { retries: 0 });

    await expect(client.get('/healthz', { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps a non-JSON body to a parse error', async () => {
    const { client } = makeClient(fetchSequence([fakeResponse({ text: '<html>oops</html>' })]), { retries: 0 });

    const error = await catchApiError(client.get('/healthz'));

    expect(error.kind).toBe('parse');
    expect(error.responseBody).toContain('<html>');
  });

  it('maps a contract mismatch to a validation error listing the offending fields', async () => {
    const { client } = makeClient(fetchSequence([fakeResponse({ body: { id: 1, name: 'a' } })]), { retries: 0 });

    const error = await catchApiError(
      client.get('/agents/a1', { schema: z.object({ id: z.string(), name: z.string() }) }),
    );

    expect(error.kind).toBe('validation');
    expect(error.issues?.[0]).toMatch(/^id:/);
  });
});

describe('HttpClient retries', () => {
  it('retries an idempotent request through a transient 503 and succeeds', async () => {
    const fetchImpl = fetchSequence([
      fakeResponse({ status: 503, body: { detail: 'starting' } }),
      fakeResponse({ body: { status: 'ok' } }),
    ]);
    const { client, logs } = makeClient(fetchImpl, { retries: 2 });

    await expect(client.get('/readyz')).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logs.map((entry) => [entry.attempt, entry.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('gives up after the configured number of attempts', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 500 })]);
    const { client } = makeClient(fetchImpl, { retries: 2 });

    await expect(client.get('/readyz')).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('never retries a 4xx — it would fail identically forever', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 400 })]);
    const { client } = makeClient(fetchImpl, { retries: 3 });

    await expect(client.get('/agents')).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never retries a non-idempotent request', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 503 })]);
    const { client } = makeClient(fetchImpl, { retries: 3 });

    await expect(client.post('/agents/a1/start')).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = [];
    const fetchImpl = fetchSequence([fakeResponse({ status: 500 })]);
    const { client } = makeClient(fetchImpl, {
      retries: 2,
      retryDelayMs: 300,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await client.get('/readyz').catch(() => undefined);

    expect(delays).toEqual([300, 600]);
  });
});

describe('HttpClient logging', () => {
  it('records one entry per attempt with method, path, status and latency', async () => {
    let clock = 0;
    const { client, logs } = makeClient(fetchSequence([fakeResponse({ body: { status: 'ok' } })]), {
      now: () => (clock += 10),
    });

    await client.get('/healthz');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: 'GET', url: `${BASE}/healthz`, ok: true, status: 200, latencyMs: 10 });
  });

  it('records the error kind when a call fails', async () => {
    const { client, logs } = makeClient(failingFetch(), { retries: 0 });

    await client.get('/healthz').catch(() => undefined);

    expect(logs[0]).toMatchObject({ ok: false, errorKind: 'network' });
  });
});
