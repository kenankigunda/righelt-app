import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { buildScenarioStaticPreviewModel } from "../shell/static-preview-model.js";

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
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.classList = new FakeClassList();
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

const withFakeDom = async (run) => {
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_ns, tagName) => new FakeElement(tagName),
  };
  try {
    await run();
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLElement = originalHTMLElement;
  }
};

test("scenario card preview integration derives recorded-action semantics and forwards them to the mini-board renderer", async () => {
  await withFakeDom(async () => {
    const snapshot = resolveToStability(createInitialState(), { artifactMode: "full" });
    const projectAction = listLegalActions(snapshot).find((action) => action.type === "project");
    assert.ok(projectAction, "expected an initial project action");

    const preview = buildScenarioStaticPreviewModel({
      resultingState: snapshot,
      savedSelection: {
        source: projectAction.from,
        target: projectAction.to,
        actorSide: snapshot.sideToMove,
        turnIndex: snapshot.turnIndex,
      },
    });

    const renders = [];
    syncMiniBoardPreviews({
      previews: [
        {
          rootEl: new FakeElement("div"),
          ...preview,
          previewKey: "scenario-preview:1",
        },
      ],
      registry: new Map(),
      createAdapter: () => ({
        mount() {},
        render(options) {
          renders.push(options);
        },
        unmount() {},
      }),
    });

    assert.equal(renders[0]?.overlay?.mode, "recorded-action");
    assert.equal(renders[0]?.overlay?.recordedAction?.type, "project");
    assert.equal(renders[0]?.overlay?.recordedActionStartPiece?.id, projectAction.actorId);
    assert.equal(renders[0]?.snapshot?.sideToMove, "P2");
  });
});
