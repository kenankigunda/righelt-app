# Righelt Engine Test Matrix (v3)

Status: Normative acceptance matrix for engine implementation against `RIGHELT_RULES_SPEC.md`.

## Conventions

- Coordinates use `(row,col)`.
- `C1` / `C2`: Commander for `P1` / `P2`.
- `U1a`, `U1b`: `P1` units. `U2a`, `U2b`: `P2` units.
- Supply points are fixed: `P1=(0,9)`, `P2=(9,0)`.
- Unless noted, game starts from standard initial position and `P1` to move.
- “Resolve” means full stabilization per spec resolution order.
- Expected result assumes deterministic rules, no UI/network concerns.

## A. Initialization and Determinism

### A-001 Standard setup
- Given: New game.
- When: Engine initializes.
- Then:
  - Board is 10x10.
  - `C1@(3,6)`, `C2@(6,3)`.
  - No other pieces.
  - Side to move is `P1`.

### A-002 Deterministic replay
- Given: A fixed legal action sequence `S`.
- When: Replay `S` from initial state twice.
- Then: Final board, side-to-move, continuation state, and terminal outcome are identical.

### A-003 No hidden randomness
- Given: Same state and same chosen action.
- When: Apply action multiple times in isolated runs.
- Then: Same resolved state each run.

## B. Commander Supply + Terminal Condition

### B-001 Commander requires supply path
- Given: A state where `C1` has no valid supply path to `(0,9)` after resolve.
- When: Resolve.
- Then: `C1.supplied=false`.

### B-002 Opponent wins on unsupplied commander
- Given: `C1.supplied=false`, `C2.supplied=true` after stabilized resolve.
- When: Terminal evaluation.
- Then: Winner is `P2`.

### B-003 Symmetric commander unsupplied
- Given: `C1.supplied=true`, `C2.supplied=false` after stabilized resolve.
- When: Terminal evaluation.
- Then: Winner is `P1`.

### B-004 Simultaneous commander unsupply
- Given: `C1.supplied=false` and `C2.supplied=false` in same stabilized resolve.
- When: Terminal evaluation.
- Then: Draw.

### B-005 Commander unsupplied is terminal immediately
- Given: Non-terminal state; side to move performs legal action that makes opponent Commander unsupplied.
- When: Resolve.
- Then: Game ends immediately; no further actions accepted.

### B-006 Commander not auto-removed on unsupply
- Given: `C1` becomes unsupplied.
- When: Resolve.
- Then: `C1` remains on board (inactive) and terminal condition is checked.

## C. Pass and Turn Progression

### C-001 Pass basic
- Given: Normal non-terminal state, no continuation phase.
- When: Active player chooses `Pass`.
- Then: Board unchanged; side-to-move switches.

### C-002 Pass illegal during forced continuation
- Given: Push continuation active for current player.
- When: Player attempts `Pass`.
- Then: Action rejected.

### C-003 Side alternation
- Given: Sequence of two legal normal turns with no continuation.
- When: Apply turn 1 then turn 2.
- Then: Side-to-move returns to original player.

## D. Move (Commander only)

### D-001 Commander orthogonal move legal
- Given: `C1` active and empty adjacent orthogonal destination.
- When: `Move` to that destination.
- Then: Commander relocates; turn ends; side switches.

### D-002 Commander move blocked by occupancy
- Given: Adjacent orthogonal destination occupied.
- When: `Move` attempted.
- Then: Rejected; state unchanged.

### D-003 Commander diagonal move illegal
- Given: Empty diagonal destination.
- When: `Move` diagonal attempted.
- Then: Rejected.

### D-004 Non-commander cannot use Move
- Given: `U1a` active with empty adjacent orthogonal square.
- When: `Move` attempted with `U1a`.
- Then: Rejected.

### D-005 Inactive commander cannot move
- Given: `C1.supplied=false` or `C1.commanded=false`.
- When: `Move` attempted.
- Then: Rejected.

### D-006 Move destination must remain supplied
- Given: Commander has an adjacent empty destination but would be unsupplied on that destination.
- When: `Move` attempted.
- Then: Rejected.

## E. Project

### E-001 Project at distance 2 orthogonal legal
- Given: `U1a` active, destination exactly 2 orthogonal squares away, intermediate and destination empty.
- When: `Project`.
- Then: New `P1` unit appears at destination; source remains; turn ends.

### E-002 Project blocked by occupied intermediate
- Given: Intermediate square occupied.
- When: `Project` attempted.
- Then: Rejected.

### E-003 Project blocked by occupied destination
- Given: Destination occupied.
- When: `Project` attempted.
- Then: Rejected.

