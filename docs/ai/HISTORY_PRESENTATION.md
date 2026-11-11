# History presentation

This is the detailed intended presentation contract for active, pending, archived and undone History. [The decision index](../UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index) records approvals and overrides. Implementation and release evidence are separate.

A turn means one player's turn. Defender retreats stay inside the attacker's turn. Show newest turns and move rows first. Stored action chronology and replay stay chronological. Visible headings read `Turn X`, with player attribution retained in accessible labels. Move rows use owner color and retain accessible actor attribution without repeating visible names.

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

The confirmed November 11 follow-up supersedes the earlier per-operation display grouping. Order all visible records by their original recorded chronology, newest first. Collapse each contiguous undone run into one disclosure across accepted Undo operations and turns. A retained move always separates runs. Do not move records to keep an operation together. Preserve each record's original accepted Undo provenance, IDs, numbering gaps, actor attribution and immutable snapshots. Fold known End turn closures and duplicate live/archive copies before counting visible moves. Individual rushes, push, defender retreat and follows remain distinct rows.

Live array order and original archive event/ordinal metadata establish order. Rebased indexes, reused turn coordinates and equal timestamps do not. Unloaded gaps and unknown chronology remain explicit. A display run has its own identity, reconciled by membership so paging or merging preserves disclosure choice and native focus/press targets. A selected move that becomes undone reveals its current run only for that viewer. A later deliberate collapse remains closed until another explicit selection. Retained portions of a turn may appear on either side of a run, with one whole-turn selection target and the original final-turn preview. Empty accepted restorations retain the existing truthful earlier-history placeholder.

This follow-up is in private preparation. Native acceptance, current-head PR validation, predecessor deployment and production verification remain pending.

This changes presentation, not target eligibility or restoration authority, and introduces no Undo picker. Self-play and computer opponents use direct Undo. Another human retains request/accept consent. Restore the position before the target action, not its after-state. Accepted Undo returns only its requester to live if their viewing intent is unchanged since initiating it. Away-and-back counts as changed. Other viewers retain their selection. Current-rules evaluation after restoration follows [rules §8.1](../RIGHELT_RULES_SPEC.md#81-approved-automatic-endings-pending-implementation). Provenance: D08 and D16.

## Recorded narration

Use acknowledged action/before/after records and global Move numbers everywhere. Exclude pending, undone and unrelated-lineage records from active turn summaries. Explicit archived selection uses its exact saved record. End turn has no visible move row, selectable target, number, narration or replay step. Attach its finalization removals once to the last substantive action. Pass remains a real recorded action.

Individual grammar: Maya moved commander from [source] to [target], projected new piece from [source] to [target], rushed from [source] to [target], pushed onto [target], followed from [source] to [target], or passed. Retreat names the actual defender. A one-action turn repeats that action's message. A partial turn describes acknowledged actions so far.

Rush totals count distinct recorded rushing actors and list their recorded ending coordinates in action order. Multiple rushes use Maya rushed N pieces to [coordinates]. Push uses Maya pushed onto [attacker destination] and had N pieces follow, excluding the initial pusher. The destination is the defender's original square, never its later retreat square. Use 1 piece or N pieces. Do not invent a follower for incomplete data.

For removals, use lost for the narrated actor's pieces and destroyed for opposing pieces. A single piece gets its coordinate. Multiple pieces get a count. Turn totals count distinct removed pieces. Individual/replay steps report only their own removals. Derive ownership from the recorded removed piece, not the current occupant. Compose event clauses dynamically: one stands alone, two join with and, three or more use commas and a final Oxford comma. Coordinate lists remain within their own event. Ordering of optional loss/destruction categories is an implementation recommendation, not a separate approved product rule.

Live completed summaries and acknowledged replay share this grammar. Replay uses recorded chronological order and board-wide move titles, with progress and controls retained. It never searches, submits or changes live state. Cancellation follows route, account, retirement, stop and relevant revision changes. Coordinates use shared comma-space chips, with escaped and directionally isolated names kept as separate structured values. Provenance: D03, D07 and D15.

## Live opponent-turn overview

Before the human starts their next turn, the live board can display the immediately preceding opponent turn using the same aggregate overlays. The underlying board snapshot, legal actions and mutation gates stay live. Viewing never selects History or submits a move. Missing snapshot detail loads through revision-fenced reads in the background; a failed visual read leaves normal play available.

Opponent-piece and supply-point inspection temporarily replace the overview. Clearing them restores it. Explicitly selecting any own piece, including one with no legal moves, dismisses it for the current visit. Deselecting does not undo that dismissal. Reopening the game or completing a new opponent turn resets the dismissal. Reopening after any acknowledged or pending action in the human's current turn shows the live position. Narration and Show me again retain their separate selection rules.


## History endpoint roles

Single-move and whole-turn History on desktop and mobile use a 2px dashed violet (`#7650A6`) source border and a 2px solid green (`#1F7A5A`) target border. A square with both roles keeps the dashed violet outer border and adds an inset 2px solid green outline. A turn uses the union of every acknowledged action's endpoints, including intermediate squares, rather than only net turn endpoints. Duplicate push/follow arrows remain deduplicated; defender retreats retain their distinct routes.

The after-action/final-turn position, affiliation colors, source ghosts, projection markers and destruction marks remain unchanged. Individual-move axis emphasis remains; aggregates have no axis emphasis or step numbers. The preview contract requires explicit `context:'history'` and transports endpoint metadata through the board runtime. Recorded overlays without that context, including live opponent summaries and replay, keep their existing appearance.

## Recorded History narration and replay

The History feature owns acknowledged action grammar, archive closure and compact native turn/move targets. The confirmed November 11 naming follow-up uses second person for a recorded human actor’s saved seat owned by the captured viewer. Self-play retains Red/Blue attribution. Other actors keep canonical names. Recorded computer proof remains authoritative even during temporary human control. This changes presentation only, without changing record identity, action chronology, stored ownership or gameplay permission. Detailed narration uses Board context and mobile inline previews. Board guidance retains its finite prompt budget.

PR193 owns the later automatic computer playback integration. Its confirmed-frame presenter must carry the recorded move identity, board-wide number, actor, action coordinates and closure-normalized final state into this shared grammar. Automatic playback must preserve finite Board guidance, context ownership and cancellation. It must add its own current-source unit/integration and native playback proof. Public History200/203 and the approved246 baseline do not contain that runtime, so History validation does not earn automatic playback acceptance.

Accepted Undo provenance uses the real restoration commit sequence, scoped to the game. The November 11 display rule groups contiguous undone records by original move order, independently of those operation boundaries. Expanded rows keep their original turn, actor and immutable identity. Display copies never change stored or replay chronology. Pending predictions stay separate from accepted runs. Missing or conflicting provenance remains unavailable. Matching times or requesters establish neither order nor accepted membership.

Personal inspection takes precedence over the default collapse. Reveal the already-selected record’s operation once for that viewer when its accepted membership arrives. Repeated passive renders must honor an explicit collapse. A later explicit selection may reveal its own operation. Keep other viewers’ disclosures independent and do not navigate, focus or scroll as part of this disclosure decision.
