import { z } from 'zod';

/**
 * Does the server's OpenAPI spec fit through the schemas in `schemas.ts`?
 *
 * The alternative to this file is code generation — either the server's spec
 * generates `schemas.ts`, or `schemas.ts` generates the Pydantic models. Both
 * work; both mean one side stops being hand-written, and the comments in
 * `schemas.ts` explaining *why* a field is loose are exactly the thing a
 * generator throws away. So neither side generates the other: both stay
 * hand-written and idiomatic, and this checker fails the build when they stop
 * agreeing.
 *
 * The comparison is deliberately asymmetric, because the two sides are not
 * peers. The server produces, the app consumes, so the question is never "are
 * these identical" but:
 *
 *   Can the server send something this app would refuse?
 *
 * That asymmetry decides every severity below. A server field the app ignores
 * is fine — zod strips unknown keys, and the app is allowed to not care about
 * `queue_depth`. A field the app *requires* that the server may omit is a
 * crash, three screens deep, in production. Only the second kind fails a build.
 *
 * Compared through JSON Schema rather than by reading `.def` internals: zod 4
 * emits it natively (`z.toJSONSchema`), it is the same language OpenAPI is
 * written in, and it survives a zod major version.
 */

/* ------------------------------------------------------------------ types */

export type Severity = 'error' | 'info';

export type Finding = {
  /** `error` fails the build. `info` is reported and tolerated. */
  severity: Severity;
  /** Where in the payload, e.g. `listAgents → [].status`. */
  where: string;
  message: string;
};

type JsonSchema = Record<string, unknown>;

export type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, JsonSchema> };
  $defs?: Record<string, JsonSchema>;
};

export type ContractEntry = {
  /** How this shows up in a failure message. Use the client function's name. */
  name: string;
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The response status the app actually reads. */
  status: string;
  /**
   * The *leaf* schema — `AgentSchema`, not `AgentListResponseSchema`. Arrays and
   * envelopes are unwrapped on the server side before comparing, so one entry
   * covers `[Agent]`, `{agents: [Agent]}` and a bare `Agent` alike.
   */
  schema: z.ZodType;
  /**
   * Envelope property to look inside, if the server uses one. Both
   * `{"agents": [...]}` and a bare `[...]` are accepted, matching the
   * `unwrapEnvelope` preprocessing on the client.
   */
  envelope?: string;
};

/* -------------------------------------------------------------- traversal */

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows `$ref` (and the single-element `allOf` FastAPI emits for a described field). */
function deref(schema: JsonSchema | undefined, doc: OpenApiDoc, depth = 0): JsonSchema | undefined {
  if (!schema || depth > 10) return schema;

  if (typeof schema.$ref === 'string') {
    const target = schema.$ref.replace(/^#\//, '').split('/');
    let node: unknown = doc;
    for (const segment of target) {
      node = isObject(node) ? node[segment] : undefined;
    }
    return isObject(node) ? deref(node, doc, depth + 1) : undefined;
  }

  // `allOf: [{$ref}]` with sibling keywords — OpenAPI 3.0's way of annotating a
  // referenced schema. The siblings win, the same as an inline override would.
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && isObject(schema.allOf[0])) {
    const { allOf: _allOf, ...siblings } = schema;
    return { ...deref(schema.allOf[0] as JsonSchema, doc, depth + 1), ...siblings };
  }

  return schema;
}

type Normalized = {
  /** The schema with any `null` branch stripped off. */
  schema: JsonSchema;
  nullable: boolean;
  /** True when a real union remains after removing `null` — compared shallowly. */
  union: boolean;
};

/**
 * Flattens the four ways a spec can say "string or null": OpenAPI 3.0's
 * `nullable: true`, JSON Schema 2020-12's `type: ["string","null"]`, and the
 * `anyOf`/`oneOf` pair that both zod and Pydantic v2 emit.
 */
function normalize(raw: JsonSchema | undefined, doc: OpenApiDoc): Normalized {
  const schema = deref(raw, doc) ?? {};
  let nullable = schema.nullable === true;

  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t) => t !== 'null');
    nullable = nullable || schema.type.length !== types.length;
    return { schema: { ...schema, type: types.length === 1 ? types[0] : types }, nullable, union: types.length > 1 };
  }

  const branches = (schema.anyOf ?? schema.oneOf) as unknown;
  if (Array.isArray(branches)) {
    const resolved = branches.map((branch) => deref(branch as JsonSchema, doc) ?? {});
    const nonNull = resolved.filter((branch) => branch.type !== 'null');
    nullable = nullable || nonNull.length !== resolved.length;
    const { anyOf: _a, oneOf: _o, ...siblings } = schema;
    if (nonNull.length === 1) return { schema: { ...nonNull[0], ...siblings }, nullable, union: false };
    return { schema: { ...schema, anyOf: nonNull }, nullable, union: nonNull.length > 1 };
  }

  return { schema, nullable, union: false };
}

