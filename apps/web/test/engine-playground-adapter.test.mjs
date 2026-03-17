import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSharedPathSegmentOffsetMaps,
  createEnginePlaygroundBoardAdapter,
  getCurvedArrowAnchor,
  normalizeOverlayPath,
  getPathSegmentOffsetVector,
  getSegmentKey,
  segmentsOverlapOnSameLine,
  shouldCurveActionPreview,
} from "../board-adapters/engine-playground-adapter.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const adapterSource = readFileSync(join(testDir, "..", "board-adapters", "engine-playground-adapter.js"), "utf8");
const styleSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      if (token) {
        this.values.add(token);
      }
    }
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.values.delete(token);
    }
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.classList = new FakeClassList();
    this._className = "";
    this._innerHTML = "";
    this.textContent = "";
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this.offsetWidth = 10;
    this.offsetHeight = 10;
    this.clientWidth = 100;
    this.clientHeight = 100;
  }

  set className(value) {
    this._className = value;
    this.classList = new FakeClassList();
    for (const token of String(value).split(/\s+/).filter(Boolean)) {
      this.classList.add(token);
    }
  }

  get className() {
    return this._className;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    if (child.dataset?.row && child.dataset?.col && this.tagName === "DIV") {
      child.offsetTop = Number(child.dataset.row) * 10;
      child.offsetLeft = Number(child.dataset.col) * 10;
      child.offsetWidth = 10;
      child.offsetHeight = 10;
    }
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((value) => value.trim()).filter(Boolean);
    const results = [];
    const matches = (element, candidate) => {
      if (candidate.startsWith("#")) {
        return element.getAttribute("id") === candidate.slice(1);
      }
      if (candidate.startsWith(".")) {
        return element.classList.contains(candidate.slice(1));
      }
      return element.tagName.toLowerCase() === candidate.toLowerCase();
    };
    const visit = (element) => {
      for (const candidate of selectors) {
        if (matches(element, candidate)) {
          results.push(element);
          break;
        }
      }
      for (const child of element.children) {
        visit(child);
      }
    };
    for (const child of this.children) {
      visit(child);
    }
    return results;
  }

  addEventListener() {}

  removeEventListener() {}

  closest(selector) {
    if (selector === ".cell" && this.classList.contains("cell")) {
      return this;
    }
    return this.parentNode?.closest?.(selector) ?? null;
  }
}

const withFakeDocument = async (run) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_ns, tagName) => new FakeElement(tagName),
  };
  try {
    await run();
  } finally {
    globalThis.document = originalDocument;
  }
};

const createMountedAdapter = () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const boardEl = new FakeElement("div");
  const overlayLinesEl = new FakeElement("svg");
  adapter.mount({
    boardEl,
    overlayLinesEl,
    onCellClick: () => {},
  });
  return { adapter, boardEl, overlayLinesEl };
};

const getCell = (boardEl, row, col) =>
  boardEl.children.find((child) => Number(child.dataset.row) === row && Number(child.dataset.col) === col) ?? null;

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

test("board adapter delegates hover callbacks only for real cell boundary changes", () => {
  const listeners = new Map();
  const boardEl = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const adapter = createEnginePlaygroundBoardAdapter();
  const hoverStarts = [];
  const hoverEnds = [];

  adapter.mount({
    boardEl,
    overlayLinesEl: {},
    onCellClick: () => {},
    onCellHoverStart: (coord) => hoverStarts.push(coord),
    onCellHoverEnd: (coord) => hoverEnds.push(coord),
  });

  const cellA = { dataset: { row: "4", col: "2" } };
  const cellB = { dataset: { row: "4", col: "3" } };
  const targetFor = (cell) => ({
    closest(selector) {
      return selector === ".cell" ? cell : null;
    },
  });

  listeners.get("mouseover")?.({ target: targetFor(cellA), relatedTarget: null });
  listeners.get("mouseover")?.({ target: targetFor(cellA), relatedTarget: targetFor(cellA) });
  listeners.get("mouseout")?.({ target: targetFor(cellA), relatedTarget: targetFor(cellB) });
  listeners.get("mouseover")?.({ target: targetFor(cellB), relatedTarget: targetFor(cellA) });

  assert.deepEqual(hoverStarts, [
    { row: 4, col: 2 },
    { row: 4, col: 3 },
  ]);
  assert.deepEqual(hoverEnds, [{ row: 4, col: 2 }]);
});

