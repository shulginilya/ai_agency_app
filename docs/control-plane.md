# Agent control plane — how the API layer works

Proof of concept for driving agents from the app. Today the API exposes two
endpoints (`/healthz`, `/readyz`); the point of this layer is that adding the
next twenty is a three-line change each.

## The shape of it

```
app/(tabs)/agents.tsx      Screen: status, probes, agents, request log
        │
src/hooks/                 useSystemStatus, useAgents  (React Query)
        │
src/api/system.ts          Endpoint modules: a path, a schema, one call
src/api/agents.ts
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

## Decisions worth knowing about

**Probes do not throw.** `runProbe` returns `{ ok: false, error }` instead of
rejecting, because "the API is down" is a state the screen renders, not an
exception. Cancellation *does* reject, so React Query drops the request rather
than caching a bogus verdict. Everything else in the API layer throws normally.

**The HTTP status is the probe's answer.** That is the Kubernetes convention for
`/healthz` and `/readyz`: 2xx means pass, anything else means fail, and the body
is a bonus. So `ProbeBodySchema` is permissive — unknown fields are kept, an
empty body is legal. Every other schema is strict: a shape change raises a
`validation` error instead of rendering `undefined` three screens later.

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
| Endpoints | `src/api/__tests__/{system,agents}.test.ts` | probe verdicts, schema strictness, both list shapes |
| Hooks | `src/hooks/__tests__/*` | healthy/degraded/down, polling, invalidation |
| Components | `src/components/__tests__/*` | probe card states, log rows |
| Screen | `__tests__/agents-screen.test.tsx` | the whole thing with only `fetch` stubbed |
| Browser | `cypress/e2e/control-plane.cy.ts` | real bundle, real HTTP, real polling |

`npm test` · `npm run test:coverage` · `npm run e2e` · `npm run verify`

The e2e run starts `tools/mock-agent-api.mjs` (zero dependencies) rather than
your FastAPI, so the suite can force failure modes on demand:

```bash
curl -X POST localhost:8000/__control__ -d '{"readyz":"fail"}'    # readiness down
curl -X POST localhost:8000/__control__ -d '{"agents":"enabled"}' # /agents starts existing
curl -X POST localhost:8000/__control__ -d '{"latencyMs":1200}'   # slow API
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
