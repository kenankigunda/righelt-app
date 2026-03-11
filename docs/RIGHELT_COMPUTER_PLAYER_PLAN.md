# Righelt Computer Player Plan

Status: Proposed implementation plan for computer-controlled players.

## Summary

Righelt should add named computer opponents that can play from the existing engine rules alone, run locally in shell and web, and differ by both strength and style:

- `Babs the Bunny`: beginner, balanced
- `Tau the Tortoise`: medium, defensive
- `Sev the Sneakster`: medium, aggressive
- `Horus the Sage`: hard, balanced

Recommended approach:

1. Harden the game-engine test suite first so it can serve as the authority for search, self-play, replay, and future model evaluation.
2. Ship a search-based local bot first using the existing deterministic engine.
3. Add offline self-play training later with compact exported weights for local inference.

This is the right fit for Righelt because the game is deterministic, perfect-information, two-player, and already exposes engine primitives suitable for search:

- `createInitialState`
- `listLegalActions`
- `validateAction`
- `applyAction`
- `resolveToStability`

## Research Basis

The recommended direction is a phased AlphaZero-style approach:

- AlphaZero showed that strong play can emerge from self-play using rules only, without human game records.
- Expert Iteration is the practical pattern here: search produces strong move targets, and learning compresses that search into a reusable evaluator.
- MuZero is less appropriate as the primary design because Righelt already has an explicit simulator; it is better when the environment model must be learned.
- KataGo is useful as an engineering reference for efficiency and richer targets, but not as a direct template for Righelt.

Reference links:

