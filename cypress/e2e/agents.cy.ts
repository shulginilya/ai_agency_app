/**
 * End-to-end coverage of the agent roster against a real browser and a real
 * HTTP server (the stub in tools/mock-agent-api.mjs). Jest proves the units;
 * this proves the wiring — bundling, routing, tab navigation, rendering.
 */
describe('Agents', () => {
  it('is the screen the app opens to', () => {
    cy.visit('/');

    cy.byTestId('agents-error').should('not.exist');
    cy.byTestId('agent-row-researcher').should('contain.text', 'researcher');
    cy.byTestId('agent-status-reviewer').should('contain.text', 'running');
    cy.byTestId('agent-meta-researcher').should('contain.text', 'sonnet');
  });

  it('marks the agents only a team run can reach', () => {
    cy.visit('/');

    cy.byTestId('agent-team-reviewer').should('contain.text', 'team');
    cy.byTestId('agent-team-researcher').should('not.exist');
  });

  it('opens an agent and shows what constrains it — with no controls, because there are none', () => {
    cy.visit('/');
    cy.byTestId('agent-row-researcher').click();

    cy.byTestId('detail-agent-name').should('contain.text', 'researcher');
    cy.byTestId('detail-model').should('contain.text', 'sonnet');
    cy.byTestId('detail-tool-Read').should('exist');
    cy.contains('Start').should('not.exist');
    cy.contains('Pause').should('not.exist');
  });

  it('reaches the other tabs from the tab bar', () => {
    cy.visit('/');
    cy.contains('Control plane').click();
    cy.byTestId('api-base-url').should('contain.text', ':8000');

    cy.contains('Conversation').click();
    cy.byTestId('conversation-target').should('contain.text', '/v1/sessions');
  });
});
