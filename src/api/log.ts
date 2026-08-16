/**
 * A tiny in-memory ring buffer of API calls.
 *
 * It exists for two reasons: the control screen shows the last few calls so you
 * can see the app actually talking to the API, and every test can assert on what
 * was sent without stubbing a logger. It is deliberately *not* persisted.
 */
export type RequestLogEntry = {
  id: string;
  method: string;
  url: string;
  /** Which attempt this was, 1-based (retries produce their own entries). */
  attempt: number;
  status?: number;
  latencyMs: number;
  ok: boolean;
  /** Populated on failure: the ApiError kind. */
  errorKind?: string;
  errorMessage?: string;
  startedAt: number;
};

export type Listener = () => void;

const MAX_ENTRIES = 50;

export class RequestLog {
  private entries: RequestLogEntry[] = [];
  private listeners = new Set<Listener>();

  constructor(private readonly maxEntries: number = MAX_ENTRIES) {}

  push = (entry: RequestLogEntry): void => {
    // A new array on every push, so `useSyncExternalStore` sees a changed snapshot.
    this.entries = [entry, ...this.entries].slice(0, this.maxEntries);
    this.listeners.forEach((listener) => listener());
  };

  /** Stable reference between pushes — required by useSyncExternalStore. */
  getSnapshot = (): readonly RequestLogEntry[] => this.entries;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  clear = (): void => {
    this.entries = [];
    this.listeners.forEach((listener) => listener());
  };
}

/** Shared instance used by the app's default client. */
export const requestLog = new RequestLog();
