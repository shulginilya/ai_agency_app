import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/errors';

/**
 * Retries live in `HttpClient` (they know about idempotency, backoff and error
 * kinds), so React Query only retries the few cases the transport cannot judge —
 * and never a 4xx, which will fail identically forever.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (isApiError(error) && !error.isRetryable) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}
