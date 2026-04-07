# Workflow Coverage Map

This inventory tracks which app surfaces have:

- a success-path `E2E`
- a recovery/failure-path `E2E`
- integration coverage for important workflow variants

It covers both direct user workflows and support surfaces that materially affect correctness, resilience, or perceived polish.

Status meanings:

- `present` = intentional automated coverage exists in that lane
- `partial` = some meaningful coverage exists, but key variants or recovery behavior are still missing
- `missing` = no intentional automated coverage yet
- `n/a` = that lane is not the right ownership layer for the surface

## Core Multiplayer Workflows

| Workflow | Success E2E | Recovery / failure E2E | Integration variants | Notes |
| --- | --- | --- | --- | --- |
| Create game and land as `Player 1` | `present` | `present` | `present` | Browser proof exists for create + enter flow; integration covers first-move-before-join and turn handoff variants. |
| Invite recipient enters the game as viewer | `present` | `present` | `present` | Includes direct-link and viewer fallback behavior once seats are full. |
| Direct-link recipient requests player join approval | `present` | `present` | `present` | Includes pending request persistence, approval upgrade, and ignored-request behavior. |
| Approver accepts or ignores request | `present` | `present` | `present` | `Ignore` is intentionally UI-only dismissal; transport-backed tests prove the request persists until resolved. |
| Join availability and disabled explainers after seat changes | `present` | `partial` | `present` | Browser coverage proves disabled viewer fallback; explainer-copy and all edge reasons are still mostly below browser level. |
| Synchronized live updates across participants | `present` | `present` | `present` | Includes reconnect catch-up and authoritative refresh after missed updates. |
| Move reflected in all active browsers | `present` | `present` | `present` | Transport layer also covers stale apply rejection, optimistic/authoritative reconciliation, and turn-end semantics. |
| Presence indicators and reconnect role restore | `present` | `present` | `present` | Browser coverage now proves visible `Connected`/`Disconnected` participant badge transitions alongside reconnect role restore. |
| History navigation and return to live | `present` | `present` | `present` | Includes live appends while pinned to history and explicit return-to-live restoration. E2E specs E-01–E-06 (`history-destruction.spec.mjs`) cover DESTROYED sub-bullet display, parent-move-owned history selection, recorded-action destruction overlays, page-reload persistence, late-join viewer sync, layout stability, and both player-colour variants. |
| Identity and role persistence across reload | `present` | `present` | `present` | Covered for approved participant reload and transport refresh after missed updates. |
| Revert / undo request lifecycle | `present` | `present` | `present` | Browser proof covers optimistic undo with both auto-approve and approval-required paths, returning history viewers to live mode after approval, and the reject/rescind history-mode variants; integration also covers approve/reject/rescind interactions while clients are already in history mode. |

## Extended Shell Workflows

| Workflow | Success E2E | Recovery / failure E2E | Integration variants | Notes |
| --- | --- | --- | --- | --- |
| Home page public entry opens join decision flow instead of silently joining | `missing` | `missing` | `present` | Covered in shell store and transport layers; still missing full browser proof for list-entry behavior. |
| Home page pagination, sectioning, and latest-activity ordering | `present` | `present` | `present` | Browser proof covers home-card opening, pagination controls, latest-activity reorder across pages, and pagination loading skeleton behavior. |
| Home page preview board stays non-authoritative | `present` | `missing` | `partial` | Browser proof now covers isolated preview refresh so one card's live update does not bleed into neighboring home cards; lower-layer preview renderer coverage remains important. |
| Tutorial first-run trigger, skip/next progression, completion, and restart | `present` | `partial` | `partial` | Browser proof now covers tutorial route progression, skip, completion back into the game route, and reset-on-revisit; explicit first-run auto-entry and failure-path handling are still not browser-covered. |
| Self-play / play-as-both activation and seat semantics | `missing` | `missing` | `present` | Transport and store coverage prove join restrictions and dual-seat behavior; browser flow coverage is still missing. |
| Offline-local self-play creation, reload restore, and explicit `Go online` confirmation | `missing` | `missing` | `missing` | This remains the largest workflow gap relative to the web-app spec. Current tests only cover adjacent pieces like live-sync offline handling and legacy self-play normalization. |
| Scenario import into a live game | `present` | `missing` | `present` | Browser coverage now includes both imported-scenario home-card rendering and the real scenario-flyout load flow into an empty live game. |
| Scenario save/update authoring flow | `present` | `partial` | `present` | Browser coverage now proves saving a scenario through the flyout, preserving a clicked source/destination selection while the flyout is open, restoring hover selection after the flyout closes, and loading the saved scenario back into a fresh game. Dedicated browser proof for update and authoring error handling is still missing. |
| History branch launch from selected move | `present` | `present` | `present` | Browser proof covers optimistic popup launch, stable route/request/response IDs, delayed-commit usability, the first immediate branched move, and branch-create failure handling in the popup shell. |
| Notification and prompt quality across core shell states | `missing` | `missing` | `present` | Store coverage proves required categories exist, but browser proof for prompt timing, replacement, and non-janky transitions is still absent. |
| Localized pending controls for join / approve / invite-copy | `present` | `partial` | `present` | Browser proof covers pulsing local pending state and pending-game invite copy waiting for commit; broader error-path polish for every button variant is still mostly owned below browser level. |

