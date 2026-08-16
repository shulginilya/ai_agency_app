import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { DEFAULT_POLL_INTERVAL_MS } from '@/api/config';
import { PROBE_NAMES, runProbe, summarize, type ProbeName, type ProbeResult, type SystemStatus } from '@/api/system';
import { qk } from '@/query/keys';

export type UseSystemStatusOptions = {
  /** Set to false to stop polling (the screen's auto-refresh switch). */
  autoRefresh?: boolean;
  intervalMs?: number;
};

export type UseSystemStatusResult = {
  status: SystemStatus;
  probes: ProbeResult[];
  byName: Partial<Record<ProbeName, ProbeResult>>;
  isFetching: boolean;
  /** First load, before any probe has answered. */
  isInitialLoading: boolean;
  lastCheckedAt?: number;
  refresh: () => Promise<void>;
};

/**
 * Drives the control screen: runs every probe in parallel, polls while the
 * screen is focused, and folds the results into one headline status.
 */
export function useSystemStatus({
  autoRefresh = true,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseSystemStatusOptions = {}): UseSystemStatusResult {
  const queryClient = useQueryClient();

  const queries = useQueries({
    queries: PROBE_NAMES.map((name) => ({
      queryKey: qk.probe(name),
      queryFn: ({ signal }: { signal: AbortSignal }) => runProbe(name, { signal }),
      refetchInterval: autoRefresh ? intervalMs : (false as const),
      refetchIntervalInBackground: false,
      // `runProbe` reports "down" as data, so a throw here means cancellation.
      retry: false,
      staleTime: 0,
    })),
  });

  const probes = useMemo(
    () => queries.map((query) => query.data).filter((data): data is ProbeResult => data !== undefined),
    [queries],
  );

  const byName = useMemo(
    () => Object.fromEntries(probes.map((probe) => [probe.name, probe])) as Partial<Record<ProbeName, ProbeResult>>,
    [probes],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.probes() });
  }, [queryClient]);

  return {
    status: summarize(probes),
    probes,
    byName,
    isFetching: queries.some((query) => query.isFetching),
    isInitialLoading: probes.length === 0 && queries.some((query) => query.isLoading),
    lastCheckedAt: probes.length ? Math.max(...probes.map((probe) => probe.checkedAt)) : undefined,
    refresh,
  };
}
