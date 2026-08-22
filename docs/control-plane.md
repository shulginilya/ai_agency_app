# Agent control plane — how the API layer works

The app is a consumer of the `agency` HTTP API. The whole of that API is:

```
GET    /healthz                        liveness
GET    /readyz                         readiness, with free run and session slots
GET    /v1/agents                      the subagent roster
GET    /v1/agents/{agent_id}           one roster entry
POST   /v1/runs                        one prompt, run to completion
GET    /v1/sessions                    what this process is holding open
POST   /v1/sessions                    open a conversation
GET    /v1/sessions/{session_id}       poll one handle
DELETE /v1/sessions/{session_id}       close it
POST   /v1/sessions/{session_id}/messages   one turn
```

The version prefix lives in the path (`AGENTS_PATH` / `SESSIONS_PATH` /
`RUNS_PATH` and their `…Path()` helpers) and nowhere else: not in the base URL,
not in a per-call option, so a `/v2` route can sit beside a `/v1` one without a
flag day.

**The roster is read-only, and the agents are not addressable.** There is no
`POST /v1/agents/{id}/start|stop|pause` and no `/v1/agents/{id}/messages`. The
client carried both for a while, against a mock that implemented them; the
contract test is what proved they had never existed on any server. Work reaches
an agent by being delegated to it from a team run, and a worker is running or it
is gone — the SDK exposes `interrupt()` on the main session, not on individual
workers.

## The shape of it

```
app/(tabs)/index.tsx         Screen: the agent roster (default tab)
app/(tabs)/chat.tsx          Route wrapper → src/screens/Conversation.tsx
app/(tabs)/control-plane.tsx Screen: status, probes, open sessions, request log
app/agent/[id].tsx           Route wrapper → src/screens/AgentDetail.tsx
        │
src/screens/Conversation.tsx  Screen: session or one-shot run, transcript, composer
src/screens/AgentDetail.tsx   Screen: one roster entry, in full
        │
src/chat/transcript.ts     The conversation — client-side, because the server keeps none
        │
src/hooks/                 useSystemStatus, useAgents, useSessions, useConversation
        │
src/api/system.ts          Endpoint modules: a path, a schema, one call
src/api/agents.ts
src/api/runs.ts
src/api/sessions.ts
        │
src/api/http.ts            HttpClient: timeouts, retries, auth, validation
src/api/client.ts          The app-wide instance
src/api/config.ts          Which base URL, on which platform
src/api/errors.ts          ApiError — one error type, with a `kind`
src/api/log.ts             Ring buffer of the last 50 calls
```

Rule of thumb: **transport concerns live in `http.ts` and nowhere else.** An
endpoint module never touches headers, timeouts or retries; a screen never
touches `fetch`.

## Adding an endpoint

```ts
// src/api/schemas.ts
export const RunRecordSchema = z.object({ run_id: z.string(), started_at: z.string().min(1) });

// src/api/runs.ts
export async function listRunHistory({ client = apiClient, signal }: RunsApiOptions = {}) {
  const { data } = await client.get(`${RUNS_PATH}/history`, { schema: z.array(RunRecordSchema), signal });
  return data;
}

// src/hooks/useRunHistory.ts
export function useRunHistory() {
  return useQuery({ queryKey: qk.runHistory(), queryFn: ({ signal }) => listRunHistory({ signal }) });
}
```

Add the key to `src/query/keys.ts`, an entry to `CONTRACT` in
`src/api/__tests__/contract.test.ts`, and a test next to the others. That's it.

Before adding to `CONTRACT`, check the route is actually in
`contracts/openapi.json`. A manifest entry for a route nobody serves fails the
build — which is the whole point, and is how the phantom agent-command routes
were finally found.

## Looking at the screen before the route serves anything

*Temporary.* `EXPO_PUBLIC_MOCK_AGENTS=1` in `.env` makes `listAgents` and
`getAgent` answer from `src/api/fixtures/agents.ts` — six agents, one per status
— instead of calling `/v1/agents`. Restart Metro after changing it; Expo inlines
`EXPO_PUBLIC_*` at bundle time. No request is made, so mocked calls do not appear
in the request log.

Unset — the default, and what every test run and CI sees — none of it is
reachable. To remove it for good: delete the fixtures file and the two
`if (MOCK_AGENTS_ENABLED)` early returns in `src/api/agents.ts`.

