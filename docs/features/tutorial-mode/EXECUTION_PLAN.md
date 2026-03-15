# Tutorial Mode Execution Plan

## Summary

Implement tutorial mode as a board-isolated learning system with two presentations:

- `fullscreen`: used for first-time tutorial runs and all narrow screens
- `compact`: used for manual restart on wide game screens as a right-side resizable flyout

The tutorial flow uses seven one-word steps:

1. `Move`
2. `Project`
3. `Rush`
4. `Pass`
5. `Push`
6. `History`
7. `Invite`

Tutorial progress must persist locally and survive reloads. Reloading should restore the active tutorial session, including the current step, tutorial-local board state, tutorial-local history state, and compact/fullscreen presentation when possible.

## Architecture

### Session Model

Replace the placeholder tutorial controller with a tutorial session model that tracks:

- `runReason`
- `returnRoute`
- `stepIndex`
- `status`
- `isReplayMode`
- `presentation`
- `compactView`
- `compactWidth`
- `completedStepIds`
- `stepStateById`
- `activeBoardSnapshot`
- `tutorialHistory`

Persist the active session to local storage after every meaningful change:

- session start
- step jump
- accepted board action
- history selection / return-live action
- shell-step completion
- presentation change
- compact width change

Do not persist transient timers. Hint/skip timers restart when a saved step is restored.

### Presentation Rules

- First required run always starts in `fullscreen`.
- Manual restart starts in `compact` only from wide game routes (`>= 1280px`).
- Manual restart falls back to `fullscreen` on smaller screens or non-game routes.
- If a saved compact session is restored on a narrow screen, reopen it in `fullscreen` while preserving progress.
- Completing or explicitly closing a tutorial clears the active in-progress session.

### Fullscreen And Compact UI

Both presentations use the same seven-step tutorial model.

`fullscreen`:

- dedicated tutorial surface
- top progress bar
- tutorial board and step content in the main viewport

`compact`:

- fixed right-side flyout over the live game page
- default width `480px`
- min width `360px`
- max width `760px`
- custom pointer-drag resize handle on the left edge
- width persisted locally
- two subviews:
  - `overview`: card gallery
  - `stage`: selected tutorial step shown in full flyout space

### Progress Bar

Add a top progress bar with all seven step titles:

- `Move`
- `Project`
- `Rush`
- `Pass`
- `Push`
- `History`
- `Invite`

States:

- `complete`
- `current`
- `upcoming`

Behavior:

- first run: read-only
- replay mode: interactive, user may jump to any step

Jumping to a step must restore that step's canonical tutorial state immediately. It must not depend on earlier steps having been completed in the current run.

### Compact Overview Cards

Compact replay opens to an overview grid with seven cards.

- `Move`, `Project`, `Rush`, `Pass`, and `Push` use mini-board animations.
- `History` and `Invite` use static shell cards.

Layout rules:

- one column below `540px`
- two columns at `540px` and above
- cards fill left-to-right, then wrap

Clicking any card:

- switches from `overview` to `stage`
- jumps the tutorial session to that step
- restores that step's canonical tutorial state

### Tutorial Isolation

Add a dedicated tutorial board host that reuses the existing board runtime but never mutates:

- live transport cache
- live game history
- presence
- invites
- participant state

Tutorial data should be driven by a tutorial scenario manifest. Each step entry must include:

- `id`
- `title`
- `kind`
- `sourceType`
- `sourceId`
- `initialSnapshot`
- `completionRule`
- `hint`
- `cardPresentation`

## Scenario Sources

### Move

Source: verified legal state from fixture `M-002`.

Position:

- `C1` at `(3,6)`
- `C2` at `(6,3)`
- `U1a` at `(5,3)`

Tutorial action:

- select `C1`
- move to `(3,5)`

Why this is the tutorial source:

- current legal action generation accepts it
- it cleanly demonstrates commander movement
- the board is sparse and easy to read

### Project

Source: verified legal state from fixture `M-002`.

Position:

- `C1` at `(3,6)`
- `C2` at `(6,3)`
- `U1a` at `(5,3)`

Tutorial action:

- select `U1a`
- project to `(5,5)`

Why this is the tutorial source:

- current legal action generation accepts it
- it clearly demonstrates a two-square orthogonal creation pattern
- source and destination are easy to highlight

### Rush

Source: `TODO` new tutorial fixture.

Required board shape:

