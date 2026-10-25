# Board and computer play acceptance

This program follows the October 2026 product decisions. Independent healthy PRs may deploy in sequence. The lead owns the final combined result. Hosted data deletion, account activation and evidence publication require separate authorization.

## Interaction contracts

- Pass is available at the start of a human turn alongside the other top-level actions. Choosing a piece or preview does not start an action. An accepted action does. Ending a legal continuation is End Turn for humans, computers and training. Required supply, retreat and follow obligations remain enforced. End Turn has durable evidence but no move row or move number.
- The commander and supply legend controls inspect the selected piece, or the side to move when nothing is selected. An unoccupied supply point inspects all paths to that point. Pieces and legal destinations take priority. Inspection works while computer actions run. Commander reclicks cycle through the agreed piece and network views.
- Board messages describe the current task briefly. Computer turns replace human prompts with thinking, preparation or completed-action narration. Show me again visually replays the acknowledged computer turn over an isolated board. It never submits, searches, selects history or mutates the live game. Stop, navigation, backgrounding, account changes, undo and new live revisions cancel playback. Reduced motion uses static manual steps.
- Ordinary thinking exposes no recovery CTA. Preparation detail starts after 5 seconds, Interrupt after 30 seconds, and save feedback after 10 seconds in the save phase. Actual failures appear immediately. Slow feedback lives outside the board card.

## Space and history

- Board heading and message geometry stay stable through selection, thinking and narration. Loading uses the same shell and board geometry as the settled page. Home uses the same card and preview structure before data arrives. Existing content stays mounted through refresh and pagination.
- Narrow layout has one document scroller. Inactive panels do not contribute height. The header uses one row, with Account in the menu. Three lightweight icons provide Players, Board and History. Navigation hides after 3 seconds idle or 24 pixels down, and returns after 12 pixels up, panel entry or its accessible handle. Keyboard interaction, safe areas, scroll restoration and overscroll must not cause accidental hiding or interception.
- Narrow Board always projects the live game. History selection shows one static after-move preview between the selected move's date and actions. Row actions explicitly act before the move. Players preserves the selection. Any return to Board clears history before revealing it. Return to live also switches to Board. Wide history retains its main-board behavior. Resizing carries the selected decision between layouts.
- Accepted undo returns only its requester to live, provided they have not changed history selection since initiating it. Browsing away and back still counts as a change. Inspection and visual replay do not. Pending undo remains a notice so browsing remains possible. Other viewers retain their own selections. Archived decisions use authoritative restoration identity.

## Motion and presentation

- Notifications retain incident identity, focus, open details and animation time during updates. Active work pulses its whole surface every 2.4 seconds. Waiting for a human uses a slower 4-second pulse. Copy and controls stay steady. Errors, completion and paused states are static. A new urgent notice must not hide a focused or expanded notice.
- Loading sweeps have crisp red and blue facets, smooth transforms and no blended edge or blur. An independent reviewer inspects the sweep, pulses, replay and narrow layout together for coherence with Righelt's stone-cut design.
- Computer home cards name the opponent rather than saying both players. User-facing experimental copy and redundant UI instructions are removed. First-use explanatory tooltips are deferred.

## Validation and release

Use the pinned released validation tools, an explicit candidate checkout and exact revisions. Preserve raw failures and repair the canonical source PR. Evidence publication remains paused. Merge readiness, user merge authority and deployed production verification are separate gates.

| Area | Required proof |
| --- | --- |
| Rules and model | Engine legality, required obligations, optimistic/server parity, durable receipts, imported continuations, no fabricated history rows, original model/config identity and real shipped-model inference |
| Computer UX | Frame-by-frame board geometry, independent think/save clocks, no early CTA/banner, immediate failures, full-turn narration, actual model reload and undo |
| Replay | Actual renderer, stacked push/retreat/follow/removal, source and destination transforms, cancellation, reduced motion, immutable live state and no API writes |
| History and undo | Narrow after-state mini preview, hidden live Board updates, panel detours, resize, self-play and friend approval, unchanged intent, away-and-back, other viewers and archived restoration |
| Navigation and layout | Chromium and touch WebKit, 320–430 widths, landscape, breakpoint edges, single scrolling, inactive-panel height, safe areas, text expansion, keyboard focus and idle/upscroll |
| Loading and notifications | Cold and warm Home/game/invite entry, delayed data and pagination, transient DOM/recordings, stable keyed nodes and pulse timeline, urgent arrival during focus/details, reduced motion |
| Release | Required exact-head CI, bounded independent code and visual review, combined retained/current-contract proof, deployment artifact identity and production smoke |

Physical iPhone checks supplement browser automation: Safari chrome resizing, rubber-band scroll, edge swipe and safe-area behavior. Record any unavailable physical-device proof as a gap, never as a passed check.

## Resource continuity

Follow `RESOURCE_MANAGEMENT.md`. Checkpoint each stream's source revision, evidence, owned runs and next action before heavy phases. Critical-pressure cancellation is incomplete validation. An authorized recovery heartbeat may resume only recorded pressure interruptions after four real normal/warning samples 15 seconds apart, completed cleanup and a free exclusive runner lock. It must not restart manual cancellations or duplicate active work. Preserve current model data and provenance. Keep Codex, unrelated resources and all worktrees open. Stop the dedicated recovery monitor when this program finishes.
