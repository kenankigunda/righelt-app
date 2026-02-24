# Righelt Rules Specification (v1)

Status: Normative source of truth for the web rewrite.

This document defines the game rules and resolution order for Righelt.  
If implementation behavior conflicts with this spec, this spec wins.

## 1. Core Definitions

- Board: 10x10 orthogonal grid with coordinates `(row, col)`, `0..9`.
- Players: exactly 2 agents (`P1`, `P2`).
- Side to move: exactly one player is the active player each turn.
- Piece types:
  - `Commander` (1 per player)
  - `Unit` (generic piece)
- Supply point: one fixed board point per player.

## 2. Initial Position

- `P1` supply point: `(0,9)`.
- `P2` supply point: `(9,0)`.
- `P1` Commander starts at `(3,6)`.
- `P2` Commander starts at `(6,3)`.
- No other pieces are on board.
- `P1` moves first.

## 3. State and Eligibility

Each piece has:
- owner (`P1` or `P2`)
- type (`Commander` or `Unit`)
- square
- temporary push-state flags used during push/retreat resolution

Each piece also has two derived booleans:
- `supplied`
- `commanded`

A piece is **active** iff `supplied == true` and `commanded == true` and it is not in a temporary state that forbids acting.

## 4. Turn Structure

On a normal turn, the active player may do exactly one of:
- `Pass`
- one legal piece action (`Move`, `Project`, `Rush`, or `Push`)

Some actions open a temporary continuation phase:
- `Push` opens a push sequence (with mandatory `Follow` to preserve push-group connectivity and forced `Retreat` behavior).
- `Rush` can chain during a rush continuation sequence as allowed by movement legality, but each piece may rush at most once in that sequence.

A turn ends when no continuation is active and control passes to opponent.

## 5. Legal Actions

## 5.1 Pass

- Active player performs no board change.
- Turn immediately passes to opponent.

## 5.2 Move (Commander only)

- Source piece must be active Commander of side to move.
- Destination must be orthogonally adjacent and empty.
- Commander moves to destination.
- Turn ends.

## 5.3 Project (create Unit)

- Source piece must be active and belong to side to move.
- Destination must be exactly 2 squares orthogonally away.
- Intermediate square and destination must both be empty.
- A new `Unit` of the same owner is created on destination.
- Source piece remains in place.
- Turn ends.

## 5.4 Rush

- Source piece must be active and belong to side to move.
- Destination must be empty.
- Rush target is one square away in any of 8 directions.
- Additional rush legality:
  - Orthogonal rush target is legal if at least one square adjacent to target contains an enemy piece.
  - Diagonal rush target is legal if at least one of the two co-adjacent orthogonal squares (from source toward target) contains an enemy piece.
  - A currently pushed piece cannot diagonal-rush.
- Rush enters rush continuation state; normal turn-end is deferred until continuation is closed.
- During rush continuation:
  - Legal actions are `Rush` and `Pass`.
  - Additional rushes are optional; player may `Pass` to end rush continuation and end turn.
  - Any single piece may rush at most once in that continuation sequence.

## 5.5 Push

- Attacker must be active, belong to side to move, and not be in a restricted temporary state.
- Target must be an enemy piece found in one of 4 orthogonal rays from attacker (first occupied square on that ray).
- Push is legal only if `attacker_group_strength > defender_group_strength`.
- On push:
  - attacker enters push continuation state,
  - target becomes `pushed`,
  - attacker moves into target square,
  - follow-point is set to attacker’s previous square,
  - acting player becomes obligated to perform `Follow` steps as needed so the pushing group remains connected,
  - retreat resolution for pushed piece becomes required.

## 5.6 Follow (during push continuation only)

- Only legal while acting player is in push continuation.
- Follow is mandatory (not optional) during push continuation whenever needed to keep the pushing group connected.
- A friendly piece that has not already shifted this continuation may move into current follow-point.
- After follow move, follow-point updates to that piece’s previous square.
- Follow repeats until the connectivity obligation is satisfied and no additional mandatory follow exists.

## 5.7 Retreat (forced for pushed piece)

- A pushed piece may retreat only to an orthogonally adjacent empty square.
- If no retreat square exists, that piece is removed.
- After retreat/removal, pushed state clears.

## 6. Connectivity Systems

Righelt uses two independent systems: `Supply` and `Command`.

## 6.1 Supply

- A piece is supplied iff a path exists from its square to its owner’s supply point under pathfinding constraints.
- Pathfinding uses board occupancy/edge-block constraints as defined by implementation; this spec requires deterministic reachability behavior.
- **Commander is NOT auto-supplied.**  
  Commander must satisfy the same supply path rule as all pieces.
- If a non-Commander piece is unsupplied after resolution, it is inactive.
- Non-Commander unsupplied pieces may be removed by rules engine during state resolution (matching legacy behavior).
- If a Commander is unsupplied after resolution stability, end-of-game evaluation applies immediately per Section 8.

## 6.2 Command

- Command originates at each player’s Commander.
- Friendly command edges are created between qualifying friendly pieces:
  - Orthogonal line of sight links are allowed through empty squares.
  - Diagonal links are allowed only at distance 1.
- Enemy edge intersections cut both intersecting edges.
- Command propagates from Commander through uncut friendly edges.
- A piece not reached by propagation is uncommanded and inactive.

## 6.3 Push Strength Groups

- Group strength is the size of the connected local group used for push comparison.
- Connectivity for this purpose is orthogonal adjacency at distance 1 only (no diagonal links, no long-range line-of-sight links).

## 7. Resolution Order (Normative)

After any atomic action step, engine must resolve in this order:

1. Clear and rebuild connectivity artifacts (edges, path overlays, temporary derived state).
2. Recompute supply for both sides (including both Commanders).
3. Recompute command propagation from each Commander.
4. Recompute legal move sets for active side/continuation context.
5. Apply forced retreat/removal consequences for currently pushed pieces, if applicable.
6. Evaluate end-of-game condition.

If any step causes board changes (e.g., forced removals), rerun resolution until stable.

## 8. Win Condition

The game ends immediately when a player’s Commander is unsupplied after resolution stability.

- If `P1` Commander unsupplied and `P2` Commander supplied: `P2` wins.
- If `P2` Commander unsupplied and `P1` Commander supplied: `P1` wins.
- If both Commanders become unsupplied in the same stabilized resolution, result is a draw.

No other win condition exists in v1 spec.

## 9. Determinism Requirements

- Rules evaluation must be deterministic from current state and chosen action.
- No hidden randomness.
- Replay of recorded action sequence must produce identical end result.

## 10. Out of Scope

- Networking protocol, spectators, presence indicators, and UI hint rendering are not game rules.
- Undo/time controls/ranked rulesets are outside v1.
