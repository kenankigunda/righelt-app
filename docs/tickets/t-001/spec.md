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

### 4.5 Non-Jumpable

Destruction sub-bullets are not independently clickable for board-state navigation. Clicking a destruction sub-bullet shows the same board snapshot as clicking its parent move entry (post-move state at that move index via `jumpToHistory(moveIndex)`).

### 4.6 Highlight on Click

When a destruction sub-bullet is clicked, the parent move's board snapshot is displayed and the square `(x,y)` named in that sub-bullet is highlighted on the board. This highlight is in addition to any normal post-move board rendering; it must not interfere with the board snapshot state itself.

The highlight treatment must use a dedicated destruction highlight role consistent with the coordinate chip color convention in RIGHELT_WEB_APP_SPEC §1.1.4: a new destruction-square chip treatment is introduced alongside the highlight.

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

The highlight-on-click behavior is shell-owned: shell calls `jumpToHistory(moveIndex)` and then instructs the board to apply a highlight overlay for the named square. The mechanism for that overlay instruction must be added to the board integration contract as a new optional command, e.g., `highlightSquare(position)` / `clearHighlight()`, so the shell does not pass board-internal state.

## 7. UX Design

### 7.1 Information Architecture

Each destruction sub-bullet sits indented one level below its parent move row in the history panel. The sub-bullet is visually subordinate to the move row: smaller or lighter text, colored per owner.

Sub-bullets do not introduce a new column or change the layout grid of the history panel. Their presence must not shift the vertical position of sibling move rows. When a move has no destruction sub-bullets, no placeholder space is reserved — the move row is unchanged. Row height stability (UI_INFORMATION_ARCHITECTURE_PRINCIPLES §Core Principle) applies across moves: the absence of sub-bullets on some rows must not cause sibling moves to visually jump or misalign.

When sub-bullets are present, they expand the height of their parent move row's containing region. This height change must follow the smooth expand/collapse convention (RIGHELT_WEB_APP_SPEC §1.1.5) if there is any animation; abrupt layout jumps are not permitted.

### 7.2 Motion & Transitions

When a new history entry appends in real time and includes destruction sub-bullets, the entry animates in as a unit (move row plus sub-bullets together). Sub-bullets must not animate separately or with a staggered delay relative to their parent.

If the sub-bullets are revealed via an expand action (not specified in this ticket but possible future extension), RIGHELT_WEB_APP_SPEC §1.1.5 motion conventions apply.

### 7.3 Feedback & Affordances

Clicking a destruction sub-bullet must show the same immediate pressed feedback as clicking a move row (RIGHELT_WEB_APP_SPEC §1.1.6). The pressed state is on the sub-bullet element itself.

On release, the board transitions to the parent move's history snapshot and the destruction highlight appears. This must be one continuous interaction — no second delayed animation after the release bounce.

Hover state on destruction sub-bullets must be gated by `data-hover-capability="hover"` (UI_INFORMATION_ARCHITECTURE_PRINCIPLES §Hover Capability Principle). The required click behavior must not depend on hover availability.

The sub-bullet must be visually distinguishable from a non-clickable annotation; it must have an interactive affordance (cursor, focus ring) to communicate that clicking it does something (the highlight).

### 7.4 Multiplayer & Presence

Destruction records are part of the persisted move record and propagate to all connected clients via the same real-time sync that delivers move entries. No optimistic destruction record is displayed; the record appears when the authoritative `moveSent` payload arrives and is committed to the history list.

If a client reconnects after missing moves, destruction records for those moves are delivered as part of the history catchup payload, not replayed from transient board events.

### 7.5 Mobile & Viewport

The sub-bullet indentation must use a minimal gutter consistent with the mobile screen real-estate principle (UI_INFORMATION_ARCHITECTURE_PRINCIPLES §Mobile Screen Real Estate Principle). The tap target for a sub-bullet must meet minimum touch comfort size even at narrow viewport widths.

## 8. Acceptance Criteria

- [ ] AC1: After any move that causes one or more piece removals, the history panel shows a `DESTROYED (x,y)` sub-bullet beneath that move entry for each removed piece, where `(x,y)` is the square the piece was on at removal.
- [ ] AC2: The sub-bullet color matches the owner color of the destroyed piece (Player 1 color for P1 pieces, Player 2 color for P2 pieces).
- [ ] AC3: In a draw (both Commanders unsupplied in the same resolution), two destruction sub-bullets appear under the triggering move entry, one per Commander, each in its respective owner color.
- [ ] AC4: All three destruction causes produce a record: `no_retreat`, `loss_of_supply`, and Commander unsupply (win/draw condition).
- [ ] AC5: Clicking a destruction sub-bullet displays the same board snapshot as clicking its parent move entry (post-move state at that move index), not a separate board state.
- [ ] AC6: Clicking a destruction sub-bullet highlights the square named in that sub-bullet on the displayed board snapshot.
- [ ] AC7: Destruction records are visible to Player 1, Player 2, and Viewers identically.
- [ ] AC8: Destruction records are persistent: they are present after a page reload, and a participant who joins after the moves occurred sees the same destruction sub-bullets as participants who were present.
- [ ] AC9: Destruction sub-bullets do not appear in the Live view board surface — they appear only in the history panel.
- [ ] AC10: The board-local transient removal tooltip (§12.3) continues to function as before and is not removed by this change.
- [ ] AC11: Sub-bullets for a move appear in the history panel at the same time as their parent move entry is appended (not delayed separately).
- [ ] AC12: A player pinned to an earlier history snapshot sees new move entries (with any destruction sub-bullets) append to the panel list without being navigated away from their current view.
- [ ] AC13: The presence or absence of destruction sub-bullets does not shift the vertical position of other move rows in the history panel.
- [ ] AC14: Destruction sub-bullet interaction feedback (pressed state, highlight reveal) is one continuous motion with no second staggered animation after release (RIGHELT_WEB_APP_SPEC §1.1.6).
- [ ] AC15: Hover state on sub-bullets is gated by `data-hover-capability="hover"`; the click-to-highlight behavior works on touch/non-hover devices.

## 9. Out of Scope

- Supply records and command records: not in scope (misnomer in original ticket description).
- Independent board-state navigation by clicking a destruction sub-bullet (sub-bullets are non-jumpable; they always show the parent move's snapshot).
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
