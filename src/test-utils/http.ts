/** Minimal `fetch` doubles — enough for the client, nothing more. */
export type FakeResponseInit = {
  status?: number;
  body?: unknown;
  /** Send a raw string instead of JSON (to exercise the parse error path). */
  text?: string;
};

export function fakeResponse({ status = 200, body, text }: FakeResponseInit = {}): Response {
  const payload = text ?? (body === undefined ? '' : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload,
  } as unknown as Response;
}

/** Returns each queued response in turn, then repeats the last one. */
export function fetchSequence(responses: Response[]): jest.Mock {
  let index = 0;
  return jest.fn(async () => responses[Math.min(index++, responses.length - 1)]);
}

/** A fetch that never settles until its signal aborts — for timeout tests. */
export function hangingFetch(): jest.Mock {
  const abortError = () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
  };
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Real fetch rejects straight away for an already-aborted signal.
        if (init?.signal?.aborted) {
          reject(abortError());
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(abortError()));
      }),
  );
}

/** A fetch that rejects the way a refused connection does. */
export function failingFetch(message = 'Network request failed'): jest.Mock {
  return jest.fn(async () => {
    throw new TypeError(message);
  });
}