test("board adapter static mount skips interactive listeners", () => {
  const listeners = new Map();
  const boardEl = {
    setAttribute() {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const adapter = createEnginePlaygroundBoardAdapter();

  adapter.mount({
    boardEl,
    overlayLinesEl: {},
    interactionMode: "static",
    onCellClick: () => {},
  });

  assert.equal(listeners.size, 0);
});

test("board adapter static render uses non-focusable cells", async () => {
  await withFakeDocument(async () => {
    const adapter = createEnginePlaygroundBoardAdapter();
    const boardEl = new FakeElement("div");
    const overlayLinesEl = new FakeElement("svg");
    adapter.mount({
      boardEl,
      overlayLinesEl,
      interactionMode: "static",
      onCellClick: () => {},
    });

    adapter.render({
      snapshot: {
        sideToMove: "P1",
        continuation: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true }],
      },
      selection: { selectedPieceId: null, source: null, target: null },
      overlay: { mode: "none" },
      legalActions: [],
      selectedPieceMoves: [],
      selectedPieceMovePreviews: [],
      removalEffects: [],
      allowFreeSelection: false,
      currentActionType: "pass",
      interactionMode: "static",
    });

    const firstCell = getCell(boardEl, 0, 0);
    assert.equal(boardEl.getAttribute("data-interaction-mode"), "static");
    assert.equal(firstCell?.tagName, "DIV");
    assert.equal(firstCell?.getAttribute("aria-hidden"), "true");
  });
});

test("preview arrow curvature detects overlapping supply or command segments only", () => {
  assert.equal(
    segmentsOverlapOnSameLine(
      { row: 4, col: 4 },
      { row: 4, col: 5 },
      { row: 4, col: 4 },
      { row: 4, col: 8 },
    ),
    true,
  );
  assert.equal(
    segmentsOverlapOnSameLine(
      { row: 4, col: 4 },
      { row: 5, col: 5 },
      { row: 4, col: 5 },
      { row: 5, col: 4 },
    ),
    false,
  );
  assert.equal(
    shouldCurveActionPreview(
      { row: 4, col: 4 },
      { row: 4, col: 5 },
      [[{ row: 4, col: 4 }, { row: 4, col: 8 }], [{ row: 2, col: 2 }, { row: 2, col: 3 }]],
    ),
    true,
  );
  assert.equal(
    shouldCurveActionPreview(
      { row: 4, col: 4 },
      { row: 5, col: 5 },
      [[{ row: 4, col: 4 }, { row: 4, col: 8 }]],
    ),
    false,
  );
  assert.deepEqual(
    getCurvedArrowAnchor(
      { x: 50, y: 100 },
      { x: 50, y: 50 },
      1,
    ),
    { x: 59, y: 54 },
  );
});

test("shared supply and command segments receive opposite parallel offsets", () => {
  const sharedKey = getSegmentKey({ row: 4, col: 4 }, { row: 4, col: 5 });
  const { supplyOffsetsBySegmentKey, commandOffsetsBySegmentKey } = buildSharedPathSegmentOffsetMaps(
    [
      { row: 4, col: 4 },
      { row: 4, col: 5 },
      { row: 4, col: 6 },
    ],
    [
      { row: 4, col: 5 },
      { row: 4, col: 4 },
      { row: 3, col: 4 },
    ],
  );

  assert.equal(supplyOffsetsBySegmentKey.get(sharedKey), -2.5);
  assert.equal(commandOffsetsBySegmentKey.get(sharedKey), 2.5);
});

