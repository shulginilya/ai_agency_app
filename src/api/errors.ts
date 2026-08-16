/**
 * One error type for the whole API layer, with a `kind` that callers can switch
 * on. Screens should never have to inspect a raw `fetch` rejection.
 */
export type ApiErrorKind =
  /** Could not reach the server at all (DNS, refused connection, offline, CORS). */
  | 'network'
  /** The request exceeded its own timeout budget. */
  | 'timeout'
  /** The caller aborted (screen unmounted, user navigated away). Not a failure. */
  | 'aborted'
  /** The server answered with a non-2xx status. */
  | 'http'
  /** The body was not the content type we asked for / not valid JSON. */
  | 'parse'
  /** The body parsed but did not match the schema — i.e. the contract changed. */
  | 'validation';

export type ApiErrorInit = {
  kind: ApiErrorKind;
  message: string;
  method: string;
  url: string;
  status?: number;
  /** Raw response body, truncated, for the request log and for debugging. */
  responseBody?: string;
  /** zod issue list, flattened to strings. */
  issues?: string[];
  cause?: unknown;
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly method: string;
  readonly url: string;
  readonly status?: number;
  readonly responseBody?: string;
  readonly issues?: string[];

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.method = init.method;
    this.url = init.url;
    this.status = init.status;
    this.responseBody = init.responseBody;
    this.issues = init.issues;
  }

  /** Whether retrying the exact same request could plausibly succeed. */
  get isRetryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    if (this.kind === 'http') return this.status !== undefined && RETRYABLE_STATUSES.has(this.status);
    return false;
  }

  /** Short, non-scary text safe to render in the UI. */
  get userMessage(): string {
    switch (this.kind) {
      case 'network':
        return 'Cannot reach the API. Is the server running, and is this device on the same network?';
      case 'timeout':
        return 'The API did not answer in time.';
      case 'aborted':
        return 'Request cancelled.';
      case 'http':
        return this.status === 404
          ? 'This endpoint does not exist yet on the server.'
          : `The API answered ${this.status}.`;
      case 'parse':
        return 'The API returned a body this app could not read.';
      case 'validation':
        return 'The API response does not match the expected contract.';
    }
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      method: this.method,
      url: this.url,
      status: this.status,
      issues: this.issues,
    };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when the failure is "the caller changed its mind", not "the API is broken". */
export function isAbortError(error: unknown): boolean {
  if (isApiError(error)) return error.kind === 'aborted';
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}