/** An empty schema (`{}`, `true`) accepts anything — nothing to check against it. */
function acceptsAnything(schema: JsonSchema): boolean {
  return Object.keys(schema).filter((key) => key !== '$schema' && key !== 'description').length === 0;
}

/* ------------------------------------------------------------- comparison */

const NUMERIC = new Set(['number', 'integer']);

function compare(server: Normalized, client: Normalized, where: string, doc: OpenApiDoc): Finding[] {
  const findings: Finding[] = [];

  if (acceptsAnything(client.schema) && !client.union) return findings;

  if (server.nullable && !client.nullable) {
    findings.push({
      severity: 'error',
      where,
      message:
        'server may send null here, client rejects it — ' +
        'either make the field non-nullable server-side (exclude it instead of nulling it) or use .nullish() in schemas.ts',
    });
  }

  if (server.union || client.union) {
    findings.push({
      severity: 'info',
      where,
      message: 'union type — compared shallowly, check this one by hand',
    });
    return findings;
  }

  const serverType = server.schema.type as string | undefined;
  const clientType = client.schema.type as string | undefined;

  if (serverType && clientType && serverType !== clientType) {
    const bothNumeric = NUMERIC.has(serverType) && NUMERIC.has(clientType);
    // An integer fits through `z.number()`; a float does not fit through `z.number().int()`.
    const widening = bothNumeric && clientType === 'number';
    if (!widening) {
      findings.push({
        severity: 'error',
        where,
        message: `server sends ${serverType}, client expects ${clientType}`,
      });
      return findings;
    }
  }

  findings.push(...compareEnum(server.schema, client.schema, where));
  findings.push(...compareStringRules(server.schema, client.schema, where));

  if (clientType === 'object' || client.schema.properties) {
    findings.push(...compareObject(server.schema, client.schema, where, doc));
  }

  if (clientType === 'array' && isObject(client.schema.items)) {
    findings.push(
      ...compare(
        normalize(server.schema.items as JsonSchema | undefined, doc),
        normalize(client.schema.items, doc),
        `${where}[]`,
        doc,
      ),
    );
  }

  return findings;
}

function compareEnum(server: JsonSchema, client: JsonSchema, where: string): Finding[] {
  const clientValues = client.enum as unknown[] | undefined;
  if (!clientValues) return [];

  const serverValues = server.enum as unknown[] | undefined;

  // The client pins a set of values, the server documents an open string. Any
  // new status the server invents becomes a validation error in the app — which
  // is why the Python side wants a StrEnum here, not a bare `str`.
  if (!serverValues) {
    return [
      {
        severity: 'error',
        where,
        message: `client accepts only [${clientValues.join(', ')}], server documents an open ${
          server.type ?? 'value'
        } — declare an enum server-side`,
      },
    ];
  }

  const findings: Finding[] = [];
  const unknownToClient = serverValues.filter((value) => !clientValues.includes(value));
  if (unknownToClient.length > 0) {
    findings.push({
      severity: 'error',
      where,
      message: `server may send [${unknownToClient.join(', ')}], client rejects those values`,
    });
  }

  const unusedByServer = clientValues.filter((value) => !serverValues.includes(value));
  if (unusedByServer.length > 0) {
    findings.push({
      severity: 'info',
      where,
      message: `client handles [${unusedByServer.join(', ')}], server never sends them`,
    });
  }

  return findings;
}

/** Constraints where the client being *stricter* than the server is the bug. */
function compareStringRules(server: JsonSchema, client: JsonSchema, where: string): Finding[] {
  const findings: Finding[] = [];

  const clientMin = typeof client.minLength === 'number' ? client.minLength : 0;
  const serverMin = typeof server.minLength === 'number' ? server.minLength : 0;
  // A formatted string (`date-time`, `uuid`, `email`) is never the empty string,
  // so a server `datetime` field satisfies a client `.min(1)` without saying so.
  // Anything stricter than "non-empty" still has to be declared.
  const impliedNonEmpty = typeof server.format === 'string' && clientMin <= 1;
  if (clientMin > serverMin && !impliedNonEmpty) {
    findings.push({
      severity: 'error',
      where,
      message: `client requires minLength ${clientMin}, server permits ${serverMin} — add min_length=${clientMin} server-side`,
    });
  }

  if (typeof client.format === 'string' && client.format !== server.format) {
    findings.push({
      severity: 'error',
      where,
      message: `client requires format "${client.format}", server documents ${
        server.format ? `"${server.format}"` : 'no format'
      }`,
    });
  }

  if (typeof client.pattern === 'string' && client.pattern !== server.pattern) {
    findings.push({
      severity: 'info',
      where,
      message: 'client applies a regex the server does not document',
    });
  }

  return findings;
}

