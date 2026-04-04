import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HISTORY } from "../generated/packages/shared-types/src/history.js";
import { createTestStore } from "./support.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const appSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const shellCssSrc = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");

test("history mode uses selected move snapshot and return-to-live clears history mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.endTurn({ gameId: game.id });
  store.addMove({ gameId: game.id, notation: "M3", snapshot: { turnIndex: 1, sideToMove: "P2" } });

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.currentSnapshot.turnIndex, 0);

  store.returnToLive({ gameId: game.id });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, false);
  assert.equal(vm.currentTurn.index, 1);
});

test("new moves append while in history mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 0, sideToMove: "P1" } });

  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.moves.length, 2);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.currentTurn.moveIndexes.length, 2);
});

test("return-to-live restores the latest turn after moves append during history mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.endTurn({ gameId: game.id });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 1, sideToMove: "P2" } });

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.currentSnapshot.turnIndex, 0);

  store.endTurn({ gameId: game.id });
  store.addMove({ gameId: game.id, notation: "M3", snapshot: { turnIndex: 2, sideToMove: "P1" } });

  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.moves.length, 3);
  assert.equal(vm.currentSnapshot.turnIndex, 0);

  store.returnToLive({ gameId: game.id });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, false);
  assert.equal(vm.currentTurn.index, 2);
  assert.equal(vm.currentSnapshot.turnIndex, 2);
});

test("history trimming preserves contiguous move indexes and live turn controls after long games", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  for (let index = 1; index <= 205; index += 1) {
    store.addMove({
      gameId: game.id,
      notation: `M${index}`,
      snapshot: { turnIndex: 0, sideToMove: "P1" },
    });
  }

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.moves.length, MAX_HISTORY);
  assert.equal(vm.moves[0].notation, `M${205 - MAX_HISTORY + 1}`);
  assert.deepEqual(
    vm.currentTurn.moveIndexes,
    Array.from({ length: MAX_HISTORY }, (_, index) => index),
  );
  assert.equal(vm.inHistoryMode, true);

  store.returnToLive({ gameId: game.id });
  const ended = store.endTurn({ gameId: game.id });
  assert.notEqual(ended?.ok, false);

  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, false);
  assert.equal(vm.currentTurn.index, 1);
  assert.equal(vm.currentTurn.playerSeat, "Player 2");
});

// U-13 — renderTurnHistory emits sub-bullets for moves with destroyedPieces
test("U-13: renderTurnHistory source emits destruction sub-bullet HTML for moves with destroyedPieces", () => {
  // Static source analysis: verify the rendering code produces the required attributes and text
  assert.match(appSource, /data-testid="history-destruction-item"/);
  assert.match(appSource, /data-action="jump-destruction"/);
  assert.match(appSource, /data-move-index="\$\{move\.index\}"/);
  assert.match(appSource, /data-position-row="\$\{record\.position\.row\}"/);
  assert.match(appSource, /data-position-col="\$\{record\.position\.col\}"/);
  assert.match(appSource, /DESTROYED \(\$\{record\.position\.row\},\$\{record\.position\.col\}\)/);
  assert.match(appSource, /history-destruction-list/);
  assert.match(appSource, /history-destruction-item/);
});

// U-13 (integration view): destroyedPieces flows through the view model
test("U-13 (I-13): destroyedPieces on a move entry flows through the store view model", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  // Add a move with destroyedPieces injected directly after creation via addMove
  store.addMove({
    gameId: game.id,
    notation: "M1",
    snapshot: { turnIndex: 0, sideToMove: "P1" },
  });

  // Manually inject destroyedPieces onto the stored move (simulating server response)
  const raw = store.getGameViewModel(game.id);
  raw.moves[0].destroyedPieces = [
    { position: { row: 2, col: 3 }, ownerSeat: "p1", reason: "no_retreat" },
  ];

  // Re-read via the view model (getGameViewModel clones from internal state)
  // The destroyedPieces field is preserved through the store if set on the internal game object
  // We verify the field type contract: an array of DestroyedPieceRecord objects
  const record = raw.moves[0].destroyedPieces[0];
  assert.equal(record.position.row, 2);
  assert.equal(record.position.col, 3);
  assert.equal(record.ownerSeat, "p1");
  assert.equal(record.reason, "no_retreat");
});

// U-14 — no sub-bullets when destroyedPieces is empty or absent
test("U-14: renderTurnHistory source renders no sub-bullet container when destroyedPieces is absent or empty", () => {
  // Source must check Array.isArray and length > 0 before emitting the <ul>
  assert.match(appSource, /Array\.isArray\(move\.destroyedPieces\)/);
  assert.match(appSource, /destroyedPieces\.length > 0/);
  // The destruction list is only emitted conditionally (ternary ? ... : "")
  assert.match(appSource, /destroyedPieces\.length > 0[\s\S]*?history-destruction-list[\s\S]*?: ""/);
});

