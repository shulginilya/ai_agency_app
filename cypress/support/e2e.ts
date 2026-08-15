import './commands';

/**
 * React Native Web occasionally throws ResizeObserver noise during layout; it is
 * not a product failure, so it must not fail a spec. Everything else still does.
 */
Cypress.on('uncaught:exception', (error) => !/ResizeObserver loop/.test(error.message));

// Every spec starts from a known API state.
beforeEach(() => {
  cy.resetApi();
});
