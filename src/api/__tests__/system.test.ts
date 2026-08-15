import { HttpClient } from '@/api/http';
import { PROBE_NAMES, PROBES, runProbe, summarize, type ProbeResult } from '@/api/system';
import { failingFetch, fakeResponse, fetchSequence, hangingFetch } from '@/test-utils/http';

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

describe('probe registry', () => {
  it('exposes the two endpoints that exist today', () => {
    expect(PROBE_NAMES).toEqual(['healthz', 'readyz']);
    expect(PROBES.healthz.path).toBe('/healthz');
    expect(PROBES.readyz.path).toBe('/readyz');
  });
});

describe('runProbe', () => {
  it('reports up, with latency and body, when the endpoint answers 200', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { status: 'ok', version: '0.1.0' } })]);

    const result = await runProbe('healthz', { client: clientWith(fetchImpl) });

    expect(result).toMatchObject({ name: 'healthz', path: '/healthz', ok: true, httpStatus: 200 });
    expect(result.body).toEqual({ status: 'ok', version: '0.1.0' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/healthz', expect.anything());
  });

  it('keeps unknown body fields instead of dropping them', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { status: 'ready', queue_depth: 3 } })]);

    const result = await runProbe('readyz', { client: clientWith(fetchImpl) });

    expect(result.body).toMatchObject({ queue_depth: 3 });
  });

  it('accepts an empty body — the status code is the answer', async () => {
    const result = await runProbe('healthz', { client: clientWith(fetchSequence([fakeResponse({ status: 204 })])) });

    expect(result.ok).toBe(true);
    expect(result.body).toBeUndefined();
  });

  it('reports down (never throws) when readiness returns 503', async () => {
    const result = await runProbe('readyz', {
      client: clientWith(fetchSequence([fakeResponse({ status: 503, body: { detail: 'db not ready' } })])),
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.error?.kind).toBe('http');
  });

  it('reports down when the server is unreachable', async () => {
    const result = await runProbe('healthz', { client: clientWith(failingFetch()) });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
    expect(result.error?.message).toMatch(/Cannot reach the API/);
  });

  it('reports down on timeout', async () => {
    const result = await runProbe('healthz', { client: clientWith(hangingFetch()), timeoutMs: 20 });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('timeout');
  });

  it('rethrows cancellation so a stale result is never cached', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runProbe('healthz', { client: clientWith(hangingFetch()), signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('summarize', () => {
  const probe = (name: 'healthz' | 'readyz', ok: boolean): ProbeResult => ({
    name,
    path: PROBES[name].path,
    ok,
    latencyMs: 1,
    checkedAt: 0,
  });

  it('is unknown before anything has answered', () => {
    expect(summarize([])).toBe('unknown');
    expect(summarize([undefined, undefined])).toBe('unknown');
  });

  it('is healthy when every probe passes', () => {
    expect(summarize([probe('healthz', true), probe('readyz', true)])).toBe('healthy');
  });

  it('is degraded when the process is alive but not ready', () => {
    expect(summarize([probe('healthz', true), probe('readyz', false)])).toBe('degraded');
  });

  it('is down when nothing answers', () => {
    expect(summarize([probe('healthz', false), probe('readyz', false)])).toBe('down');
  });
});
