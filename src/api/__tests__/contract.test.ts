import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { AGENTS_PATH } from '@/api/agents';
import {
  checkContract,
  errorsIn,
  formatFindings,
  type ContractEntry,
  type OpenApiDoc,
} from '@/api/contract';
import { RUNS_PATH } from '@/api/runs';
import {
  AgentInfoSchema,
  AgentStatusSchema,
  HealthSchema,
  MessageResponseSchema,
  ProbeBodySchema,
  ProblemSchema,
  ReadinessSchema,
  RunResponseSchema,
  SessionInfoSchema,
} from '@/api/schemas';
import { SESSIONS_PATH } from '@/api/sessions';

/**
 * The contract test. `schemas.ts` is hand-written, the Pydantic models are
 * hand-written, and this is what stops them drifting apart quietly.
 *
 * It reads a pinned copy of the server's spec (`contracts/openapi.json`,
 * refreshed by `npm run contract:pull`), so it needs no network and no running
 * API — a spec change only reaches CI when someone commits it, which is exactly
 * the moment you want the conversation to happen.
 */

const SPEC_PATH = path.join(__dirname, '..', '..', '..', 'contracts', 'openapi.json');
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDoc;

/**
 * Every response the app parses, pointed at the *leaf* schema. Arrays and the
 * `{agents: […]}` / `{message: …}` envelopes are unwrapped server-side before
 * comparing, so this mirrors `unwrapEnvelope` in schemas.ts rather than
 * duplicating it.
 *
 * Paths come from `AGENTS_PATH` so that renaming the prefix in one place either
 * keeps this passing or fails it loudly — never silently checks a stale route.
 */
const CONTRACT: readonly ContractEntry[] = [
  // Probes read the status code, so the permissive body schema is what the app
  // actually parses — and the strict one is what the control plane renders when
  // it matches. Both are checked: the second is how a change to `capacity`
  // reaches us as a build failure rather than a blank strip on the screen.
  { name: 'healthz', path: '/healthz', method: 'get', status: '200', schema: ProbeBodySchema },
  { name: 'readyz', path: '/readyz', method: 'get', status: '200', schema: ProbeBodySchema },
  { name: 'healthz(rendered)', path: '/healthz', method: 'get', status: '200', schema: HealthSchema },
  { name: 'readyz(rendered)', path: '/readyz', method: 'get', status: '200', schema: ReadinessSchema },

  { name: 'listAgents', path: AGENTS_PATH, method: 'get', status: '200', schema: AgentInfoSchema, envelope: 'agents' },
  { name: 'getAgent', path: `${AGENTS_PATH}/{id}`, method: 'get', status: '200', schema: AgentInfoSchema },

  { name: 'createRun', path: RUNS_PATH, method: 'post', status: '200', schema: RunResponseSchema },

  { name: 'openSession', path: SESSIONS_PATH, method: 'post', status: '201', schema: SessionInfoSchema },
  {
    name: 'listSessions',
    path: SESSIONS_PATH,
    method: 'get',
    status: '200',
    schema: SessionInfoSchema,
    envelope: 'sessions',
  },
  { name: 'getSession', path: `${SESSIONS_PATH}/{id}`, method: 'get', status: '200', schema: SessionInfoSchema },
  {
    name: 'sendSessionMessage',
    path: `${SESSIONS_PATH}/{id}/messages`,
    method: 'post',
    status: '200',
    schema: MessageResponseSchema,
  },

  // The failure contract, checked like any other response: `describeApiError`
  // shows the server's `detail` verbatim, so `detail` going optional would
  // quietly downgrade every error message in the app to generic copy.
  { name: 'createRun(503)', path: RUNS_PATH, method: 'post', status: '503', schema: ProblemSchema },
  {
    name: 'sendSessionMessage(409)',
    path: `${SESSIONS_PATH}/{id}/messages`,
    method: 'post',
    status: '409',
    schema: ProblemSchema,
  },
  { name: 'getSession(404)', path: `${SESSIONS_PATH}/{id}`, method: 'get', status: '404', schema: ProblemSchema },
];

