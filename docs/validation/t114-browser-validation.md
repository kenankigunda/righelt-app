# T-114 browser validation

The browser proof uses the real local Pages, Workers and D1 stack. Two players and a viewer compare rendered piece positions, history IDs and notation, active player, roles, and settled pending indicators. Each board must contain 100 cells and actual pieces; empty DOM comparisons cannot pass.

## Coverage

| Gate | Browser evidence |
| --- | --- |
| E01 | Chromium, Firefox, WebKit: committed command loses HTTP and WebSocket responses; reconciliation is held until restoration; one committed effect and no orphaned journal record. |
| E02 | All three: one-way inbound loss while online, automatic watchdog recovery, an observed recovery response interrupted again, then automatic convergence. Detection is measured from the last valid inbound frame. |
| E03 | Chromium: actual local Wrangler process-group restart before and after commit, durable D1 receipt, original command ID retained. Harness control is loopback-only and outside production code. |
| E04 | All three: unresolved journal command survives reload. Chromium additionally freezes/resumes via CDP. Firefox/WebKit visibility transitions are synthetic; these do not prove operating-system suspension timing. |
| E05 | Chromium: intentional history survives outage; home reload discovers unresolved commands in unopened games, retains Recovering, drains the journal, and clears the indicator. Reopening converges with both other participants. |
| E06 | All three: same-identity tabs retry the same command without duplicate effects; real IndexedDB concurrent admission respects 16/game and 128/identity limits; transaction abort after a successful individual write persists nothing. |
| E07 | All three: legacy socket/HTTP metadata omit protocol version, reconciliation returns 404, unsafe writes remain blocked, one automatic refresh is attempted, and the saved game survives upgrade. |
| I10 | Chromium: 205 moves and 30 successful duplicate submissions; reconnect transfers exactly one current snapshot, with no historical snapshot replay or duplicate unchanged snapshot. |
| UX | All three: 901/900/899/390px overlays, storage failure and dismissal gating, exact pending/overdue/conflict text, polite announcements, scoped accessibility checks, reduced motion, focus and scroll; healthy optimistic confirmation adds no alert. |
| Adjacent workflows | Full Chromium suite: optimistic creation and branching with queued moves, popup handoff, dual-seat play, undo approval/rejection/rescission, intentional history, home cards and pagination. |

## Faults found during this gate

Home pagination replaced the local recovery indicator with a static server card, and home reload did not hydrate unresolved commands in unopened games. Permanent transport regressions reproduce both failures before the fix.

Pending local creation opened a recovery socket before the game existed, blocking supported queued moves and hiding creation-failure dismissal. The store now defers that socket until durable creation, observes popup storage handoffs, and clears stale local creation records after authoritative loading. Existing creation and branch browser assertions exposed the failures; added integration tests cover queue admission and stale-record reload.

Initial HTTP loading and socket recovery both transferred the same large snapshot. Initial state now has one owner, with bounded fallback and shared reconciliation. The strict long-history assertion failed with two snapshots and passes with one.

The wide-alert test's 16px shift came from Playwright's locator scroll-into-view before pointerdown, despite a fully visible button (x=893.84, y=59.77, width=65.16, height=27.31). Event tracing recorded scrollY=16 before pointerdown. Clicking the verified visible center directly kept scrollY=0 through pointerdown, focus and click. The harness now uses that real pointer action; strict geometry assertions remain. No speculative product scroll overrides were retained.

Independent combined-diff review found two additional failures. Admission blockage also blocked already durable commands from reconciling, so a full journal could never free space. Durable work now continues under the admission gate, and retry-saving reconciles independent games before admitting an unsaved command; inaccessible games retain their records without blocking other games. Tests cover real 16/game and 128/identity caps, another unavailable game, and quota failure.

Operation settlement previously emitted success before applying its authoritative snapshot, exposing pre-move state in `handle.committed`. Outcomes and snapshots now publish together, and committed results use authoritative state rather than optimistic descendants or selected history. HTTP, socket, queued A/B, and older-receipt regressions cover this. Running the new sender regressions against pre-fix `331a311` produced four failures (12 passed); current code passes all 16. The independent Tester re-ran the probes and reviewed both fixes.

## Measurement interpretation

Recovery response latency is controlled at 100ms, below the 250ms acceptance ceiling. Convergence must finish within 25 seconds of restoration; silent-failure detection is measured separately against 15 seconds plus scheduling tolerance. No suspended wall-clock guarantee is claimed.

