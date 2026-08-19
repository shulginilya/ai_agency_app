# ai_agency_app — React Native (Expo) boilerplate

Expo SDK 54 · React Native 0.81 · TypeScript (strict) · expo-router

## Demo functionality

One tab — the default screen the app opens to:

| Tab | Shows off |
|---|---|
| **Agents** | **The agent control plane** — calls your own API (`/healthz`, `/readyz`), shows each call's verdict, latency and raw body, polls every 10s, and logs every request it made. |

The screen is light/dark aware and follows the OS appearance setting.

## Agent control plane

The Agents tab is the default screen and the proof of concept for driving your agents from the app. It
talks to the API on `localhost:8000` through a typed client that handles
timeouts, bounded retries, bearer auth and schema validation in one place — so
each endpoint you add next is a path, a zod schema and a one-line call.

```bash
uvicorn main:app --host 0.0.0.0 --port 8000   # your API
npm run web                                    # then open the Agents tab
```

Point it elsewhere with `EXPO_PUBLIC_API_URL` (see `.env.example`). Left unset,
the app resolves the host itself: `10.0.2.2` on the Android emulator, Metro's LAN
IP on a physical phone, `localhost` otherwise — the two mistakes that otherwise
cost an afternoon. Running in a **browser** additionally needs CORS enabled on
the API.

Architecture, how to add an endpoint, the design decisions and the device/CORS
matrix: **[docs/control-plane.md](docs/control-plane.md)**.

## Project layout

```
app/                    # expo-router: every file here is a route
  _layout.tsx           # root stack + providers (React Query lives here)
  (tabs)/_layout.tsx    # bottom tab bar
  (tabs)/index.tsx      # Agents / control plane screen (default tab)
  +not-found.tsx        # 404 route
src/
  api/                  # http client, config, errors, schemas, endpoints
  components/           # presentational components
  hooks/                # useSystemStatus, useAgents, useMessages
  query/                # React Query client, provider, cache keys
  test-utils/           # fetch doubles + render helpers (test-only)
  theme.ts              # colors, spacing, radii — one place to restyle
cypress/                # end-to-end specs, run against the web build
tools/mock-agent-api.mjs# zero-dependency stub of the control API, for e2e
docs/control-plane.md   # the API layer in detail
app.json                # app name, icons, bundle id, plugins
eas.json                # cloud build profiles
```

`@/` is aliased to `src/`, so `import { useTheme } from '@/theme'` works from anywhere.

## Run it

```bash
npm install
npm start
```

Scripts: `npm start` · `npm run ios` · `npm run android` · `npm run web` · `npm run tunnel` · `npm run typecheck` · `npm run doctor`

## Tests

```bash
npm test                # Jest unit + integration (101 tests)
npm run test:coverage   # same, with coverage thresholds enforced
npm run e2e             # Cypress against the Expo web build + the stub API
npm run verify          # typecheck + coverage + e2e — what CI should run
```

`npm run e2e` boots `tools/mock-agent-api.mjs`, a zero-dependency stand-in for
your API that can be told to fail on demand, so the browser suite also covers the
degraded, offline and slow paths — no FastAPI process required.

---

# Getting it onto your iPhone

You're on Windows, so there's no Xcode locally. That rules out one path and leaves three good ones, easiest first.

## Option 1 — Expo Go (start here, ~2 minutes)

The fastest loop. Your phone runs a host app that loads your JS over the network.

1. Install **Expo Go** from the App Store on your iPhone.
2. On your PC: `npm install && npm start`
3. Scan the QR code in the terminal with the iPhone **Camera** app.

Phone and PC must be on the same Wi-Fi. If your network blocks it (corporate Wi-Fi, VPN, or Windows Firewall), run `npm run tunnel` instead — it routes through Expo's relay and works from anywhere.

- **Cost:** free, no Apple Developer account
- **Good for:** all development on this boilerplate — every library here works in Expo Go
- **Limits:** it's not *your* app. No custom icon on the home screen, no custom native modules, and you can't hand it to someone who doesn't have Expo Go. Runs only while your dev server is up.

