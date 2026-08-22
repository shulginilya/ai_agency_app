import { getAgent, isTeamOnly, listAgents } from '@/api/agents';
import { HttpClient } from '@/api/http';
import { AgentsResponseSchema, unwrapAgentList } from '@/api/schemas';
import { catchApiError } from '@/test-utils/expect';
import { agentInfo } from '@/test-utils/fixtures';
import { fakeResponse, fetchSequence } from '@/test-utils/http';

const AGENT = agentInfo();

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

describe('listAgents', () => {
  it('calls the versioned collection route', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: { agents: [AGENT], count: 1 } })]);
    await listAgents({ client: clientWith(fetchImpl) });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/v1/agents', expect.anything());
  });

  it('accepts the { agents: [...] } envelope the server sends', async () => {
    const agents = await listAgents({
      client: clientWith(fetchSequence([fakeResponse({ body: { agents: [AGENT], count: 1 } })])),
    });
    expect(agents).toEqual([AGENT]);
  });

  it('accepts a bare array too, so the envelope can be dropped without a client release', async () => {
    const agents = await listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [AGENT] })])) });
    expect(agents).toEqual([AGENT]);
  });

  it('takes the nulls Pydantic puts on the wire for an unset optional', async () => {
    const sparse = agentInfo({ model: null, tools: null, max_turns: null });
    const agents = await listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [sparse] })])) });
    expect(agents[0]).toMatchObject({ model: null, tools: null, max_turns: null });
  });

  it('takes an agent with no name, because the server does not promise one', async () => {
    // `name` has no `min_length` in the spec. The client used to demand one,
    // which would have refused a legal response — the contract test caught it.
    const agents = await listAgents({
      client: clientWith(fetchSequence([fakeResponse({ body: [agentInfo({ name: '' })] })])),
    });
    expect(agents[0].name).toBe('');
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
      listAgents({ client: clientWith(fetchSequence([fakeResponse({ body: [{ id: 'researcher' }] })])) }),
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

  it('passes the 404 through — an unknown id is a caller error, not an empty agent', async () => {
    const error = await catchApiError(
      getAgent('nope', {
        client: clientWith(fetchSequence([fakeResponse({ status: 404, body: { detail: 'No agent named nope.' } })])),
      }),
    );

    expect(error.status).toBe(404);
  });
});

describe('isTeamOnly', () => {
  it('separates the agents a solo run can reach from the ones it cannot', () => {
    expect(isTeamOnly(agentInfo({ availability: 'team' }))).toBe(true);
    expect(isTeamOnly(agentInfo({ availability: 'always' }))).toBe(false);
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

  /** `require` rather than `await import`: jest's ESM loader is off here, and
   * this needs to re-evaluate the module *after* the env change either way. */
  const reimport = (): typeof import('@/api/agents') =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/api/agents') as typeof import('@/api/agents');

  it('serves fixtures that satisfy the real schema, without touching the network', async () => {
    process.env.EXPO_PUBLIC_MOCK_AGENTS = '1';
    jest.resetModules();
    const api = reimport();
    const fetchImpl = jest.fn();

    const agents = await api.listAgents({ client: clientWith(fetchImpl) });

    expect(agents.length).toBeGreaterThan(0);
    expect(() => AgentsResponseSchema.parse(agents)).not.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves a single agent from the same fixtures', async () => {
    process.env.EXPO_PUBLIC_MOCK_AGENTS = '1';
    jest.resetModules();
    const api = reimport();
    const fetchImpl = jest.fn();
    const [first] = await api.listAgents({ client: clientWith(fetchImpl) });

    await expect(api.getAgent(first.id, { client: clientWith(fetchImpl) })).resolves.toEqual(first);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
