# Righelt Execution Plan - Milestone 2 (Game Engine)

Status: Proposed implementation and test plan for deterministic v1 engine delivery.

This milestone delivers a shared, headless game engine that runs in both server and client contexts, with matrix-driven automated validation and a minimal UI harness for manual verification.

## 1. Milestone Goal

Implement and validate `packages/game-engine` so it can:
1. Initialize game state from spec defaults.
2. Generate legal actions for current context (normal + continuation).
3. Validate and apply selected actions.
4. Resolve continuation chains (push/follow/retreat, rush continuation) until closed.
5. Recompute supply/command/group state on each atomic step in normative order.
6. Stabilize recursively when forced effects create additional changes.
7. Evaluate terminal outcomes after stabilization.
8. Replay stored command logs headlessly and deterministically.

## 2. Scope and Non-Goals

In scope:
1. Core deterministic rules engine per `docs/RIGHELT_RULES_SPEC.md`.
2. Acceptance tests mapped to `docs/RIGHELT_ENGINE_TEST_MATRIX.md` (A-P).
3. Lightweight browser UI harness for manual board/action verification.
4. Engine API surface suitable for later AI training and server authority use.

Out of scope for this milestone:
1. Full production game UI/UX.
2. Multiplayer networking and durable game-room orchestration.
3. Performance tuning beyond basic determinism and correctness.

## 3. Deliverables

1. New package: `packages/game-engine`
2. Engine modules (proposed):
   - `state.ts`: canonical state model and constructors.
   - `actions.ts`: action types and validation helpers.
   - `legal.ts`: legal-action generation.
   - `apply.ts`: atomic action application.
   - `resolve.ts`: stabilization pipeline and continuation resolution.
   - `replay.ts`: headless command-log replay.
   - `serialize.ts`: deterministic encode/decode utilities.
3. Automated test suites:
   - Unit/rule tests (single-rule correctness)
   - Scenario/integration tests (multi-step + continuation + terminal)
   - Replay/parity tests (headless, deterministic, serialization)
4. Minimal UI harness in `apps/web` for manual testing:
   - Board render (simple grid)
   - Piece render (text markers)
   - Action controls (select source/target + action type)
   - Legal action preview/debug pane
   - Move history + final state summary

## 4. Engine API Contract (Milestone Target)

1. `createInitialState(): GameState`
2. `listLegalActions(state: GameState): Action[]`
3. `validateAction(state: GameState, action: Action): ValidationResult`
4. `applyAction(state: GameState, action: Action): ApplyResult`
5. `replayActions(initial: GameState, actions: Action[], options?): ReplayResult`
6. `serializeState(state: GameState): string`
7. `deserializeState(serialized: string): GameState`

Notes:
1. API must be pure/deterministic and UI-independent.
2. No hidden global state or runtime randomness.
3. Validation errors must be deterministic and machine-readable.

## 5. Milestone Work Plan

## Phase 0: Package and Test Harness Foundation
1. Add `packages/game-engine` package scaffold and exports.
2. Add root scripts:
   - `test:engine` (all engine tests)
   - `test:engine:unit`
   - `test:engine:integration`
3. Set up fixture format for matrix scenarios:
   - `initial_state`
   - `action_sequence`
   - `expected_final_state_hash`
   - `expected_outcome`
   - `expected_error` (negative cases)
4. Add deterministic state hash utility for assertion stability.

Exit criteria:
1. Package builds and imports from both web and server code paths.
2. Test runner executes empty baseline suite in CI.

## Phase 1: State Model + Initialization + Determinism Core
1. Implement canonical state shape:
   - board occupancy
   - side-to-move
   - continuation context
   - derived artifacts (`supplied`, `commanded`, groups, edges)
2. Implement `createInitialState()` per rules Section 2.
3. Implement serialization round-trip and stable state hashing.
4. Implement deterministic replay skeleton (apply without full legality yet).

Matrix focus:
1. A-001, A-002, A-003
2. P-006, P-008 (initial versions)

Exit criteria:
1. Initial setup deterministic across repeated runs.
2. State serialization round-trip preserves semantic equality.

## Phase 2: Action Legality + Atomic Apply
1. Implement legality for:
   - `Pass`
   - `Move`
   - `Project`
   - `Rush`
   - `Push`
   - continuation-only `Follow` and `Retreat`
2. Implement action validation boundary (`listLegalActions` vs `validateAction` parity).
3. Implement atomic state transition application for legal actions.

Matrix focus:
1. C-001..C-003
2. D-001..D-005
3. E-001..E-005
4. F-001..F-006
5. G-001..G-011 (atomic behavior + forced retreat entry points)
6. L-001..L-004
7. P-007