test("overlay path normalization expands long straight segments into unit steps", () => {
  assert.deepEqual(
    normalizeOverlayPath([
      { row: 5, col: 6 },
      { row: 3, col: 6 },
    ]),
    [
      { row: 5, col: 6 },
      { row: 4, col: 6 },
      { row: 3, col: 6 },
    ],
  );
});

test("shared offset maps catch overlap when command path spans multiple cells in one segment", () => {
  const normalizedSupply = normalizeOverlayPath([
    { row: 3, col: 2 },
    { row: 3, col: 3 },
    { row: 3, col: 4 },
  ]);
  const normalizedCommand = normalizeOverlayPath([
    { row: 3, col: 4 },
    { row: 3, col: 2 },
  ]);

  const { supplyOffsetsBySegmentKey, commandOffsetsBySegmentKey } = buildSharedPathSegmentOffsetMaps(
    normalizedSupply,
    normalizedCommand,
  );

  assert.equal(supplyOffsetsBySegmentKey.get(getSegmentKey({ row: 3, col: 2 }, { row: 3, col: 3 })), -2.5);
  assert.equal(supplyOffsetsBySegmentKey.get(getSegmentKey({ row: 3, col: 3 }, { row: 3, col: 4 })), -2.5);
  assert.equal(commandOffsetsBySegmentKey.get(getSegmentKey({ row: 3, col: 2 }, { row: 3, col: 3 })), 2.5);
  assert.equal(commandOffsetsBySegmentKey.get(getSegmentKey({ row: 3, col: 3 }, { row: 3, col: 4 })), 2.5);
});

test("path segment offset vector is stable for reversed segment direction", () => {
  assert.deepEqual(
    getPathSegmentOffsetVector({ row: 4, col: 4 }, { row: 4, col: 5 }, 2.5),
    { x: -0, y: 2.5 },
  );
  assert.deepEqual(
    getPathSegmentOffsetVector({ row: 4, col: 5 }, { row: 4, col: 4 }, 2.5),
    { x: -0, y: 2.5 },
  );
});

