# F-031 Shell Integration Test Plan

## Objective

Add a dedicated shell integration test layer that verifies user-visible shell behavior across the real live-transport API contract and the real web transport client contract.

This layer is intended to close the gap between:

- API contract tests in `packages/api-handler/test`
- lightweight web/unit tests in `apps/web/test`
- manual browser validation

## Why This Layer Is Needed

The current test coverage is strong for individual units and endpoint contracts, but several regressions have occurred in behavior that only shows up when multiple clients interact with the same game session over time. The main gaps are:

- multiple-client coordination
- invite flow state transitions
- live game progression across clients
- turn-control semantics
- route-to-transport integration assumptions

## Initial Scope

The first implementation adds a transport-level integration harness, not a full DOM/browser automation harness.

That means the initial suite will validate:

- real `handleApiRequest(...)` behavior
- real `createLiveTransportStore(...)` behavior
- multiple independent client identities
- invite-token resolution and join flows
- turn/move behavior across clients
- backend-authoritative capability transitions after refresh

Implemented in this first pass:

- stateful multi-client harness in `packages/api-handler/test/support/shell-integration-harness.mjs`
- integration scenarios in `packages/api-handler/test/shell-integration.test.mjs`
- real API-handler + real web transport store interaction
- route-level invite resolution and canonical game-route targeting

This first pass does not attempt to validate:

- DOM rendering details
- modal layout/overlay interaction semantics
- real websocket delivery timing and reconnect behavior

Those remain future scope.

## Harness Design

The integration harness will:

1. Create multiple independent client stores using the real `createLiveTransportStore(...)`.
2. Route client fetch calls into the real `handleApiRequest(...)`.
3. Provide isolated storage per client so identities remain stable and deterministic.
4. Expose helpers for:
   - creating named clients
   - creating games
   - resolving invite links
   - loading games from another client
   - joining as player/viewer
   - making moves
   - ending turns
   - refreshing state for assertions

## Implemented Initial Scenarios

### 1. Invite Join Flow

Implemented and validated:

- a created game exposes an opaque invite token
- the invite token resolves to a game id and inviter role
- a second client can join via the invite token
- the second client can move onto the canonical game route target after invite acceptance

### 2. Multi-Move Same-Turn Flow

Implemented and validated:

- the active player can record multiple moves inside one turn
- the active turn remains with that player until `end-turn`
- the waiting player cannot move before the turn ends
- refreshed client state reflects the same active turn and move count

### 3. End-Turn Handoff Flow

Implemented and validated:

- once the active player ends the turn, control passes to the next player
- capability flags update correctly after refresh
- the next player can then record moves in the new turn

### 4. Invite Availability Flow

Implemented and validated:

- invite resolution still works after player seats are full
- backend-driven capabilities reflect the correct remaining join options
- a third client can still join as viewer while player join is disabled

## Correctness Gates

This integration layer is only useful if it becomes a merge gate for shell work.

For shell/live-transport changes, the validated stack is:

1. `pnpm test:api-handler`
2. `pnpm --filter @righelt/web test`
3. shell integration scenarios in `packages/api-handler/test/shell-integration.test.mjs`

## Future Scope

Not yet implemented:

1. DOM-level integration tests for invite modal gating and disabled background interaction
2. websocket integration tests with controlled event delivery and reconnect behavior
3. stale presence / reconnect timing tests with fake clocks
4. cross-route tests that verify invite route -> canonical live route transitions at the app-controller level

Additional future candidates:

1. history-mode integration checks across multiple turns and live updates
2. offline/go-online integration scenarios using multiple clients
3. live websocket recovery tests that intentionally drop events and verify reconciliation behavior

## Status

- Planning status: `completed`
- Implementation status: `initial transport-level harness implemented`
- Validation status:
  - `pnpm test:api-handler` passed
  - `pnpm --filter @righelt/web test` passed
- Future scope: `defined`

## Traceability Audit Snapshot

This section is the lightweight audit ledger for shell/live-transport correctness. It maps the normative web-app spec to the current automated coverage shape so regressions are easier to spot during follow-up work.

### Status keys

- `behavior-covered`: validated by behavior-level tests against real state transitions or rendered/view-model outcomes
- `static-guard-only`: covered only by source-shape or implementation-structure assertions
- `partially-covered`: key flow exists in tests, but important cross-client or lifecycle edges are still missing
- `gap`: not yet covered by a meaningful automated regression test

### Current audit

| Surface | Spec focus | Status | Current evidence | Follow-up |
| --- | --- | --- | --- | --- |
| Invite token resolution -> canonical game route | Web app spec Sections 2 and 4 | `behavior-covered` | `packages/api-handler/test/shell-integration.test.mjs` | Keep as merge gate |
| Direct game route on new device behaves like non-player invite | Web app spec Section 4 | `behavior-covered` | `packages/api-handler/test/shell-integration.test.mjs` | Extend across refresh/load paths |
| Player-seat request -> approval -> upgraded capability state | Web app spec Section 4 | `partially-covered` | `packages/api-handler/test/live-transport.test.mjs`, `apps/web/test/join.test.mjs` | Add multi-client shell integration coverage |
| Approval gate ignore/dismiss behavior | Web app spec Section 4 | `static-guard-only` | `apps/web/test/ui-guards.test.mjs` | Add behavior-level shell tests where feasible |
| Join action availability and disabled fallbacks | Web app spec Section 4 | `partially-covered` | `packages/api-handler/test/shell-integration.test.mjs`, `apps/web/test/ui-guards.test.mjs` | Add explicit behavior assertions for full/closed seats |
| History mode persists while live updates append | Web app spec Sections 1 and 15 | `gap` | none at transport integration layer | Add multi-client shell integration scenario |
| Return-to-live after history catches up to latest snapshot | Web app spec Sections 1 and 15 | `partially-covered` | `apps/web/test/history.test.mjs`, `apps/web/test/game-flow.integration.test.mjs` | Add real transport-backed coverage |
| Offline-local hidden until explicit go-online confirmation | Web app spec Section 14 | `behavior-covered` | `packages/api-handler/test/live-transport.test.mjs`, `apps/web/test/offline.test.mjs` | Add shell integration reload/listing coverage |
| Dual-seat / play-as-both transition semantics | Web app spec Sections 3 and 14 | `behavior-covered` | `packages/api-handler/test/live-transport.test.mjs`, `apps/web/test/join.test.mjs` | Keep broad regression coverage |
| Websocket replay vs state-sync recovery | Web app spec Sections 2 and 15 | `partially-covered` | `packages/api-handler/test/live-websocket.test.mjs`, `apps/web/test/live-sync.test.mjs` | Add store-facing integration assertions around authoritative refresh state |
| Pages proxy shell route forwarding | Split-stack deployment contract | `partially-covered` | `apps/api/test/worker-entry.test.mjs` | Expand beyond health/create/presence smoke routes |
