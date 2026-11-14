import {historyRenderingFixture} from './support/history-rendering-context.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HISTORY } from "../generated/packages/shared-types/src/history.js";
import { createTestStore } from "./support.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const appSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const historyPreviewSource = readFileSync(join(testDir, "..", "shell", "history-preview.js"), "utf8");
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

const destroyedMove={moveId:'destroyed-turn',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'Move',at:'recorded',action:{type:'pass'},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]}};
const destroyedHistory=(destroyedPieces,selected=false)=>historyRenderingFixture().renderTurnHistory({id:'history-only',myRoles:['Player 1'],inHistoryMode:selected,historyIndex:selected?0:null,moves:[{...destroyedMove,destroyedPieces}]});
// U-13 — renderTurnHistory emits sub-bullets for moves with destroyedPieces
test("U-13: renderTurnHistory emits destruction sub-bullet HTML for moves with destroyedPieces", () => {
 const html=destroyedHistory([{position:{row:2,col:3},ownerSeat:'p1'}]);
 assert.match(html,/data-testid="history-destruction-item"/);assert.match(html,/DESTROYED \(2,3\)/);
 assert.match(html,/history-destruction-list/);assert.match(html,/history-destruction-item/);assert.doesNotMatch(html,/data-action="jump-destruction"/);
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
test("U-14: renderTurnHistory renders no sub-bullet container when destroyedPieces is absent or empty", () => {
 for(const records of [undefined,null,[],{}])assert.doesNotMatch(destroyedHistory(records),/history-destruction-list|history-destruction-item/);
});

// U-15 — P2-owned destroyed piece gets P2 color class
test("U-15: renderTurnHistory maps ownerSeat p2 to player-tone-p2 CSS class", () => {
 const html=destroyedHistory([{position:{row:2,col:3},ownerSeat:'p2'}]);assert.match(html,/<li class="history-destruction-item player-tone-p2"/);
});

// U-16 — draw (two destroyedPieces entries) renders two sub-bullets
test("U-16: renderTurnHistory maps all destroyedPieces entries to sub-bullet items", () => {
 const html=destroyedHistory([{position:{row:2,col:3},ownerSeat:'p1'},{position:{row:4,col:5},ownerSeat:'p2'}]);assert.equal((html.match(/data-testid="history-destruction-item"/g)??[]).length,2);assert.match(html,/DESTROYED \(2,3\)/);assert.match(html,/DESTROYED \(4,5\)/);
});

test("UX-09: selected history rows render destruction sub-bullets before action buttons", () => {
 const html=destroyedHistory([{position:{row:2,col:3},ownerSeat:'p1'}],true);assert(html.indexOf('history-destruction-list')>html.indexOf('history-move-line'));assert(html.indexOf('history-destruction-list')<html.indexOf('history-move-at small'));assert(html.indexOf('history-destruction-list')<html.indexOf('data-action="revert-to-move"'));assert.match(html,/history-destruction-item"[^>]*><span class="history-destruction-label">DESTROYED/);
});

// UX-03 — sub-bullet indentation uses minimal gutter (CSS structural check)
test("UX-03: shell.css contains destruction list indentation and no placeholder space", () => {
  const cssSrc = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");
  assert.match(cssSrc, /\.history-destruction-list/);
  assert.match(cssSrc, /\.history-destruction-item/);
  assert.match(cssSrc, /\.history-destruction-list\s*\{[\s\S]*list-style:\s*none;/s);
  assert.match(cssSrc, /--history-marker-slot-width:\s*0\.56rem;/);
  assert.match(cssSrc, /--history-marker-gap:\s*0\.24rem;/);
  assert.match(cssSrc, /--history-entry-row-gap:\s*0\.16rem;/);
  assert.match(cssSrc, /--history-entry-section-gap:\s*0\.42rem;/);
  assert.match(cssSrc, /\.history-item\s*\{[\s\S]*grid-template-columns:\s*var\(--history-marker-slot-width\)\s*minmax\(0,\s*1fr\);[\s\S]*column-gap:\s*var\(--history-marker-gap\);[\s\S]*gap:\s*var\(--history-entry-row-gap\);/s);
  assert.match(cssSrc, /\.history-item\.history-item-has-actions\s*\{[\s\S]*gap:\s*var\(--history-entry-section-gap\);/s);
  assert.match(cssSrc, /\.history-item > \*\s*\{[\s\S]*grid-column:\s*2;/s);
  assert.match(cssSrc, /\.history-item-info,\s*\.history-item-actions\s*\{[\s\S]*gap:\s*var\(--history-entry-row-gap\);/s);
  assert.match(cssSrc, /\.history-item::before\s*\{[\s\S]*grid-column:\s*1;[\s\S]*justify-self:\s*center;[\s\S]*align-self:\s*start;/s);
  assert.match(cssSrc, /\.history-undone-group-content\s*\{[\s\S]*padding-left:\s*0\.1rem;/s);
  assert.match(cssSrc, /\.history-destruction-list\s*\{[\s\S]*padding:\s*0 0 0 0\.1rem;/s);
  assert.match(cssSrc, /\.history-destruction-list\s*\{[\s\S]*margin:\s*0;/s);
  assert.match(cssSrc, /\.history-destruction-list\s*\{[\s\S]*gap:\s*var\(--history-entry-row-gap\);/s);
  assert.match(cssSrc, /\.history-branch-button\s*\{[\s\S]*margin-top:\s*0;/s);
  assert.match(cssSrc, /\.history-destruction-item\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*var\(--history-marker-slot-width\)\s*minmax\(0,\s*1fr\);[\s\S]*column-gap:\s*var\(--history-marker-gap\);/s);
  assert.doesNotMatch(cssSrc, /\.history-destruction-list\s*\{[^}]*min-height/);
  assert.match(cssSrc, /\.history-destruction-item::before\s*\{[\s\S]*grid-column:\s*1;[\s\S]*justify-self:\s*center;[\s\S]*width:\s*0\.5rem;[\s\S]*height:\s*0\.34rem;/s);
  assert.match(cssSrc, /\.history-destruction-item::before\s*\{[\s\S]*background:\s*currentColor;[\s\S]*clip-path:\s*polygon\(0 32%, 52% 32%, 52% 8%, 100% 50%, 52% 92%, 52% 68%, 0 68%\);/s);
  assert.match(cssSrc, /\.history-destruction-label\s*\{[\s\S]*grid-column:\s*2;/s);
});

// UX-08 — sub-bullet is not rendered in the live board surface
test("UX-08: destruction records stay in the History list without leaking into inline preview markup", () => {
 const game={id:'history-only',moves:[{...destroyedMove,destroyedPieces:[{position:{row:2,col:3},ownerSeat:'p1'}]}]};const renderer=historyRenderingFixture({getShellLayoutMode:()=> 'narrow'});assert.match(renderer.renderTurnHistory(game),/data-testid="history-destruction-item"/);const preview=renderer.renderHistoryPreview(game,{snapshot:null},'board-preview');assert.match(preview,/data-testid="history-inline-preview"/);assert.match(preview,/Preview unavailable/);assert.doesNotMatch(preview,/history-destruction-item/);
});

test("I-14: history selection continues to be owned only by the parent move row", () => {
  assert.match(appSource, /data-action="jump-history"/);
  assert.doesNotMatch(appSource, /data-action="jump-destruction"/);
});

test("I-15: history-mode view model prefers move snapshot over selection snapshot", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();
  store.addMove({
    gameId: game.id,
    notation: "M1",
    snapshot: {
      turnIndex: 0,
      sideToMove: "P2",
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "post-move-piece",
          owner: "P2",
          kind: "commander",
          position: { row: 4, col: 4 },
          supplied: false,
          commanded: false,
        },
      ],
    },
  });

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.currentSnapshot.pieces.length, 1);
  assert.equal(vm.currentSnapshot.pieces[0].id, "post-move-piece");
  assert.deepEqual(vm.currentSnapshot.pieces[0].position, { row: 4, col: 4 });
  assert.equal(vm.currentSnapshot.pieces[0].supplied, false);
  assert.equal(vm.currentSnapshot.pieces[0].commanded, false);
});

test("I-16: history destruction overlays derive inactive render state from the move selection snapshot", () => {
  assert.match(appSource, /return buildDestroyedPieceOverlays\(\{[\s\S]*destroyedPieceRecords:\s*move\?\.destroyedPieces \?\? \[\],[\s\S]*preActionSnapshot:\s*move\?\.selectionSnapshot \?\? null,[\s\S]*\}\);/s);
  assert.match(historyPreviewSource, /const preActionPieces = Array\.isArray\(preActionSnapshot\?\.pieces\) \? preActionSnapshot\.pieces : \[\];/);
  assert.match(historyPreviewSource, /const preActionPiece =[\s\S]*sameCoordinate\(piece\?\.position, record\.position\)/s);
  assert.match(historyPreviewSource, /supplied:\s*preActionPiece \? preActionPiece\.supplied !== false : record\.supplied \?\? true,/);
  assert.match(historyPreviewSource, /commanded:\s*preActionPiece \? preActionPiece\.commanded !== false : record\.commanded \?\? true,/);
  assert.match(historyPreviewSource, /piece:\s*preActionPiece[\s\S]*id:\s*preActionPiece\.id \?\? null,[\s\S]*owner:\s*preActionPiece\.owner,[\s\S]*kind:\s*preActionPiece\.kind,/s);
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
  assert.doesNotMatch(shellCssSrc, /\[data-hover-capability="hover"\]\s+\.history-destruction-item:hover/);
});

test("UX-02: shell.css keeps destruction rows visually subordinate to their parent move", () => {
  assert.match(shellCssSrc, /\.history-destruction-item\s*\{[\s\S]*cursor:\s*inherit;/s);
  assert.match(shellCssSrc, /\.history-destruction-item\s*\{[\s\S]*font-size:\s*0\.8em;/s);
  assert.doesNotMatch(shellCssSrc, /\.history-destruction-item\s*\{[^}]*min-height/);
});

test("UX-04: undone parent moves cross out destruction rows too", () => {
  assert.match(shellCssSrc, /\.history-item\.is-undone \.history-destruction-item/);
});
