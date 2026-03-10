# Righelt Web App Specification (v1)

Status: Normative source of truth for product and UX behavior of the web application.

This document defines application-level behavior around game creation, invites, joining, live updates, presence, history viewing, lobby listing, preview board, and onboarding tutorial.
The surrounding web app must remain implementation-independent from the game board and may integrate any board backend/UI that conforms to this spec's board integration contract.
If implementation behavior conflicts with this spec, this spec wins.

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

### 1.1.1.4 Pass vs End Turn (Current Board Behavior)

- `Pass` is a board action type.
  - It is submitted through normal board action flow.
  - It appears in move history as a move entry.
- `End turn` is not a board action type.
  - It is a board-to-shell semantic message (`turnEnded`) and corresponding board command.
  - It must not appear as a move entry in move history.
- Board decides when to emit `turnEnded` for this game implementation.
  - Board auto-emits `turnEnded` when the turn should close (for example after `project`, after `pass`, or after other non-continuation commits).
  - Board may emit `turnEnded` early during optional continuation windows (for example during rush) when the user elects to stop.
- During rush and push continuations, the board must continue to treat the initiating player's command/supply state as frozen from the moment that sequence started.
- Any command/supply change created during the continuation is reconciled only after the continuation fully closes for frozen-status checks and forced-removal purposes.
- However, destination-supply legality is never frozen: the board must not offer or commit a move/retreat/follow/push destination that would leave the moved piece unsupplied on that destination.
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
- When a board position inside the board preview label is rendered as an inline chip, the chip text omits parentheses because the chip already distinguishes it visually.
- The coordinate chip color must match the current visual treatment of that square on the board as closely as the UI allows:
  - selected source square -> source chip treatment
  - selected destination square -> destination chip treatment
  - continuation square already moved -> faint continuation chip treatment
  - continuation square still to move -> prominent continuation chip treatment
  - otherwise -> neutral square chip treatment
- During push retreat flow, the pushed piece's square must use a dedicated retreat highlight treatment.
- The retreat instruction should refer to that location as `highlighted square` in a pill matching the retreat highlight, rather than by coordinates.
- When a board preview label or similar instruction ends with a pill/chip or inline action button, no trailing punctuation is used after that UI token.
- Ordinary prose-only board preview labels continue using the established trailing colon format.

### 1.1.5 UI Motion Convention for Layout Stability

- Interactive UI changes that can alter element height or cause nearby layout shifting must use smooth expand/collapse animation instead of abrupt jumps.
- This applies to hover/click/reveal interactions and mode/state toggles where additional lines or controls appear/disappear.
- Motion should be subtle and brief (for example 120-220ms easing) and should preserve readability during transition.
- Implementations must respect reduced-motion preferences and disable non-essential animation when `prefers-reduced-motion: reduce` is active.

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

- Next to participant names, UI must show a live activity indicator for each player and viewer.
- When a participant disconnects (including inactivity/session drop), others in the game must see their status change to `Disconnected`.
- When that participant reconnects on the same device identity:
  - Prior role is restored automatically.
  - Their board catches up to current live state.
  - If they are a player with pending turn/actions, they are prompted to act.

## 7. Move History Sidebar (Flow 5)

- Game page must show a sidebar/history panel listing turn history in order.
- The history panel must group moves beneath their parent turn.
- Users can click any move entry.
- Clicking an entry switches board from `Live view` to `History view` at post-move state for that entry.
- While user is in `History view`:
  - New moves continue appending to the history list in real time.
  - A clear visual indicator must state that user is not on live state.
  - A prominent `Return to live` action must be visible and restore `Live view`.

## 8. Home Page Game List and Public Entry (Flow 6)

On home page, users must see a game list in reverse chronological order by latest activity timestamp (latest move time; if no moves, creation time).

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
- Users must be able to start a new playground game while offline from the home page and play full turns locally.
- While offline, move validation and rule resolution must run fully on-device; no server round trip may be required to continue play.
- The app must persist offline playground game state locally (including move history) so a reload on the same device restores the game.
- If a local persistence write fails, the UI must show a non-dismissed warning that offline progress may be lost.
- Offline playground sessions are single-device only:
  - Invite creation/sharing must be disabled while offline.
  - Join-as-player/join-as-viewer actions for other devices must be unavailable while offline.
  - Presence indicators for remote participants must be hidden or replaced with an `Offline` state.
- The game board must show a clear `Offline` indicator whenever backend connectivity is unavailable.
- The web app shell and assets required for playground mode (HTML/CSS/JS/fonts/icons) must be cached for offline startup after at least one successful online load.
- When connectivity returns, the app may offer an explicit `Go online` action for that local playground game; this transition must require user confirmation and must not happen automatically mid-turn.
- Until user confirms `Go online`, the local offline game remains device-local and does not appear in public/home game lists.

### 12.2 Playground Move Preview Semantics

- Piece move previews in playground are split into:
  - legal destination actions (submittable)
  - blocked destination previews (non-submittable) for actions that fail only due to destination supply (`SUPPLY_DESTINATION_UNSUPPLIED`)
- The `/api/engine/playground/piece-moves` contract must expose:
  - `actions`: legal-only actions
  - `previewActions`: legal actions plus supply-blocked destination previews, each with a `legal` flag and optional `blockedReason`
- UI behavior:
  - legal previews render as normal ghost destinations
  - supply-blocked previews still render at the destination, but the ghost piece is crossed out to indicate illegality
  - target/action picking must use legal actions only; blocked previews are informational and must not be auto-selected as legal actions
- Playground board selection mode:
  - default (toggle off): users may only pick source cells that contain pieces and destination cells that have at least one legal action from the selected source
  - free-selection mode (toggle on): users may click arbitrary empty source/destination cells for inspection/manual experimentation

### 12.3 Playground Removal Feedback

- The `/api/engine/playground/apply` success contract may include `removedPieces`, a transient list of piece-removal notices for pieces removed as part of the accepted action resolution.
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

## 13. Notifications and Prompts

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
