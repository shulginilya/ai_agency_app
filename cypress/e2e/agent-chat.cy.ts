/**
 * The chat round trip in a real browser against a real HTTP server.
 *
 * Jest proves the pieces; this proves the thing users actually do — tap an
 * agent, type, send, and have an answer arrive on its own without touching the
 * page again. That last part is the whole point of the polling loop and it is
 * the one behaviour a unit test cannot honestly assert.
 */
describe('Talking to an agent', () => {
  beforeEach(() => {
    cy.setApiState({ reset: true });
    cy.setApiState({ agents: 'reset', messages: 'reset' });
  });

  it('opens a thread from the agents list', () => {
    cy.visit('/');
    cy.byTestId('agent-row-a1').click();

    cy.byTestId('chat-agent-name').should('contain.text', 'Research agent');
    cy.byTestId('chat-agent-status').should('contain.text', 'running');
    cy.byTestId('chat-empty').should('exist');
  });

  it('sends a message and waits for the reply to arrive on its own', () => {
    cy.setApiState({ replyDelayMs: 2_500 });
    cy.visit('/agent/a1');

    cy.byTestId('composer-input').type('summarise the leads');
    cy.byTestId('composer-send').click();

    // The bubble is on screen before the server has said anything back.
    cy.contains('summarise the leads').should('exist');
    cy.byTestId('chat-awaiting').should('exist');

    // No further interaction: the poll has to find the reply by itself.
    cy.contains('Acknowledged: "summarise the leads"', { timeout: 15_000 }).should('exist');
    cy.byTestId('chat-awaiting').should('not.exist');
  });

  it('keeps what you typed when the send fails', () => {
    cy.visit('/agent/a1');
    cy.setApiState({ send: 'fail' });

    cy.byTestId('composer-input').type('this will not go through');
    cy.byTestId('composer-send').click();

    cy.byTestId('chat-send-error').should('exist');
    cy.byTestId('composer-input').should('have.value', 'this will not go through');

    cy.setApiState({ send: 'ok' });
    cy.byTestId('composer-send').click();
    cy.contains('this will not go through').should('exist');
  });

  it('records control commands in the same thread, and can undo them', () => {
    cy.visit('/agent/a1');

    cy.byTestId('chat-command-pause').click();
    cy.byTestId('chat-agent-status').should('contain.text', 'paused');
    cy.contains('Research agent was paused').should('exist');

    cy.byTestId('chat-command-start').click();
    cy.byTestId('chat-agent-status').should('contain.text', 'running');
  });

  it('explains itself when the messaging endpoints are not there', () => {
    cy.setApiState({ messages: 'missing' });
    cy.visit('/agent/a1');

    cy.byTestId('chat-not-implemented').should('contain.text', '/v1/agents/a1/messages');
  });
});
