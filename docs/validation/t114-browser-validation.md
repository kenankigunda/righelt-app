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

## T-114.09: Firefox CI input and timing repair

The original full local run above remains the recorded T-114.08 snapshot. PR #92's first CI run (`37121388232`, `eb55ef7`) passed Chromium, WebKit and every non-browser gate, but failed 11 Firefox cases. Trace snapshots consistently recorded `data-hover-capability="none"`; the helper assumed hover selection, so click-only Firefox selected a destination without confirming a move. Screenshots showed a selected source and no selected destination. This was a browser harness input assumption, not evidence that a submitted command was lost.

Shared helpers now select destinations using the browser's supported hover or click path, assert the destination's target state, then confirm with a real click. Pressure, overdue, and storage-geometry cases use the same path. A new regression forces each capability, observes an actual version-2 `/apply` request, and requires one history move. It is included in Chromium, Firefox and WebKit. The non-hover case fails against the original helper at `331a311` with the same hover assertion as CI; both paths pass after the correction.

The silent-failure measurement now timestamps actual socket delivery and the DOM transition to the recovery notice using a MutationObserver. Previously it included the 100ms delivery delay and locator polling lag; CI reported 16,076ms. The unchanged 16,000ms limit now measures the transition itself, with finite, positive timestamp and nonnegative elapsed assertions. No recovery budget or behavioral assertion was relaxed.

The complete representative Firefox lane passed with cached Firefox 150.0.2 configured to reproduce CI's non-hover media capability: 14 passed, five intentional Chromium-only skips. This includes both new input regressions. The pinned Firefox 1511 archive (Firefox 148.0.2) was also recovered after Playwright's extraction stalled; matching-version validation is recorded below. Linux CI remains the final platform proof. Independent review found no remaining static issues in the repair. No application code changed, and the original measurement JSON was preserved.

Pinned Firefox 148.0.2 with the same non-hover preferences passed all 14 representative tests (five intentional skips), exit 0. Silent-failure detection measured 15,007ms and post-restoration convergence 3,990ms. The two Chromium capability regressions also passed. The repair adds six browser cases across the existing three-engine matrix; final Linux CI results will supplement, rather than replace, the original full-run evidence.

The next Linux CI run (`37123167216`, `9eb0d41`) passed all Firefox cases and 96 browser cases overall, but exposed two additional fixture errors. Chromium E05's trace showed Player 1's first move ending the turn, followed by the Player 1 page trying to select Player 2's piece at (6,3). The strict target assertion correctly rejected that invalid input; the earlier click-only helper could silently leave the move unsubmitted. E05 now waits for visible Player 2 control, submits from that player's page, requires an accepted receipt and two history rows on both online players, and places the outage on the viewer. Before restoration the viewer must still have one row; afterward it must have two while retaining the same selected entry, before explicit return to live and three-party convergence.

WebKit E07 read sessionStorage while its deliberately triggered automatic refresh was destroying the JavaScript context. It now waits for exactly two observed main-frame navigations (requested reload plus one automatic reload) and DOMContentLoaded before checking the upgrade marker. The no-unsafe-command and saved-board assertions remain, with the same budgets and no broad retries. Independent review found no remaining material issue in either correction.

The finalized assertions passed three consecutive runs each of Chromium E05, Chromium E07, and WebKit E07: nine passes, three intentional WebKit E05 skips, exit 0. E05's accepted receipt is captured at the existing fault boundary before forwarding: WebSocket acceptance may legitimately cancel the obsolete HTTP request, so browser HTTP completion is not required. Its context teardown now uses the existing bounded fault-test cleanup. Isolated ports 10988, 8787 and 11088 had no listeners after the run. These are harness-only changes; full CI remains the integration gate.

Run `37124800294` at `17dbb86` passed 97 browser cases but exposed a real home-page lost-input race in Firefox at 390px. The click was correctly located and completed, but no creation request followed. A deterministic regression held the home-list responses, pressed Start with a real mouse, released those responses, and then released the mouse: the original control was disconnected and creation was lost before the fix.

Home rendering now preserves the Start control and its ancestor chain while updating surrounding markup. The comparison ignores only the transient `is-pressing` class on a clone; the original node and press state remain intact. This avoids deferring refreshes and preserves native pointer and keyboard activation without synthetic events. The regression also holds responses across Space keydown/keyup and verifies focus stays on the original button and exactly one creation request occurs. Both cases run in all three engines.

Focused validation passed ten tests: pointer and keyboard regressions in Chromium, pinned Firefox 148.0.2, and WebKit, plus four adjacent Chromium home-card and pagination workflows. The before-fix regression failed on the detached control. Independent review found no remaining material issue in the stable-control update. A fresh full local suite and Linux CI verify this product change separately from the earlier harness-only repairs.
