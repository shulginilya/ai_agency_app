import { ApiError } from '@/api/errors';
import { createQueryClient } from '@/query/client';
import { qk } from '@/query/keys';

function retryPolicy() {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('expected a retry predicate');
  return retry as (failureCount: number, error: Error) => boolean;
}

const apiError = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
  new ApiError({ kind: 'http', message: 'x', method: 'GET', url: '/x', ...init });

describe('query client retry policy', () => {
  it('never retries a client error — it would fail identically', () => {
    expect(retryPolicy()(0, apiError({ status: 404 }))).toBe(false);
    expect(retryPolicy()(0, apiError({ kind: 'validation' }))).toBe(false);
  });

  it('retries a transport failure once, then gives up', () => {
    expect(retryPolicy()(0, apiError({ kind: 'network' }))).toBe(true);
    expect(retryPolicy()(1, apiError({ kind: 'network' }))).toBe(false);
  });

  it('retries unknown (non-ApiError) failures once', () => {
    expect(retryPolicy()(0, new Error('boom'))).toBe(true);
  });
});

describe('query keys', () => {
  it('nests probe keys under the probes prefix so one invalidate hits both', () => {
    expect(qk.probes()).toEqual(['probes']);
    expect(qk.probe('healthz')).toEqual(['probes', 'healthz']);
    expect(qk.probe('healthz').slice(0, 1)).toEqual(qk.probes());
  });

  it('nests agent detail keys under the agents prefix', () => {
    expect(qk.agents()).toEqual(['agents']);
    expect(qk.agent('a1')).toEqual(['agents', 'a1']);
  });
});
