import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { isAwaitingReply, listMessages, sendMessage, sortByTime } from '@/api/messages';
import type { Message } from '@/api/schemas';
import { qk } from '@/query/keys';

/** Fast enough to feel live, slow enough not to hammer a local FastAPI. */
export const DEFAULT_REPLY_POLL_MS = 1_500;

/** After this long with no answer we stop polling and say so, rather than spin forever. */
export const DEFAULT_REPLY_TIMEOUT_MS = 60_000;

export type UseMessagesOptions = {
  enabled?: boolean;
  pollIntervalMs?: number;
  replyTimeoutMs?: number;
};

export type UseMessagesResult = {
  messages: Message[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  /** A reply is outstanding and we are still polling for it. */
  isAwaitingReply: boolean;
  /** We gave up waiting. The agent may still be working; the user can re-check. */
  replyTimedOut: boolean;
  refresh: () => Promise<void>;
};

/**
 * The thread, kept current.
 *
 * Polling is conditional on purpose: an idle thread costs nothing, and the loop
 * only spins while an answer is actually outstanding. `refetchInterval` returning
 * `false` is React Query's way of saying "stop", so there is no timer to clean up.
 */
export function useMessages(
  agentId: string,
  { enabled = true, pollIntervalMs = DEFAULT_REPLY_POLL_MS, replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS }: UseMessagesOptions = {},
): UseMessagesResult {
  const queryClient = useQueryClient();
  const [timedOut, setTimedOut] = useState(false);

  const query = useQuery({
    queryKey: qk.messages(agentId),
    queryFn: ({ signal }) => listMessages(agentId, { signal }),
    enabled: enabled && Boolean(agentId),
    select: sortByTime,
    // Never serve a cached thread as fresh: a reply may have landed a second ago.
    staleTime: 0,
    refetchInterval: (query) => {
      const messages = query.state.data;
      return messages && isAwaitingReply(messages) && !timedOut ? pollIntervalMs : false;
    },
    refetchIntervalInBackground: false,
  });

  const awaiting = query.data ? isAwaitingReply(query.data) : false;

  // Starts when the wait starts, cancelled the moment the reply lands.
  useEffect(() => {
    if (!awaiting) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), replyTimeoutMs);
    return () => clearTimeout(timer);
  }, [awaiting, replyTimeoutMs]);

  const refresh = useCallback(async () => {
    setTimedOut(false);
    await queryClient.invalidateQueries({ queryKey: qk.messages(agentId) });
  }, [queryClient, agentId]);

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    isAwaitingReply: awaiting && !timedOut,
    replyTimedOut: awaiting && timedOut,
    refresh,
  };
}

/** Local id for a message the server has not acknowledged yet. */
let optimisticCounter = 0;
export function optimisticMessage(agentId: string, content: string): Message {
  optimisticCounter += 1;
  return {
    id: `local_${optimisticCounter}`,
    agent_id: agentId,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
    pending: true,
  };
}

/**
 * Sending.
 *
 * The bubble appears the instant you hit send, before the network answers — a
 * chat that waits for a round trip to echo your own words feels broken. If the
 * send fails the optimistic bubble is rolled back rather than left lying about
 * having been delivered; the screen puts the text back in the composer so
 * nothing you typed is lost.
 */
export function useSendMessage(agentId: string) {
  const queryClient = useQueryClient();
  const key = qk.messages(agentId);

  return useMutation({
    mutationFn: (content: string) => sendMessage(agentId, content),
    onMutate: async (content: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Message[]>(key);
      queryClient.setQueryData<Message[]>(key, [...(previous ?? []), optimisticMessage(agentId, content)]);
      return { previous };
    },
    onError: (_error, _content, context) => {
      queryClient.setQueryData<Message[]>(key, context?.previous);
    },
    // Success or failure, the server's copy of the thread is the one that counts.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
