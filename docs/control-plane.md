# Agent control plane — how the API layer works

Proof of concept for driving agents from the app. Today the API exposes two
health checks (`/healthz`, `/readyz`) and the first versioned data route,
`/v1/agents`; the point of this layer is that adding the next twenty is a
three-line change each.

Every agent route lives under `/v1/agents` — list, detail, commands and the
message thread. The version prefix lives in the path (`AGENTS_PATH` /
`agentPath()` in `src/api/agents.ts`) and nowhere else: not in the base URL, not
in a per-call option, so a `/v2` route can sit beside a `/v1` one without a flag
day.

## The shape of it

```
app/(tabs)/index.tsx       Screen: status, probes, agent list, request log (default tab)
app/agent/[id].tsx         Route wrapper — reads the id, mounts the screen
        │
src/screens/AgentChat.tsx  Screen: one agent — thread, composer, controls
        │
src/hooks/                 useSystemStatus, useAgents, useMessages (React Query)
        │
src/api/system.ts          Endpoint modules: a path, a schema, one call
src/api/agents.ts
src/api/messages.ts
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
export const RunSchema = z.object({ id: z.string(), agent_id: z.string(), state: z.enum(['queued', 'done']) });

// src/api/runs.ts
export async function listRuns({ client = apiClient, signal }: AgentsApiOptions = {}) {
  const { data } = await client.get('/runs', { schema: z.array(RunSchema), signal });
  return data;
}

// src/hooks/useRuns.ts
export function useRuns() {
  return useQuery({ queryKey: qk.runs(), queryFn: ({ signal }) => listRuns({ signal }) });
}
```

Add the key to `src/query/keys.ts`, and a test next to the others. That's it.

## Looking at the screen before the route serves anything

*Temporary.* `EXPO_PUBLIC_MOCK_AGENTS=1` in `.env` makes `listAgents`, `getAgent`
and `commandAgent` answer from `src/api/fixtures/agents.ts` — six agents, one per
status — instead of calling `/v1/agents`. Restart Metro after changing it; Expo
inlines `EXPO_PUBLIC_*` at bundle time. Start/pause/stop really do move a row, so
the screen is worth clicking rather than being a screenshot; the state resets on
reload. No request is made, so mocked calls do not appear in the request log.

Unset — the default, and what every test run and CI sees — none of it is
reachable. To remove it for good: delete the fixtures file and the three
`if (MOCK_AGENTS_ENABLED)` early returns in `src/api/agents.ts`.

The message thread is not mocked, so tapping into a chat shows the "no messaging
endpoint yet" notice unless `tools/mock-agent-api.mjs` is running.

## Talking to an agent

Tapping an agent on the control screen opens `app/agent/[id].tsx`: a thread, a
composer, and the start/pause/stop controls in the header. It runs on two
endpoints the server does not have yet — `tools/mock-agent-api.mjs` implements
them, so the screen is fully clickable today and the FastAPI side only has to
match these shapes.

```http
GET /v1/agents/{id}/messages?after=<message id>&limit=<n>
200 { "messages": [ Message, … ] }        # a bare [ … ] is accepted too

POST /v1/agents/{id}/messages
    { "content": "summarise the leads" }
202 { "message": Message }                # a bare Message is accepted too
```

```jsonc
// Message
{
  "id": "m1",
  "agent_id": "a1",
  "role": "user",            // user · agent · system
  "content": "summarise the leads",
  "created_at": "2026-08-16T09:00:00Z",   // required: the thread is ordered by it
  "pending": true                          // optional: still being produced
}
```

**The POST answers with your message, not with the reply.** `202 Accepted` means
the work is queued; the answer turns up in a later `GET`. That split is what
makes the round trip pollable without any streaming machinery, and it is the
shape a queue-backed agent wants anyway — accepting work and finishing work are
different moments, and only one of them is fast.

**Polling is conditional.** `useMessages` asks one question — is an answer
outstanding? — and only then sets a `refetchInterval` (1.5s). Outstanding means
either the server flagged a message `pending`, or the last thing in the thread is
something you said. An idle thread makes no requests at all. After 60 seconds
with no answer it stops and says so rather than spinning forever, with a "check
again" that starts the wait over.

**Sending is optimistic, and rolls back.** Your bubble appears before the network
answers, because a chat that waits for a round trip to echo your own words feels
broken. If the POST fails, the optimistic message is removed rather than left
lying about having been delivered, and the screen puts your text back in the
composer. `POST` is never auto-retried by `HttpClient` — a duplicate instruction
to an agent is worse than a failed one.

**`role: "system"` is the control plane narrating itself.** Pausing an agent
writes "…was paused" into the same thread, so one surface holds both what was
said to the agent and what happened to it. If your API would rather keep events
separate, just never emit the role — the client renders whatever it is given.

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
| Route renamed or removed | `spec has no GET /v1/agents → 200 application/json response` |

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

- `AgentStatus`/`MessageRole` are `StrEnum`, not `str`. A bare `str` means a
  seventh status is legal on the wire and fatal in the app.
- Identifiers carry `Field(min_length=1)`, matching `z.string().min(1)` here.
  (A `datetime` field is exempt — a `date-time` string is never empty.)
- `str | None = None` puts `"updated_at": null` on the wire, not an absent key.
  `Agent.updated_at`, `Agent.description` and `Message.pending` are `.nullish()`
  here for that reason. If you would rather omit the key, set
  `response_model_exclude_none=True` on the route.

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
| Endpoints | `src/api/__tests__/{system,agents,messages}.test.ts` | probe verdicts, schema strictness, both list shapes |
| Contract | `src/api/__tests__/contract.test.ts` | the pinned FastAPI spec still fits through `schemas.ts` |
| Hooks | `src/hooks/__tests__/*` | healthy/degraded/down, conditional polling, optimistic send + rollback |
| Components | `src/components/__tests__/*` | probe card states, log rows, message bubbles |
| Screens | `__tests__/{agents-screen,agent-chat}.test.tsx` | the whole thing with only `fetch` stubbed |
| Browser | `cypress/e2e/{control-plane,agent-chat}.cy.ts` | real bundle, real HTTP, a reply arriving by itself |

`npm test` · `npm run test:coverage` · `npm run e2e` · `npm run verify`

The e2e run starts `tools/mock-agent-api.mjs` (zero dependencies) rather than
your FastAPI, so the suite can force failure modes on demand:

```bash
curl -X POST localhost:8000/__control__ -d '{"readyz":"fail"}'      # readiness down
curl -X POST localhost:8000/__control__ -d '{"agents":"reset"}'     # agent statuses back to the seed
curl -X POST localhost:8000/__control__ -d '{"messages":"missing"}' # the chat endpoints 404
curl -X POST localhost:8000/__control__ -d '{"send":"fail"}'        # sending answers 500
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
