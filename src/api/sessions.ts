import { apiClient } from '@/api/client';
import type { HttpClient } from '@/api/http';
import { DEFAULT_RUN_TIMEOUT_MS } from '@/api/runs';
import {
  MessageResponseSchema,
  SessionInfoSchema,
  SessionsResponseSchema,
  type MessageResponse,
  type RunProfile,
  type SessionInfo,
} from '@/api/schemas';

/**
 * Conversations.
 *
 * A session is a live subprocess the server holds for you, so this module is the
 * one place in the client with a resource to clean up. Three consequences worth
 * knowing before you call anything here:
 *
 * - `profile` and `team` are fixed at open time. Sending either on a turn is a
 *   422, not a silent no-op, because they were baked into the options the
 *   session connected with. To change them, open a new session.
 * - a session takes one turn at a time. A second message while one is in flight
 *   is a 409, not a queued turn — the caller decides whether to wait or drop it.
 * - the transcript is not stored. `SessionInfo` is status, turn count and
 *   expiry; the conversation itself is the client's to keep.
 *
 * A turn also takes a run slot, the same pool `POST /v1/runs` draws from, so a
 * 503 here means the server is busy rather than the session being wrong.
 */
export const SESSIONS_PATH = '/v1/sessions';

/** `/v1/sessions/{id}` plus any trailing segments, with the id escaped. */
export function sessionPath(id: string, ...segments: string[]): string {
  return [SESSIONS_PATH, encodeURIComponent(id), ...segments].join('/');
}

export type SessionsApiOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OpenSessionInput = {
  /** Pin the profile for the session's whole life. Omit for the server's own. */
  profile?: RunProfile | null;
  /**
   * Name of a team to open the session as, e.g. `engineering`. Omit or null for
   * the solo agent. Fixed for the session's whole life — `MessageRequest`
   * forbids `team`, so switching means closing this one and opening another.
   */
  team?: string | null;
};

/** 201, and you now own a subprocess. Close it, or let `expires_at` collect it. */
export async function openSession(
  { profile, team }: OpenSessionInput = {},
  { client = apiClient, signal, timeoutMs }: SessionsApiOptions = {},
): Promise<SessionInfo> {
  // `extra="forbid"`: only send what the caller actually chose.
  const body: Record<string, unknown> = {};
  if (profile) body.profile = profile;
  // Solo is spelled by omitting the key, same as `profile`. See `createRun`.
  if (team) body.team = team;

  const { data } = await client.post(SESSIONS_PATH, body, {
    schema: SessionInfoSchema,
    signal,
    timeoutMs,
  });
  return data;
}

/**
 * What this process is holding open, oldest first.
 *
 * Per-process, like an agent's status: with `uvicorn --workers N` each worker
 * lists only its own. It is an operational view — "what is this box holding" —
 * not a user's conversation history, which is why the control plane is where it
 * belongs rather than the chat screen.
 */
export async function listSessions({ client = apiClient, signal }: SessionsApiOptions = {}): Promise<SessionInfo[]> {
  const { data } = await client.get(SESSIONS_PATH, { schema: SessionsResponseSchema, signal });
  return data;
}

export async function getSession(
  id: string,
  { client = apiClient, signal }: SessionsApiOptions = {},
): Promise<SessionInfo> {
  const { data } = await client.get(sessionPath(id), { schema: SessionInfoSchema, signal });
  return data;
}

/**
 * Releases the subprocess. 204, no body.
 *
 * `retries: 0` even though DELETE is nominally idempotent: a close that
 * succeeded but whose response was lost would be retried into a 404, and the
 * app would report a failure for something that worked. A 409 (a turn is still
 * in flight) is the honest case to surface — wait for the turn, then close.
 *
 * `keepalive: true` because the call that matters most is the one fired while
 * the page is going away (`pagehide`, or a tab hidden for good): without it the
 * browser cancels the request with the document and the subprocess is left for
 * `expires_at` to collect.
 */
export async function closeSession(
  id: string,
  { client = apiClient, signal }: SessionsApiOptions = {},
): Promise<void> {
  await client.delete(sessionPath(id), {
    responseType: 'none',
    retries: 0,
    keepalive: true,
    signal,
  });
}

/**
 * One turn. Holds the connection open until the agent is done, like a run.
 *
 * A 502 or 504 here also means the session is gone: the server closes it on the
 * way out, because a cancelled drain leaves the SDK client in an indeterminate
 * state. Retrying the same session id after either is the obvious and wrong move
 * — open a new one.
 */
export async function sendSessionMessage(
  id: string,
  prompt: string,
  { client = apiClient, signal, timeoutMs = DEFAULT_RUN_TIMEOUT_MS }: SessionsApiOptions = {},
): Promise<MessageResponse> {
  const { data } = await client.post(
    sessionPath(id, 'messages'),
    { prompt },
    { schema: MessageResponseSchema, signal, timeoutMs },
  );
  return data;
}

/** A 502/504 on a turn, or a 404 on any call: the handle is dead, not busy. */
export function sessionIsGone(status: number | undefined): boolean {
  return status === 404 || status === 502 || status === 504;
}

export type { MessageResponse, SessionInfo };