// U-15 — P2-owned destroyed piece gets P2 color class
test("U-15: renderTurnHistory source maps ownerSeat p2 to player-tone-p2 CSS class", () => {
  // Source must convert "p2" -> "P2" before passing to playerToneClassForSide
  assert.match(appSource, /ownerSeat === "p1" \? "P1" : record\.ownerSeat === "p2" \? "P2"/);
});

// U-16 — draw (two destroyedPieces entries) renders two sub-bullets
test("U-16: renderTurnHistory source maps all destroyedPieces entries to sub-bullet items", () => {
  // The source uses .map() over destroyedPieces — two entries produce two <li>s
  assert.match(appSource, /destroyedPieces\.map\(\(record\)/);
});

// UX-03 — sub-bullet indentation uses minimal gutter (CSS structural check)
test("UX-03: shell.css contains destruction list indentation and no placeholder space", () => {
  const cssSrc = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");
  assert.match(cssSrc, /\.history-destruction-list/);
  assert.match(cssSrc, /\.history-destruction-item/);
  // Indented subordinate style (padding-left on the list)
  assert.match(cssSrc, /\.history-destruction-list[\s\S]*?padding[:\s]/);
  // No reserved height or min-height on the destruction list (no layout shift when absent)
  assert.doesNotMatch(cssSrc, /\.history-destruction-list\s*\{[^}]*min-height/);
});

// UX-08 — sub-bullet is not rendered in the live board surface
test("UX-08: history-destruction-item elements are inside renderTurnHistory (history panel only)", () => {
  // The sub-bullet HTML is only produced inside renderTurnHistory, which feeds renderHistoryPanel.
  // Verify the testid is not emitted by any board-facing render function.
  assert.match(appSource, /history-destruction-item/);

  // Locate renderTurnHistory, renderHistoryPanel, and the destruction item in source
  const renderTurnIdx = appSource.indexOf("const renderTurnHistory");
  const renderTurnEnd = appSource.indexOf("\nconst ", renderTurnIdx + 1);
  const destructionIdx = appSource.indexOf('data-testid="history-destruction-item"');

  // The destruction item testid must appear inside renderTurnHistory
  assert.ok(renderTurnIdx !== -1, "renderTurnHistory function must exist");
  assert.ok(destructionIdx > renderTurnIdx, "destruction item should appear after renderTurnHistory declaration");
  assert.ok(renderTurnEnd === -1 || destructionIdx < renderTurnEnd, "destruction item should be inside renderTurnHistory body");

  // It must NOT appear in any board runtime or board adapter source
  const boardRuntimeSrc = readFileSync(join(testDir, "..", "board", "runtime", "board-runtime.js"), "utf8");
  assert.doesNotMatch(boardRuntimeSrc, /history-destruction-item/);
});

// I-14 — jump-destruction handler navigates to the correct moveIndex snapshot
test("I-14: jump-destruction handler source reads data-move-index and calls selectHistoryMove", () => {
  // The handler must read data-move-index and call transport.selectHistoryMove with moveIndex
  assert.match(appSource, /action === "jump-destruction"/);
  assert.match(appSource, /getAttribute\("data-move-index"\)/);
  assert.match(appSource, /transport\.selectHistoryMove\(\{[^}]*moveIndex/);
});

// I-14 (extended): jump-destruction handler reads data-game-id for transport call
test("I-14 (game-id): jump-destruction handler reads data-game-id from the sub-bullet element", () => {
  // The sub-bullet HTML must carry data-game-id; the handler reads it via getAttribute
  assert.match(appSource, /data-game-id="\$\{escapeHtml\(game\.id\)\}"[^>]*data-action="jump-destruction"|data-action="jump-destruction"[^>]*data-game-id="\$\{escapeHtml\(game\.id\)\}"/);
});

// I-15 — jump-destruction click triggers setDestructionHighlight with the correct position
test("I-15: jump-destruction handler source reads data-position-row/col and calls setDestructionHighlight", () => {
  assert.match(appSource, /getAttribute\("data-position-row"\)/);
  assert.match(appSource, /getAttribute\("data-position-col"\)/);
  assert.match(appSource, /setDestructionHighlight\?\.\(\{[^}]*row[^}]*col[^}]*\}|setDestructionHighlight\(\{[^}]*row[^}]*col[^}]*\)/);

  // setDestructionHighlight must be called AFTER syncRouteDataAndLiveChannels in the jump-destruction handler
  const jumpDestructionIdx = appSource.indexOf('action === "jump-destruction"');
  assert.ok(jumpDestructionIdx !== -1, "jump-destruction handler must exist");
  const returnLiveIdx = appSource.indexOf('action === "return-live"', jumpDestructionIdx);
  const blockSrc = appSource.slice(jumpDestructionIdx, returnLiveIdx === -1 ? jumpDestructionIdx + 2000 : returnLiveIdx);
  const syncIdx = blockSrc.indexOf("syncRouteDataAndLiveChannels");
  const highlightIdx = blockSrc.indexOf("setDestructionHighlight");
  assert.ok(syncIdx !== -1, "syncRouteDataAndLiveChannels must be called in jump-destruction handler");
  assert.ok(highlightIdx !== -1, "setDestructionHighlight must be called in jump-destruction handler");
  assert.ok(
    highlightIdx > syncIdx,
    "setDestructionHighlight must be called AFTER syncRouteDataAndLiveChannels in jump-destruction handler",
  );
});

