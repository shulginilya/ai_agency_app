/**
 * End-to-end coverage of the agent roster against a real browser and a real
 * HTTP server (the stub in tools/mock-agent-api.mjs). Jest proves the units;
 * this proves the wiring — bundling, routing, tab navigation, rendering.
 */
describe('Agents', () => {
  it('is the screen the app opens to', () => {
    cy.visit('/');

    cy.byTestId('agents-error').should('not.exist');
    cy.byTestId('agent-row-a1').should('contain.text', 'Research agent');
    cy.byTestId('agent-status-a1').should('contain.text', 'running');
    cy.byTestId('agent-row-a2').should('contain.text', 'Outreach agent');
  });

  it('reaches the Control plane screen from the tab bar', () => {
    cy.visit('/');
    cy.contains('Control plane').click();
    cy.byTestId('api-base-url').should('contain.text', ':8000');
  });
});