Nothing else is mocked: for a working conversation, run
`npm run mock:api` (or your own server) and point the app at it.

## Talking to the server: runs and sessions

You do not talk to an agent. The roster lists *subagents*, and the manager — the
thread you actually converse with — is not on it; `team: true` is what selects
it. The Conversation tab offers the two ways the API gives you to send work.

**One-shot — `POST /v1/runs`.** One prompt, one answer, no memory, nothing to
clean up.

```http
POST /v1/runs
    { "prompt": "rank the leads", "team": true }     # profile optional
200 RunResponse
```

**A conversation — `/v1/sessions`.** Open once, then a turn per message. The
agent remembers, and you own a live subprocess until you close it.

```http
POST   /v1/sessions              { "team": true }   201 SessionInfo
POST   /v1/sessions/{id}/messages { "prompt": "…" } 200 { session_id, turn, run }
DELETE /v1/sessions/{id}                            204
```

Five things about that contract shape the client, and each one is load-bearing:

**The turn's result is the same `RunResponse` a one-shot run returns**, nested
under `run`. So the screen renders a turn and a run through one code path, and
`src/chat/transcript.ts` has one `agentEntry()` rather than two.

**`is_error: true` arrives on a 200.** The request succeeded; the agent did not.
Nothing in the HTTP layer will tell you — `MessageBubble` reads the flag and says
so out loud, because a failed run that renders as a normal reply is worse than an
error.

**`profile` and `team` are fixed at open time.** Sending either on a turn is a
422, not a no-op: they were baked into the options the session connected with.
The screen disables those controls once a session exists rather than letting you
find out.

**One turn at a time.** A message to a busy session is a 409, not a queued turn.
A turn also takes a slot from the same `RunSlots` pool `POST /v1/runs` draws
from, so a 503 means the server is busy rather than the session being wrong.

**502 and 504 close the session server-side.** A cancelled drain leaves the SDK
client indeterminate, so the server drops the handle on its way out — and
"retry the same session id" is the obvious, wrong next move. `sessionIsGone()`
in `src/api/sessions.ts` names those statuses; `useConversation` drops the handle
and says so in the thread, and the next message opens a fresh session.

### The transcript is the client's

There is no `GET /v1/sessions/{id}/messages`. `SessionInfo` is a handle — status,
turn count, expiry — and each turn is persisted server-side as its own run
record. Whatever the screen shows as a thread, the screen owns.

That is *less* machinery than the polled thread this replaced, not more. A turn
is one request that returns the finished reply, so there is no accept-then-poll
dance, no `pending` flag arriving from the wire, no 60-second give-up timer, and
no way for two clients to disagree about the order. `src/chat/transcript.ts` is
pure functions over an array; the only optimistic state is your own line, held
while its request is in flight and rolled back if the send fails — the screen
puts your text back in the composer. `POST` is never auto-retried by
`HttpClient`: a retried run is a second run, and it costs money.

`role: 'system'` is the control plane narrating itself into the same thread —
session opened, session closed, session dropped by the server.

### What a reply is worth looking at for

Under every agent line: turns, wall time, cost, model, who it delegated to, the
tools it touched, and any guardrail denial or tool failure. That trace is most of
the reason to look at this screen rather than run the CLI — and `delegated_to` is
the only place the roster and the conversation visibly meet.

## Keeping the Python API and these schemas in step

The API is a separate FastAPI repo. Nothing generates anything: `src/api/schemas.ts`
is hand-written, the Pydantic models are hand-written, and a test compares them.

The obvious alternative was code generation — either the server's spec generates
`schemas.ts`, or `schemas.ts` generates the Pydantic models. Both work. Both mean
one side stops being hand-written, and the comments in `schemas.ts` explaining
*why* a field is loose are exactly the thing a generator discards. So instead:

```
FastAPI repo                          this repo
────────────                          ─────────
contracts/python/contracts.py    →    contracts/openapi.json      (npm run contract:pull)
  hand-written Pydantic                 pinned copy of the spec
export_openapi.py --check                        ↓
  CI: spec committed?                 src/api/__tests__/contract.test.ts
                                        does the spec fit through our zod?
                                                 ↓
                                      src/api/schemas.ts
                                        hand-written zod
```

`contracts/python/` holds a reference copy of both Python files — copy them into
the API repo; they are not run from here.

