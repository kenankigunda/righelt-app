import test from "node:test";
import assert from "node:assert/strict";

import { createEngineBoardAdapter } from "../board-adapters/engine-board-adapter.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";

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
    this.listeners = new Map();
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const datasetKey = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[datasetKey] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const datasetKey = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[datasetKey];
    }
  }

  addEventListener(type, listener) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, listener) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((candidate) => candidate !== listener),
    );
  }

  dispatchEvent(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const selectors = selector
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const results = [];

    const matches = (element, candidate) => {
      const attributeMatch = candidate.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
      const classMatch = candidate.match(/\.([a-zA-Z0-9_-]+)/);
      const idMatch = candidate.match(/#([a-zA-Z0-9_-]+)/);
      const tagMatch = candidate.match(/^[a-zA-Z]+/);

      if (idMatch && element.getAttribute("id") !== idMatch[1]) {
        return false;
      }
      if (classMatch && !element.classList.contains(classMatch[1])) {
        return false;
      }
      if (tagMatch && element.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) {
        return false;
      }
      if (attributeMatch) {
        const dataKey = attributeMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const expectedValue = attributeMatch[2] ?? null;
        const actualValue = element.dataset?.[dataKey];
        if (actualValue == null) {
          return false;
        }
        if (expectedValue != null && actualValue !== expectedValue) {
          return false;
        }
      }
      return idMatch || classMatch || tagMatch || attributeMatch ? true : false;
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

const getCell = (boardEl, row, col) =>
  boardEl.children.find((child) => Number(child.dataset.row) === row && Number(child.dataset.col) === col) ?? null;

test("integration runtime + adapter render the push defender nudge for a lone auto-selected push target", async () => {
  await withFakeDocument(async () => {
    const boardEl = new FakeElement("div");
    const overlayLinesEl = new FakeElement("svg");
    const boardPreviewLabelEl = new FakeElement("p");

    const runtime = createBoardRuntime({
      boardAdapter: createEngineBoardAdapter(),
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({
          state: null,
          actions: [{ type: "push", actorId: "A1", from: { row: 6, col: 1 }, to: { row: 6, col: 2 } }],
          previewActions: [{ type: "push", actorId: "A1", from: { row: 6, col: 1 }, to: { row: 6, col: 2 }, legal: true }],
        }),
        canInteract: () => true,
      },
      controls: {
        getSupportsHover: () => true,
      },
    });

    runtime.bindElements({
      boardEl,
      overlayLinesEl,
      boardPreviewLabelEl,
      boardTurnIndicatorEl: null,
    });

    await runtime.loadSnapshot(
      {
        sideToMove: "P2",
        turnIndex: 12,
        continuation: null,
        outcome: null,
        pieces: [
          { id: "A1", owner: "P2", kind: "unit", position: { row: 6, col: 1 }, supplied: true, commanded: true },
          { id: "A2", owner: "P2", kind: "unit", position: { row: 5, col: 1 }, supplied: true, commanded: true },
          { id: "D1", owner: "P1", kind: "unit", position: { row: 6, col: 2 }, supplied: true, commanded: true },
        ],
      },
      {
        legalActions: [{ type: "push", actorId: "A1", from: { row: 6, col: 1 }, to: { row: 6, col: 2 } }],
      },
    );

    const sourceCell = getCell(boardEl, 6, 1);
    assert.notEqual(sourceCell, null);
    boardEl.dispatchEvent("click", { target: sourceCell });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const targetCell = getCell(boardEl, 6, 2);
    const pushPreviewStack = targetCell?.children.find((child) => child.dataset?.pushPreviewStack === "1") ?? null;

    assert.deepEqual(runtime.getSelection(), {
      selectedPieceId: "A1",
      source: { row: 6, col: 1 },
      target: { row: 6, col: 2 },
    });
    assert.equal(runtime.getActionType(), "push");
    assert.equal(pushPreviewStack !== null, true);
    assert.equal(
      pushPreviewStack?.children.some(
        (child) => child.classList.contains("stacked-underlay") && child.classList.contains("stacked-pushed"),
      ) ?? false,
      true,
    );
    assert.equal(String(boardPreviewLabelEl.innerHTML).includes("push piece onto"), true);
  });
});
