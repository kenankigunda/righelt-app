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

For UI rendering, implementations may also expose live display status that answers: "if the continuation ended at this exact board position, would this piece currently be supplied/commanded?"

## 4. Turn Structure

On a normal turn, the active player may make exactly one legal piece action (`Move`, `Project`, `Rush`, or `Push`).
When the turn can legally close without another board action, the shipped client uses `End turn` semantics instead of exposing a standalone `Pass` control.
The engine may still represent that closure internally with `Pass`, but that internal action is not a player-facing move entry in the current web UX.

Some actions open a temporary continuation phase:
- `Push` opens a push sequence with two ordered sub-phases:
  - defender retreat phase,
  - attacker follow phase.
- `Rush` can chain during a rush continuation sequence as allowed by movement legality, but each piece may rush at most once in that sequence.
- When a `Rush` or `Push` begins, the initiating player snapshots their own command/supply state as it existed before that opening action resolves.
- That initiating-player command/supply snapshot remains frozen for the entire continuation sequence and is not refreshed mid-sequence.
- During that frozen window, UI display should still show the live end-now command/supply result for the current board position, even when that differs from the frozen actionable state.
- `Move` and `Project` still require immediate destination supply.
- `Rush`, `Push`, and `Follow` may enter a temporarily unsupplied board position only if the continuation remains completable to a closure state where the initiating side's obligated continuation pieces are supplied.
- For `Rush`, the obligation set is the local same-owner 8-neighbor rush chain (`rushChainPieceIds`) built from the pieces that participate in the rush continuation.
- For `Push`, the obligation set is the recorded attacker follow group (`followGroupPieceIds`) that must remain supplied when the push sequence closes.
- `Retreat` does not require immediate destination supply; a retreated opposing piece may remain unsupplied until sequence end and be destroyed then if still unsupplied.
- Once the continuation closes, normal resolution resumes and the initiating player’s live command/supply state is recomputed before forced removals and terminal evaluation.

A turn ends when no continuation is active and control passes to opponent.

## 5. Legal Actions

## 5.1 Internal Pass / Turn Closure

- The engine may use `Pass` internally to represent a legal turn closure with no additional board change.
- In the shipped web client, that closure is surfaced as `End turn`, not as a standalone `Pass` move.
- A player-facing `PASS` history row must not be created when the turn is simply closing.

## 5.2 Move (Commander only)

- Source piece must be active Commander of side to move.
- Destination must be orthogonally adjacent and empty.
- Destination is legal only if Commander would still be supplied after relocation.
- Commander moves to destination.
- Turn ends.

## 5.3 Project (create Unit)

- Source piece must be active and belong to side to move.
- Destination must be exactly 2 squares orthogonally away.
- Intermediate square and destination must both be empty.
- Destination is legal only if the created Unit would be supplied on that square after the projection.
- A new `Unit` of the same owner is created on destination.
- Source piece remains in place.
- Turn ends.

## 5.4 Rush

- Source piece must be active and belong to side to move.
- Destination must be empty.
- Destination is legal only if the resulting rush continuation is still completable to an end state where the current rush chain is supplied.
- Rush target is one square away in any of 8 directions.
- Additional rush legality:
  - Orthogonal rush target is legal if at least one square adjacent to target contains an enemy piece.
  - Diagonal rush target is legal if at least one of the two co-adjacent orthogonal squares (from source toward target) contains an enemy piece.
  - A currently pushed piece cannot diagonal-rush.
- Rush enters rush continuation state; normal turn-end is deferred until continuation is closed.
- During rush continuation:
  - Legal continuations are additional `Rush` actions plus legal closure of the continuation.
  - The engine represents that closure with `Pass`, but the shipped web client surfaces it as `End turn`.
  - Additional rushes are optional, but closure is legal only when the current rush chain is already supplied in the live end-now position.
  - Any single piece may rush at most once in that continuation sequence.
  - The rushing player continues to use the command/supply state frozen at the start of the rush sequence for the duration of that sequence.
  - UI may show a rushing piece as currently unsupplied/uncommanded if live end-now evaluation says so, but that alone does not remove its continuation eligibility.

For action legality, immediate destination supply is a hard constraint for `Move` and `Project`.
For `Rush`, `Push`, and `Follow`, the requirement is sequence-end completable supply for the obligated continuation set.
Post-action command loss does not invalidate those actions; command is evaluated in resolution after the action is applied.

## 5.5 Push

