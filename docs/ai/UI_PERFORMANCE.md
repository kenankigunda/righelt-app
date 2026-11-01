# UI performance planning and validation

User goal: the full selected UX must stay snappy, including during live updates, motion, asset loading and long sessions. This applies alongside [UX principles](../UX_PRINCIPLES.md), the [material contract](MATERIAL_UX_CONTRACT.md), [testing strategy](TESTING_STRATEGY.md) and [resource policy](RESOURCE_MANAGEMENT.md).

Performance has two independent roles: a planner during implementation planning, and a performance tester during the prototype, propagation and combined final candidate. They form a third review lane alongside UX validation and product testing. Record findings, repair the coherent set and independently recheck changed findings. Aesthetic, functional and performance evidence cannot substitute for one another.

## Plan before broad propagation

Read the [T-118 performance plan](https://github.com/kenankigunda/righelt-backlog/blob/main/backlog/docs/tickets/t-118/marble-2026-11-01/performance-plan.md). It owns this refresh's source-backed fix ledger, native workloads, measurement contract and P0–P3 gates. At kickoff reconcile exact source/dependencies and approved incoming changes; source risk is not a measured bottleneck.

Include targeted preexisting UI repairs in touched code: retire the full obsolete page-grid lifecycle, reconcile old message-sizing replicas with the approved incoming height policy, and bound retired miniature-preview payloads if those patterns remain. Profile loading-edge geometry, layout/read-write paths, keyed list reconciliation, redundant markup and old/new optical effects before performance-specific rewrites. Preserve active consumers, drafts, native input and retained data. UI cache reclamation never authorizes deleting games, history, receipts or training evidence.

Implementer may make bounded evidenced fixes autonomously, choosing the best fit to the selected beauty and intentional workflows. Record tradeoffs in the nonblocking final conflict report. Do not introduce a user approval hold for performance tuning. Required correctness and validation still apply.

## Implementation principles

- Use bounded shared static marble/paper assets and deliberate material primitives. No animated full-page grain, per-cell/per-frame procedural textures or unbounded backdrop effects.
- Keep crisp approved masters immutable; create appropriately sized/encoded delivery assets with alpha/visual/provenance review. Load the first needed scene promptly, defer later scenes and avoid eager decode of every large image. Art loading does not grant readiness or postpone native actions.
- Prefer finite transforms/opacity and stable contact shadows where they preserve selected motion. Scope and release layers/effects; permanent will-change everywhere is not an optimization. Transform-only does not prove low raster/GPU cost.
- Reuse native DOM/adapters and complete-data fast paths, coalesce geometry work, batch reads/writes where compatible and avoid no-op updates. Preserve necessary geometry barriers and invalidate on real font/viewport/content/state changes.
- Bound UI caches, observers/listeners/timers/rAF and decorative copies by lifecycle. Idle/hidden pages stop nonessential decoration while preserving controller, authority, selection and cancellation.
- Keep worker/rules/transport/durable admission separate from presentation work. Never debounce intentional input, fake readiness, hide pending work or stretch cover motion to mask delay.
- Optimize actual combined scenes, not stripped-down mocks. Do not meet budgets by flattening selected materials, shrinking artwork, dropping icons, disabling normal animation or weakening workflow/a11y.

## Measurement and acceptance

Use real clocks and native input on matched production-style states/builds. Record exact source/assets/runtime/browser/device/DPR/cache/network/worker/dataset/tab/power/pressure conditions. A new page is not automatically cold. Pair/interleave before-after runs with matched controls, preserve raw samples and failures, characterize noise and report tails only with adequate samples.

Set numeric per-workload/profile budgets from measured baseline variation, the interaction contract and explicit improvement goals before candidate acceptance-comparison runs. Exploratory candidate profiling may precede the freeze only as explicitly non-acceptance evidence. Record statistic/units/tolerance/repetitions/rationale in one budget manifest. Do not invent universal thresholds, retrofit a budget to make a failure pass, or accept an already-slow baseline merely because it did not worsen.

Separate native event/handler/feedback, render self-time, layout/paint/compositing, finite animation, asset transfer/decode, worker/network/save authority and full user-visible completion. Retain end-to-end durations while attributing categories. Two rAF callbacks are a scheduling proxy, not guaranteed screen paint. Feature-detect APIs; unsupported observations are unknown, not zero/PASS. Emulation and Chromium traces do not certify physical phones or other engines.

The existing performance catalog lane records five controlled Chromium Account-fixture observations using DOM click and two rAF callbacks. Keep that useful smoke distinct from native full-app responsiveness, frame/GPU and memory proof. Render self-time marks likewise do not establish next paint. Extend evidence deliberately under testing policy; a valid-sample count alone is not a performance pass.

Cover representative Home/board input/live updates, glass and vellum over a live board, artwork loading/swaps, navigation/fit, long lists, long-session resource retention, hidden/multiple tabs and constrained/failure fallbacks. Use the smallest complete proof set with production browser integration and representative real-stack workflows, not a full Cartesian product.

Measure instrumentation overhead with control/minimal-observer runs. Bound records and dropped counts; keep trace/screenshots/artifact serialization outside timing windows where possible. Required traces/samples must identify actual capability and source. No fake-clock, diagnostic effect-disabled or sparse-content result may certify production performance.

At P0 the planner audits the plan and source; the performance tester checks enforceability. At P1/P2/P3 the tester independently reviews actual measurements, trace attribution, selected scene/correctness and repair evidence. Final combined proof includes before-after results, disposition of preexisting fixes, budgets, cumulative material/asset costs, required suite results, resource cleanup and honest gaps.

Use supervised launches and pinned released validation tooling with explicit candidate. Critical-pressure cancellation is incomplete, not PASS. Keep heavy raw traces/exploratory visuals local and sanitize evidence. Push written checkpoints and only selected authoritative visuals/accepted final artwork. No new publication, email, schedule, coordinator dispatch, merge or deployment action is implied.

Every workload declares exact start/end/settle predicates and clock domains. Include native queue delay when supported; separate driver actionability/protocol waits from browser processing. Cross-clock arithmetic needs explicit correlation/error bounds. Lifecycle proof declares cycle count, data pattern, allowed active owners, expected retained bounds and GC/settlement assumptions rather than treating all temporary allocation as a leak or unfinished work as a pass.
