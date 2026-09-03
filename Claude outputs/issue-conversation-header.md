## Problem

The Conversation tab's header stacked three rows of chips — mode, solo+team, profile — above a hint line. The three groups behave differently but rendered identically: mode is always exactly one of two, while team and profile each have a "none" state. As one undifferentiated grid of toggles there was nothing to tell them apart, and the middle row grows a chip per team the roster names, so it gets worse every time the server adds one. On a phone the whole thing ate the transcript the tab exists for.

The team chips were the sharper problem. A chip carried a worker count and nothing else — `engineering 2`. The roster is already in memory (`useTeams` rides the `qk.agents()` query rather than fetching its own), so the app knew who was on each team, what each one is for, and which were running, and showed a number instead. Answering "would this team's manager actually reach the agent I need?" meant leaving the conversation for the Agents tab and coming back.

## Proposal

One control bar, plus two sheets.

| Piece | What it is |
|---|---|
| `SegmentedControl.tsx` | Generic segmented control. Used for Session / One-shot. |
| `BottomSheet.tsx` | Modal sheet on RN's `Modal` — backdrop, grabber, scrolling body. No new dependency. |
| `TeamSheet.tsx` | The team picker, with the roster inside it: every team, its worker count and how many are running, and each worker's live status, description and model/tools/invocations. Workers push `/agent/{id}`. The `always` agents are listed apart. |
| `ProfileSheet.tsx` | Server default + the three profile names. |
| `Conversation.tsx` | Header rebuilt: `control-bar` while no session is open, `session-bar` once one is. |

The team button now reads `engineering · 2w` with a dot when a worker is running, so the common question is answered without opening anything.

## Design decisions worth reviewing

One fact drives most of this: of the three controls, only **mode** is genuinely always-exactly-one-of-N. Team and profile both have a "none" state (solo, server default). So:

- **Mode is a segmented control; team and profile are buttons that open sheets.** The shape now carries the semantics the chips flattened. It also stops the header growing with the roster.
- **The bar is removed, not disabled, once a session is open.** Profile and mode cannot change while the session lives — `MessageRequest` forbids both and the server fixed them at open time — so a greyed-out control is an invitation to press something that will never work. `session-bar` states them instead (`Session · sandboxed`). This is the decision most likely to be wrong: it means you cannot *see* the mode segmented control mid-session, only read the summary.
- **The team button stays live while a session is open.** Unchanged behaviour — picking closes the session — but the warning moved into the sheet, where it is read *before* the press rather than inferred after. Alternative considered: lock team too and require an explicit Close first. Rejected as more clicks for the same outcome.
- **Two press targets per team card, deliberately separated**: the header row selects the team, a worker row opens that worker. Making the whole card selectable and the rows navigable would have made every press ambiguous.
- **Members are listed expanded, not behind an accordion.** With the roster sizes this server produces, an accordion is a click that buys nothing. Revisit if teams get large.
- **`ProfileSheet` describes none of `dev` / `sandboxed` / `eval`.** The spec publishes the enum names and no description, so a sentence about what `sandboxed` does would be the UI making a promise the API never made. The sheet says only that it is sent as `profile`, and that leaving it unset lets the server decide. If someone knows what these actually mean, that copy is worth adding — but it should come from the server, not from us.

## Bug found and fixed along the way

`useConversation` wrote the turn's session back unconditionally after `sendSessionMessage` resolved. The Close button is on screen from the moment the session opens, so a turn can still be in flight when you press it — and the reply then handed the just-closed handle back, so the session appeared to reopen with a stale `turns` count. The write is now guarded on `sessionRef.current?.id === active.id`. Covered by a new test ("stays closed when the turn that was still in flight comes back").

This is a real user-visible bug that predates the redesign; it is in here because the redesign is what made it easy to hit. Say the word and I'll split it into its own ticket.

## Acceptance criteria

- [x] Mode, team and profile are reachable from one bar; the header does not grow when the server adds a team.
- [x] The team button shows the team name, its worker count, and a running indicator.
- [x] Opening the team picker lists every team with its workers — name, live status, description, model/tools/invocations.
- [x] Tapping a worker dismisses the sheet and opens that agent's detail screen.
- [x] The `always` agents appear in the picker, listed apart from the teams.
- [x] Picking a team while a session is open closes it, and the sheet warns before the press.
- [x] Once a session is open, mode and profile are not presentable as changeable.
- [x] A reply arriving after Close does not reopen the session.
- [x] `npx tsc --noEmit` clean; 238 jest tests pass.

## Out of scope / follow-ups

- [ ] **Never rendered.** This has not been run on a device, an emulator, or the web build — no screenshot exists. Everything above is verified by tests and the type-checker only. Layout at narrow widths relies on `flexWrap` and is unverified; the sheet's `maxHeight: '80%'` is untested against a long roster.
- [ ] **Cypress specs updated but not run.** `cypress/e2e/conversation.cy.ts` was rewritten for the new testIDs against `tools/mock-agent-api.mjs`, but the e2e suite needs a dev server and a browser and was not executed. Treat those three specs as unverified.
- [ ] **`src/api/__tests__/contract.test.ts` is failing, and it is not from this change.** The last `chore: openapi update` re-pinned a spec that no longer declares `createRun(503)`, `sendSessionMessage(409)` or `getSession(404)`, all of which the client still handles. Someone needs to decide which side is wrong. Its own ticket.
- [ ] **Still no `GET /v1/teams`.** A team has no description and no display name, so the sheet shows the key; a team with no workers is invisible, because a team only exists here as a value some worker carries. Unchanged by this work — see [[multi_team_2026_08]].
- [ ] The sheet has no swipe-to-dismiss; backdrop tap, ✕ and Android back only.
- [ ] The picker does not say which worker the manager actually delegated to on the last turn, though the reply already carries that.

## Notes for the reviewer

New: `src/components/{SegmentedControl,BottomSheet,TeamSheet,ProfileSheet}.tsx` (502 lines total). Changed: `src/screens/Conversation.tsx`, `src/hooks/useConversation.ts`, `__tests__/conversation-screen.test.tsx`, `cypress/e2e/conversation.cy.ts` (+290 / −146).

Tests run in the cloud container, not over the device bridge (jest cannot finish there): 238 passing, 1 failing — the pre-existing contract test above.

Two testing gotchas worth knowing before you touch these specs: the picker is behind a button now, so a test must press `team-button` and then wait for the **roster** (`team-engineering`), not for `team-sheet` — the sheet renders before the query resolves. And `toHaveTextContent('...')` is exact-match in this setup; use a regex for a substring.

Note that `git diff` on this repo is currently unreadable — every tracked file shows as modified due to line endings. `git diff --ignore-cr-at-eol` gives the four real files.