describe('the pinned server spec fits through our schemas', () => {
  const findings = checkContract(spec, CONTRACT);

  it('has nothing the client would refuse', () => {
    const errors = errorsIn(findings);
    if (errors.length > 0) {
      throw new Error(
        `The API and src/api/schemas.ts disagree:\n\n${formatFindings(errors)}\n\n` +
          `Fix one side, or re-pin the spec with: npm run contract:pull`,
      );
    }
    expect(errors).toEqual([]);
  });

  /**
   * `closeSession` cannot be a CONTRACT entry: a 204 has no body, and the
   * checker compares response schemas. What is worth pinning is that the route
   * still answers 204 rather than having grown a body the client throws away.
   */
  it('still closes a session with a bodiless 204', () => {
    const operation = spec.paths?.['/v1/sessions/{session_id}']?.delete as
      | { responses?: Record<string, { content?: unknown }> }
      | undefined;
    expect(operation?.responses?.['204']).toBeDefined();
    expect(operation?.responses?.['204']?.content).toBeUndefined();
  });

  it('reports what the client ignores, without failing', () => {
    // Not an assertion so much as a place for the list to be visible. Fields the
    // server sends and the app drops are fine — until one of them is the field
    // you spent an afternoon looking for.
    const ignored = findings.filter((finding) => finding.severity === 'info');
    if (ignored.length > 0) console.log(`Contract notes:\n${formatFindings(ignored)}`);
    expect(Array.isArray(ignored)).toBe(true);
  });
});

/**
 * Tests for the checker itself. A guard nobody has watched fail is not a guard,
 * so each of these is a real drift scenario and its expected finding.
 */
