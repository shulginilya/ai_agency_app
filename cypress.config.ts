import { defineConfig } from 'cypress';

/**
 * End-to-end config for the Expo *web* build (react-native-web), which is where
 * the control screen can be driven in a real browser. `testID` props come out as
 * `data-testid` attributes, so the same selectors work in Jest and here.
 */
export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://localhost:8081',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: false,
    video: false,
    screenshotOnRunFailure: true,
    viewportWidth: 1280,
    viewportHeight: 900,
    // Metro's dev bundle is big; the first visit pays for it once.
    defaultCommandTimeout: 15_000,
    pageLoadTimeout: 120_000,
    retries: { runMode: 2, openMode: 0 },
    env: {
      apiUrl: process.env.CYPRESS_API_URL ?? 'http://localhost:8000',
    },
  },
});