### E-004 Project wrong distance illegal
- Given: Candidate destination not exactly 2 orthogonal squares away.
- When: `Project` attempted.
- Then: Rejected.

### E-005 Inactive piece cannot project
- Given: Source piece not active.
- When: `Project` attempted.
- Then: Rejected.

### E-006 Project destination must be supplied for created unit
- Given: Source piece active and geometric projection is valid, but destination would be unsupplied for the new unit.
- When: `Project` attempted.
- Then: Rejected.

### E-007 Project can be legal even if resulting piece is uncommanded
- Given: Source piece active, projection destination supplied, and resulting command edge to Commander is cut after resolution.
- When: `Project` attempted and resolve runs.
- Then: Action is accepted and resulting projected piece may be uncommanded.

## F. Rush

### F-001 Orthogonal rush legal when target adjacent to enemy
- Given: Active `U1a`, orthogonally adjacent empty destination, and destination has at least one enemy adjacent.
- When: `Rush`.
- Then: Rush accepted and continuation starts.

### F-002 Orthogonal rush illegal without enemy adjacency
- Given: Same as F-001 but no enemy adjacent to target.
- When: `Rush`.
- Then: Rejected.

### F-003 Diagonal rush legal with co-adjacent enemy
- Given: Active `U1a`, diagonal empty destination, and at least one co-adjacent square (toward destination) contains enemy.
- When: `Rush`.
- Then: Accepted.

### F-004 Diagonal rush illegal without co-adjacent enemy
- Given: Same as F-003 but no co-adjacent enemy.
- When: `Rush`.
- Then: Rejected.

### F-005 Pushed piece cannot diagonal-rush
- Given: Source piece flagged `pushed=true`.
- When: Diagonal `Rush` attempted.
- Then: Rejected.

### F-006 Rush destination occupied
- Given: Rush destination occupied.
- When: `Rush` attempted.
- Then: Rejected.

### F-007 Rush destination must remain supplied
- Given: Rush destination is geometrically legal and empty but would leave rusher unsupplied.
- When: `Rush` attempted.
- Then: Rejected.

## G. Push / Follow / Retreat

### G-001 Push legal with stronger attacker group
- Given: Active attacker has line target on orthogonal ray; `attacker_strength > defender_strength`.
- When: `Push`.
- Then:
  - Attacker moves to defender square.
  - Defender marked pushed.
  - Follow-point set to attacker origin.
  - Push continuation active.

### G-002 Push illegal on equal strength
- Given: `attacker_strength == defender_strength`.
- When: `Push`.
- Then: Rejected.

### G-003 Push illegal on weaker attacker
- Given: `attacker_strength < defender_strength`.
- When: `Push`.
- Then: Rejected.

### G-004 Push targeting rules (first occupied on orthogonal ray)
- Given: Multiple pieces on ray.
- When: `Push` candidate not first occupied enemy on ray.
- Then: Rejected.

### G-005 Cannot push while disallowed temporary state
- Given: Attacker in restricted shifted/pushed/invalid continuation state.
- When: `Push`.
- Then: Rejected.

### G-006 Follow legal into follow-point
- Given: Push continuation active; friendly eligible piece exists with legal movement into follow-point.
- When: `Follow`.
- Then:
  - Piece moves into follow-point.
  - Follow-point updates to follower origin.

### G-007 Follow illegal outside push continuation
- Given: No push continuation active.
- When: `Follow` attempted.
- Then: Rejected.

### G-008 Follow cannot reuse shifted piece
- Given: Piece already shifted in current continuation.
- When: `Follow` with same piece.
- Then: Rejected.

### G-009 Retreat legal to orthogonal empty square
- Given: A pushed piece and at least one orthogonally adjacent empty square.
- When: `Retreat` to one such square.
- Then: Piece relocates; pushed state cleared.

### G-010 Retreat illegal to diagonal square
- Given: Pushed piece and empty diagonal square.
- When: `Retreat` diagonal attempted.
- Then: Rejected.

### G-011 Forced removal when no retreat
- Given: Pushed piece with zero orthogonally adjacent empty squares.
- When: Resolve forced retreat step.
- Then: Pushed piece removed.

## H. Supply System

### H-001 Supplied true when path exists
- Given: Piece with at least one valid path to own supply point under engine constraints.
- When: Resolve.
- Then: `supplied=true`.

### H-002 Supplied false when no path exists
- Given: Piece with no valid path to own supply point.
- When: Resolve.
- Then: `supplied=false`.