**The comparison is asymmetric, on purpose.** The server produces and the app
consumes, so the question is never "are these identical" but *can the server send
something this app would refuse*. A field the server sends and the app ignores is
fine — zod strips unknown keys. A field the app requires that the server may omit
is a crash. Only the second kind fails the build; the first is printed and
tolerated.

What it catches, in the words it uses:

| Change on the server | What the test says |
|---|---|
| Field renamed (`status` → `state`) | `client requires this field, the server does not document it at all` |
| Field made optional | `client requires this field, server may omit it` |
| New enum member (`draining`) | `server may send [draining], client rejects those values` |
| `AgentStatus` loosened to `str` | `client accepts only […], server documents an open string — declare an enum server-side` |
| `str` where the app expects a number | `server sends integer, client expects string` |
| `min_length` dropped | `client requires minLength 1, server permits 0` |
| A field started arriving as `null` | `server may send null here, client rejects it` |
| Route renamed, removed, or never shipped | `spec has no POST /v1/agents/{id}/start → 200 application/json response` |

**Everyday use needs no server.** The test reads the pinned `contracts/openapi.json`,
so `npm test` works offline and in CI. A spec change reaches the build only when
someone commits it — which is the moment the conversation should happen.

```bash
npm run contract:pull                              # refresh from localhost:8000
npm run contract:pull -- --url http://10.0.2.2:8000
npm run contract:pull -- --check                   # CI, when the API is available
```

Both sides sort the spec's keys before writing, because FastAPI's key order is not
stable across versions — unsorted, every regeneration is a diff nobody reads.

**Three things the Python side has to say out loud**, because the app already
assumes them and the test enforces them:

- `AgentStatus`, `availability`, session `status` and `ToolEvent.phase` are
  enums, not `str`. A bare `str` means a seventh status is legal on the wire and
  fatal in the app.
- Whatever carries `Field(min_length=1)` server-side is what may carry `.min(1)`
  here — and no more. `AgentInfo.name` does *not* declare one, so the client does
  not either: demanding it would refuse a legal response. (A `datetime` field is
  exempt — a `date-time` string is never empty.)
- `str | None = None` puts `"model": null` on the wire, not an absent key.
  `AgentInfo.model`/`tools`/`max_turns`, `SessionInfo.expires_at` and
  `RunResponse.output` are `.nullish()` here for that reason. If you would rather
  omit the key, set `response_model_exclude_none=True` on the route.
- `Problem.detail` is required. `describeApiError` shows it verbatim, so the day
  it goes optional every error message in the app quietly degrades to generic
  copy — which is why the 409/503/404 problem responses are in `CONTRACT` too.

**The mock is not checked against this.** `tools/mock-agent-api.mjs` exists to
force failure modes the real API cannot be asked for; keeping it spec-conformant
would defeat that.

## Decisions worth knowing about

**Probes do not throw.** `runProbe` returns `{ ok: false, error }` instead of
rejecting, because "the API is down" is a state the screen renders, not an
exception. Cancellation *does* reject, so React Query drops the request rather
than caching a bogus verdict. Everything else in the API layer throws normally.

**The HTTP status is the probe's answer.** That is the Kubernetes convention for
`/healthz` and `/readyz`: 2xx means pass, anything else means fail, and the body
is a bonus. `PROBES` (`src/api/system.ts`) is not *limited* to health-check-shaped
routes — `ProbeBodySchema` accepts anything: an object, a list, nothing — but
data endpoints stay out of it. `/v1/agents` is fetched by `useAgents` and the
list on the screen already says whether that call worked; probing it as well
would double the traffic to answer the same question twice. Every other schema
is strict: a shape change raises a `validation` error instead of rendering
`undefined` three screens later.

**Retries live in the transport, not in React Query.** `HttpClient` knows which
methods are idempotent (GET/HEAD/PUT/DELETE) and which failures are transient
(network, timeout, 408/425/429/5xx), and backs off 300ms → 600ms → 1200ms. POSTs
are never replayed. React Query's own retry is a thin backstop that refuses to
retry any error the client already marked non-retryable.

**One error type.** Every failure surfaces as `ApiError` with a `kind`:
`network` · `timeout` · `aborted` · `http` · `parse` · `validation`. Screens
switch on that, or just render `error.userMessage`.

