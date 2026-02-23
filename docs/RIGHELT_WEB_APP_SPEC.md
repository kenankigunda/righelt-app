# Righelt Web App Specification (v1)

Status: Normative source of truth for product and UX behavior of the web application.

This document defines application-level behavior around game creation, invites, joining, live updates, presence, history viewing, lobby listing, preview board, and onboarding tutorial.
If implementation behavior conflicts with this spec, this spec wins.

## 1. Core Concepts

- `Game`: A single Righelt match and its associated participants and move history.
- `Participant roles`:
  - `Player 1`
  - `Player 2`
  - `Viewer`
- `Invite link`: Shareable URL that opens a specific game and enables join decisions.
- `Live view`: Current board state with all real-time updates applied.
- `History view`: Snapshot of board state immediately after a selected move index.
- `Connected status`:
  - `Connected`: Client currently active on the game.
  - `Disconnected`: Client not currently active.

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
4. If recipient joins as `Viewer`:
   - They can view board and updates but cannot take game actions.
   - They continue seeing `Join as player` while fewer than 2 player seats are filled.
   - Once both player seats are filled, `Join as player` is hidden for viewers.
5. If recipient joins as `Player`:
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
- A viewer may request to take an eligible player seat only when:
  - Seat is empty, or
  - Existing seat holder has been inactive for more than 5 minutes.
- Such a takeover request must be approved by the opposite active player before assignment.

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
  - Can request/join as player only under Section 4 or Section 8 constraints.

## 12. Notifications and Prompts

- Prompt text/content may vary, but these state prompts are required:
  - Opponent/viewer joined.
  - Your turn.
  - Waiting for opponent turn.
  - Viewing history (not live).
  - Participant connected/disconnected.

## 13. Out of Scope (v1)

- Matchmaking/ranked queue.
- Chat/voice.
- Payments/monetization.
- Mobile native apps.