### H-003 Non-commander unsupplied removal
- Given: Non-commander piece unsupplied after resolution step.
- When: Resolve to stability.
- Then: Piece removed per rules engine policy.

### H-004 Supply recomputes after each atomic step
- Given: Action changes occupancy/connectivity.
- When: Resolve.
- Then: Supply statuses recomputed before terminal check.

### H-005 Enemy command-edge cells block supply routes
- Given: Piece has geometric route to supply through empty cells, but every route crosses interior cells of enemy command edges.
- When: Resolve to stability.
- Then: Piece is unsupplied.

### H-006 Friendly command-edge cells do not block own supply routes
- Given: Piece has supply route that crosses interior cells of friendly command edges.
- When: Resolve to stability.
- Then: Piece remains supplied.

## I. Command System

### I-001 Commander commands itself
- Given: Any state with commander present.
- When: Command propagation runs.
- Then: Commander is command root (commanded=true unless engine represents root separately).

### I-002 Orthogonal command edge through empties
- Given: Two friendly pieces aligned orthogonally with empty squares between.
- When: Edge build.
- Then: Command edge is created.

### I-003 Diagonal command edge only at distance 1
- Given: Two friendly pieces diagonal distance >1.
- When: Edge build.
- Then: No diagonal edge.

### I-004 Edge cut on geometric intersection
- Given: One friendly edge intersects enemy edge.
- When: Cut detection.
- Then: Both edges marked cut.

### I-005 Command propagation excludes cut edges
- Given: Path from commander requires traversing a cut edge.
- When: Command propagation.
- Then: Piece beyond cut edge is uncommanded.

### I-006 Uncommanded piece inactive
- Given: Piece supplied but uncommanded.
- When: Attempt action requiring active piece.
- Then: Rejected.

## J. Group Strength

### J-001 Group strength counts connected members
- Given: Friendly connected component with `n` members under group rule.
- When: Strength computed.
- Then: `strength == n`.

### J-002 Group recomposes after board change
- Given: Move changes adjacency/connectivity.
- When: Resolve.
- Then: Group strengths update before push legality checks.

## K. Resolution Order and Stability

### K-001 Resolution order enforcement
- Given: Action causing both connectivity and supply changes.
- When: Resolve.
- Then: Engine applies steps in spec order (connectivity -> supply -> command -> legal sets -> forced effects -> terminal).

### K-002 Re-run until stable
- Given: First resolution pass removes a unit causing new unsupply.
- When: Resolve.
- Then: Additional passes occur until no further state changes.

### K-003 Terminal check after stabilization
- Given: Intermediate pass shows temporary commander unsupply, later pass restores supply.
- When: Resolve to stability.
- Then: Terminal evaluation uses final stabilized state only.

## L. Negative/Integrity Tests

### L-001 Out-of-bounds coordinates
- Given: Action references coordinate outside `0..9`.
- When: Apply action.
- Then: Rejected.

### L-002 Action by non-side-to-move
- Given: Legal move shape but wrong player to move.
- When: Apply.
- Then: Rejected.

### L-003 Action from empty source square
- Given: No piece at source.
- When: Apply.
- Then: Rejected.

### L-004 Action on terminal game
- Given: Game already terminal.
- When: Any action submitted.
- Then: Rejected.

## M. Suggested Golden Scenarios (Integration)

### M-001 Minimal supply-cut win
- Given: Construct smallest board state where one legal action disconnects opponent commander from supply.
- When: Apply action and resolve.
- Then: Correct winner declared immediately.

### M-002 Simultaneous draw by mutual supply cut
- Given: Action that causes both command paths/supply paths to fail for both commanders after stabilization.
- When: Resolve.
- Then: Draw.

### M-003 Push chain into forced no-retreat then win
- Given: Push/follow sequence creates no-retreat removal and then commander unsupply.
- When: Resolve full continuation and stabilization.
- Then: Piece removal occurs correctly and terminal winner is correct.

### M-004 Replay parity with recorded log
- Given: Canonical action log fixture.
- When: Replayed from initial state.
- Then: Final state hash and outcome match snapshot.

## N. Implementation Notes for Test Harness

- Provide two layers:
  - Rule-unit tests (single action legality and state transition).
  - Scenario/integration tests (multi-action, continuation phases, terminal checks).
- Use table-driven fixtures:
  - `initial_state`
  - `action`
  - `expected_state_delta`
  - `expected_terminal`
- Add state hash assertions for replay tests.
- Keep deterministic fixture IDs stable for CI.
- Add contract test that authoritative engine modules do not import third-party graph/pathfinding libraries.

## O. Continuation Chains and Recursive Completion

