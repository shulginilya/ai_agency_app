# ai_agency_app — React Native (Expo) boilerplate

Expo SDK 57 · React Native 0.86 · TypeScript (strict) · expo-router

## Demo functionality

Two tabs, deliberately covering the four things almost every app needs:

| Tab | Shows off |
|---|---|
| **Tasks** | Local state, list rendering, text input, filtering, and **persistence** — tasks are saved to device storage and survive an app restart. |
| **Feed** | **Networking** — fetches from a public REST API with loading / error / empty states and pull-to-refresh. |

Both screens are light/dark aware and follow the OS appearance setting.

## Project layout

```
app/                    # expo-router: every file here is a route
  _layout.tsx           # root stack + providers
  (tabs)/_layout.tsx    # bottom tab bar
  (tabs)/index.tsx      # Tasks screen
  (tabs)/feed.tsx       # Feed screen
  +not-found.tsx        # 404 route
src/
  api/products.ts       # network layer — swap BASE_URL for your own API
  components/           # presentational components
  hooks/                # useTasks (state + persistence), useProducts (fetching)
  storage/tasks.ts      # AsyncStorage read/write
  theme.ts              # colors, spacing, radii — one place to restyle
  types.ts
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