test("recorded-action overlay shows move markers without supply, command, or non-push group context", async () => {
  await withFakeDocument(async () => {
    const { adapter, boardEl, overlayLinesEl } = createMountedAdapter();
    const snapshot = {
      sideToMove: "P1",
      continuation: null,
      pieces: [
        { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
        { id: "A2", owner: "P1", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      ],
      artifacts: {
        supply: [
          {
            player: "P1",
            shortestPathByPieceId: {
              A1: [
                { row: 4, col: 2 },
                { row: 4, col: 1 },
              ],
            },
          },
        ],
        command: {
          shortestPathToCommanderByPieceId: {
            A1: [
              { row: 4, col: 2 },
              { row: 3, col: 2 },
            ],
          },
        },
        groups: {
          componentByPieceId: { A1: "G1", A2: "G1" },
          membersByComponentId: { G1: ["A1", "A2"] },
          strengthByComponentId: { G1: 2 },
        },
      },
    };

    adapter.render({
      snapshot,
      selection: { selectedPieceId: null, source: null, target: null },
      overlay: {
        mode: "recorded-action",
        recordedAction: { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
      },
      legalActions: [],
      selectedPieceMoves: [],
      selectedPieceMovePreviews: [],
      removalEffects: [],
      allowFreeSelection: false,
      currentActionType: "move",
    });

    assert.equal(getCell(boardEl, 4, 2)?.classList.contains("source"), true);
    assert.equal(getCell(boardEl, 4, 3)?.classList.contains("target"), true);
    assert.equal(boardEl.querySelectorAll(".group-member").length, 0);
    assert.equal(boardEl.querySelectorAll(".group-strength-badge").length, 0);
    assert.equal(overlayLinesEl.querySelectorAll("line").length, 1);
    assert.equal(overlayLinesEl.querySelectorAll("path").length, 1);
  });
});

test("recorded-action push overlay keeps push group highlight and count", async () => {
  await withFakeDocument(async () => {
    const { adapter, boardEl } = createMountedAdapter();
    const snapshot = {
      sideToMove: "P1",
      continuation: null,
      pieces: [
        { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
        { id: "A2", owner: "P1", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      ],
      artifacts: {
        groups: {
          componentByPieceId: { A1: "G1", A2: "G1" },
          membersByComponentId: { G1: ["A1", "A2"] },
          strengthByComponentId: { G1: 2 },
        },
      },
    };

    adapter.render({
      snapshot,
      selection: { selectedPieceId: null, source: null, target: null },
      overlay: {
        mode: "recorded-action",
        recordedAction: { type: "push", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
      },
      legalActions: [],
      selectedPieceMoves: [],
      selectedPieceMovePreviews: [],
      removalEffects: [],
      allowFreeSelection: false,
      currentActionType: "push",
    });

    assert.equal(boardEl.querySelectorAll(".group-member").length, 2);
    assert.equal(boardEl.querySelectorAll(".group-strength-badge").length, 1);
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

test("preview ghosts do not render inactive state from preview metadata", () => {
  assert.match(adapterSource, /if \(!ghost && \(!renderStatus\.supplied \|\| !renderStatus\.commanded\)\) \{/);
});

test("inactive pieces use the square fill color instead of transparency", () => {
  assert.match(styleSource, /\.cell\s*\{[\s\S]*--cell-fill:\s*#fbf8f0;[\s\S]*background:\s*var\(--cell-fill\);/s);
  assert.match(styleSource, /\.piece-token\.inactive\s*\{[\s\S]*background:\s*var\(--cell-fill, #fbf8f0\);/s);
  assert.match(styleSource, /\.cell\.group-member\s*\{[\s\S]*--cell-fill:\s*#eef8f1;/s);
  assert.match(styleSource, /\.cell\.continuation-moved\s*\{[\s\S]*--cell-fill:\s*#f5f7ef;/s);
  assert.match(styleSource, /\.cell\.continuation-pending\s*\{[\s\S]*--cell-fill:\s*#e6f2d3;/s);
  assert.match(styleSource, /\.cell\.retreat-piece\s*\{[\s\S]*--cell-fill:\s*#f3e7c5;/s);
});

test("project previews use a plus badge while move-style previews use lightweight owner-colored arrows", () => {
  assert.match(adapterSource, /const PREVIEW_STROKE_BY_OWNER = \{\s*P1: "var\(--player-p1\)",\s*P2: "var\(--player-p2\)",\s*\};/s);
  assert.match(adapterSource, /const PREVIEW_OPACITY = \{\s*default: "0\.35",\s*selected: "0\.7",\s*\};/s);
  assert.match(adapterSource, /const drawArrowLine = \(from, to, owner, curved = false, selected = false\) => \{/);
  assert.match(adapterSource, /line\.setAttribute\("stroke-width", "3"\);/);
  assert.match(adapterSource, /path\.setAttribute\("stroke-width", "3"\);/);
  assert.match(adapterSource, /const previewOpacity = selected \? PREVIEW_OPACITY\.selected : PREVIEW_OPACITY\.default;/);
  assert.match(adapterSource, /line\.setAttribute\("stroke-opacity", previewOpacity\);/);
  assert.match(adapterSource, /path\.setAttribute\("stroke-opacity", previewOpacity\);/);
  assert.match(adapterSource, /arrowPath\.setAttribute\("fill-opacity", opacity\);/);
  assert.match(adapterSource, /const isSelectedTarget = targetCell\?\.classList\.contains\("target"\) \?\? false;/);
  assert.match(adapterSource, /shouldCurveActionPreview\(piece\.position, action\.to, \[supplyPath, commandPath\]\)/);
  assert.doesNotMatch(adapterSource, /drawPath\(\[piece\.position, action\.to\], "#8b5ec0", "5 5"\)/);
  assert.match(adapterSource, /if \(action\.type === "project"\) \{\s*ghost\.classList\.add\("preview-created"\);\s*\}/s);
  assert.match(styleSource, /\.piece-token\.move-ghost\.preview-created::after\s*\{[\s\S]*content:\s*"\+";[\s\S]*top:\s*-7px;[\s\S]*right:\s*-8px;/s);
  assert.match(styleSource, /:root\s*\{[\s\S]*--player-p1:\s*#c2452f;[\s\S]*--player-p2:\s*#2d67c7;/s);
  assert.match(styleSource, /\.piece-token\.p1\s*\{[\s\S]*background:\s*var\(--player-p1\);[\s\S]*border-color:\s*var\(--player-p1\);/s);
  assert.match(styleSource, /\.piece-token\.p2\s*\{[\s\S]*background:\s*var\(--player-p2\);[\s\S]*border-color:\s*var\(--player-p2\);/s);
  assert.match(adapterSource, /const supplyPath = normalizeOverlayPath\(getSupplyPathForPiece\(snapshot, piece\)\);/);
  assert.match(adapterSource, /const commandPath = normalizeOverlayPath\(getCommandPathForPiece\(snapshot, piece\)\);/);
  assert.match(adapterSource, /buildSharedPathSegmentOffsetMaps\(\s*supplyPath,\s*commandPath,\s*\)/s);
  assert.match(adapterSource, /drawPath\(supplyPath, "#2f8e63", "2 6", supplyOffsetsBySegmentKey\);/);
  assert.match(adapterSource, /const commandStroke = PREVIEW_STROKE_BY_OWNER\[piece\.owner\] \?\? PREVIEW_STROKE_BY_OWNER\.P1;/);
  assert.match(adapterSource, /drawPath\(commandPath, commandStroke, "2 6", commandOffsetsBySegmentKey\);/);
  assert.doesNotMatch(adapterSource, /drawPath\(commandPath, "#2470c7"\)/);
});

test("action preview ghosts stay centered instead of using preview offsets", () => {
  assert.doesNotMatch(adapterSource, /getPreviewOffset/);
  assert.doesNotMatch(adapterSource, /ghost\.classList\.add\("offset-move"\)/);
  assert.doesNotMatch(adapterSource, /ghost\.classList\.add\("offset-rush"\)/);
  assert.doesNotMatch(styleSource, /\.move-ghost\.offset-move\s*\{/);
  assert.doesNotMatch(styleSource, /\.move-ghost\.offset-rush\s*\{/);
});

test("same-target previews render only the preferred action type", () => {
  assert.match(adapterSource, /const preferredActionType = pickBestActionTypeForTarget\(actionsAtTarget, null\);/);
  assert.match(adapterSource, /const action = actionsAtTarget\.find\(\(candidate\) => candidate\.type === preferredActionType\) \?\? actionsAtTarget\[0\];/);
});

test("selected destination preview ghost is more opaque than other previews", () => {
  assert.match(styleSource, /\.piece-token\.ghost\s*\{[\s\S]*opacity:\s*0\.35;/s);
  assert.match(styleSource, /\.cell\.target \.piece-token\.move-ghost\s*\{[\s\S]*opacity:\s*0\.7;/s);
});

test("group strength badge sits inset from the square's upper-left corner", () => {
  assert.match(styleSource, /\.group-strength-badge\s*\{[\s\S]*top:\s*-6px;[\s\S]*left:\s*-6px;/s);
});

test("group strength badge only renders for strengths above one", () => {
  assert.match(adapterSource, /if \(anchorCell && typeof groupInfo\.strength === "number" && groupInfo\.strength > 1\) \{/);
});
