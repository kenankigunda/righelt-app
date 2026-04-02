# Shell Portability

The shell is intended to stay reusable while the game-specific implementation is swapped underneath it. This document describes the current seams and what must be replaced to run a different game on the same shell.

## Generic Shell Responsibilities

- Route handling, panels, flyouts, invite UX, history navigation, notifications, and participant orchestration live in the shell.
- The shell expects a board adapter for board-facing behavior and a scenario adapter for scenario/export engine glue.
- Live transport and server authority coordinate game creation, move submission, history mode, invites, and self-play seat ownership.

## Game-Specific Integration Surfaces

### Engine Board Adapter

- Renders the board state into DOM cells and overlays.
- Owns piece lookup, selection transitions, and selected-piece summaries.
- Translates shell/runtime interaction requests into game-specific board behavior.

### Engine Scenario Adapter

- Computes scenario hashes and any scenario-specific normalization/stabilization needed for exported game states.
- Keeps scenario/export engine coupling out of shell modules and out of the board adapter contract.

### Engine And State Shape

- The shell currently assumes a turn-based state with:
  - `board.state`
  - `sideToMove`
  - `turnIndex`
  - `pieces`
  - optional `continuation`
  - `outcome`
- Move history assumes actions can be recorded with notation, a pre-action snapshot, and a post-action snapshot.
- Notifications and participant roles assume two player seats plus viewers.

### Live Authority

- The server/game authority must support:
  - create game
  - create from scenario/history branch
  - join as viewer or player
  - self-play promotion
  - apply action
  - end turn
  - history mode
  - invite resolution
  - websocket state sync

## Replacement Checklist For A Different Game

- Replace the engine board adapter with a game-specific board adapter implementation.
- Replace the engine scenario adapter with a scenario adapter that knows how to hash and normalize that game's state.
- Replace engine move validation, action application, and notation generation behind the live transport / authority flows.
- Revisit shell assumptions about seats, turn order, history entries, and continuation phases if the new game differs.
- Revisit UI copy that currently assumes two-player seat labels and the existing action model.

## Current Coupling To Be Aware Of

- The shell is still tailored to a two-seat turn-based game model.
- Board runtime and optimistic live flows assume action legality, snapshots, and turn handoff semantics similar to Righelt.
- Scenario tooling is isolated behind the scenario adapter, but the surrounding UX still assumes scenario records look like Righelt scenario exports.
- A very different game may need additional abstraction work in transport, history presentation, and participant semantics before the shell is fully reusable.
