/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/.expo/', '/dist/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.tsx',
    '!src/test-utils/**',
    '!**/__tests__/**',
    // Pre-existing scaffolding (the tasks + product feed demo) is out of scope for
    // this proof of concept. Delete these lines as they get tests of their own.
    '!src/api/products.ts',
    '!src/hooks/useProducts.ts',
    '!src/hooks/useTasks.ts',
    '!src/storage/tasks.ts',
    '!src/components/{ProductCard,TaskItem,EmptyState}.tsx',
    '!app/(tabs)/{index,feed}.tsx',
    '!app/+not-found.tsx',
    // Router layouts are framework wiring, exercised by the e2e run instead.
    '!app/**/_layout.tsx',
  ],
  coverageThreshold: {
    global: { statements: 85, branches: 80, functions: 80, lines: 85 },
    './src/api/http.ts': { statements: 95, branches: 85, functions: 95, lines: 95 },
    './src/api/system.ts': { statements: 95, branches: 85, functions: 100, lines: 95 },
  },
};
