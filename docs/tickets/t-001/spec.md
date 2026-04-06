# Spec: t-001 — Feature: History Destruction Record

## 1. Customer Problem

When a piece is destroyed during a game — whether because it had no retreat square, lost supply after a continuation closed, or caused a Commander unsupply win condition — the history panel gives no record of that destruction. Players reviewing the move log cannot tell from the panel alone that a piece was removed, why it was removed, or where it stood when it was destroyed. They must mentally reconstruct that from the board snapshot, which is slow and easy to miss.

## 2. Affected Users & Contexts

- All participant roles: Player 1, Player 2, Viewer.
- Context: in-game history panel, available during any game phase (in-progress or completed).
- Applies in both multiplayer and Playground mode.
- The destruction record must be persistent: visible on reload and to participants who join after the fact.

## 3. Current Behavior

N/A — this is a new feature. The history panel today shows only move entries grouped under turns (RIGHELT_WEB_APP_SPEC §7). No destruction information is recorded or displayed.

The §12.3 board-local removal feedback (transient flashing highlight and tooltip at the removed square) exists only as ephemeral board-surface feedback and is separate from the history panel. It is not affected by this ticket.

## 4. Intended Behavior

### 4.1 Destruction Records as Sub-Bullets

Each history move entry may have one or more destruction record sub-bullets immediately beneath it.

A destruction record sub-bullet must be shown for every piece that is permanently removed from the board as a direct result of that move's resolution. This covers all three removal causes:

- `no_retreat`: pushed piece has no legal retreat square; removed immediately during push resolution.
- `loss_of_supply`: piece becomes unsupplied after a continuation closes and live supply is recomputed.
- Commander unsupplied (win condition): Commander removed as part of end-of-game resolution after a move.

### 4.2 Move Attachment Rule

A destruction record attaches to the specific sub-action whose resolution triggered the removal:

- For `no_retreat`: the push move entry that caused the immediate removal.
- For `loss_of_supply` after a rush closes: the final rush sub-action (or the Pass) that closed the rush continuation and triggered live supply recomputation.
- For `loss_of_supply` after a push-retreat-follow sequence closes: the follow sub-action (or the Pass) that closed the push continuation and triggered live supply recomputation.
- For Commander unsupply triggering win: the move entry after which supply recomputation found the Commander unsupplied.

Where the rules engine currently emits only transient removal notices, the backend must now persist removal metadata on the move record so it survives reload and late join (see §5).

### 4.3 Sub-Bullet Content

Each sub-bullet displays:

```
DESTROYED (x,y)
```

where `(x,y)` is the square the piece occupied at the moment of removal, using the board's `(row, col)` coordinate convention.

One sub-bullet per destroyed piece. If multiple pieces are destroyed by the same move's resolution, each gets its own sub-bullet, ordered by the canonical removal order defined in §12.3 / engine resolution order (Section 7 of RIGHELT_RULES_SPEC).

### 4.4 Sub-Bullet Color

The sub-bullet color must match the owner color of the destroyed piece (i.e., the same color treatment used for Player 1 and Player 2 piece rendering elsewhere in the UI).

In a draw — both Commanders unsupplied in the same resolution — both destruction records appear, each in the color of its respective owner.

### 4.5 Parent-Move-Owned Navigation

Destruction sub-bullets are not independently actionable. History navigation remains owned by the parent move row. If a user clicks within a destruction sub-bullet, the interaction may bubble to the parent move row and show the same post-move history snapshot, but there is no separate `jump-destruction` action and no separate board-state target.

### 4.6 Recorded-Action Destruction Overlays

When a move with `destroyedPieces` is selected in history mode, the board shows those removals as part of the recorded-action/history rendering for that move. The overlay is derived from the selected move's persisted `destroyedPieces` plus pre-action piece data from the move's `selectionSnapshot`, so the board can render the destroyed piece markers with the correct owner/kind/supply-command styling without mutating snapshot state.

### 4.7 Live Append Behavior

Destruction sub-bullets are part of their parent move entry. When the history panel appends a new move entry in real time (RIGHELT_WEB_APP_SPEC §7), any destruction sub-bullets for that entry appear together with it. A player pinned to an earlier history snapshot sees the new entry (including its sub-bullets) appended to the panel list without being navigated away from their current view.

### 4.8 Playground Mode

Attribution is identical to multiplayer. Sub-bullet color reflects piece owner (Player 1 or Player 2), regardless of which seat the Playground device controls.

## 5. Rules & Engine Contract

