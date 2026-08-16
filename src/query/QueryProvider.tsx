import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { createQueryClient } from '@/query/client';

/**
 * React Query's `refetchOnWindowFocus` is a browser concept. On native the
 * equivalent signal is AppState, so we forward it — without this, coming back
 * from the background shows stale agent status.
 */
function useAppStateFocus() {
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client for the app's lifetime; a new one per render would drop the cache.
  const clientRef = useRef(createQueryClient());
  useAppStateFocus();
  return <QueryClientProvider client={clientRef.current}>{children}</QueryClientProvider>;
}
