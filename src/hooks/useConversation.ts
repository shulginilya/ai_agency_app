import { useMutation, useQueryClient, type UseMutateFunction } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@/api/errors';
import { createRun } from '@/api/runs';
import { closeSession, openSession, sendSessionMessage, sessionIsGone } from '@/api/sessions';
import type { RunProfile, RunResponse, SessionInfo } from '@/api/schemas';
import {
  agentEntry,
  drop,
  settle,
  systemEntry,
  userEntry,
  type TranscriptEntry,
} from '@/chat/transcript';
import { qk } from '@/query/keys';

/**
 * Talking to the server.
 *
 * Two ways to do it, and the difference is worth exposing rather than hiding:
 *
 * - `run` — `POST /v1/runs`. One prompt, one answer, no memory. Nothing to
 *   clean up, nothing to expire.
 * - `session` — `POST /v1/sessions` once, then a turn per message. The agent
 *   remembers the conversation, and you own a subprocess until you close it.
 *
 * The transcript is the client's, in both modes (see `src/chat/transcript.ts`).
 * Sending is a single request that returns the finished reply, so "waiting" is
 * just the request being in flight — there is no polling loop here, and the
 * optimistic bubble is rolled back if the send never lands.
 *
 * The session is held in a ref as well as in state: `send` reads it inside an
 * async mutation, where a stale closure would silently open a second session.
 */
export type ConversationMode = 'session' | 'run';

export type UseConversationOptions = {
  mode?: ConversationMode;
  /** Fixed at open time for a session; per-call for a run. */
  profile?: RunProfile | null;
  /**
   * Name of the team to run as, or null for the solo agent. Fixed at open time
   * for a session — changing it here closes the open one, see `mutationFn`.
   */
  team?: string | null;
  now?: () => Date;
};

export type SendResult = {
  run: RunResponse;
  /** 1-based turn index, on a session turn. Absent for a one-shot run. */
  turn?: number;
};

export type UseConversationResult = {
  entries: TranscriptEntry[];
  session: SessionInfo | null;
  /**
   * The mutation's own `mutate`, options and all: the screen passes an
   * `onError` so it can put the text back in the composer, which a narrower
   * `(prompt: string) => void` would have quietly forbidden.
   */
  send: UseMutateFunction<SendResult, unknown, string, { entry: TranscriptEntry }>;
  close: UseMutateFunction<void, unknown, void, unknown>;
  clear: () => void;
  isSending: boolean;
  isClosing: boolean;
  /** The last send failure, already turned into something printable. */
  sendError: unknown;
  closeError: unknown;
};

