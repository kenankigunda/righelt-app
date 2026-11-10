# History presentation

A turn means one player's turn. Defender retreats stay inside the attacker's turn. Show newest turns first and display each turn’s moves newest first, including expanded undone records and archived entries. Stored records, turn ownership, aggregate previews and replay remain chronological; reverse a copy only for displayed rows. Visible headings read `Turn X`, with player attribution retained in accessible labels. Move rows use owner color and retain accessible actor attribution without repeating visible names.

Use `buildMovePreview` for every individual move surface. Desktop and mobile show the same after-state, source ghost, owner-colored route, projection marker and destroyed-piece state. Source coordinates, cells and axes use violet `#7650A6`. Targets use green `#1F7A5A`. Red and blue identify piece ownership.

Use `buildTurnPreview` for whole turns. Show the final board with all routes, source ghosts, projection markers and destruction marks. Deduplicate an identical attacker push/follow route. Preserve distinct defender retreat routes. History whole turns show the endpoint-role borders described below, without selected-piece rings, emphasized axes or step numbers. Undo and new-game actions belong only to individual moves.

History selection freezes the acknowledged moves and their revision. New moves, reconnects, trimming and archive refreshes must not replace the selected position. Narrow History owns an inline preview, while its separate Board panel remains live. Selecting an entry reveals its heading and whole mini-board together. On short viewports, measure the actual heading and available height, then scale the complete mini-board proportionally so its axes and overlays fit above the mobile navigation. Resize and text enlargement must recalculate this fit. Actions may fall below the viewport. Background updates must not repeatedly scroll the reader.

The selected entry has no selection action, button cursor or press animation. Its child actions remain buttons. A highlighted live entry can still be selected to enter history.

Regression proof covers shared presentation models, turn-selection transport, desktop overlays, mobile parity and reveal, accessible attribution, and interactive child actions. Preserve production histories and receipts. No data migration is needed for this presentation contract.

## Live opponent-turn overview

Before the human starts their next turn, the live board can display the immediately preceding opponent turn using the same aggregate overlays. The underlying board snapshot, legal actions and mutation gates stay live. Viewing never selects History or submits a move. Missing snapshot detail loads through revision-fenced reads in the background; a failed visual read leaves normal play available.

Opponent-piece and supply-point inspection temporarily replace the overview. Clearing them restores it. Explicitly selecting any own piece, including one with no legal moves, dismisses it for the current visit. Deselecting does not undo that dismissal. Reopening the game or completing a new opponent turn resets the dismissal. Reopening after any acknowledged or pending action in the human's current turn shows the live position. Narration and Show me again retain their separate selection rules.


## History endpoint roles

Single-move and whole-turn History on desktop and mobile use a 2px dashed violet (`#7650A6`) source border and a 2px solid green (`#1F7A5A`) target border. A square with both roles keeps the dashed violet outer border and adds an inset 2px solid green outline. A turn uses the union of every acknowledged action's endpoints, including intermediate squares, rather than only net turn endpoints. Duplicate push/follow arrows remain deduplicated; defender retreats retain their distinct routes.

The after-action/final-turn position, affiliation colors, source ghosts, projection markers and destruction marks remain unchanged. Individual-move axis emphasis remains; aggregates have no axis emphasis or step numbers. The preview contract requires explicit `context:'history'` and transports endpoint metadata through the board runtime. Recorded overlays without that context, including live opponent summaries and replay, keep their existing appearance.


## Recorded History narration and replay

The History feature owns acknowledged action grammar, archive closure and compact native turn/move targets. Detailed narration uses Board context and mobile inline previews. Board guidance retains its finite prompt budget.

PR193 owns the later automatic computer playback integration. Its confirmed-frame presenter must carry the recorded move identity, board-wide number, actor, action coordinates and closure-normalized final state into this shared grammar. Automatic playback must preserve finite Board guidance, context ownership and cancellation. It must add its own current-source unit/integration and native playback proof. Public History200/203 and the approved246 baseline do not contain that runtime, so History validation does not earn automatic playback acceptance.