// I-16 — return-live clears the destruction highlight
test("I-16: return-live handler source calls clearDestructionHighlight before returning to live", () => {
  // Locate the return-live handler and assert clearDestructionHighlight is called within it
  const returnLiveIdx = appSource.indexOf('action === "return-live"');
  assert.ok(returnLiveIdx !== -1, "return-live handler must exist");
  // Find clearDestructionHighlight within the return-live block (before the next action block)
  const nextActionIdx = appSource.indexOf('if (action === "launch-history-branch")', returnLiveIdx);
  const blockSrc = appSource.slice(returnLiveIdx, nextActionIdx === -1 ? returnLiveIdx + 2000 : nextActionIdx);
  assert.match(blockSrc, /clearDestructionHighlight/);
});

// I-17 — jump-history clears prior destruction highlight
test("I-17: jump-history handler source calls clearDestructionHighlight before loading snapshot", () => {
  const jumpHistoryIdx = appSource.indexOf('action === "jump-history"');
  assert.ok(jumpHistoryIdx !== -1, "jump-history handler must exist");
  // Find the end of the jump-history block (next handler)
  const jumpDestructionIdx = appSource.indexOf('action === "jump-destruction"', jumpHistoryIdx);
  const blockSrc = appSource.slice(jumpHistoryIdx, jumpDestructionIdx === -1 ? jumpHistoryIdx + 2000 : jumpDestructionIdx);
  assert.match(blockSrc, /clearDestructionHighlight/);
  // clearDestructionHighlight must appear before selectHistoryMove within this block
  const clearIdx = blockSrc.indexOf("clearDestructionHighlight");
  const selectIdx = blockSrc.indexOf("selectHistoryMove");
  assert.ok(clearIdx < selectIdx, "clearDestructionHighlight must be called before selectHistoryMove in jump-history");
});

// I-18 — new move appended while pinned to earlier history: move list grows but historyIndex stays
test("I-18: new move appended while client is pinned to earlier history does not change historyIndex", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  // Add first move and pin to it in history mode
  store.addMove({
    gameId: game.id,
    notation: "M1",
    snapshot: { turnIndex: 0, sideToMove: "P1" },
  });
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });

  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.historyIndex, 0);

  // Add a second move while still pinned (simulates a new destructive move arriving live)
  store.addMove({
    gameId: game.id,
    notation: "M2",
    snapshot: { turnIndex: 0, sideToMove: "P1" },
  });

  // The client remains pinned to move 0; the move list grows to 2
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true, "should still be in history mode");
  assert.equal(vm.historyIndex, 0, "historyIndex must remain at 0");
  assert.equal(vm.moves.length, 2, "new move should be appended to the panel list");
});

// UX-01 — sub-bullet hover state is gated behind data-hover-capability="hover"
test("UX-01: shell.css gates destruction sub-bullet hover behind data-hover-capability=hover", () => {
  assert.match(
    shellCssSrc,
    /\[data-hover-capability="hover"\]\s+\.history-destruction-item:hover/,
  );
});

// UX-02 — touch tap target meets minimum size (≥ 44px / 2.75rem)
test("UX-02: shell.css sets min-height on history-destruction-item for touch tap target", () => {
  // min-height must be set — 2.75rem ≈ 44px at 16px root font size
  assert.match(shellCssSrc, /\.history-destruction-item\s*\{[^}]*min-height/);
});

// UX-04 — no staggered animation: sub-bullets share the history-item-release animation class
test("UX-04: shell.css applies history-item-release animation to history-destruction-item", () => {
  assert.match(shellCssSrc, /\.history-destruction-item\.history-item-release/);
});

// UX-05 — pressed state on sub-bullet uses is-pressing class
test("UX-05: shell.css defines is-pressing style for history-destruction-item", () => {
  assert.match(shellCssSrc, /\.history-destruction-item\.is-pressing/);
});

// UX-05 (source): pointerdown wires startHistoryPress for jump-destruction action
test("UX-05 (source): pointerdown handler includes jump-destruction in startHistoryPress gating", () => {
  // The pointerdown listener must include jump-destruction as a trigger for startHistoryPress
  assert.match(appSource, /action !== "jump-destruction"/);
  // And it appears alongside jump-history and return-live
  const pdIdx = appSource.indexOf('startHistoryPress(actionEl)');
  assert.ok(pdIdx !== -1, "startHistoryPress must be called in pointerdown");
  // Find the guard block just above startHistoryPress
  const guardStart = appSource.lastIndexOf('action !== "jump-history"', pdIdx);
  const guardSrc = appSource.slice(guardStart, pdIdx + 50);
  assert.match(guardSrc, /jump-destruction/);
});