Counters exclude party setup where the fault helper resets its baseline. Request and snapshot counts include observed transfers during the fault and recovery, including intentionally dropped responses. Bytes are uncompressed UTF-8 application response/frame payload bytes, excluding headers and transport compression. Presence changes may create legitimate distinct snapshots. The long-history case requires exactly one snapshot and includes a 5.5-second observation window in its conservative elapsed measurement.

Local verification uses cached Chromium 148.0.7778.96, Firefox 150.0.2, and WebKit 26.4 because downloads of the installed Playwright version's engines timed out. CI retains Playwright-managed versions. Physical-device verification is outstanding and is not represented by these desktop runs.

`pnpm e2e:install` installs all three engines; optional `RIGHELT_*_EXECUTABLE` overrides are local-only. CI runs full Chromium and representative Firefox/WebKit lanes and always uploads `test-results/sync-recovery` measurements.

## Final verification and measurements

`pnpm test` passed on `ccf1d9e` on 2026-10-03: typecheck, generated-runtime freshness, **362 unit tests**, **562 integration/stress/runtime tests**, and **92 browser tests**. Ten browser cases were intentionally skipped because the full restart/history/long-history matrix runs in Chromium; Firefox and WebKit run the approved representative lanes. The integration count includes 100 fixed seeds × 300 events (30,000 events) and two actual Workers/D1 durability tests.

All 32 measured recovery cases finished below 25 seconds at controlled 100ms recovery response latency. Automatic silent-failure detection measured 15,244ms (Chromium), 15,612ms (Firefox), and 15,737ms (WebKit), separately from recovery. The 205-move/30-duplicate case transferred exactly one snapshot and 621,020 application payload bytes (about 606.5 KiB); its 5,550ms elapsed measurement includes the observation window.

The complete machine-readable evidence is [t114-browser-measurements.json](t114-browser-measurements.json). Local stack ports 9887, 9888, and 9988 were checked after shutdown; no listeners remained.

| Engine | Fault | Recovery ms | Detection ms | Requests | Snapshots | Application bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |

| chromium | history-reconnect | 5,049 | — | 5 | 17 | 152,305 |
| chromium | home-journal-reload | 1,051 | — | 5 | 11 | 98,979 |
| chromium | long-history | 5,550 | — | 2 | 1 | 621,020 |
| chromium | lost-response | 948 | — | 3 | 6 | 55,082 |
| chromium | reload-resume | 409 | — | 6 | 10 | 90,438 |
| chromium | same-identity-tabs | 958 | — | 6 | 16 | 130,407 |
| chromium | silent-online | 5,015 | 15244 | 5 | 22 | 196,502 |
| chromium | storage-390px | 321 | — | 6 | 4 | 48,244 |
| chromium | storage-899px | 341 | — | 6 | 4 | 48,244 |
| chromium | storage-900px | 346 | — | 6 | 4 | 48,244 |
| chromium | storage-901px | 334 | — | 6 | 4 | 48,244 |
| chromium | upgrade-refresh | 399 | — | 6 | 4 | 33,616 |
| chromium | worker-restart-after-commit | 944 | — | 19 | 7 | 64,444 |
| chromium | worker-restart-before-commit | 1,952 | — | 16 | 5 | 46,149 |
| firefox | lost-response | 973 | — | 3 | 6 | 55,082 |
| firefox | reload-resume | 331 | — | 3 | 10 | 90,390 |
| firefox | same-identity-tabs | 1,000 | — | 4 | 17 | 138,922 |
| firefox | silent-online | 5,032 | 15612 | 5 | 22 | 196,502 |
| firefox | storage-390px | 437 | — | 6 | 4 | 48,244 |
| firefox | storage-899px | 440 | — | 6 | 4 | 48,244 |
| firefox | storage-900px | 443 | — | 6 | 4 | 48,244 |
| firefox | storage-901px | 451 | — | 6 | 4 | 48,244 |
| firefox | upgrade-refresh | 403 | — | 2 | 4 | 33,520 |
| webkit | lost-response | 1,012 | — | 3 | 6 | 55,082 |
| webkit | reload-resume | 459 | — | 5 | 11 | 99,230 |
| webkit | same-identity-tabs | 1,153 | — | 6 | 18 | 148,315 |
| webkit | silent-online | 4,062 | 15737 | 5 | 22 | 196,502 |
| webkit | storage-390px | 515 | — | 6 | 4 | 48,244 |
| webkit | storage-899px | 532 | — | 6 | 4 | 48,244 |
| webkit | storage-900px | 514 | — | 6 | 4 | 48,244 |
| webkit | storage-901px | 523 | — | 6 | 4 | 48,244 |
| webkit | upgrade-refresh | 436 | — | 6 | 5 | 42,070 |
