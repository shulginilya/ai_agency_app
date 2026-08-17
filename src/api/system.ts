import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { HttpClient } from '@/api/http';
import { ProbeBodySchema, type ProbeBody } from '@/api/schemas';

/**
 * The endpoints worth a reachability check on the control screen. Not just
 * k8s-style health checks — any route is fair game, versioned or not. Add to
 * this map as the API grows; `ProbeBodySchema` accepts whatever shape comes
 * back, so a new entry never needs a new schema.
 *
 * Data endpoints stay out: `/v1/agents` is already fetched by `useAgents`, and
 * the list on the screen shows whether that call worked. Probing it as well
 * would double the traffic to answer the same question twice.
 */
export const PROBES = {
  healthz: { path: '/healthz', label: 'Liveness', hint: 'Process is up and serving' },
  readyz: { path: '/readyz', label: 'Readiness', hint: 'Dependencies are wired and ready' },
} as const;

export type ProbeName = keyof typeof PROBES;
export const PROBE_NAMES = Object.keys(PROBES) as ProbeName[];

export type ProbeResult = {
  name: ProbeName;
  path: string;
  /** True only when the server answered 2xx. */
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  body?: ProbeBody;
  checkedAt: number;
  error?: { kind: ApiError['kind']; message: string };
};

export type ProbeOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * Runs one probe. Deliberately does not throw: "the API is down" is a state this
 * screen renders, not an exception. A cancelled request *does* rethrow, so React
 * Query can drop it instead of caching a bogus "down".
 */
export async function runProbe(name: ProbeName, options: ProbeOptions = {}): Promise<ProbeResult> {
  const { client = apiClient, signal, timeoutMs, now = Date.now } = options;
  const { path } = PROBES[name];
  const startedAt = now();

  try {
    const response = await client.get(path, {
      schema: ProbeBodySchema,
      signal,
      timeoutMs,
      // Probes are cheap; one quick retry smooths over a restarting server.
      retries: 1,
    });
    return {
      name,
      path,
      ok: true,
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      body: response.data,
      checkedAt: now(),
    };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'aborted') throw error;
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError({ kind: 'network', message: String(error), method: 'GET', url: path });
    return {
      name,
      path,
      ok: false,
      httpStatus: apiError.status,
      latencyMs: now() - startedAt,
      checkedAt: now(),
      error: { kind: apiError.kind, message: apiError.userMessage },
    };
  }
}

export type SystemStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Liveness up but readiness down is the classic "degraded" case worth showing. */
export function summarize(results: readonly (ProbeResult | undefined)[]): SystemStatus {
  const known = results.filter((result): result is ProbeResult => result !== undefined);
  if (known.length === 0) return 'unknown';
  if (known.every((result) => result.ok)) return 'healthy';
  if (known.every((result) => !result.ok)) return 'down';
  return 'degraded';
}
