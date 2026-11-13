# Righelt Web App Specification (v1)

Read the [selected marble and glass contract](ai/MATERIAL_UX_CONTRACT.md) before planning or changing material presentation. It owns the approved November 1 visual extension while preserving the latest approved product workflows. Selection does not imply implementation or deployment.

Status: Normative source of truth for product and UX behavior of the web application.

This document defines application-level behavior around game creation, invites, joining, live updates, presence, history viewing, lobby listing, preview board, and onboarding tutorial.
The surrounding web app must remain implementation-independent from the game board and may integrate any board backend/UI that conforms to this spec's board integration contract.
If implementation behavior conflicts with this spec, this spec wins.

Requirements state intended behavior. Approval, implementation, merge and deployment are separate facts. The [decision index](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index) identifies final approvals and superseded guidance. It does not certify a deployed build. [History presentation](ai/HISTORY_PRESENTATION.md), [recovery](ai/GAME_RECOVERY.md), and [the rules spec](RIGHELT_RULES_SPEC.md) own their detailed contracts.

## 1. Core Concepts

- `Game`: A single Righelt match and its associated participants and move history.
- `Participant roles`:
  - `Player 1`
  - `Player 2`
  - `Viewer`
- `Playground mode`: A single-device mode where one device controls both `Player 1` and `Player 2` for the same game.
- `Invite link`: Shareable URL that opens a specific game and enables join decisions.
- `Live view`: Current board state with all real-time updates applied.
- `History view`: Snapshot of board state immediately after a selected move index.
- `Offline mode`: Device has no network connectivity or cannot reach backend services.
- `Connected status`:
  - `Connected`: Client currently active on the game.
  - `Disconnected`: Client not currently active.
- `Board integration contract`: Stable API boundary used by the web app shell to host a game board implementation.

## 1.1 Board Implementation Independence (Normative)

- The web app shell (routing, identity, invites, join decisions, presence, history UI, lobby/home surfaces, tutorial orchestration, notifications, and offline shell behavior) must not directly depend on any board-specific internals.
- All game-board integrations must occur only through the `Board integration contract` in this section.
- A board implementation may be swapped (UI renderer, rules engine location, transport/backend model) without changing shell behavior specified in Sections 2-15.
- Board-specific rendering details are replaceable; shell-level UX states and decisions remain authoritative in this spec.

### 1.1.1 Required Board Contract Surface

Every board implementation must provide:

- `Capabilities`:
  - Report whether it supports `live`, `history`, `tutorial`, and `offline-local` execution modes.
  - Report legal action affordances for current state/role when requested by shell.
- `State`:
  - Deterministic board snapshot format sufficient for render and history playback.
  - Move/action metadata needed for history entries and turn ownership.
  - Explicit status for `ready`, `applying-update`, `error`, and `desynced`.
- `Commands`:
  - `initialize(sessionContext, initialSnapshot)`.
  - `applyRemoteUpdate(update)`.
  - `requestLocalAction(actionIntent)` returning acceptance/rejection with reason.
  - `jumpToHistory(moveIndex)` and `returnToLive()`.
  - `dispose()`.
- `Events` emitted to shell:
  - `stateChanged`.
  - `moveSent` (board has produced a move payload that shell should transmit/store).
    - includes abstract control metadata for post-move control within the current turn:
      - `control: "turn-owner" | "opponent"`
  - `turnEnded` (board has ended the turn and ownership passed).
  - `actionRejected` (board declined to commit requested intent; optional reason metadata may be included).
  - `modeChanged` (`live`/`history`/`tutorial`).
  - `syncStatusChanged`.
  - `fatalError`.

### 1.1.1.1 Shell Event Consumption Rule

- Shell must treat board events as semantic messages only.
- Shell must not branch on board-internal action types (`move`, `project`, `rush`, etc.) or board-rule details.
- Shell must not branch on board phase internals.
- Shell is allowed to react only to abstract board messages such as:
  - `moveSent`
  - `turnEnded`
- For control routing inside a turn, shell may only consume `moveSent.control` with values:
  - `turn-owner`
  - `opponent`
- Shell must not consume or infer any phase identifiers.
- `actionRejected` is an abstract failure signal only:
  - shell may show generic failure status/notification and record telemetry
  - shell must not branch game flow or policy on rejection reason codes/messages
  - board-owned UI may present rule-specific rejection details inside the board surface
- Any game-specific decision of when a move is committed or when a turn ends is board-owned behavior.
- This rule is mandatory for board swap compatibility in Section 1.1.3.

### 1.1.1.2 Turn Owner vs Control (Current Board Behavior)

- Shell turn model remains unchanged:
  - moves are recorded within a shell turn owned by `currentTurn.playerSeat` (`turn-owner`)
  - shell advances to the next turn only when board emits `turnEnded`
- Board owns temporary control routing inside a turn.
  - `control` starts as `turn-owner` by default
  - board may shift control to `opponent` for board-defined internal sequences
  - board reports control to shell only as abstract labels:
    - `turn-owner`
    - `opponent`
- `phase` is board-internal implementation detail.
  - board may use phases (for example push retreat/follow phases) to compute control
  - shell must not know or depend on phase names

### 1.1.1.3 Push-Retreat-Follow Control Sequence (Current Board)

For the current board implementation:

- Start of turn:
  - control = `turn-owner`
  - board is in default action selection behavior
- After `push` commit:
  - board enters internal retreat phase
  - board emits `moveSent` with `control = "opponent"`
- After `retreat` commit:
  - board enters internal follow phase
  - board emits `moveSent` with `control = "turn-owner"`
- After `follow` commits:
  - board may allow one or more legal follows within the same shell turn
  - when follow sequence is complete, board emits `turnEnded`
  - shell then advances to next turn and updates turn-owner

### 1.1.1.4 Pass vs End turn (Current Board Behavior)

- `Pass` is a board action type.
  - It is submitted through normal board action flow.
  - It appears in move history as a move entry.
- `End turn` is not a board action type.
  - It is a board-to-shell semantic message (`turnEnded`) and corresponding board command.
  - It must not appear as a move entry in move history.
- Board decides when to emit `turnEnded` for this game implementation.
  - Board auto-emits `turnEnded` when the turn should close (for example after `project`, after `pass`, or after other non-continuation commits).
