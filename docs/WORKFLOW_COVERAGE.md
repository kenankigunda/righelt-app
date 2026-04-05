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
| Presence indicators and reconnect role restore | `partial` | `present` | `present` | Browser proof is currently indirect through reconnect workflows; direct browser assertions for participant presence badges are still light. |
| History navigation and return to live | `present` | `present` | `present` | Includes live appends while pinned to history and explicit return-to-live restoration. |
| Identity and role persistence across reload | `present` | `present` | `present` | Covered for approved participant reload and transport refresh after missed updates. |
| Revert / undo request lifecycle | `present` | `partial` | `present` | Browser proof now covers optimistic undo with both auto-approve and approval-required paths, plus returning history viewers to live mode after approval; reject/rescind remain deeper in integration than in dedicated browser flows. |

## Extended Shell Workflows

| Workflow | Success E2E | Recovery / failure E2E | Integration variants | Notes |
| --- | --- | --- | --- | --- |
| Home page public entry opens join decision flow instead of silently joining | `missing` | `missing` | `present` | Covered in shell store and transport layers; still missing full browser proof for list-entry behavior. |
| Home page pagination, sectioning, and latest-activity ordering | `missing` | `missing` | `present` | Transport and migration tests cover section query params and indexed metadata; browser interaction coverage is absent. |
| Home page preview board stays non-authoritative | `missing` | `missing` | `partial` | Preview renderer/registry coverage exists, but there is no browser proof that preview playback stays visually correct and isolated from live state. |
| Tutorial first-run trigger, skip/next progression, completion, and restart | `missing` | `missing` | `partial` | Controller/store coverage exists, but no browser or full shell-integration proof covers the real first-run route handoff UX yet. |
| Self-play / play-as-both activation and seat semantics | `missing` | `missing` | `present` | Transport and store coverage prove join restrictions and dual-seat behavior; browser flow coverage is still missing. |
| Offline-local self-play creation, reload restore, and explicit `Go online` confirmation | `missing` | `missing` | `missing` | This remains the largest workflow gap relative to the web-app spec. Current tests only cover adjacent pieces like live-sync offline handling and legacy self-play normalization. |
| Scenario import into a live game | `missing` | `missing` | `present` | Store and transport coverage are good; browser-level scenario-flyout/load flow is not yet covered. |
| Scenario save/update authoring flow | `missing` | `missing` | `partial` | Scenario builder and local-writer helpers are covered, but end-user save/update interaction and error handling are not. |
| History branch launch from selected move | `present` | `present` | `present` | Browser proof covers optimistic popup launch, stable route/request/response IDs, delayed-commit usability, the first immediate branched move, and branch-create failure handling in the popup shell. |
| Notification and prompt quality across core shell states | `missing` | `missing` | `present` | Store coverage proves required categories exist, but browser proof for prompt timing, replacement, and non-janky transitions is still absent. |
| Localized pending controls for join / approve / invite-copy | `present` | `partial` | `present` | Browser proof covers pulsing local pending state and pending-game invite copy waiting for commit; broader error-path polish for every button variant is still mostly owned below browser level. |

## Platform And Polish Safeguards

These are not always “user workflows,” but regressions here directly damage correctness or app feel.

| Surface | Success E2E | Recovery / failure E2E | Integration variants | Notes |
| --- | --- | --- | --- | --- |
| Routing correctness across home / game / invite / tutorial / flyout states | `n/a` | `n/a` | `present` | Route parsing/building and flyout-state collapse are covered at the unit layer. |
| Runtime sync preserves board selection correctly across authoritative updates | `n/a` | `n/a` | `present` | Shell runtime-sync tests cover selection reset/preservation rules that strongly affect perceived polish. |
| Board runtime interaction polish and continuation rendering | `n/a` | `n/a` | `present` | Extensive board-runtime and adapter coverage exists for hover/click semantics, continuation prompts, overlays, and removal feedback. |
| Pages proxy behavior and local-dev fallback | `n/a` | `n/a` | `present` | Proxy coverage includes service binding, local fallback, suffixed ports, and stable failure behavior. |
| Bootstrap determinism, cache policy, and startup-path stability | `n/a` | `n/a` | `present` | Bootstrap/cache/startup tests are strong and should remain a hard gate because startup regressions hurt every workflow. |
| Live websocket replay vs state-sync fallback | `n/a` | `n/a` | `present` | Durable-object websocket tests plus live-sync tests cover replay/fallback behavior beneath the browser layer. |
| CI layering and E2E harness health | `n/a` | `n/a` | `present` | Workflow and harness tests protect fast-fail order, artifact upload, and shared stack expectations. |

## Highest-Value Remaining Gaps

The most important follow-up coverage still missing from the current repo is:

1. Offline-local self-play:
   the spec expects offline creation, local persistence, reload restore, disabled remote actions, visible offline state, and explicit `Go online` confirmation. The current automated evidence does not yet prove that workflow holistically.
2. Browser-level tutorial flow:
   first-run trigger, live-route handoff after completion, skip/next timing, and restart-from-game remain uncovered in the actual shell UI.
3. Browser-level scenario workflows:
   loading a saved scenario and saving/updating scenarios through the flyout are not yet exercised end-to-end; history-branch success proof exists now, but branch failure UX is still not browser-covered.
4. Browser-level home-page workflows:
   public entry from the list, pagination behavior, preview-board isolation, and latest-activity ordering are still only covered below the browser layer.
5. Presence and prompt polish:
   the app has strong lower-level coverage, but there is still limited browser proof for visible participant status changes, waiting/your-turn prompts, and disabled-action explainer quality.

## Current Guidance

- Keep required Playwright focused on representative user-visible success and recovery proof.
- Keep transport-backed integration responsible for multi-client coordination, stale-state recovery, revert lifecycles, and deep workflow variants.
- When adding new features, update this map only after checking whether the behavior is a primary workflow, an extended shell workflow, or a platform/polish safeguard so ownership stays clear.
