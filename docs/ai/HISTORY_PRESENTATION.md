# History presentation

This is the detailed intended presentation contract for active, pending, archived and undone History. [The decision index](../UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index) records approvals and overrides. Implementation and release evidence are separate.

## Order and selection

A turn means one player's turn. Defender retreats stay inside the attacker's turn and retain their own actor attribution. All displayed move rows are newest first, including within turns, pending lists, archive lists and expanded Undo disclosures. Reverse display order only. Engine arrays, recorded action chronology, turn reconstruction and sequence playback remain chronological. Preserve stable IDs, original global Move numbers and lineage.

Use an owner-colored compact turn rail, Turn N headings and full Move N: labels. Every active move stays visible. Keep player names in accessible turn/move attribution without repeating visible names in aligned rows. The turn rail belongs to the turn owner even when a child retreat belongs to the defender. Names elsewhere follow the [shared identity policy](../UX_PRINCIPLES.md#identify-people-and-visual-roles-separately).

Heading and surrounding group space select the whole turn. Native child move targets win over their parent. Undo and new-game actions belong only to individual eligible moves. A selected target has no selection button, button cursor or press effect. Child moves and actions retain their own semantics, keyboard access and at least 44px action targets. Do not disable an entire parent subtree or nest buttons. A highlighted live entry remains selectable to enter History.

History selection freezes acknowledged records and their revision. New moves, reconnects, trimming and archive refresh must not replace it. A selected pending record retains identity when assigned its durable ID. Lazy loading preserves the selected historical context, with honest loading/error feedback rather than a temporary live title. Unknown data never gains fabricated numbering, ownership or Undo eligibility. Provenance: D05, D08 and D15.

## Shared desktop and mobile previews

Use buildMovePreview for every individual move and buildTurnPreview for whole turns. Both layouts show the same saved after-state/final-turn position, source ghosts, owner-colored routes, projection markers and destruction marks. Deduplicate identical attacker push/follow routes and preserve separate defender retreat routes. Whole turns have no Undo/new-game actions, emphasized axes or step numbers.

Desktop headings read Board - Move X or Board - Turn X. Inspection retains that title, temporarily replaces narration with connections, then restores narration when cleared. Mobile inline History previews show narration without an extra Board heading. The separate mobile Board remains live.

Reveal the selected heading and entire mini-board together. Measure actual available viewport height and proportionally fit all axes and overlays above mobile navigation. Recalculate on resize and text enlargement. Actions may follow below the viewport. New background updates must not repeatedly scroll the reader. Players detours preserve the selection. Returning to Board clears History before reveal. Return to live also switches to Board. Resize carries the chosen view across layouts. Provenance: D05, D06 and D08.

## Undo boundaries

Each accepted Undo produces its own initially collapsed disclosure at that operation's boundary. Expand its moves flat across turns, newest first under the later ordering correction. Count only that operation's visible moves. Older undone records remain at their own boundary and do not move into the newest disclosure. Preserve IDs, numbering gaps, actor attribution and immutable archived snapshots. Individual rushes, push, defender retreat and follows remain distinct rows.

This changes presentation, not target eligibility or restoration authority, and introduces no Undo picker. Self-play and computer opponents use direct Undo. Another human retains request/accept consent. Restore the position before the target action, not its after-state. Accepted Undo returns only its requester to live if their viewing intent is unchanged since initiating it. Away-and-back counts as changed. Other viewers retain their selection. Current-rules evaluation after restoration follows [rules §8.1](../RIGHELT_RULES_SPEC.md#81-approved-automatic-endings-pending-implementation). Provenance: D08 and D16.

## Recorded narration

Use acknowledged action/before/after records and global Move numbers everywhere. Exclude pending, undone and unrelated-lineage records from active turn summaries. Explicit archived selection uses its exact saved record. End turn has no visible move row, selectable target, number, narration or replay step. Attach its finalization removals once to the last substantive action. Pass remains a real recorded action.

Individual grammar: Maya moved commander from [source] to [target], projected new piece from [source] to [target], rushed from [source] to [target], pushed onto [target], followed from [source] to [target], or passed. Retreat names the actual defender. A one-action turn repeats that action's message. A partial turn describes acknowledged actions so far.

Rush totals count distinct recorded rushing actors and list their recorded ending coordinates in action order. Multiple rushes use Maya rushed N pieces to [coordinates]. Push uses Maya pushed onto [attacker destination] and had N pieces follow, excluding the initial pusher. The destination is the defender's original square, never its later retreat square. Use 1 piece or N pieces. Do not invent a follower for incomplete data.

For removals, use lost for the narrated actor's pieces and destroyed for opposing pieces. A single piece gets its coordinate. Multiple pieces get a count. Turn totals count distinct removed pieces. Individual/replay steps report only their own removals. Derive ownership from the recorded removed piece, not the current occupant. Compose event clauses dynamically: one stands alone, two join with and, three or more use commas and a final Oxford comma. Coordinate lists remain within their own event. Ordering of optional loss/destruction categories is an implementation recommendation, not a separate approved product rule.

Live completed summaries and acknowledged replay share this grammar. Replay uses recorded chronological order and board-wide move titles, with progress and controls retained. It never searches, submits or changes live state. Cancellation follows route, account, retirement, stop and relevant revision changes. Coordinates use shared comma-space chips, with escaped and directionally isolated names kept as separate structured values. Provenance: D03, D07 and D15.

## History endpoint roles

Single-move and whole-turn History on desktop and mobile use a 2px dashed violet (`#7650A6`) source border and a 2px solid green (`#1F7A5A`) target border. A square with both roles keeps the dashed violet outer border and adds an inset 2px solid green outline. A turn uses the union of every acknowledged action's endpoints, including intermediate squares, rather than only net turn endpoints. Duplicate push/follow arrows remain deduplicated; defender retreats retain their distinct routes.

The after-action/final-turn position, affiliation colors, source ghosts, projection markers and destruction marks remain unchanged. Individual-move axis emphasis remains; aggregates have no axis emphasis or step numbers. The preview contract requires explicit `context:'history'` and transports endpoint metadata through the board runtime. Recorded overlays without that context, including live opponent summaries and replay, keep their existing appearance.
