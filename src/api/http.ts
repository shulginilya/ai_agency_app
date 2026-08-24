import type { ZodType } from 'zod';
import { DEFAULT_TIMEOUT_MS } from '@/api/config';
import { ApiError } from '@/api/errors';
import type { RequestLogEntry } from '@/api/log';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** Methods that are safe to replay after a transient failure. */
const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'HEAD', 'PUT', 'DELETE']);

export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

export type HttpClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  /** Extra attempts after the first one, for idempotent requests only. */
  retries?: number;
  /** First backoff step; doubles per attempt. */
  retryDelayMs?: number;
  defaultHeaders?: Record<string, string>;
  /** Called before every request; return null when the user is not signed in. */
  getAuthToken?: TokenProvider;
  onLog?: (entry: RequestLogEntry) => void;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  randomId?: () => string;
};

export type RequestOptions<T> = {
  path: string;
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Serialized as JSON unless it is already a string. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Validates (and types) the parsed body. Omit to get `unknown`. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  /** `none` skips body reading entirely (useful for HEAD). */
  responseType?: 'json' | 'text' | 'none';
  /**
   * Lets the request outlive the page that started it (`fetch`'s `keepalive`).
   * Web only, small bodies only — for the teardown calls fired from `pagehide`.
   */
  keepalive?: boolean;
};

export type ApiResponse<T> = {
  data: T;
  status: number;
  latencyMs: number;
  requestId: string;
  /** Untouched response text, capped, for the request log / raw view. */
  raw?: string;
};

/** Cap on what reaches the request log and `ApiError.responseBody`. Never the parser. */
const MAX_LOGGED_BODY = 2_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let idCounter = 0;
const defaultRandomId = () => `req_${Date.now().toString(36)}_${(idCounter += 1).toString(36)}`;

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestOptions<unknown>['query'],
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return params.length ? `${base}${suffix}?${params.join('&')}` : `${base}${suffix}`;
}

/**
 * The single place where this app talks to the network.
 *
 * Everything the rest of the code needs is here and nowhere else: timeouts,
 * bounded retries with backoff, bearer auth, JSON encoding, schema validation
 * and a uniform `ApiError`. Endpoint modules stay three lines long.
 */
