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
  - `actionCommitted`.
  - `actionRejected` (with reason code).
  - `modeChanged` (`live`/`history`/`tutorial`).
  - `syncStatusChanged`.
  - `fatalError`.

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

When a recipient opens an invite link:

1. Recipient is taken to the game board.
2. Recipient sees `Join as player` and `Join as viewer` options.
3. After selecting one option:
   - Existing participants are notified that either a player joined or a viewer joined.
   - Default policy: joining as `Player` requires opposite-player approval unless the join is from a player-shared invite link.
4. If recipient joins as `Viewer`:
   - They can view board and updates but cannot take game actions.
   - They can share the invite link with additional participants.
   - They continue seeing `Join as player` while fewer than 2 player seats are filled.
   - Once both player seats are filled, `Join as player` is hidden for viewers.
5. If recipient joins as `Player`:
   - If the invite link was shared by a `Player`, recipient may join an eligible player seat without additional approval.
   - If the invite link was shared by a `Viewer`, player-seat assignment requires approval from the opposite player before join completes.
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

- Game page must show a sidebar/history panel listing all moves in order.
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
- Selecting a game from this list opens that game as `Viewer`.
- Opening from list alone must not auto-assign `Player 2` (or any player seat).
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
  - Invitees from viewer-shared links need opposite-player approval to join as `Player`.
  - Users entering from the home page list need opposite-player approval to join as `Player`.
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
