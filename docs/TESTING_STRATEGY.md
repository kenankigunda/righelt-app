# Righelt Testing Strategy

This repo uses a strict three-layer testing model:

- `unit test`
  - One module/component in isolation
  - Owns pure logic branches, validation rules, and narrow edge cases
- `integration test`
  - Multiple components/subsystems or contract boundaries together
  - Owns event ordering, persistence and rehydration, transport-shell-board coordination, and important workflow variants
- `E2E test`
  - Full browser workflow against the real local Pages + API stack
  - Owns representative user-visible success and recovery proof, not the whole edge-case matrix

## UX Verification Standard

UX-sensitive changes should be proven automatically before manual inspection whenever practical.

- Integration owns:
  - state variants and state sequencing
  - motion toggles and reduced-motion branching
  - notification ordering, replacement rules, and sound-event mapping
  - zone selection logic and non-visual UX contracts
- `E2E` owns representative user-visible proof for:
  - placement and responsive repositioning
  - focus behavior and broad semantic structure
  - accessibility scans for touched surfaces
  - layout stability and curated visual confirmation
- Use the smallest complete set of proof lanes needed:
  - semantic
  - geometry
  - visual
  - stability and responsiveness
  - behavioral
- Prefer user-visible assertions first. Use visual snapshots only for curated deterministic scenes.
- Manual testing remains valuable for taste and holistic judgment, but it is not an acceptable substitute for automated proof of the intended UX contract.

## Coverage Rules

- Every behavioral change must add or update `unit` coverage.
- Every behavioral change must add or update `integration` coverage.
- Every touched workflow must explicitly consider whether its `E2E` coverage should be added or expanded.
- Every important workflow should have:
  - one success-path `E2E`
  - one recovery/failure-path `E2E`
  - integration coverage for important workflow variants beneath the browser layer

## Contract-Drift Rules

- Any workflow that creates a client-generated identifier before the server confirms it must be covered by automated tests for identifier stability.
- Those tests must prove the full contract, not just the happy-path UI:
  - the client sends the optimistic identifier in the create request body
  - the server response echoes the same identifier
  - the route or opened tab uses that same identifier
  - the first follow-up mutation targets that same identifier
- This rule applies to create-game, history-branch, and any future optimistic route-opening workflow.

## Verification Guidance

- Manual testing is useful for exploration, but it is not an acceptable substitute for regression proof on transport, routing, persistence, or optimistic-state contracts.
- Manual testing is also not an acceptable substitute for UX-sensitive contracts that can be automated, such as placement, focus, accessibility semantics, reduced-motion behavior, and layout stability.
- For cross-boundary bugs, verification should default to:
  - `integration` tests that exercise the real API boundary with captured requests and responses
  - `E2E` tests that assert the browser route and observed network traffic remain consistent
- For UX-sensitive work, verification should additionally consider:
  - semantic proof via ARIA or accessibility assertions
  - geometry proof for placement and responsive zones
  - curated visual proof where the look itself is part of the contract
  - layout-stability or user-timing proof when smoothness is part of the requirement
- PRs and implementation notes should call out when a change adds or updates one of these contract tests.

## CI Order

CI runs in lane order:

1. `typecheck`
2. generated runtime freshness guard
3. `unit`
4. `integration`
5. `E2E`

The integration gate includes `test:sync-stress` (100 fixed multiplayer fault schedules with saved failure traces) and `test:sync-runtime` (actual local Workers/D1 transactions, sockets and restart durability). CI runs these as explicit jobs as well as the existing engine/API/web integration jobs. See [sync fault harness details](../packages/api-handler/test-stress/README.md) for replay commands, assertions and browser-proof boundaries.

## Browser setup and recovery evidence

`pnpm e2e:install` installs Chromium, Firefox, and WebKit. The E2E gate runs the full workflow suite in Chromium and representative multiplayer recovery and UX cases in Firefox and WebKit. CI uses Playwright-managed browser versions. Optional `RIGHELT_CHROMIUM_EXECUTABLE`, `RIGHELT_FIREFOX_EXECUTABLE`, and `RIGHELT_WEBKIT_EXECUTABLE` overrides are for local environments only.

Recovery measurements are written to `test-results/sync-recovery` and uploaded by CI even after successful runs. They count application payload bytes, not compressed wire traffic. See [T-114 browser validation](validation/t114-browser-validation.md) for fault coverage and measurement limits.

## Change Review Expectations

Implementation plans and PR summaries should identify:

- the unit logic under test
- the integration boundary under test
- the user workflow touched
- whether `E2E` coverage was added, expanded, or intentionally left unchanged
- which UX proof lanes were used when the change touches the user experience

## Validation evidence and PR shepherding

Use the repo skill `skills/validate-and-shepherd/SKILL.md` for local validation or integrated PR shepherding. Run `pnpm validate:local` before completion; use `pnpm validate:integrated --manifest FILE` for ordered PR sets. Inspect actual screenshots, repair source PRs, publish the evidence report, and report current-head readiness and remaining risks. Personal report review progress never authorizes a merge.
