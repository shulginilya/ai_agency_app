export {};

type ApiState = Partial<{
  healthz: 'ok' | 'fail';
  readyz: 'ok' | 'fail';
  agents: 'missing' | 'enabled';
  latencyMs: number;
  reset: boolean;
}>;

declare global {
  namespace Cypress {
    interface Chainable {
      /** Drives the stub API's failure modes (see tools/mock-agent-api.mjs). */
      setApiState(state: ApiState): Chainable<void>;
      resetApi(): Chainable<void>;
      /** Opens the control screen and waits for the first verdict to land. */
      visitControlPlane(): Chainable<void>;
      byTestId(
        id: string,
        options?: Partial<Cypress.Loggable & Cypress.Timeoutable & Cypress.Withinable & Cypress.Shadow>,
      ): Chainable<JQuery<HTMLElement>>;
    }
  }
}

Cypress.Commands.add('setApiState', (state: ApiState) => {
  cy.request('POST', `${Cypress.env('apiUrl')}/__control__`, state).its('status').should('eq', 200);
});

Cypress.Commands.add('resetApi', () => {
  cy.setApiState({ reset: true });
});

Cypress.Commands.add('byTestId', (id: string, options = {}) => cy.get(`[data-testid="${id}"]`, options));

Cypress.Commands.add('visitControlPlane', () => {
  cy.visit('/agents');
  cy.byTestId('system-status').should('not.contain.text', 'unknown');
});
