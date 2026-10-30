# History presentation

A turn means one player's turn. Defender retreats stay inside the attacker's turn. Show newest turns first, with their moves in chronological order. Headings read `Turn X · Player Name`. Move rows use owner color and retain accessible actor attribution without repeating visible names.

Use `buildMovePreview` for every individual move surface. Desktop and mobile show the same after-state, source ghost, owner-colored route, projection marker and destroyed-piece state. Source coordinates, cells and axes use violet `#7650A6`. Targets use green `#1F7A5A`. Red and blue identify piece ownership.

Use `buildTurnPreview` for whole turns. Show the final board with all routes, source ghosts, projection markers and destruction marks. Deduplicate an identical attacker push/follow route. Preserve distinct defender retreat routes. Whole turns have no selected cell rings, emphasized axes or step numbers. Undo and new-game actions belong only to individual moves.

History selection freezes the acknowledged moves and their revision. New moves, reconnects, trimming and archive refreshes must not replace the selected position. Narrow History owns an inline preview, while its separate Board panel remains live. Selecting an entry reveals its heading and whole mini-board together. On short viewports, measure the actual heading and available height, then scale the complete mini-board proportionally so its axes and overlays fit above the mobile navigation. Resize and text enlargement must recalculate this fit. Actions may fall below the viewport. Background updates must not repeatedly scroll the reader.

The selected entry has no selection action, button cursor or press animation. Its child actions remain buttons. A highlighted live entry can still be selected to enter history.

Regression proof covers shared presentation models, turn-selection transport, desktop overlays, mobile parity and reveal, accessible attribution, and interactive child actions. Preserve production histories and receipts. No data migration is needed for this presentation contract.