function compareObject(server: JsonSchema, client: JsonSchema, where: string, doc: OpenApiDoc): Finding[] {
  const findings: Finding[] = [];
  const serverProps = isObject(server.properties) ? server.properties : {};
  const clientProps = isObject(client.properties) ? client.properties : {};
  const serverRequired = new Set(Array.isArray(server.required) ? (server.required as string[]) : []);
  const clientRequired = new Set(Array.isArray(client.required) ? (client.required as string[]) : []);

  for (const field of clientRequired) {
    const at = `${where}.${field}`;
    if (!(field in serverProps)) {
      findings.push({
        severity: 'error',
        where: at,
        message: 'client requires this field, the server does not document it at all',
      });
    } else if (!serverRequired.has(field)) {
      findings.push({
        severity: 'error',
        where: at,
        message: 'client requires this field, server may omit it — make it required server-side or .optional() here',
      });
    }
  }

  for (const [field, clientField] of Object.entries(clientProps)) {
    if (!(field in serverProps) || !isObject(clientField)) continue;
    findings.push(
      ...compare(
        normalize(serverProps[field] as JsonSchema, doc),
        normalize(clientField, doc),
        `${where}.${field}`,
        doc,
      ),
    );
  }

  for (const field of Object.keys(serverProps)) {
    if (field in clientProps) continue;
    findings.push({
      severity: 'info',
      where: `${where}.${field}`,
      message: 'server sends this, client ignores it',
    });
  }

  return findings;
}

/* ------------------------------------------------------------ entry point */

/** Digs past arrays and the optional envelope to the object the client schema describes. */
function leafOf(schema: JsonSchema | undefined, envelope: string | undefined, doc: OpenApiDoc): JsonSchema | undefined {
  let current = deref(schema, doc);
  for (let hops = 0; hops < 5 && current; hops += 1) {
    const { schema: unwrapped } = normalize(current, doc);
    if (envelope && isObject(unwrapped.properties) && envelope in unwrapped.properties) {
      current = deref(unwrapped.properties[envelope] as JsonSchema, doc);
      continue;
    }
    if (unwrapped.type === 'array' && isObject(unwrapped.items)) {
      current = deref(unwrapped.items, doc);
      continue;
    }
    return unwrapped;
  }
  return current;
}

/** `/v1/agents/{agent_id}` and `/v1/agents/{id}` are the same route. */
function pathKey(path: string): string {
  return path.replace(/\{[^}]*\}/g, '{}');
}

function findOperation(doc: OpenApiDoc, entry: ContractEntry): unknown {
  const paths = doc.paths ?? {};
  const exact = paths[entry.path];
  if (isObject(exact)) return exact[entry.method];
  const wanted = pathKey(entry.path);
  for (const [candidate, operations] of Object.entries(paths)) {
    if (pathKey(candidate) === wanted && isObject(operations)) return operations[entry.method];
  }
  return undefined;
}

function responseSchema(doc: OpenApiDoc, entry: ContractEntry): JsonSchema | undefined {
  const operation = findOperation(doc, entry);
  if (!isObject(operation)) return undefined;
  const responses = operation.responses;
  if (!isObject(responses)) return undefined;
  const response = responses[entry.status];
  if (!isObject(response)) return undefined;
  const content = response.content;
  if (!isObject(content)) return undefined;
  const json = content['application/json'];
  if (!isObject(json) || !isObject(json.schema)) return undefined;
  return json.schema;
}

/**
 * The whole check. Returns every disagreement; the caller decides what to do
 * with `info` ones (the test prints them and passes).
 */
export function checkContract(doc: OpenApiDoc, entries: readonly ContractEntry[]): Finding[] {
  const findings: Finding[] = [];

  for (const entry of entries) {
    const raw = responseSchema(doc, entry);
    if (!raw) {
      findings.push({
        severity: 'error',
        where: entry.name,
        message: `spec has no ${entry.method.toUpperCase()} ${entry.path} → ${entry.status} application/json response — route renamed, removed, or never shipped`,
      });
      continue;
    }

    const server = leafOf(raw, entry.envelope, doc);
    const client = z.toJSONSchema(entry.schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;

    findings.push(...compare(normalize(server, doc), normalize(client, doc), entry.name, doc));
  }

  return findings;
}

export function errorsIn(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === 'error');
}

export function formatFindings(findings: readonly Finding[]): string {
  return findings.map((f) => `  [${f.severity}] ${f.where}\n      ${f.message}`).join('\n');
}