- Attacker must be active, belong to side to move, and not be in a restricted temporary state.
- Target must be an orthogonally adjacent enemy piece.
- Push is legal only if `attacker_group_strength > defender_group_strength`.
- Push destination is legal only if the resulting push continuation is still completable to an end state where the recorded attacker follow group is supplied.
- On push:
  - attacker moves into target square,
  - target piece remains on that same square in temporary `pushed` state,
  - pushing piece is the top piece on the stacked pushed square,
  - follow-point is set to attacker’s previous square,
  - follow-group connectivity obligation is recorded from the attacker side,
  - attacker-side command/supply state is frozen from the pre-push board and remains frozen until push continuation closes,
  - UI may still show attacker-side pieces using the live end-now command/supply result while the frozen continuation eligibility remains in force,
  - play immediately passes to the owner of the pushed piece for forced `Retreat`, unless no retreat square exists.
  - if no orthogonally adjacent empty retreat square exists, the pushed piece is removed immediately, the retreat sub-phase is skipped, and play remains with the attacker for the follow sub-phase.

## 5.6 Retreat (forced for pushed piece)

- Retreat is the only legal action for the owner of the pushed piece during the retreat sub-phase.
- Only the currently pushed piece may retreat.
- Retreat destination must be an orthogonally adjacent empty square that is not the current follow-point.
- If there is exactly one legal retreat square, that retreat source and destination are considered forced.
- If there is no legal retreat square, the pushed piece is removed and no retreat action is taken.
- After retreat completes, `pushed` state clears and play immediately returns to the attacker for follow continuation.

## 5.7 Follow (during attacker follow sub-phase only)

- Follow is legal only during attacker follow sub-phase.
- During attacker follow sub-phase, no non-follow non-pass regular action is legal.
- Follow is mandatory whenever needed to keep the recorded pushing group connected through the current follow-point.
- A friendly piece that has not already shifted this push sequence may move into current follow-point.
- Follow destination is legal only if the resulting push continuation is still completable to an end state where the recorded attacker follow group is supplied.
- After a follow move:
  - that piece becomes shifted for this push sequence,
  - follow-point updates to that piece’s previous square.
- If there is exactly one legal follow actor, that actor is forced.
- If that forced actor has exactly one legal follow destination, that destination is forced.
- Light UI highlighting may indicate all pieces in the connectivity-constrained follow group; this is representational and not a separate rule.
- When no follow action remains legal:
  - if internal `Pass` is the only remaining legal closure for the attacker, the push continuation closes automatically with no visible `PASS` move,
  - control passes to opponent for a normal turn.

## 6. Connectivity Systems

Righelt uses two independent systems: `Supply` and `Command`.

## 6.1 Supply

- A piece is supplied iff a path exists from its square to its owner’s supply point under pathfinding constraints.
- Supply pathfinding is orthogonal-only (no diagonal supply traversal).
- A supply path may traverse:
  - empty squares
  - squares occupied by friendly pieces (including the starting square)
- A supply path may not traverse:
  - squares occupied by enemy pieces
  - interior cells crossed by enemy command edges (orthogonal line-of-sight command links block supply traversal through their interior cells)
- Enemy command-edge blocking for supply is evaluated from the same deterministic command-edge build used by resolution artifacts.
- **Commander is NOT auto-supplied.**  
  Commander must satisfy the same supply path rule as all pieces.
- If a non-Commander piece is unsupplied after resolution, it is inactive.
- Non-Commander unsupplied pieces are removed only after any active rush/push continuation fully closes and live supply is recomputed.
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
  - If a rush/push continuation is active, the initiating player keeps the frozen command/supply state captured at continuation start; live recomputation is deferred for that player until continuation end.
5. For push continuation:
  - if retreat sub-phase is pending and no retreat square exists, remove pushed piece and advance to attacker follow sub-phase,
  - if attacker follow sub-phase is pending and no follow remains legal, close continuation and pass turn normally.
6. Evaluate end-of-game condition.

If any step causes board changes (e.g., forced removals), rerun resolution until stable.

## 8. Win Condition

The game ends immediately when a player’s Commander is unsupplied after resolution stability.

- If `P1` Commander unsupplied and `P2` Commander supplied: `P2` wins.
- If `P2` Commander unsupplied and `P1` Commander supplied: `P1` wins.
- If both Commanders become unsupplied in the same stabilized resolution, result is a draw.

No other win condition exists in v1 spec.

**Invariant**: A Commander removal always produces a terminal outcome (`p1_win`, `p2_win`, or `draw`). A move whose outcome status is `ongoing` cannot contain a Commander removal. This invariant is relied upon by the history destruction record system to classify Commander removals as `commander_unsupplied` without further engine-side tagging.

## 9. Determinism Requirements

- Rules evaluation must be deterministic from current state and chosen action.
- No hidden randomness.
- Replay of recorded action sequence must produce identical end result.

## 10. Out of Scope

- Networking protocol, spectators, presence indicators, and UI hint rendering are not game rules.
- Undo/time controls/ranked rulesets are outside v1.
