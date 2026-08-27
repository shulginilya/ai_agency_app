#!/usr/bin/env node
/**
 * Stand-in for the `agency` control API.
 *
 * It exists so the end-to-end suite can run without your FastAPI process — and,
 * more importantly, so the suite can force failure modes (readiness down, no run
 * slot, a busy session, the whole API unreachable) that are hard to produce on
 * demand against a real server. Zero dependencies on purpose:
 * `node tools/mock-agent-api.mjs`.
 *
 *   PORT=8000 node tools/mock-agent-api.mjs
 *
 * It serves the surface in `contracts/openapi.json` and nothing else. That is
 * the point of it: the previous version implemented agent lifecycle commands and
 * a per-agent message thread that the real server has never had, and the app was
 * written against the mock rather than against the API. Errors are RFC 9457
 * problem documents, like the real thing.
 *
 * Test-only control channel:
 *   POST /__control__ {"readyz":"fail"}      -> readiness answers 503
 *   POST /__control__ {"runs":"busy"}        -> runs and turns answer 503 (no slot)
 *   POST /__control__ {"runs":"fail"}        -> the agent loop 502s
 *   POST /__control__ {"runs":"error"}       -> 200 with is_error: true
 *   POST /__control__ {"sessions":"busy"}    -> every session reports busy; turns 409
 *   POST /__control__ {"replyDelayMs":5000}  -> the stub agent takes its time
 *   POST /__control__ {"latencyMs":1200}     -> every response is delayed
 *   POST /__control__ {"reset":true}         -> back to defaults, sessions dropped
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8000);
const VERSION = '0.1.0';

const DEFAULT_STATE = {
  /** 'ok' | 'fail' */
  healthz: 'ok',
  readyz: 'ok',
  /** 'ok' | 'busy' (503) | 'fail' (502) | 'error' (200 with is_error) | 'timeout' (504) */
  runs: 'ok',
  /** 'ok' | 'busy' — a busy session refuses turns with 409 and refuses to close. */
  sessions: 'ok',
  /** How long the stub agent "thinks" before answering. */
  replyDelayMs: 250,
  latencyMs: 0,
};

let state = { ...DEFAULT_STATE };

/**
 * The roster. Names, not ids like `a1`: on the real server an agent's id equals
 * its name, and a test that pretends otherwise stops testing the real thing.
 */
const AGENT_SEED = [
  {
    id: 'researcher',
    name: 'researcher',
    status: 'idle',
    description: 'Reads the brief and pulls together background before anyone writes code.',
    availability: 'always',
    team: null,
    model: 'sonnet',
    tools: ['Read', 'Grep', 'WebSearch'],
    max_turns: 12,
    invocations: 0,
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    status: 'running',
    description: 'Reviews a diff and reports what would break.',
    availability: 'team',
    team: 'engineering',
    model: null,
    tools: null,
    max_turns: null,
    invocations: 3,
  },
  {
    id: 'builder',
    name: 'builder',
    status: 'idle',
    description: 'Applies the plan and runs the tests.',
    availability: 'team',
    team: 'engineering',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Bash'],
    max_turns: 20,
    invocations: 1,
  },
  {
    id: 'scribe',
    name: 'scribe',
    status: 'idle',
    description: 'Writes the run up afterwards, for people who were not watching.',
    availability: 'team',
    team: 'docs',
    model: 'haiku',
    tools: ['Read', 'Write'],
    max_turns: 4,
    invocations: 0,
  },
];

/**
 * The teams the mock knows, derived the same way the app derives them: a team
 * exists because a worker names it. Two of them on purpose — a mock with one
 * team cannot catch a client that hardcodes it.
 */
const teamNames = () => [...new Set(AGENT_SEED.map((agent) => agent.team).filter(Boolean))];

/** The real server 422s an unknown team; a mock that accepted anything would hide it. */
function unknownTeam(team) {
  return team !== undefined && team !== null && !teamNames().includes(team);
}

const seedAgents = () => AGENT_SEED.map((agent) => ({ ...agent, updated_at: new Date().toISOString() }));

let agents = seedAgents();

/** id -> SessionInfo. Sessions are per-process on the real server too. */
let sessions = new Map();
let sessionCounter = 0;
let runCounter = 0;

const SESSION_TTL_MS = 15 * 60 * 1000;