No changes to game rule legality, scoring, or resolution order. This ticket only changes what metadata is persisted and surfaced.

### 5.1 Engine Must Expose

The board contract (RIGHELT_WEB_APP_SPEC §1.1.1) must be extended to include destruction metadata in the move record:

- The `moveSent` event payload (or the stored move record it produces) must carry a `destroyedPieces` array, analogous to the existing transient `removedPieces` in §12.3 but intended for permanent persistence.
- Each entry in `destroyedPieces` must include at minimum:
  - `position`: `{ row, col }` — square the piece occupied at removal.
  - `ownerSeat`: `"p1"` or `"p2"` — for color rendering.
  - `reason`: `"no_retreat"` | `"loss_of_supply"` | `"commander_unsupplied"` — for potential future filtering; not currently displayed in the sub-bullet text.

### 5.2 Shell Consumption Rule

Shell must not branch on `reason` for display logic in this ticket. The sub-bullet text is always `DESTROYED (x,y)` regardless of reason. Shell reads `position` and `ownerSeat` only.

The existing transient `removedPieces` in §12.3 is a board-owned rendering artifact and must not be used as the source of truth for history records.

### 5.3 Persistence

The backend must persist `destroyedPieces` on the stored move record. It must be returned as part of move history responses so that participants who join late or reload receive destruction records without re-executing the game.

## 6. Shell / Board Boundary

Shell owns the history panel container and the destruction sub-bullet UI (RIGHELT_WEB_APP_SPEC §1.1.2). Shell must not branch on board-internal action types to infer destruction; it must consume only the `destroyedPieces` array from the move record.

Board owns resolution logic that determines when and why pieces are removed. Board populates `destroyedPieces` before emitting `moveSent`.

The board overlay behavior is shell-owned at the move-selection level: shell selects a history move, then passes the selected move's `destroyedPieces`-derived overlay data into the board runtime as part of the recorded-action load. No standalone shell-to-board highlight command is added for destruction records.

## 7. UX Design

### 7.1 Information Architecture

Each destruction sub-bullet sits indented one level below its parent move row in the history panel. The sub-bullet is visually subordinate to the move row: smaller or lighter text, colored per owner.

Sub-bullets do not introduce a new column or change the layout grid of the history panel. Their presence must not shift the vertical position of sibling move rows. When a move has no destruction sub-bullets, no placeholder space is reserved — the move row is unchanged. Row height stability (UI_INFORMATION_ARCHITECTURE_PRINCIPLES §Core Principle) applies across moves: the absence of sub-bullets on some rows must not cause sibling moves to visually jump or misalign.

When sub-bullets are present, they expand the height of their parent move row's containing region. This height change must follow the smooth expand/collapse convention (RIGHELT_WEB_APP_SPEC §1.1.5) if there is any animation; abrupt layout jumps are not permitted.

### 7.2 Motion & Transitions

When a new history entry appends in real time and includes destruction sub-bullets, the entry animates in as a unit (move row plus sub-bullets together). Sub-bullets must not animate separately or with a staggered delay relative to their parent.

If the sub-bullets are revealed via an expand action (not specified in this ticket but possible future extension), RIGHELT_WEB_APP_SPEC §1.1.5 motion conventions apply.

### 7.3 Feedback & Affordances

Destruction sub-bullets should read as subordinate annotations inside the move row, not as separate controls. The parent move row keeps the pressed/release interaction behavior for history navigation; the sub-bullets themselves do not introduce a second affordance, independent press target, or dedicated focus treatment.

When a history move is selected, the board transitions to that move's recorded-action snapshot and any destruction overlays for that move appear as part of the same recorded-action presentation. The transition should remain visually cohesive with no second delayed animation for the destruction markers once the history state settles.

Hover styling is not required for destruction sub-bullets. They should remain readable and visually subordinate on both hover-capable and touch/non-hover devices without implying a separate click target.

### 7.4 Multiplayer & Presence

Destruction records are part of the persisted move record and propagate to all connected clients via the same real-time sync that delivers move entries. No optimistic destruction record is displayed; the record appears when the authoritative `moveSent` payload arrives and is committed to the history list.

If a client reconnects after missing moves, destruction records for those moves are delivered as part of the history catchup payload, not replayed from transient board events.

### 7.5 Mobile & Viewport

The sub-bullet indentation must use a minimal gutter consistent with the mobile screen real-estate principle (UI_INFORMATION_ARCHITECTURE_PRINCIPLES §Mobile Screen Real Estate Principle). At narrow widths the subordinate rows must remain readable, avoid horizontal overflow, and avoid introducing extra row chrome that would make the history panel feel heavier than the parent move rows.

