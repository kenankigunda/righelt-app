# Engine Contract Freeze v1

Version: 1.0.0
Date: 2026-02-24

## Frozen Engine API Signatures

- `createInitialState(): GameState`
- `listLegalActions(state: GameState): Action[]`
- `validateAction(state: GameState, action: Action): ValidationResult`
- `applyAction(state: GameState, action: Action): ApplyResult`
- `replayActions(initial: GameState, actions: Action[], options?: ReplayOptions): ReplayResult`
- `serializeState(state: GameState): string`
- `deserializeState(serialized: string): GameState`

## Frozen Artifact Contract

- `ResolveArtifacts` contains deterministic `supply`, `command`, and `groups` sections.
- `ARTIFACT_CONTRACT_VERSION` is `1.0.0` in `packages/game-engine/src/types.ts`.

## Frozen Tie-Break Policy

- Supply shortest path tie-break order: `row`, then `col`.
- Command edge tie-break policy:
  - Primary: lexicographic node order.
  - Secondary: shortest path row/col ordering.
- `TIE_BREAK_POLICY_VERSION` is `1.0.0` in `packages/game-engine/src/types.ts`.