> **Why SDK 54 and not the newest?** Apple has not approved a newer Expo Go build for the App Store since SDK 54 — Expo confirmed SDK 55 was still pending review in May 2026, and SDK 57 shipped with the same caveat. On SDK 55+ the App Store Expo Go returns *"Project is incompatible with this version of Expo Go."* Newer SDKs are only reachable on iOS via `eas go` or a development build, both of which need a paid Apple Developer account. Staying on SDK 54 keeps this option free. See [expo.dev/go](https://expo.dev/go).

## Option 2 — EAS development / preview build (a real app on your phone)

Expo builds the actual `.ipa` on their Macs in the cloud. You never need a Mac.

```bash
npm install -g eas-cli
eas login                      # free Expo account
eas build:configure
eas device:create              # registers your iPhone's UDID — follow the QR/link on the phone
eas build --profile preview --platform ios
```

When it finishes you get a link/QR — open it on the iPhone and install. Your icon, your name, runs standalone.

- **Cost:** Apple Developer Program, **$99/year** (required — Apple won't let you install a signed build on a device without it). EAS itself has a free tier with a build queue.
- **Good for:** testing real device behavior, sharing with a handful of people (up to 100 registered devices)
- **Note:** use `--profile development` instead if you want a build that still connects to the Metro dev server — that's the setup to move to once you add native modules Expo Go doesn't include.

## Option 3 — TestFlight (share with testers properly)

```bash
eas build --profile production --platform ios
eas submit --platform ios
```

Testers install via Apple's TestFlight app — no UDID registration, up to 100 internal testers or 10,000 external (external needs a light Apple review).

- **Cost:** same $99/year
- **Good for:** beta testing, sending builds to people who aren't technical
- **Then:** `eas submit` again against App Store Connect when you're ready for actual App Store review.

## Option 4 — Free, no Apple Developer account (with caveats)

Tools like **AltStore** or **Sideloadly** sideload an `.ipa` signed with a free Apple ID. You'd still need an `.ipa` from somewhere, and the signing dance is fiddly from Windows.

The real catch: **free-provisioned apps expire after 7 days** and must be re-signed, and you're capped at 3 apps. Fine for a one-off demo, painful as a workflow.

## What's ruled out

Building iOS locally on Windows. Xcode is macOS-only, and it's the only thing that can compile and sign an iOS binary. That's why EAS cloud builds exist — and why staying in the Expo managed workflow (no `/ios` folder in the repo) is the right call for you. If you ever run `npx expo prebuild`, you'll generate a native `/ios` project you can't build without a Mac.

## Quick recommendation

Use **Expo Go** while you're building. Pay the $99 and switch to **EAS preview builds** only once you need the app standalone on your phone, or need a native module Expo Go doesn't ship.

---

## Adding to this boilerplate

- **New screen:** drop a file in `app/(tabs)/` — the route appears automatically (register the tab in `(tabs)/_layout.tsx`).
- **New API call:** add a function to `src/api/`, wrap it in a hook in `src/hooks/`.
- **Restyle:** edit `src/theme.ts` only.
- **Native module:** `npx expo install <package>` — use `expo install`, not `npm install`, so versions stay compatible with the SDK. If it isn't in Expo Go, move to a development build (Option 2).

---

## Troubleshooting

### `npm audit` reports vulnerabilities

**Do not run `npm audit fix --force`.** It "resolves" them by downgrading Expo several major versions, which breaks the project.

`.npmrc` sets `audit=false`, which suppresses the vulnerability banner printed after `npm install`. It does not hide anything — running `npm audit` manually still gives the complete, unfiltered report. Delete that line if you'd rather see the banner.

The remaining advisories trace to build tooling under the Metro bundler. There is no patched release — the advisory covers every published version including the latest. It is a denial-of-service in image parsing that can only trigger while bundling on your own machine, and it never ships inside the app binary.

### `Unable to resolve "react-native-web/dist/index"` on `npm run web`

Web support needs three packages that aren't part of the native build: `react-dom`, `react-native-web`, and `@expo/metro-runtime`. They're in `dependencies`. If you don't care about the web target you can remove all three — `npm start` / iOS / Android are unaffected.

### Upgrading the SDK later

Once Apple approves a newer Expo Go, `npx expo install expo@latest --fix` moves the whole project forward. Until then, staying on SDK 54 is what keeps the free Expo Go path working.

### Adding dependencies

Use `npx expo install <package>`, not `npm install`, so versions stay pinned to what the SDK supports. Run `npm run doctor` afterwards to confirm.