**Auth is wired but empty.** `setAuthTokenProvider()` in `src/api/client.ts`
takes any sync or async function; when it returns a token the client sends
`Authorization: Bearer …`. Point it at SecureStore when the API grows auth —
nothing else changes. `EXPO_PUBLIC_API_TOKEN` is for local work only: anything
`EXPO_PUBLIC_*` is baked into the bundle and readable by anyone with the app.

**The request log exists so the network is visible.** Every attempt (including
retries) is pushed to a 50-entry ring buffer that the screen renders. It is
in-memory only, never persisted.

## Reaching your API from a device

`resolveBaseUrl` picks, in order: `EXPO_PUBLIC_API_URL` → the Metro LAN host →
a platform default.

| Where the app runs | What `localhost:8000` means there | What the app uses |
|---|---|---|
| Web (`npm run web`) | your machine ✅ | `http://localhost:8000` |
| iOS simulator | your machine ✅ | `http://localhost:8000` |
| Android emulator | the emulator itself ❌ | `http://10.0.2.2:8000` |
| Physical phone (Expo Go) | the phone itself ❌ | `http://<Metro LAN IP>:8000` |

For a physical phone this only works if the API listens on all interfaces —
`uvicorn main:app --host 0.0.0.0 --port 8000`, not the default `127.0.0.1` — and
Windows Firewall allows inbound 8000 on the private network.

**Web needs CORS.** The browser blocks `localhost:8081 → localhost:8000` unless
the API says otherwise; that failure arrives as a `network` error, which is why
the message mentions it. For FastAPI:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Native (iOS/Android) does not use CORS, so a device build works without it.
Plain `http://` is allowed on both platforms for localhost/LAN in development;
production over the public internet should be HTTPS.

## Tests

| Layer | Where | What it pins down |
|---|---|---|
| Transport | `src/api/__tests__/http.test.ts` | timeouts, abort, backoff, auth header, error taxonomy, logging |
| Config | `src/api/__tests__/config.test.ts` | base URL per platform and host |
| Endpoints | `src/api/__tests__/{system,agents,runs,sessions}.test.ts` | probe verdicts, schema strictness, what is and is not retried |
| Contract | `src/api/__tests__/contract.test.ts` | the pinned FastAPI spec still fits through `schemas.ts` |
| Transcript | `src/chat/__tests__/transcript.test.ts` | the conversation as pure functions: rollback, fallbacks, formatting |
| Hooks | `src/hooks/__tests__/*` | healthy/degraded/down, session reuse, optimistic send + rollback, a session dropped under you |
| Components | `src/components/__tests__/*` | probe card states, log rows, message bubbles and their run trace |
| Screens | `__tests__/{agents-screen,agent-detail,conversation-screen,control-plane-screen}.test.tsx` | the whole thing with only `fetch` stubbed |
| Browser | `cypress/e2e/{agents,conversation,control-plane}.cy.ts` | real bundle, real HTTP, a real session held between messages |

`npm test` · `npm run test:coverage` · `npm run e2e` · `npm run verify`

The e2e run starts `tools/mock-agent-api.mjs` (zero dependencies) rather than
your FastAPI, so the suite can force failure modes on demand:

```bash
curl -X POST localhost:8000/__control__ -d '{"readyz":"fail"}'      # readiness down
curl -X POST localhost:8000/__control__ -d '{"runs":"busy"}'        # 503: no run slot, and capacity drops to 0
curl -X POST localhost:8000/__control__ -d '{"runs":"fail"}'        # 502: the loop failed, and the session is closed
curl -X POST localhost:8000/__control__ -d '{"runs":"error"}'       # 200 with is_error: true
curl -X POST localhost:8000/__control__ -d '{"sessions":"busy"}'    # 409 on a turn, and on closing
curl -X POST localhost:8000/__control__ -d '{"replyDelayMs":5000}'  # a slow agent
curl -X POST localhost:8000/__control__ -d '{"latencyMs":1200}'     # slow API
curl -X POST localhost:8000/__control__ -d '{"reset":true}'
```

To point Cypress at your real API instead:

```bash
npm run web:e2e                                   # terminal 1
CYPRESS_API_URL=http://localhost:8000 npx cypress run   # terminal 2
```

Specs that call `cy.setApiState` will fail against the real API — it has no
`/__control__` — which is the intended split: the stub covers failure paths, the
real server covers the happy path.
