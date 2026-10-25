# Opponent and invitation follow-up

This is a separate follow-up to the board UX and result releases. Its initial combined base is `3a78c49`, containing canonical PR152 and PR154 sources. Refresh against their actual merged results before final acceptance. All production games, moves, receipts and model provenance remain preserved. Publication and other paused schedules stay paused.

## Confirmed decisions

- Human opponents receive completed-turn narration and the same isolated Show me again replay as computers. Playback never submits actions or changes the live game.
- Play as Red and Play as Blue use their explicit seat color, regardless of the visiting identity's default action affiliation. Invitation, viewer and Home controls use existing angular icons.
- The initial Invite a friend card closes when its intended vacant seat becomes authoritatively occupied. Pending approval, a viewer arriving or a temporary disconnect does not close it. Viewer invitations remain available under Players.
- A held route-loading sweep keeps visibly pulsing while its position remains fixed. Keep its sharp facets, existing transition geometry and reduced-motion behavior. Apply the treatment to every shared use of that held phase.
- Piece destruction produces one short stone-crack sound per causing action, including a batch of destroyed pieces. Respect mute, gesture and foreground gates. Initial hydration, reload, history, visual replay and repeated receipts stay silent.
- Actual invitation join failures stay visible with the existing action available for manual retry. Scope feedback and completion to the exact game, account and visit; preserve keyboard focus and ignore stale completions.
- Selected archived moves use the same narrow inline after-state preview as retained moves. Unknown legacy lineage does not imply permission to undo or restore.
- History offers additional records only when they exist. Use More game history initially and Load more history for remaining pages. Remove exhausted controls, retain accumulated records and mark undone history accurately. Keep the full diagnostic decision explorer separate from ordinary move history.

Seated human play uses Your opponent, as confirmed by the user. Spectators use an unambiguous Red or Blue subject. Do not claim a human is thinking merely because their turn is active.

## Implementation ownership

- Lead: generic opponent narration and replay modules, bounded message sizing, final integration and release acceptance.
- Shell agent: the only app.js integrator, invitation presentation and lifecycle, held-sweep CSS, history availability/pagination and their focused tests. Preserve priority for releasing prerequisite tooling PR153.
- Board agent: destruction sound and event deduplication modules and tests. Preserve canonical PR154 source ownership and its later release checks.
- Engine agent: staged prerequisite releases and retained-data proof. No follow-up source ownership unless an explicit affected contract requires it.

Use one canonical follow-up branch and PR. Agents leave coherent changes for the lead's integration commits, use disjoint source ownership and coordinate browser ports. Never alter another stream's dirty files.

## Important contracts

Opponent status uses actual turn-control authority, including defender-controlled retreat, viewer and non-seated contexts. Never offer Pass, Move, End Turn or another gameplay CTA to someone who cannot take that action. Read-only piece and line inspection remain available. Preserve replay, selected-piece, history, recovery and pending-save precedence.

Generic turn playback uses acknowledged active-lineage snapshots, including push, retreat, follow, pass and turn finalization. Preserve archive fallback, revision/account/route fencing, immutable source state, separate rendering adapter, cancellation and manual reduced-motion steps. Existing computer exports remain compatible with their consumers. Reserve geometry for the new message subjects without adding ordinary-size empty space or allowing long names to shift the board.

The existing archive cursor moves forward through ascending stored records. It is not an ordinary scroll control. Do not infer availability from a cursor that has not been loaded, from archiveStartRevision alone or from an exact retained-list length. Establish additional-move availability from authoritative read-only evidence. Prefer a small compatible response extension over unbounded prefetching. Distinguish active, undone and alternate-lineage records using restoration evidence, preserve snapshot identity and show truthful partial-history limits. Hide an unavailable or exhausted CTA; show an actual retry only after a real read failure. Scope every response and accumulated page to account, game and revision.

Destruction detection uses authoritative destruction records or removed piece IDs rather than net piece count. A projected piece and a destroyed piece can cancel each other numerically. A turn-finalization removal can arrive after a local move acknowledgment. Deduplicate the same causing action across optimistic, receipt, socket and finalization updates, while allowing a later distinct destruction action to sound. Do not turn rejected or canceled operations into sound events. Keep result sounds and their finite lifecycle intact.

## Validation

| Surface | Required proof |
| --- | --- |
| Invitation | Both explicit seats, unrelated/default affiliation, viewer entry, approval waiting, stale/occupied seat, angular icons, keyboard focus, narrow and 200% text |
| Host card | Real two-context friend join closes once, viewer-only arrival does not close, approval does not dismiss early, stale account/game/copy completion cannot resurrect it, board interaction and focus recover |
| Held loading | Home/game/invite and other shared consumers, visible motion during a held interval, unchanged transform/board geometry, stable animation identity, completion, failure, background and reduced motion |
| Opponent messages | Real human and computer turns, spectators, self-play, forced retreat, inactive or disconnected opponent, no impossible CTAs, selection/inspection, narrow and enlarged text geometry |
| Replay | Multi-action acknowledged turn, archive fallback, no gameplay/search writes, unchanged board/history/authority, natural completion, manual Stop/Next, new live move, undo, navigation, background and account cancellation |
| Additional history | Short games with nothing extra, retained overflow beyond 200 moves, 100/101-record pages, undo then a new branch, finalization/removal, turn-only records, partial legacy data, exhaustion, retry, stale response and no mutating calls |
| Sound | Single and multiple destruction, projection with unchanged net count, no-retreat push, supply loss and End Turn removal, local/remote receipt ordering, deduplication, later new action, mute/background, silent history/reload/replay and result-sound coexistence |
| Release | Relevant unit and integration coverage, actual browser journeys, bounded independent source/visual/audio-contract review, exact-head required CI, released combined/retained proof, actual deployment identity and production verification |

Physical iPhone Safari checks remain a supplemental gap when no device is available. Do not describe automation as physical-device proof.

## Continuity

Use supervised heavy and preview launches. Keep run ownership, exact revisions, failed attempts and next actions in private test-results checkpoints. Critical-pressure cancellation is incomplete validation and must resume only after recorded recovery and cleanup. Reuse compatible proof explicitly; avoid repeating unchanged cumulative suites. Keep Codex, unrelated resources and all worktrees open. The lead owns completion of this follow-up as well as the preceding releases.

## Later selection and event explanations

The subsequent tooltip follow-up uses the user’s selection rule: piece and move explanations, including inactivity and blocked actions, belong in the board message area. Floating tooltips are reserved for events such as destruction and must wrap and reposition within the viewport. This later slice must preserve this release’s narration, Pass, replay, inspection and stable geometry contracts.
