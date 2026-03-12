import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createEnginePlaygroundBoardAdapter } from "../board-adapters/engine-playground-adapter.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const adapterSource = readFileSync(join(testDir, "..", "board-adapters", "engine-playground-adapter.js"), "utf8");
const styleSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");

test("retreat stack click selects pushed piece as retreat actor", () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const snapshot = {
    sideToMove: "P2",
    continuation: {
      type: "push",
      phase: "retreat",
      pushedPieceId: "D1",
    },
    pieces: [
      {
        id: "A1",
        owner: "P1",
        kind: "unit",
        position: { row: 4, col: 4 },
        supplied: true,
        commanded: true,
        pushed: false,
      },
      {
        id: "D1",
        owner: "P2",
        kind: "unit",
        position: { row: 4, col: 4 },
        supplied: true,
        commanded: true,
        pushed: true,
      },
    ],
  };

  const result = adapter.nextSelectionForCell({
    snapshot,
    selection: { selectedPieceId: null, source: null, target: null },
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
    currentActionType: "pass",
    clickedCoord: { row: 4, col: 4 },
    allowFreeSelection: false,
  });

  assert.deepEqual(result, {
    selection: {
      selectedPieceId: "D1",
      source: { row: 4, col: 4 },
      target: null,
    },
    nextActionType: "pass",
  });
});

test("empty-cell preview markers use a geometry-based centered dot", () => {
  assert.match(adapterSource, /marker\.className = "piece-empty";\s*marker\.setAttribute\("aria-hidden", "true"\);/s);
  assert.doesNotMatch(adapterSource, /marker\.textContent = "\.";/);
  assert.match(styleSource, /\.piece-empty\s*\{[\s\S]*width:\s*10px;[\s\S]*height:\s*10px;[\s\S]*display:\s*inline-flex;/s);
  assert.match(styleSource, /\.piece-empty::before\s*\{[\s\S]*width:\s*4px;[\s\S]*height:\s*4px;[\s\S]*border-radius:\s*50%;/s);
});

test("overlay lines are constrained to the board box, excluding axis-label padding", () => {
  assert.match(styleSource, /\.board-wrap\s*\{[\s\S]*padding-bottom:\s*1rem;/s);
  assert.match(styleSource, /\.overlay-lines\s*\{[\s\S]*top:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*1rem;[\s\S]*left:\s*0;/s);
  assert.doesNotMatch(styleSource, /\.overlay-lines\s*\{[\s\S]*inset:\s*0;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;/s);
});

test("preview ghosts render from projected preview-piece state when available", () => {
  assert.match(adapterSource, /const ghost = buildPieceToken\(action\.previewPiece \?\? piece, true\);/);
});
