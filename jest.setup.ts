/**
 * Icons are decorative here and pull in the whole expo-font/asset chain, which
 * is slow to load and irrelevant to what these tests assert. Every icon renders
 * as its name instead.
 */
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = ({ name, ...props }: { name: string }) =>
    React.createElement(Text, { accessibilityRole: 'image', ...props }, name);
  return new Proxy({} as Record<string, unknown>, { get: () => Icon });
});

/**
 * Screens navigate, and tests render them without a router around them. Keeping
 * the navigation surface to `useRouter()` means this four-line double is enough,
 * and `router.push` being a spy lets a test assert where a tap would lead.
 */
jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
  return { router, useRouter: () => router, useLocalSearchParams: () => ({}), usePathname: () => '/' };
});

/**
 * Global test setup.
 *
 * Tests must never hit a real network: any test that forgets to stub `fetch`
 * fails loudly here instead of silently trying to reach localhost:8000.
 */
beforeEach(() => {
  globalThis.fetch = jest.fn(() => {
    throw new Error('Unexpected network call — stub fetch in the test.');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});
