import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the agent control API lives.
 *
 * Precedence:
 *  1. `EXPO_PUBLIC_API_URL` — always wins. Set it in `.env` (see `.env.example`).
 *  2. The Metro host, when the app runs on a physical device via Expo Go/dev client.
 *     `localhost` on a phone is the phone itself, so we reuse the LAN IP that Metro
 *     is already serving from and swap in the API port.
 *  3. A platform default: the Android emulator reaches the host machine through the
 *     10.0.2.2 alias; simulators and web can use localhost directly.
 */
export const DEFAULT_API_PORT = 8000;

/** Hard ceiling for a single HTTP attempt. Probes should fail fast, not hang a screen. */
export const DEFAULT_TIMEOUT_MS = 8_000;

/** How often the control screen re-runs the probes while it is on screen. */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

export type ResolveBaseUrlInput = {
  /** Raw value of EXPO_PUBLIC_API_URL. */
  envUrl?: string | null;
  /** e.g. `192.168.1.24:8081` — Metro's host as reported by expo-constants. */
  hostUri?: string | null;
  platform?: typeof Platform.OS;
  port?: number;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/** Strip a trailing slash so callers can always join with a leading-slash path. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Pure so it can be unit-tested across every platform/host combination. */
export function resolveBaseUrl({
  envUrl,
  hostUri,
  platform = Platform.OS,
  port = DEFAULT_API_PORT,
}: ResolveBaseUrlInput = {}): string {
  if (envUrl && envUrl.trim()) return normalizeBaseUrl(envUrl);

  const host = hostUri?.split('/')[0]?.split(':')[0]?.trim();
  if (host && !LOOPBACK_HOSTS.has(host.toLowerCase())) {
    return `http://${host}:${port}`;
  }

  if (platform === 'android') return `http://10.0.2.2:${port}`;
  return `http://localhost:${port}`;
}

function metroHostUri(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null;
  return config?.hostUri ?? null;
}

/**
 * Resolved once at module load: the base URL cannot change without a reload
 * anyway, and keeping it constant makes React Query cache keys stable.
 */
export const API_BASE_URL = resolveBaseUrl({
  envUrl: process.env.EXPO_PUBLIC_API_URL,
  hostUri: metroHostUri(),
});

/** Optional bearer token for when the control API stops being wide open. */
export const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? null;
