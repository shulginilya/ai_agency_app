import { useSyncExternalStore } from 'react';
import { requestLog, type RequestLogEntry } from '@/api/log';

/** Subscribes the UI to the client's request log without any global state library. */
export function useRequestLog(): readonly RequestLogEntry[] {
  return useSyncExternalStore(requestLog.subscribe, requestLog.getSnapshot, requestLog.getSnapshot);
}