function newSession({ profile, team }) {
  sessionCounter += 1;
  const now = new Date();
  const session = {
    id: `sess_${sessionCounter}`,
    profile: profile ?? 'dev',
    // The name, or null for solo — a boolean until the server grew a second team.
    team: team ?? null,
    status: 'idle',
    turns: 0,
    created_at: now.toISOString(),
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
  sessions.set(session.id, session);
  return session;
}

/**
 * A finished run, shaped exactly like `RunResponse`. The tool trace is not
 * decoration: the app renders it under every reply, so an empty one would leave
 * that path untested.
 */
function buildRun({ prompt, team, profile, isError = false }) {
  runCounter += 1;
  // Delegation comes from the roster, so a run as `engineering` names
  // engineering's workers and never docs'. A mock that always said
  // `['researcher']` would let a team mix-up through untouched.
  const delegated = team ? AGENT_SEED.filter((agent) => agent.team === team).map((agent) => agent.name) : [];
  return {
    run_id: `run_${runCounter}`,
    profile: profile ?? 'dev',
    model: 'claude-sonnet-4-6',
    is_error: isError,
    output: isError ? null : `Acknowledged: "${prompt}". A real agent would do the work here.`,
    num_turns: team ? 3 : 1,
    duration_ms: Math.max(1, Number(state.replyDelayMs) || 1),
    total_cost_usd: 0.0042,
    usage: { input_tokens: 1200, output_tokens: 340 },
    tools_used: ['Read'],
    delegated_to: delegated,
    tool_events: [
      { tool: 'Read', phase: 'pre', at: new Date().toISOString(), detail: { path: 'README.md' } },
      { tool: 'Read', phase: 'post', at: new Date().toISOString(), detail: { bytes: 812 } },
      ...(isError ? [{ tool: 'Bash', phase: 'failed', at: new Date().toISOString(), detail: { code: 1 } }] : []),
    ],
    summary: isError ? 'The agent loop reported an error.' : `Handled: ${prompt.slice(0, 60)}`,
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
  'Cache-Control': 'no-store',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(payload);
}

/** RFC 9457, like the real server. The app reads `detail` and shows it verbatim. */
function problem(res, status, title, detail, instance) {
  res.writeHead(status, { 'Content-Type': 'application/problem+json', ...CORS_HEADERS });
  res.end(
    JSON.stringify({
      type: `https://agency.invalid/problems/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      title,
      status,
      detail,
      instance: instance ?? null,
      request_id: `mock_${Date.now().toString(36)}`,
    }),
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shared by `POST /v1/runs` and a session turn — they cost the same server-side. */
async function runOrProblem(res, { prompt, team, profile, instance }) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { failed: true, sent: problem(res, 422, 'Request failed validation', 'prompt must not be empty', instance) };
  }
  if (unknownTeam(team)) {
    return {
      failed: true,
      sent: problem(res, 422, 'Request failed validation', `no team named ${team}`, instance),
    };
  }
  if (prompt.length > 20_000) {
    return { failed: true, sent: problem(res, 422, 'Request failed validation', 'prompt is too long', instance) };
  }
  if (state.runs === 'busy') {
    return { failed: true, sent: problem(res, 503, 'No run slot available', 'All run slots are in use; retry.', instance) };
  }
  if (state.runs === 'fail') {
    return { failed: true, sent: problem(res, 502, 'The agent loop failed', 'The SDK client raised mid-run.', instance) };
  }
  if (state.runs === 'timeout') {
    return { failed: true, sent: problem(res, 504, 'Run exceeded the server timeout', 'The run was cut off.', instance) };
  }

  await sleep(Math.max(0, Number(state.replyDelayMs) || 0));
  return { failed: false, run: buildRun({ prompt: prompt.trim(), team, profile, isError: state.runs === 'error' }) };
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (pathname === '/__control__') {
    if (method === 'POST') {
      const patch = await readJson(req);
      state = patch.reset ? { ...DEFAULT_STATE } : { ...state, ...patch };
      delete state.reset;
      if (patch.reset) {
        agents = seedAgents();
        sessions = new Map();
      }
      if (patch.sessions === 'reset') {
        sessions = new Map();
        state.sessions = DEFAULT_STATE.sessions;
      }
      return send(res, 200, state);
    }
    return send(res, 200, state);
  }

  if (state.latencyMs > 0) await sleep(state.latencyMs);

  /* ------------------------------------------------------------- health */

  if (pathname === '/healthz' && method === 'GET') {
    if (state.healthz === 'fail') return problem(res, 503, 'Not alive', 'Liveness probe failed.');
    return send(res, 200, { status: 'ok', version: VERSION });
  }

  if (pathname === '/readyz' && method === 'GET') {
    const busySlots = state.runs === 'busy';
    if (state.readyz === 'fail') {
      return send(res, 503, {
        status: 'degraded',
        checks: { sdk: 'error: no credentials', profile: 'ok' },
        capacity: { runs_free: 0, sessions_free: 0 },
      });
    }
    return send(res, 200, {
      status: 'ready',
      checks: { sdk: 'ok', profile: 'ok' },
      capacity: {
        runs_free: busySlots ? 0 : 4,
        sessions_free: Math.max(0, 8 - sessions.size),
      },
    });
  }

  /* ------------------------------------------------------------- agents */

  if (pathname === '/v1/agents' && method === 'GET') {
    // The envelope, always — the client accepts a bare array too, and the unit
    // tests cover that, but the server has never sent one.
    return send(res, 200, { agents, count: agents.length });
  }

  const oneAgent = /^\/v1\/agents\/([^/]+)$/.exec(pathname);
  if (oneAgent && method === 'GET') {
    const id = decodeURIComponent(oneAgent[1]);
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) return problem(res, 404, 'No agent with that id', `No agent named ${id}.`, pathname);
    return send(res, 200, agent);
  }

  /* --------------------------------------------------------------- runs */

  if (pathname === '/v1/runs' && method === 'POST') {
    const { prompt, team, profile } = await readJson(req);
    const outcome = await runOrProblem(res, { prompt, team, profile, instance: pathname });
    if (outcome.failed) return outcome.sent;
    return send(res, 200, outcome.run);
  }

  /* ----------------------------------------------------------- sessions */

  if (pathname === '/v1/sessions' && method === 'GET') {
    const open = [...sessions.values()].map((session) => ({
      ...session,
      status: state.sessions === 'busy' ? 'busy' : session.status,
    }));
    return send(res, 200, { sessions: open, count: open.length });
  }

  if (pathname === '/v1/sessions' && method === 'POST') {
    const body = await readJson(req);
    if (body.profile !== undefined && !['dev', 'sandboxed', 'eval'].includes(body.profile)) {
      return problem(res, 422, 'Request failed validation', 'profile must be dev, sandboxed or eval', pathname);
    }
    if (unknownTeam(body.team)) {
      return problem(res, 422, 'Request failed validation', `no team named ${body.team}`, pathname);
    }
    if (sessions.size >= 8) {
      return problem(res, 503, 'No session slot available', 'Too many open sessions; close one.', pathname);
    }
    // 201: this created a resource the caller is now responsible for closing.
    return send(res, 201, newSession(body));
  }

  const oneSession = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
  if (oneSession) {
    const id = decodeURIComponent(oneSession[1]);
    const session = sessions.get(id);
    if (!session) return problem(res, 404, 'No such session', 'It was closed or expired.', pathname);

    if (method === 'GET') {
      return send(res, 200, { ...session, status: state.sessions === 'busy' ? 'busy' : session.status });
    }

    if (method === 'DELETE') {
      if (state.sessions === 'busy') {
        return problem(res, 409, 'A turn is in flight', 'Wait for the turn to finish, then close.', pathname);
      }
      sessions.delete(id);
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
  }

  const turn = /^\/v1\/sessions\/([^/]+)\/messages$/.exec(pathname);
  if (turn && method === 'POST') {
    const id = decodeURIComponent(turn[1]);
    const session = sessions.get(id);
    if (!session) return problem(res, 404, 'No such session', 'It was closed or expired.', pathname);
    if (state.sessions === 'busy') {
      return problem(res, 409, 'A turn is already in flight', 'One turn at a time per session.', pathname);
    }

    const body = await readJson(req);
    // `extra="forbid"` server-side: profile and team are fixed at open time.
    const extra = Object.keys(body).filter((key) => key !== 'prompt');
    if (extra.length > 0) {
      return problem(res, 422, 'Request failed validation', `unexpected field(s): ${extra.join(', ')}`, pathname);
    }

    session.status = 'busy';
    const outcome = await runOrProblem(res, {
      prompt: body.prompt,
      team: session.team,
      profile: session.profile,
      instance: pathname,
    });

    if (outcome.failed) {
      // A 502 or 504 closes the session on the way out, so "retry the same id"
      // is not on the table — same as the real server.
      session.status = 'idle';
      if (state.runs === 'fail' || state.runs === 'timeout') sessions.delete(id);
      return outcome.sent;
    }

    session.status = 'idle';
    session.turns += 1;
    session.last_active_at = new Date().toISOString();
    return send(res, 200, { session_id: id, turn: session.turns, run: outcome.run });
  }

  problem(res, 404, 'Not Found', `No route for ${method} ${pathname}.`, pathname);
});

server.listen(PORT, () => {
  process.stdout.write(`mock agency API listening on http://localhost:${PORT}\n`);
});
