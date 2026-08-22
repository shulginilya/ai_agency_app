import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { closeSession, listSessions } from '@/api/sessions';
import { qk } from '@/query/keys';

/** Sessions come and go on their own (the idle reaper), so the list goes stale fast. */
export const DEFAULT_SESSION_POLL_MS = 10_000;

export type UseSessionsOptions = {
  enabled?: boolean;
  pollIntervalMs?: number | false;
};

/**
 * Every session this *process* is holding open — an operational view, not a
 * user's history. With `uvicorn --workers N` each worker knows only its own, so
 * a shrinking list is not proof that anything was closed.
 *
 * It belongs on the control plane for that reason: it answers "what is this box
 * holding", which is the same question the probes answer.
 */
export function useSessions({ enabled = true, pollIntervalMs = DEFAULT_SESSION_POLL_MS }: UseSessionsOptions = {}) {
  return useQuery({
    queryKey: qk.sessions(),
    queryFn: ({ signal }) => listSessions({ signal }),
    enabled,
    refetchInterval: pollIntervalMs === false ? false : pollIntervalMs,
    refetchIntervalInBackground: false,
  });
}

/**
 * Closing someone else's session from the control plane — the janitorial case,
 * for a handle whose owner has gone away. A 409 means a turn is still running:
 * the server refuses rather than tearing the client out mid-turn, and waiting is
 * the right answer.
 */
export function useCloseSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => closeSession(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.sessions() }),
  });
}