Exit criteria:
1. All action families accepted/rejected correctly for direct legality.
2. No state mutation on rejected actions.

## Phase 3: Connectivity, Supply, Command, Groups, and Resolution Order
1. Implement connectivity artifact rebuild.
2. Implement supply recomputation for all pieces including commanders.
3. Implement command propagation and edge cuts.
4. Implement push strength group composition.
5. Implement full normative resolution pipeline order.
6. Implement rerun-until-stable loop.
7. Implement terminal evaluation from stabilized state.

Matrix focus:
1. B-001..B-006
2. H-001..H-004
3. I-001..I-006
4. J-001..J-002
5. K-001..K-003

Exit criteria:
1. Resolution pipeline behavior matches rules Section 7 and Section 8 outcomes.
2. Stabilization loop converges deterministically.

## Phase 4: Continuation Chain Completion and Headless Replay
1. Implement push continuation obligations (mandatory follow semantics).
2. Implement rush continuation chaining and closure rules.
3. Enforce continuation-gated action availability.
4. Finalize headless command-log replay with fail-fast index reporting.
5. Support optional replay mode without intermediate snapshots.

Matrix focus:
1. O-001..O-004
2. P-001..P-004
3. M-003, M-004

Exit criteria:
1. Continuation chains complete correctly and close exactly once.
2. Headless replay deterministic in both trace and final-only modes.

## Phase 5: Golden Scenarios, Cross-Runtime Parity, and CI Hardening
1. Implement full golden scenario fixtures:
   - M-001, M-002, M-003, M-004
2. Add cross-runtime parity runner:
   - same fixtures executed in Node and browser-target runtime.
3. Wire CI gates to fail on any matrix regression.
4. Publish matrix coverage report (scenario ID -> test file mapping).

Matrix focus:
1. M-001..M-004
2. P-005
3. Full A-P regression pass

Exit criteria:
1. Matrix scenarios A-P are covered and passing.
2. Node/browser parity is green for canonical fixtures.

## 6. Minimal UI Harness Plan (Manual Verification Only)

Purpose:
1. Verify engine behavior interactively without coupling rules to UI code.
2. Provide debugging visibility for legal actions, continuation context, and terminal transitions.

Implementation:
1. Add a simple “Engine Playground” view in `apps/web`:
   - static grid with coordinate labels
   - click-select source/destination
   - action picker (`Pass`, `Move`, `Project`, `Rush`, `Push`, `Follow`, `Retreat`)
2. Drive all state transitions only through `packages/game-engine` API.
3. Add panels:
   - current side to move
   - continuation context
   - commander supply status
   - legal actions for selected piece
   - textual move log
4. Add fixture loader to run selected golden scenarios and inspect final state.

Manual smoke checklist:
1. Start new game and confirm initial positions.
2. Execute representative legal/illegal actions and confirm expected acceptance.
3. Trigger push/rush chains and verify continuation closure.
4. Trigger commander unsupply and verify immediate terminal result.
5. Replay a stored action list and verify final hash/outcome matches tests.

## 7. Test Strategy and Matrix Mapping

1. Unit tests:
   - Focus on local rule boundaries and invalid/edge inputs.
   - Fast feedback for legality, geometry, and derived-state logic.
2. Integration tests:
   - Multi-step scenarios with continuation, forced effects, and stabilization.
   - Golden fixtures for outcome correctness and replay.
3. Parity tests:
   - Same fixture corpus across runtimes to detect environment drift.
4. UI smoke tests:
   - Manual, non-blocking, for quick behavioral confidence.

Required pass condition:
1. Every matrix ID from `A-001` through `P-008` is linked to at least one automated test case.
2. No matrix item is validated only by UI/manual checks.

## 8. Risks and Mitigations

1. Risk: Ambiguity in continuation semantics (especially mandatory follow/rush chaining).
   - Mitigation: encode explicit continuation-state invariants and fixture-based edge cases early (Phase 4).
2. Risk: Divergence between legal-action generation and validation logic.
   - Mitigation: enforce P-007 parity tests from Phase 2 onward.
3. Risk: Runtime-specific behavior differences (Node vs browser).
   - Mitigation: isolate pure engine package and run identical fixtures in both environments (Phase 5).
4. Risk: UI harness accidentally becoming rule authority.
   - Mitigation: UI only consumes engine API; no duplicated legality logic.

## 9. Definition of Done (Milestone 2)

Milestone 2 is complete when:
1. `packages/game-engine` exposes stable deterministic API listed in Section 4.
2. Automated tests cover and pass all matrix scenarios `A-P`.
3. Headless replay supports validation, deterministic failure indexing, and final-only mode.
4. Minimal UI harness supports interactive manual verification but contains no rules logic.
5. CI includes mandatory engine test gate for PRs.
