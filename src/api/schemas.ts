import { z } from 'zod';

/**
 * Runtime contracts for the `agency` control API.
 *
 * Every schema here mirrors a component in `contracts/openapi.json`, and
 * `src/api/contract.ts` fails the build when the two stop agreeing. The naming
 * follows the spec deliberately — `AgentInfo`, `RunResponse`, `SessionInfo` —
 * so a finding that says `listAgents → [].availability` points at something you
 * can grep for on both sides.
 *
 * Two different strictness levels, on purpose:
 *
 * - Probe endpoints (anything in `PROBES`, e.g. `/healthz`, `/readyz`) only care
 *   about the HTTP status — that *is* the answer, the body is a bonus the UI
 *   renders raw. `PROBES` is meant to grow to any route worth a reachability
 *   check, so the body can be an object, a list, or nothing at all. The schema
 *   is maximally permissive to match.
 * - Everything else is strict. If the server changes shape, the app fails loudly
 *   with a `validation` ApiError instead of rendering `undefined` somewhere.
 *
 * One rule the checker enforces that is easy to trip over: never ask for more
 * than the spec promises. `.min(1)` on a field the server declares without
 * `min_length` is an error, not a nicety — the server is allowed to send `""`
 * and the app would refuse a legal response.
 */
export const ProbeBodySchema = z.unknown().nullish();

export type ProbeBody = z.infer<typeof ProbeBodySchema>;

/* ----------------------------------------------------------------- health */

/**
 * `GET /healthz`. Parsed only for display — the probe itself still reads the
 * status code, because a liveness check that depends on a body shape has an
 * extra way to fail.
 */