- Board may emit `turnEnded` early during optional continuation windows only when closure is currently legal (for example during rush after the rush chain is already resupplied).
- Required rush-supply guidance follows the selection precedence in [stable board messages](#stable-board-messages-and-inline-actions). With nothing selected, name all and only pieces that must regain supply before closure. Selection replaces that summary with the piece or destination message.
- During rush and push continuations, the board must continue to treat the initiating player's command/supply state as frozen from the moment that sequence started.
- Any command/supply change created during the continuation is reconciled only after the continuation fully closes for frozen-status checks and forced-removal purposes.
- `Move` and `Project` still use immediate destination-supply legality.
- `Rush`, `Push`, and `Follow` instead use sequence-completion legality: the board must not offer or commit a destination that cannot complete to a closure state with the obligated initiating-side continuation pieces supplied.
- `Retreat` may be temporarily unsupplied; closure legality never requires the attacker to resupply the opposing retreated piece.
- Even so, the board should visually render pieces using the live "if the sequence ended now" command/supply result at the current board position.
- A piece that was eligible at the start of the continuation must remain highlighted/selectable/movable for that continuation when the frozen rules still allow it, even if its live displayed status now appears inactive.
- Shell must treat `turnEnded` as an abstract control message and must not infer it from action-type heuristics.

### 1.1.2 Ownership Boundary

- Shell owns:
  - Identity persistence and role restoration.
  - Invite/share and join approval workflows.
  - Presence indicators and participant roster UX.
  - History panel container and `Return to live` controls.
  - Home list/preview board placement and routing.
  - Home pagination keeps both arrows and its page label on one line without document overflow, including enlarged text and page zoom. Arrow targets remain at least 44 CSS pixels and label text is not reduced. At exceptionally narrow card content widths, the visible label may omit “Page” and use card inset space; assistive technology retains the full “Page X of Y” text.
  - Tutorial trigger policy and completion bookkeeping.
- Board owns:
  - Rule legality and board-state transitions.
  - Board rendering and board-local interaction handling.
  - Producing deterministic snapshots/events through the contract.

### 1.1.3 Compatibility Requirement for Swapping Boards

- A replacement board implementation is compliant only if:
  - It satisfies the contract in Section 1.1.1.
  - It preserves shell-observable behavior in Sections 2-15.
  - No shell code changes are required beyond selecting/configuring the board adapter.

### 1.1.4 UI Writing Convention for Pills

- Inline pills/chips used inside instructional copy are treated as self-contained UI tokens rather than prose.
- When a board position appears in plain text, it uses parentheses, for example `(x,y)`.
- Any board position shown inside the board preview label must be rendered as an inline coordinate chip rather than plain text.
- Board preview label coordinate chips omit parentheses because the chip already distinguishes the position visually.
- The coordinate chip color must match the current visual treatment of that square on the board as closely as the UI allows:
  - selected source square -> source chip treatment
  - selected destination square -> destination chip treatment
  - continuation square already moved -> faint continuation chip treatment
  - continuation square still to move -> prominent continuation chip treatment
  - named rush-blocker square -> dedicated rush-blocker chip treatment
  - otherwise -> neutral square chip treatment
- Coordinate chips and their referenced board squares must share the same semantic highlight role; when a new square highlight role is introduced, a matching coordinate chip treatment must be introduced with it.
- During push retreat flow, the pushed piece's square must use a dedicated retreat highlight treatment.
- The retreat instruction says Select a retreat for piece at, followed by the shared coordinate chip with the retreat role.
- When a board preview label or similar instruction ends with a pill/chip or inline action button, no trailing punctuation is used after that UI token.
- Use grammatical sentences. Restrictions connect to a complete causal clause with because. Do not use an explanatory colon in Board copy. Action labels use sentence case: Pass, End turn, Show me again.

### 1.1.5 UI Motion Convention for Layout Stability

- Interactive UI changes that can alter element height or cause nearby layout shifting must use smooth expand/collapse animation instead of abrupt jumps.
- This applies to hover/click/reveal interactions and mode/state toggles where additional lines or controls appear/disappear.
- This also applies to transient feedback revealed by an interaction, including helper text, inline confirmations, invite/share status, validation notices, and similar messages that appear or disappear in response to hover/click.
- Motion should be subtle and brief (for example 120-220ms easing) and should preserve readability during transition.
- Implementations must respect reduced-motion preferences and disable non-essential animation when `prefers-reduced-motion: reduce` is active.

### 1.1.6 UI Motion Convention for Direct Interaction Feedback

- Motion for user-triggered interactions must be attached to the interactive element itself, not only to nearby layout or background surfaces.
- On pointer-down / mouse-down, the interacted control should show immediate pressed feedback.
- On release, motion should resolve as one short continuous release animation, not as multiple stacked animations separated by a visible pause.
- Prefer a single quick overbounce-and-settle on release over a delayed second bounce or a separate follow-up flourish.
- When a related surface should feel coupled to the same interaction, it may mirror the same press/release timing, but the timing must stay synchronized with the interactive element.
- Example pattern from shell history:
- the clicked move row compresses immediately on pointer-down
- the board may mirror that same pressed state at the same time
- on click/release, both perform one quick release bounce
- the history/state swap happens without adding a second delayed animation after that release bounce

### 1.1.7 Shared UI Constant Convention

- Any constant consumed by both JavaScript and CSS must come from a single implementation source of truth.
- Do not duplicate raw values across JS and CSS for shared behavior or styling concerns, including breakpoints, spacing values, colors, timing values, sizing constants, and similar UI tokens.
- Preferred pattern: one layer owns the token and exposes derived state for the other layer to consume.
  - Example: JS owns a breakpoint constant and writes a DOM attribute/class that CSS styles against.
  - Example: CSS owns a color token as a custom property and JS reads it via `getComputedStyle(...)` when runtime logic must use the same color value.
  - Example: a build-generated shared token source may emit synchronized values for both JS and CSS.
- When adding or changing a shared constant, update the shared source first and keep tests that prove the consuming CSS and JS stay aligned.

## 2. Identity and Rejoin

- The app must persist a device-local identity token.
- If a user later revisits the same game link on the same device, the app must restore their prior role automatically when valid.
- Reconnected users must receive all missed game state updates before interaction resumes.
- If a reconnected user is a player and has pending turn/actions, the UI must prompt them accordingly.

## 3. Game Creation and First-Player Flow (Flow 1)

When a user creates a game from the home page:

1. User sees a `Play Game` action.
2. Selecting it creates a new game and navigates to that game board.
3. Creator is assigned `Player 1`.
4. Game board shows an `Invite` option for sharing a join link.
5. `Player 1` may optionally make the first legal move before a second player joins.
6. After such a move, turn ownership advances normally; if the next player slot is unfilled, game remains waiting for invite-based join.

## 4. Invite Join Flow (Flow 2)

Two invite classes exist:

- `Player invite`:
  - Produced when a current `Player` uses the `Invite` action.
  - Grants immediate player-seat join when an eligible player seat is open.
- `Non-player invite`:
  - Produced when a current `Viewer` uses the `Invite` action.
  - Also used when a different device visits the canonical game URL directly instead of an invite token link.
  - Never grants immediate player-seat assignment; player-seat entry becomes an approval request.

When a recipient opens either invite type:

1. Recipient sees the game board in the background, greyed out and not interactable.
2. Recipient sees an invite screen at the top of the page with `Join as player` and `Join as viewer` options.
3. The invite screen must show feasible actions as enabled and non-feasible actions as disabled/greyed out with a short explainer.
   - Example: `Game already has the maximum number of players`.
4. If recipient selects `Join as viewer`:
   - Join is applied immediately for both invite classes.
   - Recipient then transitions onto the canonical live game route and receives live updates there.
5. If recipient selects `Join as player` from a `Player invite`:
   - Join is applied immediately when an eligible player seat is open.
   - Existing participants are notified that a player joined.
   - Recipient then transitions onto the canonical live game route and receives live updates there.
6. If recipient selects `Join as player` from a `Non-player invite`:
   - Recipient is added as `Viewer` immediately if not already present.
   - A player-seat request is sent to the approving player.
   - Recipient is shown that the action is pending approval.
   - If approval is granted, recipient is upgraded from `Viewer` to `Player`.
   - If approval is not yet granted, recipient remains `Viewer`.
   - The approving player must be shown a blocking top-of-page approval surface, with the rest of the game page greyed out and non-interactable, matching the invite-entry UX pattern.
   - That approval surface must provide `Accept` and `Ignore` options.
   - Selecting `Ignore` dismisses the blocking approval surface for now, but the pending request remains visible in the `Join / Invite` section until accepted or otherwise resolved.
   - If one player-seat request is accepted, competing pending player-seat requests for that game are dismissed immediately.
7. If recipient joins as `Viewer`:
   - They can view board and updates but cannot take game actions.
   - They can share the invite link with additional participants.
   - They continue seeing `Join as player` while fewer than 2 player seats are filled.
   - Once both player seats are filled, `Join as player` is disabled with an explainer rather than silently disappearing.
8. If recipient joins as `Player`:
   - They occupy an available player seat.
   - UI prompts the side to move to act.
   - UI prompts the non-active player to wait.
   - When turn passes, that player is prompted to make their move.

## 5. Real-Time Move Synchronization (Flow 3)

- Moves made by one player must appear automatically for all other connected participants without manual refresh.
- This applies symmetrically for both players and all viewers.

## 6. Presence and Reconnection (Flow 4)

- Human presence appears beside participant names. Computers use the distinct Players activity contract below, rather than treating runner control as human connectivity.
- When a participant disconnects (including inactivity/session drop), others in the game must see their status change to `Disconnected`.
- When that participant reconnects on the same device identity:
  - Prior role is restored automatically.
  - Their board catches up to current live state.
  - If they are a player with pending turn/actions, they are prompted to act.

## 7. Move History Sidebar (Flow 5)

- Game page must show a sidebar/history panel listing turn history in order.
- The history panel must group moves beneath their parent turn.
- Use the approved compact owner-colored rail. Its affiliation belongs to the whole turn, including defender-retreat rows whose text retains the defender color. Turn headings visibly read `Turn N`; retain player attribution in accessible labels. Every move label retains its board-wide `Move N:` prefix.
- The entire turn group is an implicit selection surface. Heading and surrounding space select the aggregate; each child move selects that exact move; child action buttons win over both. Use independent native button targets without nested buttons or duplicate keyboard activation. Selected move/turn targets are inert while their child move/action controls remain usable.
- Keep the rail compact without collapsing turn contents. Preserve newest-first display order for turns and every move list, recorded destruction nesting, pending/archive states, frozen acknowledged selection and mobile preview reveal. Mobile selection and action targets stay at least 44px; desktop density follows the approved rail study. Reduced motion removes press/release movement.
- The History panel groups active moves beneath their parent turn. All displayed move lists are newest first, including within a turn and expanded undone disclosures. Display sorting never changes engine, replay or stored action chronology.
- [History presentation](ai/HISTORY_PRESENTATION.md) owns compact turn rails, global Move numbers, frozen selections, inert selected targets, mobile preview parity, narration and Undo boundaries.
- Users can click any move entry.
- Clicking an entry switches board from `Live view` to `History view` at post-move state for that entry.
- While user is in `History view`:
  - New moves continue appending to the history list in real time.
  - A clear visual indicator must state that user is not on live state.
  - A prominent `Return to live` action must be visible and restore `Live view`.

## 8. Home Page Game List and Public Entry (Flow 6)

On home page, users must see a game list in reverse chronological order by latest activity timestamp (latest move time; if no moves, creation time).

Pagination uses Ghost arrows at every width, with full accessible Previous/Next page names and no visible words on the buttons. Keep transparent resting borders, quiet hover, clear keyboard focus, and unobstructed native targets of at least 44 by 44px. Both arrows and the full Page X of Y label stay on one physical line at 320px, 390px, and desktop, including natural 200% text and two-digit counts. The arrow and loading pieces replace each other in the same centered slot. Preserve the 200ms cue and 5000ms slow thresholds. Both arrows remain disabled during their request. The opted-in Home section shares one existing slow status below its content, outside the busy buttons and pagination row, so feedback does not move the arrows or label. Preserve modulo wraparound, header/footer placement, page-size rules, cancellation and account guards, and the current failure behavior: retain the page and allow another arrow activation to retry, without a new error panel or separate Retry button.

Each listed game must display:
- `Player 1` activity state.
- `Player 2` activity state.
- Timestamp of last move.
- Viewer metrics: `active viewers / peak viewers`.

List behavior:
- Selecting a game from this list on a device that is not already a participant/viewer opens the `Non-player invite` screen for that game rather than silently adding the device as `Viewer`.
- Opening from list or direct game URL alone must not auto-assign a player seat or silently auto-add a new viewer.
- When a player seat is eligible, users entering from the home page list must still be shown `Join as player` and may request that seat.
- A viewer may request to take an eligible player seat only when:
  - Seat is empty, or
  - Existing seat holder has been inactive for more than 5 minutes.
- Such a takeover request must be approved by the opposite player before assignment.

### Completed games on Home

- Keep ongoing owned games in Continue playing. Put Your completed games below Start something new and above Other games. Only the current account's completed games belong in Your completed games. Other people's completed games remain in Other games.
- Classify completion only from a confirmed `p1_win`, `p2_win` or `draw` outcome. Unknown status shows Game status unavailable, never a guessed winner or draw. A pending winning move or Undo does not change confirmed membership. Accepted Undo can reopen a game and update all affected counts, pages and cards together.
- Filter membership before server counts and pagination. Preserve newest-activity ordering and stable ties. Clamp a removed last page. Each section has independent loading and recovery, and an empty completed section is hidden only after a successful zero count.
- Home's first failed attempt remains a private whole read, followed by one 500ms retry. Only an exhausted second ordinary Home attempt may publish healthy sections after all work settles, retaining failed sections and explicit Retry. Account continuation, owner changes and auth/session/protocol/schema/storage/contract failures always refuse the whole read. No healthy section means global recovery. A failed section never restarts itself from a trailing refresh.
- Membership freshness has its own bounded repair. If `home_list_changed` remains afterward, retain the entire previous cards/counts/focus with manual global recovery. Do not publish an unproven mixture or treat this as a recoverable network section failure.
- Completed cards show the winner line beside the matchup and a subtle three-pixel rail in the winning side's color. Own victories say You won. Own losses name the actual winner, such as Tau won, with You lost beneath. Draw says Draw and No winner. Self-play uses Red won or Blue won without personal win/loss wording. Missing winner identity falls back to the actual side.
- A completed card keeps its final board, saved move count and one full-card Review game link. It has no active-turn or presence cues and no nested interactive elements. The winner comes from the outcome's winning seat, independent of whose turn follows or shared computer ownership. Reuse shared player names and perspective rules, escape names and isolate their writing direction.
- A card's board, result, count and identities form one confirmed revision. Older list replies must not overwrite a newer live projection or Undo reopening. Provisional previews stay separate. Recheck section membership and counts after concurrent updates rather than mixing old totals with newer cards.
- Preserve a connected control the reader moved to during refresh. Otherwise retain the same card or a stable neighbor/heading in its previous section with no scroll jump. Announce a completed focus restoration. Refresh a trailing update after a successful batch, without creating a tight automatic retry on a failed section.
- Validate narrow layouts, text zoom, keyboard activation, single focus stops and the actual application rendering. Approved static study references do not replace app acceptance.

## 9. Home Page Preview Board (Flow 7)

- Home page must include a top-of-page preview board.
- Preview board replays an example game sequence automatically.
- Preview is non-authoritative and does not mutate live games.

## 10. Tutorial Flow (Flow 8)

Tutorial triggers:
- Show tutorial when a user first starts a new game, joins as player, or joins as viewer on that device.
- Skip automatically on later visits for that same device identity.

Tutorial behavior:
- Uses a dedicated tutorial board, separate from live game state.
- Walks user through each core action step-by-step.
- User is prompted to perform each tutorial action before advancing.
- If user does not act after a short delay, a hint animation is shown.
- After a short delay, a `Next` option appears to let user skip current step action.
- On completion, user is taken to the intended live game board.

Tutorial restart:
- Every game board must expose a control to restart the tutorial on demand.

## 11. Role Capability Matrix

- `Player`:
  - Can make legal moves when it is their turn.
  - Can invite others.
  - Can view history/live and presence.
- `Viewer`:
  - Cannot make game moves.
  - Can view live board, history, and presence.
  - Can share invite links.
  - Invitees from viewer-shared links use the `Non-player invite` path and need opposite-player approval to join as `Player`.
  - Users entering from the home page list or direct game URL on a new device use the `Non-player invite` path and need opposite-player approval to join as `Player`.
  - Can request/join as player only under Section 4 or Section 8 constraints.

## 12. Playground Mode

- The app must provide a `Playground mode` option when starting a new game.
- In `Playground mode`, the current device is assigned control of both player seats.
- The same device may execute legal actions for whichever side is currently to move.
- Turn order and all game-rule legality remain unchanged; only seat control differs.
- Invite and viewer behavior remains available:
  - Invite links may still be shared.
  - Invite recipients can join as `Viewer`.
  - Invite recipients cannot claim either player seat unless `Playground mode` is exited.
- Presence should represent both player seats as controlled by the same device identity while connected.
- Exiting `Playground mode` converts the game to standard multiplayer seating and re-enables normal player-join rules.

### 12.1 Offline Playground Requirements

- `Playground mode` must be runnable with no network access.
- Users must be able to start a new self-play game while offline from the home page and play full turns locally.
- While offline, move validation and rule resolution must run fully on-device; no server round trip may be required to continue play.
- The app must persist offline self-play game state locally (including move history) so a reload on the same device restores the game.
- If a local persistence write fails, the UI must show a non-dismissed warning that offline progress may be lost.
- Offline self-play sessions are single-device only:
  - Invite creation/sharing must be disabled while offline.
  - Join-as-player/join-as-viewer actions for other devices must be unavailable while offline.
  - Presence indicators for remote participants must be hidden or replaced with an `Offline` state.
- The game board must show a clear `Offline` indicator whenever backend connectivity is unavailable.
- The web app shell and assets required for self-play mode (HTML/CSS/JS/fonts/icons) must be cached for offline startup after at least one successful online load.
- When connectivity returns, the app may offer an explicit `Go online` action for that local self-play game; this transition must require user confirmation and must not happen automatically mid-turn.
- Until user confirms `Go online`, the local offline game remains device-local and does not appear in public/home game lists.

### 12.2 Self-Play Move Preview Semantics

- Piece move previews in self-play are split into:
  - legal destination actions (submittable)
  - blocked destination previews (non-submittable) for actions that fail only because they cannot complete to a legal end-supplied closure state (`SUPPLY_DESTINATION_UNSUPPLIED`)
- The engine board adapter and related board helpers must expose:
  - `actions`: legal-only actions
  - `previewActions`: legal actions plus supply-blocked destination previews, each with a `legal` flag and optional `blockedReason`
- UI behavior:
  - legal previews render as normal ghost destinations
  - supply-blocked previews still render at the destination, but the ghost piece is crossed out to indicate illegality
  - target/action picking must use legal actions only; blocked previews are informational and must not be auto-selected as legal actions
- Self-play board selection mode:
  - default (toggle off): users may only pick source cells that contain pieces and destination cells that have at least one legal action from the selected source
  - free-selection mode (toggle on): users may click arbitrary empty source/destination cells for inspection/manual experimentation

### 12.3 Self-Play Removal Feedback

- Accepted action resolution may include `removedPieces`, a transient list of piece-removal notices for pieces removed as part of the accepted action resolution.
- Each removal notice must include:
  - `pieceId`
  - `position`
  - `reason` (`no_retreat` or `loss_of_supply`)
  - `message` (player-facing text suitable for direct tooltip display)
- Playground UI must render removal notices as transient board-local feedback at the removed piece's former square.
- The default treatment is:
  - a short flashing highlight on the affected square
  - a tooltip with the supplied player-facing explanation
- Removal notices are informational only and must not alter deterministic engine state or replay artifacts.

### 12.4 Persistent Destruction Records

- In addition to the transient `removedPieces` path (§12.3), each stored `MoveEntry` carries a `destroyedPieces` field: a persistent record of pieces removed during that move's resolution.
- Each `DestroyedPieceRecord` includes:
  - `position` — the piece's coordinates at removal time
  - `ownerSeat` — `"p1"` or `"p2"`
  - `reason` — one of `"no_retreat"`, `"loss_of_supply"`, or `"commander_unsupplied"`
- The `commander_unsupplied` reason is used for Commander removals exclusively. **Invariant**: A Commander removal always produces a terminal outcome (`p1_win`, `p2_win`, or `draw`); a move with an `ongoing` outcome cannot contain a Commander removal.
- Destruction records are used by the history panel to render `DESTROYED (row,col)` sub-bullets beneath the triggering move entry (see §7 and §1.1.5).
- Pre-deploy moves without `destroyedPieces` default to `[]` on normalization; no sub-bullets are shown for those moves.

## 13. Notifications and Prompts

The confirmed November 11 [incoming presentation follow-up](ai/INCOMING_NARRATION.md) gives incoming move narration a desktop History host or mobile bottom flyout. Other notices keep their authority and layering. Its implementation and deployment are tracked separately from the original refresh.

Notices are nonmodal and preserve incident identity, focused controls, open details and animation time. Their shared page layer stays above content, loading borders, menus, utility rails, mobile navigation and transition ribbons, and below native modal dialogs/backdrops. Check ancestor transforms, stacking contexts and clipping across both layouts and route transitions. Preserve native DOM/event ownership where possible. The study's token numbers and fallback root host are implementation proposals, not independently approved architecture. Notices never trap focus or make the background inert. [D13](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index) records the approved ordering.

- Prompt text/content may vary, but these state prompts are required:
  - Opponent/viewer joined.
  - Your turn.
  - Waiting for opponent turn.
  - Viewing history (not live).
  - Participant connected/disconnected.

## 14. Out of Scope (v1)

- Matchmaking/ranked queue.
- Chat/voice.
- Payments/monetization.
- Mobile native apps.

## 15. Fast-Start Baseline (Mandatory for All Future Work)

This section is normative and applies to every new endpoint, page, and performance-affecting change.

- Startup-path endpoints must avoid repeated deterministic computation per request:
  - If payload content is deterministic for a deployment/version, it must be precomputed at module scope and reused.
  - Request handlers on the startup path must not rebuild static bootstrap payloads on each call.
- Cache behavior must be explicit per endpoint:
  - Stable bootstrap/read endpoints must return explicit cache policy suitable for edge reuse (for example `s-maxage` with `stale-while-revalidate`).
  - Mutable/user-specific/safety-sensitive endpoints must remain non-cacheable (`no-store`) unless a stricter endpoint contract is documented.
- Edge/API cold-start import surface must be minimized:
  - API handlers must use direct module imports for required symbols.
  - Barrel imports on startup-path handlers are disallowed unless a measured benchmark demonstrates no startup regression.
- Page initialization must prioritize first meaningful render:
  - Initial UI render must not block on non-critical requests.
  - Non-essential data loading must happen after first render and progressively enhance the page.
- New startup-path code must carry verification:
  - Tests must assert bootstrap endpoint cache headers and response determinism.
  - Performance-sensitive changes must include a short note in PR/commit text describing startup impact and why the chosen approach preserves fast start.

### Independent board legend inspection

Approved intended behavior, including the November 1 supply/commander follow-up. Provenance: [D02](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

- Commander and Supply point retain independent inspection targets and affiliation contexts. Supply point selection never clears the selected commander. Clearing one explicit inspector leaves the other intact. Inspection never submits, queues a move or changes authority.
- Supply paths use fixed green `#2f8e63`, round 3px strokes and `7 5` dashes. Command paths use owner colors, round 3px strokes and `2 6` dots. Shared segments use separate lanes at -2.5px supply and +2.5px command under canonical endpoint ordering. Define styles once for both adapter branches. Compact 16×3px legend samples use 5/4 supply and 2/4 command mark/gap patterns. Identity emblems, pieces, selected supply square and label underlines keep affiliation colors.
- Selected labels use a 2px text underline with a 5px offset and neutral text. Keep separate visible keyboard focus and at least 44px touch targets. Add no selected tint, outline, check mark or button-wide bottom rule.
- Commander-piece clicks cycle moves → combined connections → moves when complete legal previews exist. Combined connections include the commander's recorded supply path and applicable nonzero command paths ending at that commander. The Commander legend remains an independent command-only inspector. Ordinary unit behavior remains unchanged.
- An explicit Supply point inspector exclusively chooses the affiliation whose supplies are drawn. Blue commander plus red Supply point draws blue commands and only red supplies. Clearing red supply does not silently restore blue personal supply. A deliberate commander-piece activation may re-enter the combined phase.
- Use recorded paths, affiliation and endpoints. Do not invent substitute routes. Zero-length supply at its own source is not missing supply. Skip empty command stops. In read-only contexts, show useful connections or selected-piece information without a move-preview phase. Preserve independent explicit layers.
- Commander and Supply point identity controls remain present. Line samples and group descriptions appear only when their overlays are actually drawn. A real board change drops vanished targets and routes while preserving unrelated valid inspectors.

### Stable board messages and inline actions

- The host’s `canPresentActions` callback expresses durable human control of the current actor. `canInteract` expresses permission to submit right now. Selection, preview phase and instructional copy express player intent. Temporary command admission, socket recovery, lease renewal and save confirmation must not switch them to another state. Keep Pass and End turn in their sentence and disable submission while blocked. Never queue a blocked click. Authoritative board changes may invalidate selection.
- Use “Select a move for piece at” and “Supply and command lines for piece at”, followed by the shared coordinate chip. Keep specific explanations for pieces without legal moves.
- Completed opponent and historical narration lives in Board context outside the finite guidance prompt. Historical move/turn headings follow the selected recorded identity. Mobile History keeps its inline narration and after-state preview while the live Board remains independent. Replay retains its finite guidance controls and shows recorded narration with progress in context.
- All board-message coordinates, including move narration, use the shared coordinate-chip renderer with a space after the comma. Structured coordinates must stay separate from player-controlled names. Coordinate-chip text and action-label text share the surrounding prose baseline. Pass, End turn, and Show me again use the approved restrained treatment: .88em type, 1.5 line height, .2em vertical and .48em horizontal padding, a 1px border, and automatic height. Coordinate chips stay shorter at .9em type and 1.25em chip height, retaining semantic colors. Keep the existing 12px action icons. Reuse these renderers and exact metrics for primary and fallback sizing replicas. Expanded hit surfaces must be at least 44 by 44px, fit inside reserved message space, remain fully clickable across engines, and never overlap another action. Verify native keyboard activation, stable focus identity, disabled/busy behavior, cold fonts, zoom, narrow widths, and unchanged board anchors when changing token metrics.
- Recorded narration uses acknowledged board-wide Move numbers and the recorded actor, including the defender for retreat. End-turn bookkeeping is never a selectable/narrated replay step: its final state and distinct removals belong to the preceding visible action. A push calls an opposing no-retreat removal at its destination captured only when the pre-action occupant and the same move's removal record match by piece, owner, and square; own losses, identity mismatches, and loss-of-supply/turn-end removals remain ordinary loss or destruction copy. Turn summaries name distinct rush actors and list destinations in action order. One event stands alone, two join with and, and three or more split into compact paired sentences so commas do not sit directly after coordinate pills. The article-dropping Board style is intentional.
- Refreshing an unchanged board message must retain its live action buttons through pointer and keyboard press/release feedback. Ignore only the known temporary feedback classes (`is-pressing`, `is-releasing`, `button-release-bounce`) during structural comparison; action IDs, disabled state and genuine style classes remain semantic. Verify pointer-down → refresh → pointer-up and keyboard activation → release feedback → refresh with one action and stable focus.
- Narration describes the acknowledged sequence. Multiple rushed pieces name the distinct count and destinations in action order. Push summaries use the recorded destination and distinct follower count. Full text and coordinates remain available in scrollable context without increasing Board height.
- Routine computer activity copy appears only while the human is waiting: Waiting for the named computer, thinking, and saving their move. Preparation and control renewal remain waiting. Once confirmed movement is shown, persistence and control work continue quietly in the background. Delayed actionable recovery notices are separate. Activity-dot ownership follows the computer named in the message rather than a pending human operation.
- Narration uses acknowledged actions, exact actor/follower counts and the shared [History grammar](ai/HISTORY_PRESENTATION.md#recorded-narration). Live completed summaries and recorded replay use that same grammar. Push coordinates identify the attacker destination, which was the victim’s original square.

- Reserve only the measured routine prompt envelope at each actual width, font and text scale before first paint. Routine selection, inspection, waiting and ordinary confirmation keep the Board anchor. Opponent summaries and extended copy use independently scrollable Board context outside the finite prompt. They must not increase Board height. Do not reserve a turn-summary maximum or silently truncate full context. Use identical primary/fallback sizing replicas. Recheck cold/loaded/reload anchors at 100% and 200% text.
- Distinct semantic messages and supporting details start on separate lines with uniform body size and 1.5 line height. Use identical row safety padding `max(0px, 23.0625px - .836em)`, an added .5em gap and full-rule offset -.25em from the following row border edge. Text-only and no-Pass rows retain the same padding. No gap appears for absent detail. Keep clauses and coordinate lists within their event.
- Detached replay/recovery/status pills sit below their own message. Pass and End turn stay in grammatical sentences. Obligatory follows only the unselected supply warning, with no rule separating a message from its own pills.
- With no selection, list all required rush-supply pieces. A selected piece, including automatic sole-helpful-piece selection, replaces the entire summary. A destination replaces the piece instruction with confirmation and a separate known supply effect. Hide the global summary and Obligatory while selected. Hover alone changes neither context. Deselecting restores the current complete obligation list.
- The later finite-prompt contract adopted in PR246 supersedes D18’s earlier 450/280ms Board overflow motion. Font and text-scale corrections measure the approved finite grammar before reveal. Extended content scrolls in Board context. Preserve native press targets and the Board anchor through refresh and responsive changes.
- Keep the actual native action node through semantically unchanged updates. Verify pointer-down/update/pointer-up, touch, Enter/Space, focus, disabled/busy state, wrapped hit areas and nonoverlap in Chromium, Firefox and WebKit. Temporary admission fences preserve selection, preview and inspection phase. Complete legal-query results, not coarse subsets or timeouts, establish move availability. Provenance: [D01, D03, D18](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

### Undo consent

- Undo applies directly in self-play and against a computer controlled by the same human. While its durable receipt is pending, do not show an undo request, acceptance message, or approval controls. Confirm completion as “Move undone”.
- The confirmed November 11 follow-up replaces per-operation display boundaries with contiguous undone runs in original newest-first move order. Runs may cross accepted Undo operations and turns, but never a retained move or an unproved unloaded gap. Preserve original stored operation provenance and chronological replay. If a viewer selected a record that becomes undone, reveal its current run only for that viewer. Honor deliberate collapse until another explicit selection. Paging and merging preserve disclosure identity, focus and held native input. Expanded records keep their original turn, actor and immutable state. Count neither duplicate live/archive copies nor folded End turn closures. Unknown order/provenance and empty earlier-history placeholders stay explicit. See [History](ai/HISTORY_PRESENTATION.md#undo-boundaries) for the approved target and pending acceptance.
- A pending local prediction is labelled pending until the durable acknowledgement. Missing historical boundary evidence remains unavailable. Do not reconstruct an accepted operation from matching times or names.
- Only another human controller must approve Undo. Keep that player's request, Accept, Reject and Cancel request flow. Use authoritative seat-controller identities, never display names, to distinguish these cases.
- Direct Undo keeps the existing serialized command, receipt and recovery path. Computer work is paused and reconciled before restoration, then resumes under the acknowledged position and control generation. Reopening a completed game by explicit Undo retains these same safeguards.
### Projected status during a sequence

- During a live rush or push sequence, show every piece's status as it would be after the turn ended at its current position. Recompute the projection after each acknowledged sequence step, including defender retreats and follows.
- Pieces that would be destroyed use the same crossed-out treatment as historical destruction. A later step that restores supply removes that forecast and restores the piece's projected status.
- A forecast never removes a real piece, changes frozen action eligibility, completes a turn, adds a history destruction record, or triggers removal animation or sound. Real move admission continues to use the authoritative state. Preserve the existing acknowledged-history presentation separately.


### Canonical player references and accessible affiliation

Use the current canonical player name in its owning color for opponents, spectators, profiles and authored instructional references. The confirmed November 11 viewer-relative naming follow-up is a scoped exception to D04: an owning human sees You in Home matchups, completed-game matchups and their main Players label. Human self-play says You play both sides on Home and You · Red / You · Blue in Players. Home says Your turn to play only for a saved human seat owned by the captured viewer. Canonical profile names, profile actions and full accessible identity remain available. Temporary computer control does not transfer human identity. If an owning viewer’s You label collides with a different participant’s canonical name You, preserve that name and show the existing quiet @username. Without a username, add the seat qualifier to both displayed labels. Compare labels only after saved ownership is established. One anonymous player is Guest; when both seats are anonymous, use Guest 1 and Guest 2 by fixed seat. Names that happen to be Red, Blue or Guest remain unchanged. Preserve profile actions, bidirectional isolation and complete accessible names for long or duplicate names. Accessible labels retain the owner color and identify the human's own seat independently of visible color. Useful relative control prompts and You won may remain.

Recorded History and replay use You only for the recorded actor’s saved human seat owned by the captured viewer. Human self-play retains the recorded color, such as You (Red) and Playing your recorded Red move. Other actors keep canonical names and recorded computer proof takes precedence over current seat projections. Do not infer the actor from the current turn, inspected seat, freeform name or temporary control. Result titles identify the actual winner, never the active side or selected rematch side. Human self-play needs the winning-seat qualification: You won as Red/Blue for its owner and {player name} won as Red/Blue for viewers. Other results omit redundant visible color suffixes while retaining accessible color attribution. Commander explanations carry structured owner references; style the entire Your Blue commander phrase in the relevant color. Never infer an owner's color by matching user-supplied name text. Viewing, temporary computer control and replay must not change the recorded owner or gameplay authority.

Curated instructional descriptions may resolve structured owner references only when real game context exists and the shipped scenario ID and original description match. Edited and imported prose stays untouched. Editing always exposes the original description, not resolved names or nonvisual affiliation text. Changing between display and editing must replace that description node before preserving editable content. Analysis keeps its fixed first-player/Red score perspective. A Red owner reads your perspective, a Blue owner reads your opponent’s perspective ({canonical Red name}), and a self-play owner reads your Red side’s perspective. Only that score-perspective phrase receives the referenced seat’s color, with non-color attribution. Your move and the remaining message stay neutral. Spectators retain the canonical Red player’s name. Raw evidence and exported owner enums keep their technical coordinate system.

### History endpoint roles

[History presentation](ai/HISTORY_PRESENTATION.md#history-endpoint-roles) owns source, target and combined endpoint roles for desktop and mobile. Explicit History context must reach both adapters and reset on return live. Automatic live overviews and replay retain their separate presentation.

### Computer identity and activity in Players

Players retains each computer's 34px seat-colored identity emblem and actual, affiliation-colored name. A neutral 22px bot in one 24px slot replaces the small name-adjacent bot and separate presence circle. Its overlapping status mark carries the activity. Ordinary status words appear only in the complete row accessible name and shared hover tooltip, including when details are expanded. The existing row remains the sole disclosure target. Resume actions retain their permissions, disabled explanations and minimum 44px target.

Consume the existing computer activity result without inferring control ownership or adding thinking/saving states. Active here uses a check and active elsewhere uses an outward arrow from a window, both in the existing connected green. Ordinary waiting/inactive uses a minus in the existing disconnected gray. Resuming uses a static circular arrow. Paused uses a 14px amber mark with 12px solid bars. Needs help uses a 15px light coral mark with a 13px dark warning triangle and contrasting exclamation. Finished uses a 15px muted teal mark with a 12px light flag. Confirmed move playback uses a blue mark and light play symbol. Remaining ordinary marks are 12px with 11px symbols. Use shared semantic tokens for the approved palette: connected `--connection-status-connected-bg` green `#3ea76a` for Active here/elsewhere, ordinary `--connection-status-disconnected-bg` gray `#c8c4bc`, paused amber `#f0bb55`, help coral `#f2a397`, finished teal `#426e65` and confirmed playback blue `#1a5ca1`. Paused/help symbols use dark `#252b2d`, and finished/playback symbols use light `#fffdf6`. Reuse connection ring tokens and define new state colors once rather than duplicating literals across renderers. Symbols remain distinct in forced colors and do not pulse or spin.

The complete row name includes computer name, affiliation, computer kind and current activity. Decorative icons add no focus stops or duplicate accessible names. Hover text mirrors that name, stays inside the visual viewport, permits pointer entry, dismisses on Escape, and updates or disappears when the underlying row changes. This presentation is restricted to Players. It changes neither Home cards nor computer recovery, gameplay admission, leases or runner authority.

Acceptance checks cover all activity states, both affiliations, 320px and desktop widths, 100% and 200% text size, native disclosure and permitted/disabled Resume, tooltip lifecycle, forced colors, reduced motion and no document overflow. Integrate the quiet-recovery producer and current Players naming/viewer work before final combined validation.

Approved intended presentation. Implementation and combined release proof remain separate. Provenance: [D11](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

### Completed games and Play again

A confirmed terminal game is review-only. Stop new computer decisions and mutation controls, while allowing bounded presentation of already confirmed moves. Do not acquire computer control or show routine thinking for a finished game. A presentation failure is not a new calculation. Keep inspection, History, result viewing and permitted rematch available. Forecast destruction does not establish completion.

History shows Play again beside the completed outcome and wraps it below at narrow widths. Keep the outcome announcement separate from the button. Reuse the existing rematch modal and icon. Show the action only for authoritative saved human-seat ownership under the current identity, including eligible guest and both-side play. Spectators, stale account continuations and temporary computer takeover gain no eligibility. Recheck ownership on direct entry and after sign-in. Selection of an old move never changes final-result eligibility.

Opening, dismissing, preparing or retrying the modal creates no game. Only explicit Start game does. Preserve opponent and opposite-side defaults, native modal focus containment, Escape/Cancel and return focus to the current History trigger even after rerender. Account or route changes cancel stale intent. Friend choice starts a fresh invitation. New game before this move remains a separate action. Provenance: [D09, D14](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

### Home sections and pagination

Use Continue playing for unfinished owned games. Your completed games sits after Start something new and before Other games. Personal ownership follows the existing authorization mode. With account authentication active, only the authenticated account's account-owned games appear in either personal section. Signed-out requests receive no personal games, and legacy games stay in Other games even if their saved identity matches the account. Before account activation, the existing legacy mode retains identity-owned personal lists. This introduces no new account setting or activation permission. Membership precedes server counts and pagination. Other people's completed games stay in Other games. A winner line and subtle winning-side rail carry the outcome. Own losses name the winner, with You lost secondary. Use the current [identity policy](UX_PRINCIPLES.md#identify-people-and-visual-roles-separately), including self-play disambiguation, rather than older color-only result copy. Unknown outcomes are not draws. Preserve fresh off-page completion data.

Play both sides is a standalone native action centered below opponent cards. Remove Choose your opponent. Placement changes preserve creation semantics, story entry, error handling and duplicate-submit protection.

Pagination uses Ghost arrows at every width, quiet hover and visible focus. Both 44px native targets and the full Page X of Y remain on one physical line, including 320px and 200% text. Arrow and loading cue share a centered slot without moving the label or hit bounds. Preserve the 200ms visible and 5000ms slow thresholds. Show one existing slow message below the row. Preserve wraparound, cancellation and account fencing. On failure retain the current page and existing arrow retry, with no additional Retry action or newly invented failure UI. Provenance: [D10, D12](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

### Route motion and scroll intent

Deliberate Home navigation starts at the top while retaining list pages. Repeated Home does not add a visit. New game-card visits begin at the live Board at the top. Browser Back/Forward restores that visit’s panel, list pages and reading position. Preserve per-panel reading positions and selected History through responsive changes. Restore scroll and focus before reveal. Latest navigation cancels obsolete transition/recovery work, including rapid reversals to the same game. The approved Dense ribbon is 94% opaque with 160ms cover and 200ms reveal using existing easing, with a quiet covered hold. Forward sweeps left to right with the top-right corner leading. Back mirrors the complete outer silhouette and internal diagonals, with the top-left corner leading. Restrict route-content motion so shared headers and notices retain their layer order. Reduced motion preserves navigation and scroll semantics without the sweep. Test actual short windows, safe areas, keyboard focus and scroll owners. Provenance: [D06, D13](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

### Unique required follow and confirmed playback

Automatically perform a required follow only when complete current legality proves exactly one choice. Multiple alternatives remain the player's decision. Show animation and movement sound as the acknowledged action is presented, and offer Show me again for the entire push/retreat/follow sequence. Replay is visual-only and never submits another action. Preserve durable dependency and receipt identity across recovery. Incomplete search, stale authority and a temporary admission fence must not manufacture a unique move or duplicate an earlier command. Scope changes cancel obsolete pre-journal work while already durable intent reconciles its original receipt. Provenance: [D07, D17](UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).


### Commander connections and semantic line roles

- Board supply paths use `--connection-supply` (`#2f8e63`) with a `7 5` dash cadence. Command paths use their affiliation color with a `2 6` cadence. Both are 3px with round caps. Shared segments retain the canonical endpoint orientation and split into supply −2.5px and command +2.5px lanes, invariant under route reversal. Compact 16px legend samples use 5px marks/4px gaps for supply and 2px marks/4px gaps for command. One shared connection-style contract feeds both adapter branches and legend samples. Piece, emblem, inspector icon, selected-square and underline affiliation styling stays independent.
- A commander-piece selection with complete legal move previews has exactly two phases: moves, then one combined connections view, then moves. Keep moves first and preserve phase while preparation or temporary recovery is pending. Skip an empty connections stop. The combined view draws that commander's recorded supply route and every correctly affiliated recorded nonzero command route ending at that commander. Ordinary unit inspection is unchanged. Never compute substitute routes in the UI.
- Commander legend activation is an independent command-only network inspector. It does not activate personal supply. An explicit Supply point inspector exclusively controls supply affiliation while keeping the selected commander and command context. Blue commander plus red Supply point draws blue commands and only red supplies. Clearing either explicit inspector preserves the other. Clearing explicit supply does not automatically restore a hidden personal supply path. Deliberate commander-piece activation can re-enter its combined phase.
- Read-only/opponent commander selection shows combined recorded connections directly. Repeat activation may clear that personal selection while retaining unrelated explicit layers. Preserve recorded-move/turn overlays after inspection clears. Drop vanished targets or unavailable routes on authoritative refresh without changing unrelated inspectors or submission authority.
- Keep the routine inspection prompt inside the existing finite Supply lines, Command lines, Supply and command lines and No connection grammar, including the existing mapped coordinate variant. Full commander explanations, affiliation-specific network descriptions and actual coordinate metadata belong in the scrollable Board context. Both roles use “Supply and command lines for piece at” with the shared coordinate pill. Supply-only uses “Supply line for commander at [coordinate]. No connected units.” Command-only at the supply point uses “Command lines for commander at [coordinate]. Already at its supply point.” With neither drawable route there, use “At its supply point. No connected units.” Zero-length supply at its source is not loss of supply. Preserve specific inactive, frozen or terminal explanations for actual missing supply. Mixed network copy describes the roles and affiliations actually drawn. Samples/group explanations appear only when their overlays exist; identity controls remain available.
- Inspection never submits or queues gameplay. Acceptance includes real Standard rush engine paths, both affiliations and adapter branches, mixed-layer clearing, pending preparation, authoritative refresh, route crossings/reversal, zero-length/missing paths, native mouse/touch/keyboard/focus and 44px controls. Validate primary/fallback fonts, 200% text, stable board anchors, reduced motion, grayscale/color-vision variants and actual desktop/mobile app behavior. Study renders and unit tests do not substitute for browser acceptance.

### Stable human controls during computer maintenance

A fresh, owned computer lease renewal that changes neither the human actor's position nor their authority must not disable a legal Pass, End turn, piece selection, or destination. Keep control-changing requests serialized. Exempt gameplay only while the exact renewal, owner, device, generation, lease, state/revision, and recovery episode remain valid. Storage uncertainty, overdue or failed requests, incompatible versions, lost permissions, changed positions, and independent recovery continue to disable unavailable actions; blocked input never creates deferred gameplay intent.

An explicit permitted action still enters the ordinary durable journal and receipt chain. A shared predecessor does not advance gameplay revision. Compatible metadata arriving during that durable write may update a completed projection without another rules worker, but only after rechecking authority, permissions, queue lineage, recovery, and viewing context. Never publish a solid local move before durable admission, reuse a stale authority projection, or recompute an admitted command to conceal a failure.

### Board message composition and height

Semantic messages use uniform body text, with a fine full-width rule between messages. Grammatical Pass and End turn actions and coordinate pills stay inline. Replay and status pills belong below their own message and wrap naturally. Rows share a .5em gap and max(0px, 23.0625px - .836em) padding. Keep native 44px targets and shared primary/fallback metrics.

The later finite-prompt contract adopted in PR246 owns message geometry. Measure only the supported routine primary/fallback grammar. Opponent summaries, replay and extended explanations belong to independently scrollable Board context and do not enlarge the Board. D18’s earlier variable-height overflow and 450/280ms motion are superseded. A held native press freezes current geometry and defers compatible prose changes until release. Genuine action or availability changes remain immediate and every deferred refresh repeats the full availability checks.

An unselected rush shows all and only required supply-restoration pieces with its Obligatory status. Any real piece selection, including automatic selection, replaces that global message. A selected destination owns its confirmation and a known supply effect appears separately. Preserve specific blocked-piece explanations. Hover alone does not change selection, and deselection restores the current required-piece summary. Viewing messages never queues a gameplay action.

### Computer identity and activity in Players

Players retains each computer's 34px seat-colored identity emblem and actual, affiliation-colored name. A neutral 22px bot in one 24px slot replaces the small name-adjacent bot and separate presence circle. Its overlapping status mark carries the activity. Ordinary status words appear only in the complete row accessible name and shared hover tooltip, including when details are expanded. The existing row remains the sole disclosure target. Resume actions retain their permissions, disabled explanations and minimum 44px target.

Consume the existing computer activity result without inferring control ownership or adding thinking/saving states. Active here uses a check and active elsewhere uses an outward arrow from a window, both in the existing connected green. Ordinary waiting/inactive uses a minus in the existing disconnected gray. Resuming uses a static circular arrow. Paused uses a 14px amber mark with 12px solid bars. Needs help uses a 15px light coral mark with a 13px dark warning triangle and contrasting exclamation. Finished uses a 15px muted teal mark with a 12px light flag. Confirmed move playback uses a blue mark and light play symbol. Remaining ordinary marks are 12px with 11px symbols. Semantic colors are shared design tokens. Symbols remain distinct in forced colors and do not pulse or spin.

The complete row name includes computer name, affiliation, computer kind and current activity. Decorative icons add no focus stops or duplicate accessible names. Hover text mirrors that name, stays inside the visual viewport, permits pointer entry, dismisses on Escape, and updates or disappears when the underlying row changes. The decorative mirror shares the existing utility layer below navigation, route ribbons and notices; native modal dialogs remain above it. This presentation is restricted to Players. It changes neither Home cards nor computer recovery, gameplay admission, leases or runner authority.

Acceptance checks cover all activity states, both affiliations, 320px and desktop widths, 100% and 200% text size, native disclosure and permitted/disabled Resume, tooltip lifecycle, forced colors, reduced motion and no document overflow. Integrate the quiet-recovery producer and current Players naming/viewer work before final combined validation.

### Global notice layers

Game recovery and destination notices use the shared `--shell-layer-notice` page layer. They remain above board decorations, menus, nonmodal utility/account rails, mobile navigation and the route-transition ribbon. Native `showModal()` dialogs and their backdrops remain above notices in the browser top layer. Notices themselves stay nonmodal: they do not make the page inert, trap focus or intercept uncovered page input.

Keep the existing notice DOM, delegated native controls, incident identity, live-region deduplication and document Tab order. Header ancestors must not acquire transforms, filters, isolation, opacity animation or clipping that traps the notice in a lower stacking context. Route reveal motion belongs on route content beneath the header. A document-level notice host is a fallback requiring a separate event/focus ownership review.

Use the named page-layer tokens in `design-tokens.css` rather than component-specific escalation. Keep local card/stone layers local. Acceptance includes actual overlay pixels and native hit targets, unchanged focused controls through updates, modal Escape/focus restoration, nonmodal rail coexistence, narrow and zoomed layouts, and notice/ribbon coexistence during navigation. A computed layer number alone is insufficient visual proof.
