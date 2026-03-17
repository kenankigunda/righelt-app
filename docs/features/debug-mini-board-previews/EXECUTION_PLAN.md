# Debug Mini-Board Previews Execution Plan

## Summary

Add a shared mini-board preview system for shell surfaces that need to render an existing board snapshot in a compact, non-interactive form.

First shipping targets:

- debug flyout scenario panel: show a mini board directly below the selected scenario description
- home page Active Games section: replace the current simple game list with compact cards that include a mini-board preview of each game's current state

This work should reuse the existing board adapter/rendering path instead of introducing a second board renderer.

## Goal And Success Criteria

Goal:
Create one reusable preview architecture that can render the current Righelt board snapshot in multiple shell surfaces without depending on the full interactive board runtime.

Success criteria:

- Selecting a scenario in debug mode updates the description area to include a mini board for that scenario
- Active Games on the home page renders one mini board per game card using the game's current snapshot
- Mini boards are non-interactive, non-focusable, and visually distinct from the main board
- The main game board behavior remains unchanged
- The preview system supports multiple simultaneous boards on the same page without leaking adapter instances
- Preview rendering survives normal shell rerenders and incremental game-shell updates

## Architecture

### Shared preview primitive

Introduce a dedicated mini-board preview module in the web board layer.

Responsibilities:

- create one board adapter instance per mounted preview
- mount the adapter into a supplied DOM root
- render from a plain `snapshot`
- use empty selection, no legal actions, and `overlay.mode = "none"`
- expose `update(snapshot, key)` and `destroy()` semantics for shell hydration/reconciliation

Recommended shape:

- `createMiniBoardPreview({ rootEl, snapshot, previewKey, labelEl?, sizeVariant? })`
- `syncMiniBoardPreviews({ previews, registry, createAdapter })`

The preview layer should not depend on `createBoardRuntime()` or any transport/host API because previews never submit actions or request legal moves.

### Board adapter support

Extend the board adapter path so it can render a static board cleanly.

Recommended contract addition:

- optional `interactionMode: "interactive" | "static"` or `readOnly: true` on `mount()` and/or `render()`

Static mode requirements:

- no click listeners
- no hover listeners
- no tabbable cells
- no pointer affordance styles
- render output remains visually consistent with the main board

This should be implemented in the adapter rather than by layering CSS hacks over interactive buttons.

### Shell hydration and lifecycle

The shell currently renders HTML strings, so mini boards must be mounted after DOM updates.

Add a shell-side preview registry that:

- scans for `[data-mini-board-preview]` roots after each render
- mounts previews for new roots
- updates existing previews when their `previewKey` changes
- destroys previews whose roots disappeared

Call this reconciliation after:

- full `render()` updates
- incremental shell updates that patch the debug flyout or home page

This avoids leaking adapter instances when the selected scenario changes or when Active Games rerenders.

## Product Decisions Captured Here

- Active Games becomes a compact card list, not a plain ordered text list
- Mini boards are static and do not show overlays or legal move affordances
- Mini boards include a small supporting status label near the board
- Scenario previews should use `resultingState` when available, with fallback to `initialState`
- This work is additive to the existing top-of-page home preview-board requirement in the web app spec, not a replacement for it

## Implementation Plan

### 1. Add the shared mini-board preview module

Target files:

- `apps/web/board-adapters/engine-playground-adapter.js`
- `apps/web/board-adapter-contract.js`
- new module under `apps/web/board/` for mini-board lifecycle and rendering

Changes:

- add static/read-only rendering support to the adapter contract
- update the engine playground adapter so static mode uses non-interactive cells
- add a reusable preview helper that mounts, renders, updates, and destroys a compact board preview

### 2. Wire scenario previews into debug mode

Target files:

- `apps/web/shell/app.js`
- `apps/web/shell/shell.css`

Changes:

- update `renderScenarioPanel()` to emit a preview root under the selected scenario description
- add a scenario status row showing move count and expected outcome alongside or below the mini board
- ensure scenario preview hydration runs after debug flyout rerenders

Snapshot source:

- `selectedScenario.resultingState ?? selectedScenario.initialState`

### 3. Convert Active Games to preview cards

Target files:

- `apps/web/shell/app.js`
- `apps/web/shell/shell.css`

Changes:

- replace the ordered list in `renderHome()` with compact cards
- each card should include:
  - game link/id
  - latest activity timestamp
  - role/status metadata
  - mini-board root
  - small status label such as side to move or history/live state

Snapshot source:

- `game.currentSnapshot ?? game.board?.state ?? null`

### 4. Add mini-board styling

Target files:

- `apps/web/shell/shell.css`
- possibly `apps/web/styles.css` if shared board primitives need preview-specific hooks

Changes:

- add a preview-specific wrapper class and compact sizing rules
- keep the main board styles unchanged
- ensure mini boards fit inside the debug flyout width
- ensure Active Games cards stack cleanly on narrow screens

### 5. Reconcile preview instances during rerender

Target files:

- `apps/web/shell/app.js`

Changes:

- maintain a registry keyed by DOM root or stable preview id
- generate stable preview ids for:
  - scenario preview: selected scenario id
  - home cards: game id
- use a stable snapshot key so unchanged previews do not rerender unnecessarily

## Testing Plan

### Adapter tests

Add or extend tests to cover:

- adapter accepts static/read-only mount or render mode
- static mode cells are not interactive or focusable
- interactive mode remains unchanged

Likely files:

- `apps/web/test/board-adapter-contract.test.mjs`
- a new or existing adapter-focused web test

### Shell rendering tests

Add or extend tests to cover:

- debug scenario panel markup includes a mini-board preview root
- Active Games renders card markup with one preview root per game
- render path contains preview reconciliation hooks

Likely files:

- `apps/web/test/shell-render-stability.test.mjs`
- a new shell rendering/unit test if regex coverage becomes too brittle

### Runtime/DOM tests

Add tests for:

- mounting multiple previews at once
- updating the scenario preview when the selected scenario changes
- destroying preview instances when their roots disappear

### Validation commands

- `pnpm test:web`
- `pnpm typecheck`

## Risks And Notes

- The current app uses a singleton board adapter for the main board. Mini boards must not reuse that same adapter instance because multiple previews may exist simultaneously.
- The current shell uses string-based rendering. Preview hydration must happen after DOM writes, or the mini boards will disappear on rerender.
- If preview-specific styling is added by altering shared board selectors, verify the full-size board remains unchanged.
- Keep this implementation shell-owned and snapshot-driven. Do not make preview rendering depend on legal-action fetching or transport state transitions.
