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

## Coverage Rules

- Every behavioral change must add or update `unit` coverage.
- Every behavioral change must add or update `integration` coverage.
- Every touched workflow must explicitly consider whether its `E2E` coverage should be added or expanded.
- Every important workflow should have:
  - one success-path `E2E`
  - one recovery/failure-path `E2E`
  - integration coverage for important workflow variants beneath the browser layer

## CI Order

CI runs in lane order:

1. `typecheck`
2. generated runtime freshness guard
3. `unit`
4. `integration`
5. `E2E`

## Change Review Expectations

Implementation plans and PR summaries should identify:

- the unit logic under test
- the integration boundary under test
- the user workflow touched
- whether `E2E` coverage was added, expanded, or intentionally left unchanged