export const HealthSchema = z.object({
  status: z.literal('ok').nullish(),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export const READINESS_STATUSES = ['ready', 'degraded'] as const;
export const ReadinessStatusSchema = z.enum(READINESS_STATUSES);
export type ReadinessStatus = z.infer<typeof ReadinessStatusSchema>;

/**
 * `GET /readyz`. `capacity` is the interesting part: it is how many run and
 * session slots this process has left, which is the difference between "the
 * API is up" and "the API will actually take my prompt right now".
 */
export const ReadinessSchema = z.object({
  status: ReadinessStatusSchema,
  checks: z.record(z.string(), z.string()),
  capacity: z.record(z.string(), z.number().int()),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

/* ----------------------------------------------------------------- agents */

/**
 * The full set from the spec. `starting`, `paused` and `stopped` are reserved
 * server-side and nothing emits them today — the client renders them anyway,
 * because removing a member is as breaking as adding one and the day one starts
 * arriving should not be the day the app throws a validation error.
 */
export const AGENT_STATUSES = ['idle', 'starting', 'running', 'paused', 'error', 'stopped'] as const;
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** `always` — loaded on every run. `team` — only when the run is started with `team=<name>`. */
export const AGENT_AVAILABILITY = ['always', 'team'] as const;
export const AgentAvailabilitySchema = z.enum(AGENT_AVAILABILITY);
export type AgentAvailability = z.infer<typeof AgentAvailabilitySchema>;

/**
 * One subagent the server can invoke — `AgentInfo` in the spec.
 *
 * Not an actor you drive: there is no start/stop/pause on the wire, because a
 * worker is running or it is gone. `status` is this process's live view from the
 * subagent hook stream, so with `uvicorn --workers N` each worker reports its
 * own.
 *
 * `name` is `z.string()` rather than `.min(1)`: the server does not declare
 * `min_length` on it, and the contract checker is right to refuse a client that
 * is stricter than the contract it was handed.
 */
export const AgentInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: AgentStatusSchema,
  /** What the agent is for. This is what drives the manager's routing. */
  description: z.string(),
  availability: AgentAvailabilitySchema,
  /**
   * ISO-8601, and never null: the time the agent entered its current status.
   * Use `invocations === 0` to tell "never ran" from "ran and finished" — the
   * timestamp cannot distinguish them.
   */
  updated_at: z.string().min(1),
  /**
   * The optional half of the roster entry. All four are `.nullish()` rather
   * than `.optional()`: a Pydantic `str | None = None` serialises as an
   * explicit `null`, not an absent key, so the wire has two spellings of "no
   * value" and only one of them is in our gift.
   */
  model: z.string().nullish(),
  tools: z.array(z.string()).nullish(),
  max_turns: z.number().int().nullish(),
  invocations: z.number().int().nullish(),
  /**
   * Which team this worker belongs to, or null for an `always` agent. Pass it
   * as `team` on a run or a session to reach the agents that carry it — this
   * field is the only place the set of teams is published, so it is what
   * `teamsFromRoster` derives the picker from.
   *
   * `.nullish()` and not `.nullable()`: the spec leaves `team` out of
   * `AgentInfo.required`, so the key may be absent as well as null.
   */
  team: z.string().nullish(),
});
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

/**
 * Unwraps `{"<key>": …}` so an envelope and a bare payload validate identically.
 * Every collection endpoint on this API uses an envelope; accepting the bare
 * array too costs nothing and keeps the mock honest.
 */
function unwrapEnvelope(key: string) {
  return (value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value) && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return value;
  };
}

/** Unwraps `{"agents": [...]}` so both that and a bare `[...]` validate identically. */
export const unwrapAgentList = unwrapEnvelope('agents');

/**
 * Unwrapping before validating (rather than a union of both shapes) keeps the
 * error messages pointed at the offending field, e.g. `0.status`, instead of a
 * useless top-level "invalid input".
 */
export const AgentsResponseSchema = z.preprocess(unwrapAgentList, z.array(AgentInfoSchema));

/* ------------------------------------------------------------------- runs */

export const RUN_PROFILES = ['dev', 'sandboxed', 'eval'] as const;
export const RunProfileSchema = z.enum(RUN_PROFILES);
export type RunProfile = z.infer<typeof RunProfileSchema>;

/** The server caps a prompt at 20k characters and answers 422 over it. */
export const MAX_PROMPT_LENGTH = 20_000;

export const TOOL_EVENT_PHASES = ['pre', 'post', 'blocked', 'failed'] as const;
export const ToolEventPhaseSchema = z.enum(TOOL_EVENT_PHASES);
export type ToolEventPhase = z.infer<typeof ToolEventPhaseSchema>;

/** One entry of a run's tool trace. `blocked` is the guardrail denying a call. */
export const ToolEventSchema = z.object({
  tool: z.string(),
  phase: ToolEventPhaseSchema,
  at: z.string(),
  detail: z.record(z.string(), z.unknown()).nullish(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

/**
 * The result of one completed run — and of one session turn, which nests the
 * very same object under `run`. That is what lets the conversation screen and a
 * one-shot run share a single renderer.
 *
 * `is_error: true` arrives with a 200: the request succeeded, the agent did not.
 * The app has to read the flag, because the HTTP status will not tell it.
 */
export const RunResponseSchema = z.object({
  run_id: z.string(),
  profile: z.string(),
  model: z.string(),
  is_error: z.boolean(),
  /** Null when the run produced no final text — an error run usually does not. */
  output: z.string().nullish(),
  num_turns: z.number().int(),
  duration_ms: z.number().int(),
  total_cost_usd: z.number(),
  usage: z.record(z.string(), z.unknown()),
  tools_used: z.array(z.string()),
  /** Which subagents the manager handed work to. Empty on a solo run. */
  delegated_to: z.array(z.string()),
  tool_events: z.array(ToolEventSchema),
  summary: z.string(),
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

/* --------------------------------------------------------------- sessions */

/** `busy` while a turn is in flight. Sending to a busy session is a 409, not a queue. */
export const SESSION_STATUSES = ['idle', 'busy'] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * One open session: a live SDK subprocess this process is holding for you.
 *
 * Deliberately not the conversation — the transcript is not stored server-side,
 * each turn is persisted as its own run record. Whatever the app wants to show
 * as a thread, the app has to keep. See `src/chat/transcript.ts`.
 */
export const SessionInfoSchema = z.object({
  id: z.string(),
  /** Fixed at open time. Sending `profile` on a turn is a 422, not a no-op. */
  profile: z.string(),
  /**
   * The team this session runs as manager+workers, or null for a solo agent.
   * A name since the server grew more than one team — it was a boolean until
   * 2026-08-27, and the contract test is what caught the change.
   *
   * Fixed at open time like `profile`: `MessageRequest` forbids `team`, so
   * changing it means closing this session and opening another.
   */
  team: z.string().nullish(),
  status: SessionStatusSchema,
  turns: z.number().int(),
  created_at: z.string().min(1),
  last_active_at: z.string().min(1),
  /** When the server may reap this for idleness. Null when the TTL is disabled. */
  expires_at: z.string().nullish(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const unwrapSessionList = unwrapEnvelope('sessions');

export const SessionsResponseSchema = z.preprocess(unwrapSessionList, z.array(SessionInfoSchema));

/**
 * The answer to one turn. `run` is the same object `POST /v1/runs` returns, so a
 * turn and a one-shot run render through one code path.
 */
export const MessageResponseSchema = z.object({
  session_id: z.string(),
  /** 1-based index of this turn within the session. `run.run_id` is per-turn. */
  turn: z.number().int(),
  run: RunResponseSchema,
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

/* --------------------------------------------------------------- problems */

/**
 * RFC 9457 problem document — every 4xx and 5xx on this API.
 *
 * Nothing parses a response through this at runtime: `describeApiError` in
 * `errors.ts` reads `detail` by hand, because a failure to read a failure must
 * never become a second failure. It earns its place as a *contract* entry —
 * `contract.test.ts` checks it against the 409/503 responses, so the day the
 * server stops sending `detail` the build says so instead of the UI quietly
 * falling back to generic copy.
 */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string().nullish(),
  request_id: z.string().nullish(),
});
export type Problem = z.infer<typeof ProblemSchema>;
