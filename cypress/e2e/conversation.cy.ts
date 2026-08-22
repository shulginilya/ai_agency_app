/**
 * End-to-end coverage of the conversation against a real browser and a real
 * HTTP server (the stub in tools/mock-agent-api.mjs).
 *
 * What only this level can prove: that a turn is one request held open until the
 * agent is done, that the session survives between messages, and that the
 * failure modes the server actually has (no run slot, a busy session, a loop
 * failure that closes the session) reach the screen as words rather than as a
 * spinner that never stops.
 */
describe('Conversation', () => {
  beforeEach(() => {
    cy.visit('/chat');
  });

  it('opens a session on the first message and keeps it for the second', () => {
    cy.sendPrompt('rank the leads');

    cy.byTestId('chat-thread').should('contain.text', 'Acknowledged: "rank the leads"');
    cy.byTestId('conversation-target').should('contain.text', 'sess_');
    cy.byTestId('conversation-target').should('contain.text', '1 turn');

    cy.sendPrompt('and again');
    cy.byTestId('conversation-target').should('contain.text', '2 turns');
  });

  it('shows what the turn cost underneath the reply', () => {
    cy.sendPrompt('go');

    cy.byTestId('chat-thread').should('contain.text', 'turn 1');
    cy.byTestId('chat-thread').should('contain.text', '$');
    cy.byTestId('chat-thread').should('contain.text', 'tools:');
  });

  it('locks profile and team once the session is open', () => {
    cy.byTestId('profile-eval').click();
    cy.sendPrompt('go');

    cy.byTestId('chat-thread').should('contain.text', 'profile eval');
    cy.byTestId('profile-eval').should('have.attr', 'aria-disabled', 'true');
  });

  it('closes the session, and the next message opens a fresh one', () => {
    cy.sendPrompt('go');
    cy.byTestId('close-session').click();

    cy.byTestId('chat-thread').should('contain.text', 'Session closed.');
    cy.byTestId('close-session').should('not.exist');

    cy.sendPrompt('again');
    cy.byTestId('conversation-target').should('contain.text', '1 turn');
  });

  it('puts your text back in the composer when there is no run slot', () => {
    cy.setApiState({ runs: 'busy' });
    cy.sendPrompt('rank the leads');

    cy.byTestId('chat-send-error').should('contain.text', 'All run slots are in use');
    cy.byTestId('composer-input').should('have.value', 'rank the leads');
  });

  it('says the agent failed without pretending the request did', () => {
    // `is_error: true` comes back on a 200 — the HTTP layer saw nothing wrong.
    cy.setApiState({ runs: 'error' });
    cy.sendPrompt('go');

    cy.byTestId('chat-thread').should('contain.text', 'The agent reported an error');
  });

  it('drops the handle when a loop failure closes the session server-side', () => {
    cy.sendPrompt('go');
    cy.byTestId('close-session').should('exist');

    cy.setApiState({ runs: 'fail' });
    cy.sendPrompt('again');

    cy.byTestId('chat-thread').should('contain.text', 'closed this session');
    cy.byTestId('close-session').should('not.exist');
  });

  it('runs one-shot against /v1/runs, with nothing to close afterwards', () => {
    cy.byTestId('mode-run').click();
    cy.sendPrompt('one piece of work');

    cy.byTestId('chat-thread').should('contain.text', 'Acknowledged');
    cy.byTestId('close-session').should('not.exist');
    cy.byTestId('conversation-target').should('contain.text', '/v1/runs');
  });

  it('shows the open session on the control plane, and closes it from there', () => {
    cy.sendPrompt('go');
    cy.byTestId('conversation-target').invoke('text').as('target');

    cy.contains('Control plane').click();
    cy.byTestId('sessions-empty').should('not.exist');
    cy.get('[data-testid^="session-close-"]').first().click();
    cy.byTestId('sessions-empty').should('exist');
  });

  it('waits out a slow agent rather than giving up on it', () => {
    cy.setApiState({ replyDelayMs: 2_500 });
    cy.sendPrompt('take your time');

    cy.byTestId('chat-awaiting').should('exist');
    cy.byTestId('chat-thread', { timeout: 15_000 }).should('contain.text', 'Acknowledged');
    cy.byTestId('chat-awaiting').should('not.exist');
  });
});