### O-001 Rush continuation can chain multiple atomic rushes
- Given: A rush continuation state where same-side legal rush follow-up exists after first rush step.
- When: Apply first rush, then apply legal second rush in continuation.
- Then: Continuation remains active until no legal mandatory/selected rush continuation steps remain.

### O-002 Continuation closes exactly when no continuation obligations remain
- Given: Push or rush continuation state that is one step away from completion.
- When: Apply final required continuation step.
- Then: Continuation context clears and side-to-move switches once.

### O-003 Premature turn-ending action rejected during continuation
- Given: Active continuation context (`push` or `rush`) with legal continuation steps available.
- When: Player attempts non-continuation action (including another piece action type).
- Then: Rejected; continuation context unchanged.

### O-004 Recursive resolve handles continuation-induced forced removals
- Given: Continuation step that triggers forced retreat/removal and creates secondary supply/command changes.
- When: Resolve.
- Then: Engine reruns stabilization passes until fixed point before terminal evaluation.

## P. Headless Engine, Log Validation, and Cross-Runtime Parity

### P-001 Headless command-log replay without UI state
- Given: Initial state and stored command list `S`.
- When: Engine replays `S` in headless mode (no UI hooks, no rendering callbacks).
- Then: Replay succeeds/fails strictly by rules legality and returns deterministic final state + outcome.

### P-002 Invalid command in log fails at exact index
- Given: Stored command list with first illegal command at index `k`.
- When: Headless replay validates and applies sequentially.
- Then: Replay halts at `k` with deterministic validation error and unchanged state from `k-1`.

### P-003 Optional snapshot-only replay path
- Given: Legal command list `S`.
- When: Replay with intermediate snapshots disabled.
- Then: Engine can produce final state and terminal outcome without materializing intermediate UI states.

### P-004 Snapshot parity between full-trace and final-only modes
- Given: Same initial state and legal list `S`.
- When: Replay once with per-step snapshots and once in final-only mode.
- Then: Final state hash, side-to-move, continuation flags, and outcome are identical.

### P-005 Client/server deterministic parity
- Given: Canonical fixture set `F` (initial states + action sequences).
- When: Execute `F` in browser-target build and server-target build.
- Then: Each fixture yields identical final state hash, legality decisions, continuation transitions, and outcome.

### P-006 Serialization round-trip stability
- Given: Engine state with continuation context and derived flags.
- When: Serialize -> deserialize -> continue replay.
- Then: Legal move generation, validation outcomes, and final state match non-round-tripped run.

### P-007 Legal action generation equals validation boundary
- Given: Arbitrary non-terminal state.
- When: Enumerate legal actions `L`, then validate each `a in L` and a sampled set `not in L`.
- Then: All `a in L` are accepted and all sampled `not in L` are rejected.

### P-008 Deterministic history emission
- Given: Same initial state and same legal command list.
- When: Produce machine-readable move history twice.
- Then: History entries (ordering, action encoding, resulting metadata) are byte-identical.

## Q. Analysis Artifacts for UI Indicators

### Q-001 Supply shortest-path artifact present
- Given: State where a piece is supplied.
- When: Resolve with full artifact mode.
- Then: Engine returns shortest path from piece to own supply point for that piece.

### Q-002 Supply shortest-path deterministic tie-break
- Given: State where multiple equal-length supply paths exist.
- When: Resolve same state repeatedly (and across runtimes).
- Then: Returned shortest path is identical in all runs.

### Q-003 Command artifact includes edges and cut edges
- Given: State with at least one friendly command edge and at least one edge intersection.
- When: Resolve with full artifact mode.
- Then: Engine returns candidate edges, cut-edge identifiers, and active propagation edges consistently.

### Q-004 Command path-to-commander artifact present
- Given: Commanded piece reachable from Commander via uncut edges.
- When: Resolve with full artifact mode.
- Then: Engine returns deterministic shortest path-to-commander artifact for that piece.

### Q-005 Group artifact exposes connected components and strengths
- Given: State with at least two friendly components of different sizes.
- When: Resolve with full artifact mode.
- Then: Engine returns component id per piece, members per component, and strength per component.

### Q-006 Rules booleans derive from same artifact build
- Given: Any non-terminal state.
- When: Resolve with full artifact mode.
- Then: `supplied`, `commanded`, and push-strength decisions are consistent with returned supply/command/group artifacts.

### Q-007 Full vs minimal artifact mode parity
- Given: Same initial state and legal command list.
- When: Replay once with minimal artifacts and once with full artifacts.
- Then: Final state hash, legality decisions, continuation state, and terminal outcome are identical.
