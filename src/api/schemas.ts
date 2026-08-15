import { z } from 'zod';

/**
 * Runtime contracts for the control API.
 *
 * Two different strictness levels on purpose:
 *
 * - Probe endpoints (`/healthz`, `/readyz`) follow the Kubernetes convention:
 *   the HTTP status *is* the answer, the body is a bonus. So the schema is
 *   permissive — unknown keys are kept, an empty body is legal — and we only
 *   type the fields we actually render.
 * - Everything else is strict. If the server changes shape, the app fails loudly
 *   with a `validation` ApiError instead of rendering `undefined` somewhere.
 */
export const ProbeBodySchema = z
  .looseObject({
    status: z.string().optional(),
    version: z.string().optional(),
    uptime_seconds: z.number().optional(),
    detail: z.string().optional(),
    checks: z.record(z.string(), z.unknown()).optional(),
  })
  .nullish();

export type ProbeBody = z.infer<typeof ProbeBodySchema>;

export const AGENT_STATUSES = ['idle', 'starting', 'running', 'paused', 'error', 'stopped'] as const;
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: AgentStatusSchema,
  /** ISO-8601. Optional so the first version of the endpoint can omit it. */
  updated_at: z.string().optional(),
  description: z.string().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** Unwraps `{"agents": [...]}` so both that and a bare `[...]` validate identically. */
export function unwrapAgentList(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'agents' in value) {
    return (value as { agents: unknown }).agents;
  }
  return value;
}

/**
 * Accepts both `[...]` and `{"agents": [...]}` because the endpoint does not
 * exist yet — whichever you settle on, the app already reads it. Narrow this to
 * the real shape once `/agents` ships.
 *
 * Unwrapping before validating (rather than a union of both shapes) keeps the
 * error messages pointed at the offending field, e.g. `0.status`, instead of a
 * useless top-level "invalid input".
 */
export const AgentListResponseSchema = z.preprocess(unwrapAgentList, z.array(AgentSchema));