export class HttpClient {
  private readonly options: Required<
    Pick<HttpClientOptions, 'baseUrl' | 'timeoutMs' | 'retries' | 'retryDelayMs' | 'defaultHeaders'>
  > &
    HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      retries: 2,
      retryDelayMs: 300,
      defaultHeaders: {},
      ...options,
    };
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  get<T = unknown>(path: string, options: Omit<RequestOptions<T>, 'path' | 'method'> = {}) {
    return this.request<T>({ ...options, path, method: 'GET' });
  }

  post<T = unknown>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'path' | 'method' | 'body'> = {}) {
    return this.request<T>({ ...options, path, body, method: 'POST' });
  }

  /**
   * DELETE is in `IDEMPOTENT_METHODS`, so it is retried by default. Callers
   * deleting something whose absence is itself an error (a session handle, say)
   * should pass `retries: 0` — a lost 204 replayed into a 404 reports a failure
   * for work that succeeded.
   */
  delete<T = unknown>(path: string, options: Omit<RequestOptions<T>, 'path' | 'method'> = {}) {
    return this.request<T>({ ...options, path, method: 'DELETE' });
  }

  async request<T = unknown>(options: RequestOptions<T>): Promise<ApiResponse<T>> {
    const method = options.method ?? 'GET';
    const url = buildUrl(this.options.baseUrl, options.path, options.query);
    const maxAttempts =
      1 + (IDEMPOTENT_METHODS.has(method) ? (options.retries ?? this.options.retries) : 0);

    let lastError: ApiError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attempt<T>({ ...options, method }, url, attempt);
      } catch (error) {
        const apiError = error as ApiError;
        if (apiError.kind === 'aborted' || !apiError.isRetryable || attempt === maxAttempts) {
          throw apiError;
        }
        lastError = apiError;
        // Exponential backoff: 300ms, 600ms, 1200ms…
        const delay = this.options.retryDelayMs * 2 ** (attempt - 1);
        await (this.options.sleep ?? defaultSleep)(delay);
      }
    }

    /* istanbul ignore next — the loop always returns or throws. */
    throw lastError;
  }

  private async attempt<T>(
    options: RequestOptions<T> & { method: HttpMethod },
    url: string,
    attempt: number,
  ): Promise<ApiResponse<T>> {
    const { method, schema, signal, body, responseType = 'json', keepalive } = options;
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const now = this.options.now ?? Date.now;
    const requestId = (this.options.randomId ?? defaultRandomId)();
    const startedAt = now();

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const unlinkCaller = linkSignal(signal, controller);

    const log = (entry: Omit<RequestLogEntry, 'id' | 'method' | 'url' | 'attempt' | 'startedAt'>) =>
      this.options.onLog?.({ id: requestId, method, url, attempt, startedAt, ...entry });

    const fail = (error: ApiError): never => {
      log({
        latencyMs: now() - startedAt,
        ok: false,
        status: error.status,
        errorKind: error.kind,
        errorMessage: error.message,
      });
      throw error;
    };

    try {
      const headers = await this.buildHeaders(options.headers, body);
      const response = await fetchImpl(url, {
        method,
        headers,
        body: encodeBody(body),
        signal: controller.signal,
        ...(keepalive ? { keepalive: true } : {}),
      });

      // Read once, then keep the two uses apart: the parser needs the whole
      // body, the log and the error only ever show a capped copy. Parsing the
      // capped copy would fail on any response over `MAX_LOGGED_BODY` — a
      // roster or a long agent reply — with "not valid JSON".
      const text = responseType === 'none' ? undefined : await response.text();
      const raw = text === undefined ? undefined : truncate(text);
      const latencyMs = now() - startedAt;

      if (!response.ok) {
        return fail(
          new ApiError({
            kind: 'http',
            message: `${method} ${url} failed with ${response.status}`,
            method,
            url,
            status: response.status,
            responseBody: raw,
          }),
        );
      }

      const parsed = parseBody(text, responseType, method, url);
      const data = schema ? validate(schema, parsed, method, url, raw) : (parsed as T);

      log({ latencyMs, ok: true, status: response.status });
      return { data, status: response.status, latencyMs, requestId, raw };
    } catch (error) {
      if (error instanceof ApiError) throw error; // already logged by `fail`
      if (timedOut) {
        return fail(
          new ApiError({
            kind: 'timeout',
            message: `${method} ${url} timed out after ${timeoutMs}ms`,
            method,
            url,
            cause: error,
          }),
        );
      }
      if (signal?.aborted || (error as Error)?.name === 'AbortError') {
        return fail(
          new ApiError({ kind: 'aborted', message: `${method} ${url} was cancelled`, method, url, cause: error }),
        );
      }
      return fail(
        new ApiError({
          kind: 'network',
          message: `${method} ${url} could not reach the server: ${(error as Error)?.message ?? 'unknown error'}`,
          method,
          url,
          cause: error,
        }),
      );
    } finally {
      clearTimeout(timer);
      unlinkCaller();
    }
  }

  private async buildHeaders(
    extra: Record<string, string> | undefined,
    body: unknown,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
      ...extra,
    };
    if (body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const token = await this.options.getAuthToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
}

/** Forwards a caller-supplied abort to our internal controller, and unsubscribes cleanly. */
function linkSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  return () => signal.removeEventListener('abort', onAbort);
}

function encodeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function truncate(text: string): string {
  return text.length > MAX_LOGGED_BODY ? `${text.slice(0, MAX_LOGGED_BODY)}…` : text;
}

function parseBody(raw: string | undefined, responseType: 'json' | 'text' | 'none', method: string, url: string) {
  if (responseType === 'none' || raw === undefined) return undefined;
  if (responseType === 'text') return raw;
  if (raw.trim() === '') return undefined; // 204 and friends
  try {
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new ApiError({
      kind: 'parse',
      message: `${method} ${url} returned a body that is not valid JSON`,
      method,
      url,
      responseBody: raw,
      cause,
    });
  }
}

function validate<T>(schema: ZodType<T>, value: unknown, method: string, url: string, raw?: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new ApiError({
    kind: 'validation',
    message: `${method} ${url} returned an unexpected shape`,
    method,
    url,
    issues,
    responseBody: raw,
  });
}
