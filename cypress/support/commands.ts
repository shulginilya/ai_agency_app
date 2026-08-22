export {};

type ApiState = Partial<{
  healthz: 'ok' | 'fail';
  readyz: 'ok' | 'fail';
  /** How a run ends: 503 no slot, 502 loop failure, 504 timeout, or is_error. */
  runs: 'ok' | 'busy' | 'fail' | 'error' | 'timeout';
  /** 'busy' makes every session refuse turns with 409 and refuse to close. */
  sessions: 'ok' | 'busy' | 'reset';
  replyDelayMs: number;
  latencyMs: number;
  reset: boolean;
}>;

declare global {
  namespace Cypress {
    interface Chainable {
      /** Drives the stub API's failure modes (see tools/mock-agent-api.mjs). */
      setApiState(state: ApiState): Chainable<void>;
      resetApi(): Chainable<void>;
      /** Opens the control plane screen and waits for the first verdict to land. */
      visitControlPlane(): Chainable<void>;
      /** Types into the conversation composer and sends it. */
      sendPrompt(text: string): Chainable<void>;
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

Cypress.Commands.add('sendPrompt', (text: string) => {
  cy.byTestId('composer-input').clear().type(text);
  cy.byTestId('composer-send').click();
});

Cypress.Commands.add('visitControlPlane', () => {
  cy.visit('/control-plane');
  cy.byTestId('system-status').should('not.contain.text', 'unknown');
});