export function useConversation({
  mode = 'session',
  profile = null,
  team = null,
  now = () => new Date(),
}: UseConversationOptions = {}): UseConversationResult {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  /**
   * What we *asked* for when the open session was opened — deliberately not
   * what the server echoed back. Comparing against the echo would make a server
   * that ignores `team` (or renames it) look like a change on every send, and
   * the guard below would close and reopen a session per message forever.
   */
  const openedWith = useRef<{ team: string | null; profile: RunProfile | null }>({ team: null, profile: null });

  const holdSession = useCallback((next: SessionInfo | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const append = useCallback((entry: TranscriptEntry) => {
    setEntries((current) => [...current, entry]);
  }, []);

  const send = useMutation<SendResult, unknown, string, { entry: TranscriptEntry }>({
    onMutate: (prompt) => {
      const entry = userEntry(prompt, now);
      append(entry);
      return { entry };
    },
    mutationFn: async (prompt) => {
      if (mode === 'run') {
        const run = await createRun({ prompt, profile, team });
        return { run };
      }

      let active = sessionRef.current;

      // Team and profile are baked into the options a session connected with,
      // and `MessageRequest` forbids both — a turn cannot carry new ones. So a
      // session opened as another team is not reusable: hand the subprocess
      // back and open a fresh one, rather than sending this prompt to whoever
      // happens to be on the other end.
      //
      // The screen closes the session itself when you pick a different team;
      // this is the backstop that makes the hook honest no matter what drives
      // it. A null `profile` means "the server's own", which matches whatever
      // the session already has.
      const opened = openedWith.current;
      if (active && (opened.team !== team || (profile !== null && opened.profile !== profile))) {
        const stale = active;
        active = null;
        holdSession(null);
        // Nobody is waiting on this: the prompt in hand is what matters, and
        // the session expires server-side regardless.
        void closeSession(stale.id).catch(() => {});
        append(
          systemEntry(
            `Switched to ${team ?? 'the solo agent'} — the previous session was closed.`,
            now,
          ),
        );
      }

      // Lazily: the session is opened by the first message, so choosing a
      // profile costs nothing until you actually say something.
      if (!active) {
        active = await openSession({ profile, team });
        openedWith.current = { team, profile };
        holdSession(active);
        void queryClient.invalidateQueries({ queryKey: qk.sessions() });
        append(
          systemEntry(
            // The server's echo, not what we sent: if it ignored the team, the
            // transcript should say so rather than repeat our own request back.
            `Session opened · profile ${active.profile} · ${active.team ?? 'solo'}`,
            now,
          ),
        );
      }

      const response = await sendSessionMessage(active.id, prompt);
      // The turn count and idle clock moved; the server would tell us the same
      // thing for the price of a second round trip per message.
      holdSession({
        ...active,
        status: 'idle',
        turns: response.turn,
        last_active_at: now().toISOString(),
      });
      return { run: response.run, turn: response.turn };
    },
    onSuccess: (result, _prompt, context) => {
      setEntries((current) => [
        ...(context ? settle(current, context.entry.id) : current),
        agentEntry(result.run, { turn: result.turn, now }),
      ]);
      void queryClient.invalidateQueries({ queryKey: qk.sessions() });
    },
    onError: (error, _prompt, context) => {
      // Nothing typed should be left looking delivered. The screen puts the text
      // back in the composer.
      if (context) setEntries((current) => drop(current, context.entry.id));

      // 404 / 502 / 504 on a turn all mean the handle is dead, not busy: the
      // server closes the session on the way out of a failed drain. Retrying the
      // same id would be the obvious and wrong next move.
      if (isApiError(error) && sessionIsGone(error.status) && sessionRef.current) {
        holdSession(null);
        append(systemEntry('The server closed this session. The next message opens a new one.', now));
        void queryClient.invalidateQueries({ queryKey: qk.sessions() });
      }
    },
  });

  const close = useMutation<void, unknown, void>({
    mutationFn: async () => {
      const active = sessionRef.current;
      if (!active) return;
      await closeSession(active.id);
    },
    onSuccess: () => {
      if (sessionRef.current) append(systemEntry('Session closed.', now));
      holdSession(null);
      void queryClient.invalidateQueries({ queryKey: qk.sessions() });
    },
    onError: (error) => {
      // A 404 means someone else already closed it — the handle is gone either
      // way, which is what the caller wanted. A 409 is not: a turn is still in
      // flight, and the session is still ours.
      if (isApiError(error) && error.status === 404) {
        holdSession(null);
        void queryClient.invalidateQueries({ queryKey: qk.sessions() });
      }
    },
  });

  /**
   * The browser's last chance to hand the subprocess back.
   *
   * `pagehide` covers navigation, reload and tab close; `visibilitychange`
   * covers the mobile case, where a backgrounded tab is often discarded without
   * ever firing `pagehide`. Both are web-only, hence the `document` guard —
   * on native there is no page to hide.
   *
   * This deliberately skips the `close` mutation and calls the endpoint
   * directly: nothing is left to observe the result once the document is going
   * away, and `closeSession` sends the DELETE with `keepalive` so the request
   * survives the teardown. The handle is dropped locally either way, so a tab
   * that does come back opens a fresh session on its next message rather than
   * spending one on a 404.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const closeActiveSession = () => {
      const active = sessionRef.current;
      if (!active) return;
      holdSession(null);
      // There is no one left to surface a failure to; the session expires
      // server-side regardless.
      void closeSession(active.id).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: qk.sessions() });
    };

    const onPageHide = () => closeActiveSession();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') closeActiveSession();
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [holdSession, queryClient]);

  const clear = useCallback(() => setEntries([]), []);

  return {
    entries,
    session,
    send: send.mutate,
    close: close.mutate,
    clear,
    isSending: send.isPending,
    isClosing: close.isPending,
    sendError: send.error,
    closeError: close.error,
  };
}
