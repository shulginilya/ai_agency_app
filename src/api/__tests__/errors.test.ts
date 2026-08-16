import { ApiError, isAbortError, isApiError } from '@/api/errors';

const make = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ kind: 'http', message: 'boom', method: 'GET', url: 'http://localhost:8000/x', ...init });

describe('ApiError.isRetryable', () => {
  it('is true for transport failures', () => {
    expect(make({ kind: 'network' }).isRetryable).toBe(true);
    expect(make({ kind: 'timeout' }).isRetryable).toBe(true);
  });

  it('is true only for the transient HTTP statuses', () => {
    [408, 425, 429, 500, 502, 503, 504].forEach((status) => {
      expect(make({ status }).isRetryable).toBe(true);
    });
    [400, 401, 403, 404, 409, 422].forEach((status) => {
      expect(make({ status }).isRetryable).toBe(false);
    });
  });

  it('is false for contract problems and cancellation', () => {
    expect(make({ kind: 'validation' }).isRetryable).toBe(false);
    expect(make({ kind: 'parse' }).isRetryable).toBe(false);
    expect(make({ kind: 'aborted' }).isRetryable).toBe(false);
  });
});

describe('ApiError.userMessage', () => {
  it('explains a missing endpoint differently from other HTTP errors', () => {
    expect(make({ status: 404 }).userMessage).toMatch(/does not exist yet/);
    expect(make({ status: 500 }).userMessage).toBe('The API answered 500.');
  });

  it('covers every kind without leaking stack details', () => {
    (['network', 'timeout', 'aborted', 'parse', 'validation'] as const).forEach((kind) => {
      expect(make({ kind }).userMessage).toEqual(expect.any(String));
    });
  });
});

describe('guards', () => {
  it('identifies ApiError instances', () => {
    expect(isApiError(make())).toBe(true);
    expect(isApiError(new Error('nope'))).toBe(false);
  });

  it('identifies aborts from both the client and the platform', () => {
    expect(isAbortError(make({ kind: 'aborted' }))).toBe(true);
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(make({ kind: 'network' }))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('serialization', () => {
  it('is JSON-safe for logs', () => {
    expect(JSON.parse(JSON.stringify(make({ status: 503 })))).toMatchObject({
      name: 'ApiError',
      kind: 'http',
      status: 503,
    });
  });
});
