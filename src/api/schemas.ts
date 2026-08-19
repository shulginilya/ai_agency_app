import { z } from 'zod';

/**
 * Runtime contracts for the control API.
 *
 * Two different strictness levels on purpose:
 *
 * - Probe endpoints (anything in `PROBES`, e.g. `/healthz`, `/readyz`) only care
 *   about the HTTP status — that *is* the answer, the body is a bonus the UI
 *   renders raw. `PROBES` is meant to grow to any route worth a reachability
 *   check, not just `/healthz`-shaped ones, so the body can be an object, a
 *   list, or nothing at all. The schema is maximally permissive to match: it
 *   accepts anything.
 * - Everything else is strict. If the server changes shape, the app fails loudly
 *   with a `validation` ApiError instead of rendering `undefined` somewhere.
 */
export const ProbeBodySchema = z.unknown().nullish();

export type ProbeBody = z.infer<typeof ProbeBodySchema>;

export const AGENT_STATUSES = ['idle', 'starting', 'running', 'paused', 'error', 'stopped'] as const;
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: AgentStatusSchema,
  /**
   * ISO-8601. Optional so the first version of the endpoint can omit it.
   *
   * `.nullish()` rather than `.optional()`: a Pydantic `str | None = None`
   * serialises as `"updated_at": null` instead of leaving the key out, so a
   * field that is merely *absent* in our heads arrives as an explicit null on
   * the wire. Accepting both spellings of "no value" costs nothing here, and
   * only one of them is in our gift. `src/api/contract.ts` fails the build if
   * the server starts nulling a field we only made optional.
   */
  updated_at: z.string().nullish(),
  description: z.string().nullish(),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * Unwraps `{"<key>": …}` so an envelope and a bare payload validate identically.
 * Every collection endpoint on this API is allowed to use either shape.
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
 * Accepts both `[...]` and `{"agents": [...]}` because `GET /v1/agents` is not
 * pinned to one of them yet — whichever you settle on, the app already reads it.
 * Narrow this once the shape is fixed.
 *
 * Unwrapping before validating (rather than a union of both shapes) keeps the
 * error messages pointed at the offending field, e.g. `0.status`, instead of a
 * useless top-level "invalid input".
 */
export const AgentListResponseSchema = z.preprocess(unwrapAgentList, z.array(AgentSchema));

/* ---------------------------------------------------------------- messages */

/**
 * `user` is you, typing into the composer. `agent` is the reply. `system` is the
 * control plane narrating itself — "agent paused", "run failed" — so operational
 * events can share the thread instead of needing a second surface.
 */
export const MESSAGE_ROLES = ['user', 'agent', 'system'] as const;
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  agent_id: z.string().min(1),
  role: MessageRoleSchema,
  content: z.string(),
  /** ISO-8601. Required — the thread is ordered by it, so it is not optional. */
  created_at: z.string().min(1),
  /**
   * Set by the server on a message it has accepted but not finished producing.
   * The client polls while any message carries it. `.nullish()` for the same
   * reason as `Agent.updated_at` — `bool | None = None` puts a null on the wire.
   */
  pending: z.boolean().nullish(),
});
export type Message = z.infer<typeof MessageSchema>;

export const unwrapMessageList = unwrapEnvelope('messages');
export const unwrapMessage = unwrapEnvelope('message');

/** Accepts `[...]` and `{"messages": [...]}`, same deal as the agent list. */
export const MessageListResponseSchema = z.preprocess(unwrapMessageList, z.array(MessageSchema));

/** `POST /v1/agents/{id}/messages` answers with the accepted message, enveloped or not. */
export const SendMessageResponseSchema = z.preprocess(unwrapMessage, MessageSchema);
