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
 *   POST /__control__ {"readyz":"fail"}       -> readiness starts answering 503
 *   POST /__control__ {"agents":"enabled"}    -> GET /agents starts working
 *   POST /__control__ {"messages":"missing"}  -> the messaging endpoints 404
 *   POST /__control__ {"send":"fail"}         -> POST a message answers 500
 *   POST /__control__ {"replyDelayMs":5000}   -> the agent takes its time replying
 *   POST /__control__ {"latencyMs":1200}      -> every response is delayed
 *   POST /__control__ {"reset":true}          -> back to defaults
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
  /** 'enabled' | 'missing' — the chat endpoints, independently switchable. */
  messages: 'enabled',
  /** 'ok' | 'fail' — make POST /messages answer 500, to exercise the rollback. */
  send: 'ok',
  /** How long the stub agent "thinks" before its reply appears in the thread. */
  replyDelayMs: 900,
  latencyMs: 0,
};

let state = { ...DEFAULT_STATE };
let agents = [
  { id: 'a1', name: 'Research agent', status: 'running', updated_at: new Date().toISOString() },
  { id: 'a2', name: 'Outreach agent', status: 'idle', updated_at: new Date().toISOString() },
];

/** agent id -> thread. Reset with {"messages":"reset"}. */
let threads = new Map();
let messageCounter = 0;
let pendingReplies = new Set();

function threadFor(agentId) {
  if (!threads.has(agentId)) threads.set(agentId, []);
  return threads.get(agentId);
}

function appendMessage(agentId, role, content, extra = {}) {
  messageCounter += 1;
  const message = {
    id: `m${messageCounter}`,
    agent_id: agentId,
    role,
    content,
    created_at: new Date().toISOString(),
    ...extra,
  };
  threadFor(agentId).push(message);
  return message;
}

/**
 * The whole point of the stub: a reply that arrives *later*, so the client's
 * polling loop, its "working…" state and its optimistic bubble all get exercised
 * for real rather than being mocked away.
 */
function scheduleReply(agent, prompt) {
  const timer = setTimeout(() => {
    pendingReplies.delete(timer);
    appendMessage(agent.id, 'agent', `Acknowledged: "${prompt}". ${agent.name} would do the work here.`);
  }, Math.max(0, Number(state.replyDelayMs) || 0));
  pendingReplies.add(timer);
  timer.unref?.();
}

const PAST_TENSE = { start: 'started', pause: 'paused', stop: 'stopped' };

function clearPendingReplies() {
  pendingReplies.forEach((timer) => clearTimeout(timer));
  pendingReplies = new Set();
}

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
      if (patch.reset || patch.messages === 'reset') {
        clearPendingReplies();
        threads = new Map();
        if (patch.messages === 'reset') state.messages = DEFAULT_STATE.messages;
      }
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

  const one = /^\/agents\/([^/]+)$/.exec(pathname);
  if (one && method === 'GET') {
    if (state.agents !== 'enabled') return send(res, 404, { detail: 'Not Found' });
    const agent = agents.find((candidate) => candidate.id === decodeURIComponent(one[1]));
    if (!agent) return send(res, 404, { detail: 'Unknown agent' });
    return send(res, 200, agent);
  }

  const command = /^\/agents\/([^/]+)\/(start|stop|pause)$/.exec(pathname);
  if (command && method === 'POST') {
    if (state.agents !== 'enabled') return send(res, 404, { detail: 'Not Found' });
    const [, id, verb] = command;
    const agent = agents.find((candidate) => candidate.id === decodeURIComponent(id));
    if (!agent) return send(res, 404, { detail: 'Unknown agent' });
    agent.status = verb === 'start' ? 'running' : verb === 'pause' ? 'paused' : 'stopped';
    agent.updated_at = new Date().toISOString();
    // The control plane narrating itself into the thread, so the chat is a full
    // record of what happened to the agent and not just what was said to it.
    appendMessage(agent.id, 'system', `${agent.name} was ${PAST_TENSE[verb]} — status is now ${agent.status}.`);
    return send(res, 200, agent);
  }

  const thread = /^\/agents\/([^/]+)\/messages$/.exec(pathname);
  if (thread) {
    if (state.messages !== 'enabled') return send(res, 404, { detail: 'Not Found' });
    const agentId = decodeURIComponent(thread[1]);
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) return send(res, 404, { detail: 'Unknown agent' });

    if (method === 'GET') {
      // The envelope shape on purpose: the client has to accept both, and the
      // bare-array case is already covered by the unit tests.
      return send(res, 200, { messages: threadFor(agentId) });
    }

    if (method === 'POST') {
      if (state.send === 'fail') return send(res, 500, { detail: 'Could not queue the message' });
      const { content } = await readJson(req);
      if (typeof content !== 'string' || content.trim() === '') {
        return send(res, 422, { detail: 'content is required' });
      }
      const message = appendMessage(agentId, 'user', content.trim());
      scheduleReply(agent, content.trim());
      // 202: accepted, not answered. The reply arrives in a later GET.
      return send(res, 202, { message });
    }
  }

  send(res, 404, { detail: 'Not Found' });
});

server.listen(PORT, () => {
  process.stdout.write(`mock agent API listening on http://localhost:${PORT}\n`);
});
