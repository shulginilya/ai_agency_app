/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // `_to_delete/` holds files the device bridge could not `rm`; some are whole
  // test suites for code that no longer exists. Jest must not run them.
  testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/.expo/', '/dist/', '/_to_delete/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.tsx',
    '!src/test-utils/**',
    '!**/__tests__/**',
    '!app/+not-found.tsx',
    // Router layouts and route wrappers are framework wiring, exercised by the
    // e2e run instead. The screen a route mounts lives in src/ and is tested there.
    '!app/**/_layout.tsx',
    '!app/agent/**',
    // Same reason: `chat.tsx` mounts `src/screens/Conversation`, which is where
    // the tests are.
    '!app/(tabs)/chat.tsx',
    // TEMPORARY: dummy agents for looking at the screen before /v1/agents serves
    // anything. Goes away with src/api/fixtures/ — see docs/control-plane.md.
    '!src/api/fixtures/**',
  ],
  coverageThreshold: {
    global: { statements: 85, branches: 80, functions: 80, lines: 85 },
    './src/api/http.ts': { statements: 95, branches: 85, functions: 95, lines: 95 },
    './src/api/system.ts': { statements: 95, branches: 85, functions: 100, lines: 95 },
    './src/api/sessions.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
    './src/chat/transcript.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
  },
};
