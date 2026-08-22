import type { RunResponse } from '@/api/schemas';

/**
 * The conversation, client-side.
 *
 * The server does not keep one. `SessionInfo` is a handle — status, turn count,
 * expiry — and each turn is persisted as its own run record, so there is no
 * `GET /v1/sessions/{id}/messages` to poll and nothing to reconcile against.
 * Whatever the screen shows as a thread, the screen owns.
 *
 * That is a smaller job than it sounds, and a much simpler one than the polling
 * loop this replaced: a turn is a single request that returns the finished
 * reply, so there is no accept-then-poll dance, no `pending` flag arriving from
 * the wire, and no way for two clients to disagree about the order. The only
 * optimistic state is the user's own line, held for as long as the request is in
 * flight.
 *
 * Everything here is pure so it can be tested without a hook, a timer or a
 * network double.
 */

export const TRANSCRIPT_ROLES = ['user', 'agent', 'system'] as const;
export type TranscriptRole = (typeof TRANSCRIPT_ROLES)[number];

export type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  content: string;
  /** ISO-8601. Local clock — these are the client's own records. */
  created_at: string;
  /** The user's line, while its request is still in flight. */
  pending?: boolean;
  /** The agent said it failed: `is_error` on a 200, not a transport failure. */
  failed?: boolean;
  /** The run behind an agent line — cost, tools, delegation, the lot. */
  run?: RunResponse;
  /** 1-based turn index within a session. Absent for a one-shot run. */
  turn?: number;
};

let counter = 0;

/** Local ids only: nothing here is ever sent to the server or matched against it. */
export function nextEntryId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function userEntry(content: string, now: () => Date = () => new Date()): TranscriptEntry {
  return {
    id: nextEntryId('user'),
    role: 'user',
    content,
    created_at: now().toISOString(),
    pending: true,
  };
}

/**
 * The reply. `output` is null on a run that produced no final text — an error
 * run usually does — so the summary is the fallback rather than an empty bubble.
 */
export function agentEntry(
  run: RunResponse,
  { turn, now = () => new Date() }: { turn?: number; now?: () => Date } = {},
): TranscriptEntry {
  const content = run.output?.trim() || run.summary?.trim() || 'The run finished without producing any output.';
  return {
    id: nextEntryId('agent'),
    role: 'agent',
    content,
    created_at: now().toISOString(),
    failed: run.is_error,
    run,
    turn,
  };
}

/** The control plane narrating itself: session opened, session closed, run refused. */
export function systemEntry(content: string, now: () => Date = () => new Date()): TranscriptEntry {
  return { id: nextEntryId('system'), role: 'system', content, created_at: now().toISOString() };
}

/** Clears the in-flight flag on one entry, leaving the rest untouched. */
export function settle(entries: readonly TranscriptEntry[], id: string): TranscriptEntry[] {
  return entries.map((entry) => (entry.id === id ? { ...entry, pending: false } : entry));
}

/** Rollback for a send that never reached the server. The screen puts the text back. */
export function drop(entries: readonly TranscriptEntry[], id: string): TranscriptEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** True while any line is still waiting on a request. */
export function isAwaitingReply(entries: readonly TranscriptEntry[]): boolean {
  return entries.some((entry) => entry.pending);
}

/* ------------------------------------------------------------- formatting */

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/**
 * Sub-cent runs are the common case and `$0.00` reads as free, which is a lie
 * that compounds. Four decimals until it is worth rounding.
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (usd === 0) return '$0';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** The one-line "what did that cost me" under an agent bubble. */
export function runHeadline(run: RunResponse): string {
  const parts = [
    `${run.num_turns} turn${run.num_turns === 1 ? '' : 's'}`,
    formatDuration(run.duration_ms),
    formatCost(run.total_cost_usd),
    run.model,
  ];
  if (run.delegated_to.length > 0) parts.push(`→ ${run.delegated_to.join(', ')}`);
  return parts.join(' · ');
}

/** Tools the run actually touched, deduped, in the order they were first used. */
export function toolsUsed(run: RunResponse): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const tool of [...run.tools_used, ...run.tool_events.map((event) => event.tool)]) {
    if (seen.has(tool)) continue;
    seen.add(tool);
    ordered.push(tool);
  }
  return ordered;
}

/** Guardrail denials and tool failures — the part of the trace worth surfacing. */
export function blockedEvents(run: RunResponse) {
  return run.tool_events.filter((event) => event.phase === 'blocked' || event.phase === 'failed');
}