describe('checkContract', () => {
  const objectSpec = (properties: Record<string, unknown>, required: string[]): OpenApiDoc => ({
    paths: {
      '/thing': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties, required } } } },
          },
        },
      },
    },
  });

  const entry = (schema: ContractEntry['schema']): ContractEntry[] => [
    { name: 'thing', path: '/thing', method: 'get', status: '200', schema },
  ];

  /**
   * A stand-in for a response schema, defined here rather than imported: these
   * tests are about the *checker*, and pinning them to whatever `schemas.ts`
   * happens to contain today means a change over there breaks tests that were
   * never about it. `AgentInfoSchema` is checked against the real spec above.
   */
  const SampleSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: AgentStatusSchema,
  });

  const agentProps = {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['idle', 'starting', 'running', 'paused', 'error', 'stopped'] },
  };

  it('passes when the server matches', () => {
    const findings = checkContract(objectSpec(agentProps, ['id', 'name', 'status']), entry(SampleSchema));
    expect(errorsIn(findings)).toEqual([]);
  });

  it('catches a renamed field', () => {
    const { status: _dropped, ...renamed } = agentProps;
    const findings = checkContract(
      objectSpec({ ...renamed, state: agentProps.status }, ['id', 'name', 'state']),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.status', message: expect.stringContaining('does not document it') }),
    );
  });

  it('catches a field the server stopped guaranteeing', () => {
    const findings = checkContract(objectSpec(agentProps, ['id', 'status']), entry(SampleSchema));
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.name', message: expect.stringContaining('may omit it') }),
    );
  });

  it('catches a new enum value the client would reject', () => {
    const findings = checkContract(
      objectSpec(
        { ...agentProps, status: { type: 'string', enum: [...agentProps.status.enum, 'draining'] } },
        ['id', 'name', 'status'],
      ),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.status', message: expect.stringContaining('draining') }),
    );
  });

  it('catches a status field widened to a bare string', () => {
    const findings = checkContract(
      objectSpec({ ...agentProps, status: { type: 'string' } }, ['id', 'name', 'status']),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.status', message: expect.stringContaining('declare an enum') }),
    );
  });

  it('catches a type change', () => {
    const findings = checkContract(
      objectSpec({ ...agentProps, id: { type: 'integer' } }, ['id', 'name', 'status']),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.id', message: 'server sends integer, client expects string' }),
    );
  });

  it('catches a server that permits the empty string where the client does not', () => {
    const findings = checkContract(
      objectSpec({ ...agentProps, name: { type: 'string' } }, ['id', 'name', 'status']),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.name', message: expect.stringContaining('min_length=1') }),
    );
  });

  /** What `updated_at` used to be: optional, but not nullable. */
  const OptionalOnly = SampleSchema.extend({ updated_at: z.string().optional() });

  it('catches a nullable field the client only made optional', () => {
    const absentOnly = checkContract(
      objectSpec({ ...agentProps, updated_at: { type: 'string' } }, ['id', 'name', 'status']),
      entry(OptionalOnly),
    );
    expect(errorsIn(absentOnly)).toEqual([]);

    const nullable = checkContract(
      objectSpec(
        { ...agentProps, updated_at: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        ['id', 'name', 'status'],
      ),
      entry(OptionalOnly),
    );
    expect(errorsIn(nullable)).toContainEqual(
      expect.objectContaining({ where: 'thing.updated_at', message: expect.stringContaining('may send null') }),
    );

    // …and `.nullish()`, which is what schemas.ts uses everywhere, takes it.
    const fixed = checkContract(
      objectSpec(
        { ...agentProps, updated_at: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        ['id', 'name', 'status'],
      ),
      entry(SampleSchema.extend({ updated_at: z.string().nullish() })),
    );
    expect(errorsIn(fixed)).toEqual([]);
  });

  it('reads OpenAPI 3.0 nullable and 3.1 type-arrays the same way', () => {
    const client = entry(OptionalOnly);
    const oldStyle = checkContract(
      objectSpec({ ...agentProps, updated_at: { type: 'string', nullable: true } }, ['id', 'name', 'status']),
      client,
    );
    const newStyle = checkContract(
      objectSpec({ ...agentProps, updated_at: { type: ['string', 'null'] } }, ['id', 'name', 'status']),
      client,
    );
    expect(errorsIn(oldStyle)).toHaveLength(1);
    expect(errorsIn(newStyle)).toHaveLength(1);
  });

  it('reports a field the client ignores without failing', () => {
    const findings = checkContract(
      objectSpec({ ...agentProps, queue_depth: { type: 'integer' } }, ['id', 'name', 'status']),
      entry(SampleSchema),
    );
    expect(errorsIn(findings)).toEqual([]);
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'info', where: 'thing.queue_depth' }),
    );
  });

  it('fails loudly when the route is gone', () => {
    const findings = checkContract({ paths: {} }, entry(SampleSchema));
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing', message: expect.stringContaining('GET /thing') }),
    );
  });

  it('matches a route regardless of what the path parameter is called', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/v1/agents/{agent_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: agentProps, required: ['id', 'name', 'status'] },
                  },
                },
              },
            },
          },
        },
      },
    };
    const findings = checkContract(doc, [
      { name: 'getAgent', path: '/v1/agents/{id}', method: 'get', status: '200', schema: SampleSchema },
    ]);
    expect(errorsIn(findings)).toEqual([]);
  });

  it('unwraps arrays and envelopes to reach the same leaf object', () => {
    const leaf = { type: 'object', properties: agentProps, required: ['id', 'name', 'status'] };
    const shapes = [
      leaf,
      { type: 'array', items: leaf },
      { type: 'object', properties: { agents: { type: 'array', items: leaf } }, required: ['agents'] },
    ];

    for (const schema of shapes) {
      const doc: OpenApiDoc = {
        paths: { '/thing': { get: { responses: { '200': { content: { 'application/json': { schema } } } } } } },
      };
      const findings = checkContract(doc, [
        { name: 'thing', path: '/thing', method: 'get', status: '200', schema: SampleSchema, envelope: 'agents' },
      ]);
      expect(errorsIn(findings)).toEqual([]);
    }
  });

  it('follows $ref into components', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/thing': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          Agent: {
            type: 'object',
            properties: { ...agentProps, status: { $ref: '#/components/schemas/AgentStatus' } },
            required: ['id', 'name', 'status'],
          },
          AgentStatus: agentProps.status,
        },
      },
    };
    expect(errorsIn(checkContract(doc, entry(SampleSchema)))).toEqual([]);
  });

  it('accepts anything for a probe body', () => {
    const doc: OpenApiDoc = {
      paths: { '/healthz': { get: { responses: { '200': { content: { 'application/json': { schema: {} } } } } } } },
    };
    const findings = checkContract(doc, [
      { name: 'healthz', path: '/healthz', method: 'get', status: '200', schema: ProbeBodySchema },
    ]);
    expect(findings).toEqual([]);
  });

  it('reads the allOf-plus-$ref shape OpenAPI 3.0 uses for an annotated field', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/thing': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { allOf: [{ $ref: '#/components/schemas/Agent' }], description: 'the agent' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { Agent: { type: 'object', properties: agentProps, required: ['id', 'name', 'status'] } },
      },
    };
    expect(errorsIn(checkContract(doc, entry(SampleSchema)))).toEqual([]);
  });

  it('lets an integer through a z.number(), but not a float through a z.number().int()', () => {
    const widening = checkContract(
      objectSpec({ count: { type: 'integer' } }, ['count']),
      entry(z.object({ count: z.number() })),
    );
    expect(errorsIn(widening)).toEqual([]);

    const narrowing = checkContract(
      objectSpec({ count: { type: 'number' } }, ['count']),
      entry(z.object({ count: z.number().int() })),
    );
    expect(errorsIn(narrowing)).toContainEqual(
      expect.objectContaining({ message: 'server sends number, client expects integer' }),
    );
  });

  it('descends into array items', () => {
    const findings = checkContract(
      objectSpec({ tags: { type: 'array', items: { type: 'integer' } } }, ['tags']),
      entry(z.object({ tags: z.array(z.string()) })),
    );
    expect(errorsIn(findings)).toContainEqual(
      expect.objectContaining({ where: 'thing.tags[]', message: 'server sends integer, client expects string' }),
    );
  });

  it('flags a union as needing a human rather than pretending to have checked it', () => {
    const findings = checkContract(
      objectSpec({ value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, ['value']),
      entry(z.object({ value: z.union([z.string(), z.number()]) })),
    );
    expect(errorsIn(findings)).toEqual([]);
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'info', message: expect.stringContaining('union type') }),
    );
  });

  it('accepts a server datetime where the client only asked for a non-empty string', () => {
    // `created_at: datetime` in Pydantic has no minLength, but a date-time
    // string is never empty — so `.min(1)` is satisfied without being declared.
    const findings = checkContract(
      objectSpec({ created_at: { type: 'string', format: 'date-time' } }, ['created_at']),
      entry(z.object({ created_at: z.string().min(1) })),
    );
    expect(errorsIn(findings)).toEqual([]);
  });

  it('notes a client-side regex the server does not document', () => {
    const findings = checkContract(
      objectSpec({ id: { type: 'string' } }, ['id']),
      entry(z.object({ id: z.string().regex(/^a-/) })),
    );
    expect(errorsIn(findings)).toEqual([]);
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'info', where: 'thing.id' }));
  });

  it('formats findings into something readable', () => {
    const text = formatFindings([{ severity: 'error', where: 'thing.id', message: 'boom' }]);
    expect(text).toContain('[error] thing.id');
    expect(text).toContain('boom');
  });
});
