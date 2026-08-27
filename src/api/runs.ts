import { apiClient } from '@/api/client';
import type { HttpClient } from '@/api/http';
import {
  MAX_PROMPT_LENGTH,
  RunResponseSchema,
  type RunProfile,
  type RunResponse,
} from '@/api/schemas';

/**
 * One prompt, run to completion.
 *
 * This is the whole of the stateless surface: no job id, no polling, no
 * streaming — the response *is* the finished run, so the request is held open
 * for as long as the agent takes. That shapes two things in this client:
 *
 * - the timeout is a caller's choice, not the default 8s meant for probes. A
 *   real run outlives a health check by two orders of magnitude.
 * - it is a POST, so `HttpClient` never replays it. A retried run is a second
 *   run: it costs money and may act on the world twice.
 *
 * `is_error: true` still arrives as a 200 — the request succeeded, the agent
 * did not. Only transport failures are 5xx, and each has a distinct meaning:
 * 503 means no run slot was free (retry), 504 means the run outlived the
 * server's own timeout (the work may have partly happened).
 */
export const RUNS_PATH = '/v1/runs';

/** A run is not a probe. Ten minutes is a working ceiling, overridable per call. */
export const DEFAULT_RUN_TIMEOUT_MS = 600_000;

export type RunsApiOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CreateRunInput = {
  prompt: string;
  /** Override the server's configured profile for this run. */
  profile?: RunProfile | null;
  /**
   * Name of a team to run as manager+workers, e.g. `engineering`. Omit or null
   * for the solo agent. `GET /v1/agents` publishes the names — see
   * `teamsFromRoster` in `src/api/teams.ts`.
   */
  team?: string | null;
};

/**
 * Rejects an over-long prompt here rather than spending a round trip to be told
 * 422 — the bound is part of the published contract, so the client can hold it.
 */
export function promptTooLong(prompt: string): boolean {
  return prompt.length > MAX_PROMPT_LENGTH;
}

export async function createRun(
  { prompt, profile, team }: CreateRunInput,
  { client = apiClient, signal, timeoutMs = DEFAULT_RUN_TIMEOUT_MS }: RunsApiOptions = {},
): Promise<RunResponse> {
  // `extra="forbid"` server-side: an undefined key must not be serialised as
  // `null`, or a request that means "use the default" becomes a 422.
  const body: Record<string, unknown> = { prompt };
  if (profile) body.profile = profile;
  // Truthiness, not `!== undefined`: solo is the server's default and is
  // spelled by *omitting* the key. This was `team !== undefined` while `team`
  // was a boolean, where `false` was a real choice worth sending.
  if (team) body.team = team;

  const { data } = await client.post(RUNS_PATH, body, {
    schema: RunResponseSchema,
    signal,
    timeoutMs,
  });
  return data;
}

export type { RunProfile, RunResponse };
