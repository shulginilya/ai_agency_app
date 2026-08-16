#!/usr/bin/env node
/**
 * Stand-in for the real agent control API.
 *
 * It exists so the end-to-end suite can run without your FastAPI process — and,
 * more importantly, so the suite can force failure modes (readiness down, the
 * whole API unreachable, a slow endpoint) that are hard to produce on demand
 * against a real server. Zero dependencies on purpose: `node tools/mock-agent-api.mjs`.
 *
 *   PORT=8000 node tools/mock-agent-api.mjs
 *
 * Test-only control channel:
 *   POST /__control__ {"readyz":"fail"}      -> readiness starts answering 503
 *   POST /__control__ {"agents":"enabled"}   -> GET /agents starts working
 *   POST /__control__ {"latencyMs":1200}     -> every response is delayed
 *   POST /__control__ {"reset":true}         -> back to defaults
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8000);
const BOOTED_AT = Date.now();

const DEFAULT_STATE = {
  /** 'ok' | 'fail' */
  healthz: 'ok',
  readyz: 'ok',
  /** 'missing' mirrors today's real API, where /agents does not exist yet. */
  agents: 'missing',
  latencyMs: 0,
};

let state = { ...DEFAULT_STATE };
let agents = [
  { id: 'a1', name: 'Research agent', status: 'running', updated_at: new Date().toISOString() },
  { id: 'a2', name: 'Outreach agent', status: 'idle', updated_at: new Date().toISOString() },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Cache-Control': 'no-store',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(payload);
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
      if (patch.agents === 'reset') agents = agents.map((agent) => ({ ...agent, status: 'idle' }));
      return send(res, 200, state);
    }
    return send(res, 200, state);
  }

  if (state.latencyMs > 0) await sleep(state.latencyMs);

  if (pathname === '/healthz' && method === 'GET') {
    if (state.healthz === 'fail') return send(res, 503, { status: 'error', detail: 'liveness probe failed' });
    return send(res, 200, {
      status: 'ok',
      version: '0.1.0',
      uptime_seconds: Math.round((Date.now() - BOOTED_AT) / 1000),
    });
  }

  if (pathname === '/readyz' && method === 'GET') {
    if (state.readyz === 'fail') {
      return send(res, 503, { status: 'not ready', detail: 'database connection is not established' });
    }
    return send(res, 200, { status: 'ready', checks: { database: 'ok', queue: 'ok' } });
  }

  if (pathname === '/agents' && method === 'GET') {
    if (state.agents !== 'enabled') return send(res, 404, { detail: 'Not Found' });
    return send(res, 200, agents);
  }

  const command = /^\/agents\/([^/]+)\/(start|stop|pause)$/.exec(pathname);
  if (command && method === 'POST') {
    if (state.agents !== 'enabled') return send(res, 404, { detail: 'Not Found' });
    const [, id, verb] = command;
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) return send(res, 404, { detail: 'Unknown agent' });
    agent.status = verb === 'start' ? 'running' : verb === 'pause' ? 'paused' : 'stopped';
    agent.updated_at = new Date().toISOString();
    return send(res, 200, agent);
  }

  send(res, 404, { detail: 'Not Found' });
});

server.listen(PORT, () => {
  process.stdout.write(`mock agent API listening on http://localhost:${PORT}\n`);
});
