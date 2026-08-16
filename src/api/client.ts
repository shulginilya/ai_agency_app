import { API_BASE_URL, API_TOKEN } from '@/api/config';
import { HttpClient, type TokenProvider } from '@/api/http';
import { requestLog } from '@/api/log';

/**
 * Auth is pluggable from day one. Today it reads an optional env token; when the
 * control API grows real auth, call `setAuthTokenProvider` once at startup with
 * something backed by SecureStore and nothing else in the app has to change.
 */
let tokenProvider: TokenProvider = () => API_TOKEN;

export function setAuthTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/** The app-wide client. Tests build their own with `new HttpClient(...)`. */
export const apiClient = new HttpClient({
  baseUrl: API_BASE_URL,
  getAuthToken: () => tokenProvider(),
  onLog: requestLog.push,
});