- [Silver et al. 2017, AlphaZero](https://arxiv.org/abs/1712.01815)
- [Anthony et al. 2017, Expert Iteration](https://arxiv.org/abs/1705.08439)
- [Schrittwieser et al. 2019, MuZero](https://arxiv.org/abs/1911.08265)
- [Wu 2019, KataGo](https://arxiv.org/abs/1902.10565)

## Phase 0: Strengthen the Engine Test Suite

This phase should land before bot implementation. AI search and self-play will amplify engine bugs, so the engine suite needs to be strong enough to act as a trusted oracle.

### Current assessment

The current suite is healthy:

- `pnpm test:engine` passes
- `pnpm typecheck` passes
- broad rule families are already covered

However, there are still important gaps:

- coverage is still heavily example-driven
- most tests use hand-built states rather than reachable states
- golden/parity fixtures are too small for long-term regression protection
- some matrix/test naming has drifted and traceability is not strict enough
- several continuation and geometry edge cases are covered only indirectly

### Required improvements

#### 1. Add a matrix coverage test

Add a test that enforces a one-to-one mapping between matrix ids in [docs/RIGHELT_ENGINE_TEST_MATRIX.md](/Users/kenankigunda/.codex/worktrees/b058/righelt/docs/RIGHELT_ENGINE_TEST_MATRIX.md) and named tests in `packages/game-engine/test/`.

It should:

- fail if a matrix id has no matching test id
- fail if an unrelated concern reuses a matrix namespace
- catch naming drift such as misleading rule titles

#### 2. Expand fixture-backed golden scenarios

Grow the golden fixture set beyond `M-001` to `M-004` so it covers:

- minimal supply-cut win
- simultaneous commander unsupply draw
- push with no retreat
- push with forced retreat
- push with forced follow
- push continuation auto-close
- rush chain close/open boundaries
- serialization during continuation
- continuation-driven forced removal followed by terminal evaluation

These fixtures should be reused for:

- replay parity
- browser/server parity
- trainer smoke checks

#### 3. Add reachable-state property tests

Generate states by legal play from `createInitialState()` and assert:

- all actions in `listLegalActions` validate successfully
- sampled non-listed actions fail validation
- replay of generated histories reaches the same final state hash
- serialization/deserialization at random checkpoints preserves legality and outcome
- stable-state invariants always hold

This closes a major gap in the current `P-007` coverage, which is only lightly sampled.

#### 4. Centralize engine invariants

Add a reusable invariant helper for stabilized states. It should assert:

- commanders remain on board
- terminal states have no legal actions
- no non-commander remains unsupplied after stability unless continuation-freeze rules explicitly allow it
- no pushed piece exists outside push continuation
- no shifted flag survives turn end
- continuation owner and `sideToMove` agree
- minimal and full artifact modes produce identical gameplay state

Use this helper in replay, continuation, fixture, and property tests.

#### 5. Make forced continuation behavior explicit

Add direct tests for:

- exactly one legal retreat square
- exactly one legal follow actor
- exactly one legal follow destination
- retreat cannot use reserved follow-point
- push continuation auto-closes when no follow remains
- rush continuation stays open only while an unused legal rusher exists
- turn index increments exactly once when continuation closes

#### 6. Add geometry boundary tests

Strengthen command/supply geometry coverage with explicit tests for:

- orthogonal line-of-sight blocked by interior occupancy
- diagonal command links only at distance 1
- vertical/horizontal edge intersections
- diagonal/orthogonal edge intersections
- collinear overlap handling
- deterministic tie-break behavior for equal-length command paths

#### 7. Add symmetry and metamorphic tests

For representative scenarios, mirror or rotate the board and swap owners, then assert legality and outcomes transform consistently.

This is especially important before self-play training so the engine does not silently bias data generation.

#### 8. Add trainer-facing regression harnesses

Create reusable helpers so the eventual bot/trainer stack can run:

- golden fixtures
- legality smoke tests over sampled reachable states
- deterministic move-selection smoke checks under fixed seeds

## Phase 1: Search-Based Local Bots

After test hardening, build `packages/computer-player/` with:

- a game adapter around the engine APIs
- canonical state encoding
- action indexing
- seeded RNG
- PUCT MCTS
- heuristic evaluator with persona style weights

Initial runtime target:

- offline-trained or search-only
- local-run in shell
- local-run in browser via worker when needed

### Persona policy

Use one shared architecture with persona-specific scoring and search budgets:

- `Babs`: shallow search, higher randomness, balanced weights
- `Tau`: defensive weights, medium search
- `Sev`: aggressive weights, medium search
- `Horus`: balanced weights, strongest search, low randomness

## Phase 2: Offline Self-Play Training

Use a small Python/PyTorch offline trainer in `tools/ai-trainer/`.

Training loop:

1. Generate self-play games with current best search/model.
2. Train a compact policy/value network.
3. Evaluate candidate against incumbent in arena matches.
4. Export only promoted weights for local runtime inference.

Recommended model direction:

- start with a small MLP for simple TypeScript inference
- feed board occupancy, supply/command status, continuation state, and derived tactical features
- export compact weights plus manifest metadata

## Planned Interfaces

Add a public bot package with interfaces along these lines:

```ts
export type BotId = "babs" | "tau" | "sev" | "horus";
export type BotStyle = "balanced" | "defensive" | "aggressive";
export type BotSkill = "beginner" | "medium" | "hard";

export type BotMoveRequest = {
  state: GameState;
  legalActions?: Action[];
  seed?: number;
  timeBudgetMs?: number;
};

export type BotMoveDiagnostics = {
  value: number;
  visitCount: number;
  policyTopK: { action: Action; probability: number }[];
  principalVariation: Action[];
  searchTimeMs: number;
};

export type BotMoveResponse = {
  action: Action;
  diagnostics: BotMoveDiagnostics;
};
```

## Acceptance Targets

Before training:

- expanded engine fixture corpus is in place
- reachable-state and invariant suites pass in CI
- search bots never emit illegal actions

For initial shipped bots:

- `Babs` average move target under `150ms`
- `Tau` and `Sev` average move target under `500ms`
- `Horus` average move target under `1200ms`
- `Horus` clearly outperforms `Tau` and `Sev`
- `Tau` and `Sev` differ on a meaningful style probe suite, not just strength

## Assumptions

- runtime move generation should remain local-first
- offline training may use Python/PyTorch
- engine correctness work must precede AI training
- personas should differ by real style bias, not only search depth