## 8. Acceptance Criteria

- [ ] AC1: After any move that causes one or more piece removals, the history panel shows a `DESTROYED (x,y)` sub-bullet beneath that move entry for each removed piece, where `(x,y)` is the square the piece was on at removal.
- [ ] AC2: The sub-bullet color matches the owner color of the destroyed piece (Player 1 color for P1 pieces, Player 2 color for P2 pieces).
- [ ] AC3: In a draw (both Commanders unsupplied in the same resolution), two destruction sub-bullets appear under the triggering move entry, one per Commander, each in its respective owner color.
- [ ] AC4: All three destruction causes produce a record: `no_retreat`, `loss_of_supply`, and Commander unsupply (win/draw condition).
- [ ] AC5: History navigation remains owned by the parent move row; destruction sub-bullets do not introduce a separate navigation action or alternate board state.
- [ ] AC6: Selecting a history move with destruction records shows those removals as destroyed-piece overlays on the recorded-action/history board view for that move.
- [ ] AC7: Destruction records are visible to Player 1, Player 2, and Viewers identically.
- [ ] AC8: Destruction records are persistent: they are present after a page reload, and a participant who joins after the moves occurred sees the same destruction sub-bullets as participants who were present.
- [ ] AC9: Destruction sub-bullets do not appear in the Live view board surface — they appear only in the history panel.
- [ ] AC10: The board-local transient removal tooltip (§12.3) continues to function as before and is not removed by this change.
- [ ] AC11: Sub-bullets for a move appear in the history panel at the same time as their parent move entry is appended (not delayed separately).
- [ ] AC12: A player pinned to an earlier history snapshot sees new move entries (with any destruction sub-bullets) append to the panel list without being navigated away from their current view.
- [ ] AC13: The presence or absence of destruction sub-bullets does not shift the vertical position of other move rows in the history panel.
- [ ] AC14: Destruction sub-bullets animate in with their parent move entry, and selecting a history move reveals its destruction overlays without a second staggered animation after the history state settles.
- [ ] AC15: Destruction sub-bullets remain visually subordinate and readable on both hover-capable and touch/non-hover devices without implying a separate interactive affordance.

## 9. Out of Scope

- Supply records and command records: not in scope (misnomer in original ticket description).
- Independent board-state navigation or a dedicated shell action for destruction sub-bullets.
- Filtering or sorting history by destruction events.
- Displaying the piece type (Commander vs Unit) or a reason label in the sub-bullet text.
- Any changes to turn grouping structure in the history panel.
- Destruction records in the Live view surface.
- Undo/revert interaction with destruction records.

## 10. Open Questions & Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Was "supply/command" in the ticket description literal scope? | No. Canonical scope is destruction records only. Supply/command records are out of scope entirely. |
| 2 | Are destruction sub-bullets independently jumpable to a mid-resolution board state? | No. They show the parent move's post-resolution snapshot. No new `jumpToHistory` variants are needed. |
| 3 | Should the §12.3 board-local tooltip be retired once history records exist? | No. They are complementary: tooltip is transient in-game feedback; history record is persistent review surface. |
| 4 | Attribution in Playground mode? | Same as multiplayer — sub-bullet color reflects piece owner seat (P1/P2), not device control. |
| 5 | Multiple pieces destroyed by same move — ordering? | Ordered by engine resolution order (RIGHELT_RULES_SPEC §7); one sub-bullet per piece. |
| 6 | What happens in a draw? | Both Commander destruction records appear under the triggering move, each in its owner's color. |
| 7 | Does persistence require schema/migration work? | Yes — `destroyedPieces` must be added to the stored move record. Scope of that migration is implementation detail for Architect/Engineer. |

## 11. References

- RIGHELT_WEB_APP_SPEC.md §7 (Move History Sidebar), §1.1.1 (Board Contract), §1.1.2 (Ownership Boundary), §1.1.4 (Pill/chip convention), §1.1.5 (Layout stability motion), §1.1.6 (Direct interaction feedback), §12.3 (Self-play removal feedback)
- RIGHELT_RULES_SPEC.md §5.5 (Push), §5.6 (Retreat), §5.7 (Follow), §6.1 (Supply), §7 (Resolution Order), §8 (Win Condition)
- UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md (Core Principle, Hover Capability Principle, Mobile Screen Real Estate Principle)
- WORKFLOW_COVERAGE.md — "History navigation and return to live" row (present); no new workflow row required; this feature is a sub-feature of the history surface.
