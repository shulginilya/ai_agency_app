import { commandAgent, getAgent, listAgents } from '@/api/agents';
import { HttpClient } from '@/api/http';
import { unwrapAgentList } from '@/api/schemas';
import { catchApiError } from '@/test-utils/expect';
import { fakeResponse, fetchSequence } from '@/test-utils/http';

const AGENT = { id: 'a1', name: 'Research agent', status: 'running', updated_at: '2026-08-15T09:00:00Z' };

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

describe('listAgents', () => {
  it('accepts a bare array', async () => {
    const agents = await listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [AGENT] })])) });
    expect(agents).toEqual([AGENT]);
  });

  it('accepts an { agents: [...] } envelope', async () => {
    const agents = await listAgents({
      client: clientWith(fetchSequence([fakeResponse({ body: { agents: [AGENT] } })])),
    });
    expect(agents).toEqual([AGENT]);
  });

  it('rejects loudly when an agent status is not one we know', async () => {
    const error = await catchApiError(
      listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [{ ...AGENT, status: 'exploded' }] })])) }),
    );

    expect(error.kind).toBe('validation');
    expect(error.issues?.join(' ')).toMatch(/^0\.status:/);
  });

  it('rejects loudly when a required field is missing', async () => {
    const error = await catchApiError(
      listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [{ id: 'a1' }] })])) }),
    );

    expect(error.kind).toBe('validation');
  });

  it('surfaces the 404 of the not-yet-implemented endpoint as an http error', async () => {
    const error = await catchApiError(
      listAgents({ client: clientWith(fetchSequence([fakeResponse({ status: 404, body: { detail: 'Not Found' } })])) }),
    );

    expect(error.kind).toBe('http');
    expect(error.status).toBe(404);
  });
});

describe('getAgent', () => {
  it('url-encodes the id', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: AGENT })]);
    await getAgent('a/1', { client: clientWith(fetchImpl) });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/agents/a%2F1', expect.anything());
  });
});

describe('commandAgent', () => {
  it('POSTs to the command path and returns the updated agent', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { ...AGENT, status: 'stopped' } })]);

    const agent = await commandAgent('a1', 'stop', { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8000/agents/a1/stop',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(agent.status).toBe('stopped');
  });
});

describe('unwrapAgentList', () => {
  it('flattens the envelope and leaves a bare array alone', () => {
    expect(unwrapAgentList({ agents: [AGENT] })).toEqual([AGENT]);
    expect(unwrapAgentList([AGENT])).toEqual([AGENT]);
    expect(unwrapAgentList(null)).toBeNull();
  });
});
