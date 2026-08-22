/**
 * End-to-end coverage of the control plane against a real browser and a real
 * HTTP server (the stub in tools/mock-agent-api.mjs). Jest proves the units;
 * this proves the wiring — bundling, routing, CORS, polling, rendering.
 */
describe('Control plane', () => {
  it('reports healthy and shows both probe results', () => {
    cy.visitControlPlane();

    cy.byTestId('system-status').should('contain.text', 'healthy');
    cy.byTestId('probe-status-healthz').should('contain.text', 'up');
    cy.byTestId('probe-status-readyz').should('contain.text', 'up');
    cy.byTestId('probe-http-healthz').should('contain.text', 'HTTP 200');
    cy.byTestId('probe-body-healthz').should('contain.text', '"status":"ok"');
    cy.byTestId('probe-latency-readyz').should('match', /\d+ ms/);
    cy.byTestId('last-checked').should('exist');
  });

  it('says whether the server will actually take a prompt right now', () => {
    cy.visitControlPlane();

    cy.byTestId('capacity-runs_free').should('contain.text', '4');
    cy.byTestId('capacity-sessions_free').should('exist');
  });

  it('shows nothing open on a server that is holding nothing', () => {
    cy.visitControlPlane();

    cy.byTestId('sessions-empty').should('exist');
  });

  it('drops the free-slot count to zero when the run pool is exhausted', () => {
    cy.visitControlPlane();
    cy.setApiState({ runs: 'busy' });
    cy.byTestId('run-checks').click();

    cy.byTestId('capacity-runs_free').should('contain.text', '0');
  });

  it('logs every call it makes, and clears the log on demand', () => {
    cy.visitControlPlane();

    cy.byTestId('request-log-row').should('have.length.at.least', 2);
    cy.byTestId('request-log-row').should('contain.text', '/healthz');
    cy.byTestId('request-log-row').should('contain.text', '/readyz');
    cy.byTestId('request-log-row').should('contain.text', '/v1/sessions');

    cy.byTestId('clear-log').click();
    cy.byTestId('request-log-row').should('not.exist');
  });

  it('goes degraded when readiness fails but the process is alive', () => {
    cy.visitControlPlane();
    cy.byTestId('system-status').should('contain.text', 'healthy');

    cy.setApiState({ readyz: 'fail' });
    cy.byTestId('run-checks').click();

    cy.byTestId('system-status').should('contain.text', 'degraded');
    cy.byTestId('probe-status-healthz').should('contain.text', 'up');
    cy.byTestId('probe-status-readyz').should('contain.text', 'down');
    cy.byTestId('probe-error-readyz').should('contain.text', '503');
  });

  it('goes down when nothing answers, and recovers on the next check', () => {
    cy.visitControlPlane();

    cy.setApiState({ healthz: 'fail', readyz: 'fail' });
    cy.byTestId('run-checks').click();
    cy.byTestId('system-status').should('contain.text', 'down');

    cy.setApiState({ reset: true });
    cy.byTestId('run-checks').click();
    cy.byTestId('system-status').should('contain.text', 'healthy');
  });

  it('recovers on its own while auto-refresh is on', () => {
    cy.visitControlPlane();
    cy.setApiState({ readyz: 'fail' });
    cy.byTestId('run-checks').click();
    cy.byTestId('system-status').should('contain.text', 'degraded');

    cy.setApiState({ reset: true });
    // No click this time: the 10s poll must pick the recovery up by itself.
    cy.byTestId('system-status', { timeout: 20_000 }).should('contain.text', 'healthy');
  });

  it('survives a slow API without hanging the screen', () => {
    cy.setApiState({ latencyMs: 1_200 });
    cy.visit('/control-plane');

    cy.byTestId('system-status').should('contain.text', 'healthy');
    cy.byTestId('probe-latency-healthz')
      .invoke('text')
      .should((text) => {
        expect(Number.parseInt(text, 10)).to.be.greaterThan(1_000);
      });
  });
});