- non-continuation state
- one clearly legal opening rush
- visible nearby enemy contact explaining why the rush is legal
- at least one obvious rush follow-up after the opening rush resolves

Reason for TODO:

- existing fixture `M-009` starts mid-continuation, so it is useful reference for `Pass` but not a clean first-teach rush position

### Pass

Source: verified legal state from fixture `M-009`.

Position:

- `C1` at `(3,6)`
- `U1-1` at `(5,6)`
- `U1-2` at `(4,5)`
- `U1-3` at `(3,4)`
- `U1-4` at `(7,6)`
- `C2` at `(5,5)`
- `U2-1` at `(5,4)`
- rush continuation active for `P1`

Tutorial action:

- use `Pass` to end the rush chain

Why this is the tutorial source:

- current legal action generation includes `pass`
- it demonstrates that `Pass` is a tactical choice during continuation, not only an empty turn action

### Push

Source: verified legal state from fixture `M-008`.

Position:

- `C1` at `(3,6)`
- `U1-1` at `(5,6)`
- `U1-2` at `(5,4)`
- `U1-3` at `(3,4)`
- `C2` at `(6,4)`
- `U2-1` at `(6,5)`

Tutorial action:

- push from `C2 (6,4)` to `(5,4)`

Why this is the tutorial source:

- current legal action generation accepts the push
- it clearly shows orthogonal contact and stronger local support for the attacker

### History

Source: `TODO` new tutorial replay fixture, or repair/replace stale replay fixtures first.

Required board shape:

- short, fully legal scripted sequence
- three to four visible history entries
- board changes that are easy to inspect when moving between history and live tutorial state

Reason for TODO:

- existing replay-oriented fixtures `M-004` and `M-005` do not currently replay cleanly against generated legal actions, so they are not safe tutorial/test sources without repair

### Invite

Source: `TODO` tutorial shell fixture.

Required state:

- stable non-terminal board snapshot
- tutorial-only participant metadata
- tutorial-only invite metadata
- shell state that can demonstrate invite sharing without touching real invite generation

Suggested board base:

- reuse a verified non-terminal board such as `M-002` or `M-008`
- pair it with dedicated tutorial shell metadata

Reason for TODO:

- current engine fixtures only describe board state, not shell invite context

## Serial Implementation Order

1. Add tutorial session persistence helpers and storage schema.
2. Replace the current tutorial controller with a serializable session API.
3. Add the tutorial scenario manifest with the seven steps above.
4. Build the tutorial board host so it can load and restore tutorial-local state without touching live transport data.
5. Replace the current fullscreen placeholder tutorial with the real fullscreen flow and progress bar.
6. Add compact flyout rendering, overview cards, resize handling, and width persistence.
7. Add mini-card board animations for `Move`, `Project`, `Rush`, `Pass`, and `Push`.
8. Add route/bootstrap restore logic so saved tutorial sessions survive reloads.
9. Add fixture-validation tests for every fixture-backed tutorial action.
10. Add missing tutorial-specific fixtures:
   - `TODO`: rush-entry fixture
   - `TODO`: replay/history fixture
   - `TODO`: invite-shell fixture

## Validation

Required automated validation:

- `pnpm typecheck`
- `pnpm test:web`
- targeted tutorial controller / persistence tests
- targeted tutorial host restore tests
- targeted fixture-legality guard tests

Required scenario guard tests:

- `Move` action remains legal from `M-002`
- `Project` action remains legal from `M-002`
- `Pass` remains legal from `M-009`
- `Push` remains legal from `M-008`

Required behavior tests:

- first-run tutorial opens in fullscreen
- manual restart opens compact on wide game routes
- tutorial progress restores after reload
- compact flyout width restores after reload
- compact restore falls back to fullscreen on narrow screens
- overview cards render in one or two columns based on flyout width
- clicking a card opens that step in full flyout stage view
- tutorial actions never mutate live transport or real invite state

TODO-backed tests to add after new fixtures land:

- rush-entry tutorial stage
- history tutorial stage
- invite tutorial stage

## Assumptions And TODOs

- Tutorial completion state and in-progress tutorial session state are separate local-storage keys.
- In-progress tutorial state must survive reloads within the same local device state.
- Hint/skip timers restart on reload; semantic progress does not.
- `Rush`, `History`, and `Invite` still need dedicated tutorial fixtures rather than guessed board states.
- Existing replay fixtures `M-004` and `M-005` should not be used directly for tutorial playback until repaired.
