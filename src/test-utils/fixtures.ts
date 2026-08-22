import type { AgentInfo, MessageResponse, RunResponse, SessionInfo } from '@/api/schemas';

/**
 * Wire-shaped fixtures: every field the spec marks required, and nothing the
 * spec does not have.
 *
 * Built as factories rather than shared constants so a test can never mutate
 * another test's data, and typed as the real schema types so a change in
 * `schemas.ts` breaks these at compile time instead of at assertion time.
 */
export function agentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'researcher',
    name: 'researcher',
    status: 'idle',
    description: 'Pulls together background before anyone writes code.',
    availability: 'always',
    updated_at: '2026-08-21T09:00:00.000Z',
    model: 'sonnet',
    tools: ['Read', 'Grep'],
    max_turns: 12,
    invocations: 3,
    ...overrides,
  };
}

export function runResponse(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    run_id: 'run_1',
    profile: 'dev',
    model: 'claude-sonnet-4-6',
    is_error: false,
    output: 'Four leads, ranked.',
    num_turns: 2,
    duration_ms: 4200,
    total_cost_usd: 0.0042,
    usage: { input_tokens: 1200, output_tokens: 340 },
    tools_used: ['Read'],
    delegated_to: [],
    tool_events: [{ tool: 'Read', phase: 'post', at: '2026-08-21T09:00:01.000Z' }],
    summary: 'Ranked the leads.',
    ...overrides,
  };
}

export function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess_1',
    profile: 'dev',
    team: false,
    status: 'idle',
    turns: 0,
    created_at: '2026-08-21T09:00:00.000Z',
    last_active_at: '2026-08-21T09:00:00.000Z',
    expires_at: '2026-08-21T09:15:00.000Z',
    ...overrides,
  };
}

export function messageResponse(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    session_id: 'sess_1',
    turn: 1,
    run: runResponse(),
    ...overrides,
  };
}