## Platform And Polish Safeguards

These are not always “user workflows,” but regressions here directly damage correctness or app feel.

| Surface | Success E2E | Recovery / failure E2E | Integration variants | Notes |
| --- | --- | --- | --- | --- |
| Routing correctness across home / game / invite / tutorial / flyout states | `n/a` | `n/a` | `present` | Route parsing/building and flyout-state collapse are covered at the unit layer. |
| Runtime sync preserves board selection correctly across authoritative updates | `n/a` | `n/a` | `present` | Shell runtime-sync tests cover selection reset/preservation rules that strongly affect perceived polish. |
| Board runtime interaction polish and continuation rendering | `partial` | `n/a` | `present` | Extensive board-runtime and adapter coverage exists for hover/click semantics, continuation prompts, overlays, and removal feedback. Playwright now also proves the lone auto-selected push preview stays visible in the real browser, while the broader action matrix remains owned below the browser layer. |
| Pages proxy behavior and local-dev fallback | `n/a` | `n/a` | `present` | Proxy coverage includes service binding, local fallback, suffixed ports, and stable failure behavior. |
| Bootstrap determinism, cache policy, and startup-path stability | `n/a` | `n/a` | `present` | Bootstrap/cache/startup tests are strong and should remain a hard gate because startup regressions hurt every workflow. |
| Live websocket replay vs state-sync fallback | `n/a` | `n/a` | `present` | Durable-object websocket tests plus live-sync tests cover replay/fallback behavior beneath the browser layer. |
| CI layering and E2E harness health | `n/a` | `n/a` | `present` | Workflow and harness tests protect fast-fail order, artifact upload, and shared stack expectations. |

## Highest-Value Remaining Gaps

The most important follow-up coverage still missing from the current repo is:

1. Offline-local self-play:
   the spec expects offline creation, local persistence, reload restore, disabled remote actions, visible offline state, and explicit `Go online` confirmation. The current automated evidence does not yet prove that workflow holistically.
2. Home-page public-entry flow:
   entering a game from the home list as a non-participant should still be browser-proven to open the join decision flow rather than silently joining or routing incorrectly.
3. Scenario update and authoring failure handling:
   browser proof now exists for save + load, but update-in-place, validation failures, and local-writer failure states are still mostly covered below the browser layer.
4. Tutorial first-run auto-entry:
   the browser suite now covers progression/completion/reset, but the true first-run trigger and any associated route handoff edge cases are still not proven.
5. Prompt and explainer polish:
   the app still has limited browser proof for waiting/your-turn prompts, disabled-action explainers, and notification replacement timing.

## Current Guidance

- Keep required Playwright focused on representative user-visible success and recovery proof.
- Keep transport-backed integration responsible for multi-client coordination, stale-state recovery, revert lifecycles, and deep workflow variants.
- When adding new features, update this map only after checking whether the behavior is a primary workflow, an extended shell workflow, or a platform/polish safeguard so ownership stays clear.
