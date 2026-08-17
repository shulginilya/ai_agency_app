import { agentPath } from '@/api/agents';
import { apiClient } from '@/api/client';
import type { HttpClient } from '@/api/http';
import {
  MessageListResponseSchema,
  SendMessageResponseSchema,
  type Message,
  type MessageRole,
} from '@/api/schemas';

/**
 * Talking to an agent.
 *
 * The contract this expects (see docs/control-plane.md — the server does not
 * implement it yet, the mock in tools/mock-agent-api.mjs does):
 *
 *   GET  /v1/agents/{id}/messages?after=<message id>&limit=<n>
 *        -> [Message]  or  { "messages": [Message] }
 *   POST /v1/agents/{id}/messages   { "content": "…" }
 *        -> 202  Message  or  { "message": Message }
 *
 * The POST answers with the *user's* message, accepted — not with the reply. The
 * reply shows up in a later GET. That is what makes the round trip pollable
 * without any streaming machinery, and it is the shape a queue-backed agent
 * wants anyway: accepting work and finishing work are different moments.
 */
export type MessagesApiOptions = {
  client?: HttpClient;
  signal?: AbortSignal;
};

export type ListMessagesOptions = MessagesApiOptions & {
  /** Only messages newer than this id. The server may ignore it and send all. */
  after?: string;
  limit?: number;
};

export async function listMessages(
  agentId: string,
  { client = apiClient, signal, after, limit }: ListMessagesOptions = {},
): Promise<Message[]> {
  const { data } = await client.get(agentPath(agentId, 'messages'), {
    schema: MessageListResponseSchema,
    query: { after, limit },
    signal,
  });
  return data;
}

/** A POST, so `HttpClient` will not replay it — sending twice is worse than failing. */
export async function sendMessage(
  agentId: string,
  content: string,
  { client = apiClient, signal }: MessagesApiOptions = {},
): Promise<Message> {
  const { data } = await client.post(
    agentPath(agentId, 'messages'),
    { content },
    { schema: SendMessageResponseSchema, signal },
  );
  return data;
}

/**
 * Whether the thread is still owed an answer — the one thing the polling loop
 * needs to decide, kept pure so it can be tested without a hook or a timer.
 *
 * Two ways to be waiting: the server flagged a message as still being produced,
 * or the last thing in the thread is something you said and nothing has answered
 * it. The second case is what covers a server that does not bother with `pending`.
 */
export function isAwaitingReply(messages: readonly Message[]): boolean {
  if (messages.some((message) => message.pending)) return true;
  const last = messages[messages.length - 1];
  return last?.role === 'user';
}

/** Oldest first. The server is not required to sort, and two clients may disagree. */
export function sortByTime(messages: readonly Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
    return delta !== 0 && !Number.isNaN(delta) ? delta : a.id.localeCompare(b.id);
  });
}

export type { Message, MessageRole };
