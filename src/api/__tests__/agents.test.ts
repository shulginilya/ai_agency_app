import { commandAgent, getAgent, listAgents } from '@/api/agents';
import { HttpClient } from '@/api/http';
import { AgentListResponseSchema, unwrapAgentList } from '@/api/schemas';
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
  it('calls the versioned collection route', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: [AGENT] })]);
    await listAgents({ client: clientWith(fetchImpl) });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/v1/agents', expect.anything());
  });

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

  it('surfaces a 404 as an http error rather than an empty list', async () => {
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
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/v1/agents/a%2F1', expect.anything());
  });
});

describe('commandAgent', () => {
  it('POSTs to the command path and returns the updated agent', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { ...AGENT, status: 'stopped' } })]);

    const agent = await commandAgent('a1', 'stop', { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8000/v1/agents/a1/stop',
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

/**
 * TEMPORARY, alongside src/api/fixtures/agents.ts. Delete this block with it.
 *
 * The flag is read at module load, so the module has to be re-imported after the
 * env changes — which is also what makes "off by default" real rather than a
 * claim: every other test in this file asserts a `fetch` that the fixtures would
 * have swallowed.
 */
describe('EXPO_PUBLIC_MOCK_AGENTS', () => {
  const original = process.env.EXPO_PUBLIC_MOCK_AGENTS;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_MOCK_AGENTS;
    else process.env.EXPO_PUBLIC_MOCK_AGENTS = original;
    jest.resetModules();
  });

  it('serves fixtures that satisfy the real schema, without touching the network', async () => {
    process.env.EXPO_PUBLIC_MOCK_AGENTS = '1';
    jest.resetModules();
    const api = await import('@/api/agents');
    const fetchImpl = jest.fn();

    const agents = await api.listAgents({ client: clientWith(fetchImpl) });

    expect(agents.length).toBeGreaterThan(0);
    expect(() => AgentListResponseSchema.parse(agents)).not.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets a command move an agent, so the screen is worth clicking', async () => {
    process.env.EXPO_PUBLIC_MOCK_AGENTS = '1';
    jest.resetModules();
    const api = await import('@/api/agents');
    const fetchImpl = jest.fn();
    const [first] = await api.listAgents({ client: clientWith(fetchImpl) });

    const paused = await api.commandAgent(first.id, 'pause', { client: clientWith(fetchImpl) });

    expect(paused.status).toBe('paused');
    await expect(api.getAgent(first.id, { client: clientWith(fetchImpl) })).resolves.toMatchObject({
      status: 'paused',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
