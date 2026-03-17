import test from "node:test";
import assert from "node:assert/strict";

import { syncMiniBoardPreviews } from "../board/mini-board-preview.js";

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

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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

test("mini board preview registry mounts, updates, and destroys previews by root", async () => {
  await withFakeDom(async () => {
    const registry = new Map();
    const adapterEvents = [];

    const createAdapter = () => ({
      mount(options) {
        adapterEvents.push({ type: "mount", options });
      },
      render(options) {
        adapterEvents.push({ type: "render", options });
      },
      unmount() {
        adapterEvents.push({ type: "unmount" });
      },
    });

    const rootA = new FakeElement("div");
    const rootB = new FakeElement("div");

    syncMiniBoardPreviews({
      previews: [
        { rootEl: rootA, snapshot: { sideToMove: "P1", pieces: [] }, previewKey: "A:1" },
        { rootEl: rootB, snapshot: { sideToMove: "P2", pieces: [] }, previewKey: "B:1" },
      ],
      registry,
      createAdapter,
    });

    assert.equal(registry.size, 2);
    assert.equal(adapterEvents.filter((event) => event.type === "mount").length, 2);
    assert.equal(adapterEvents.filter((event) => event.type === "render").length, 2);

    syncMiniBoardPreviews({
      previews: [
        { rootEl: rootA, snapshot: { sideToMove: "P1", pieces: [] }, previewKey: "A:1" },
        { rootEl: rootB, snapshot: { sideToMove: "P2", pieces: [] }, previewKey: "B:1" },
      ],
      registry,
      createAdapter,
    });

    assert.equal(adapterEvents.filter((event) => event.type === "render").length, 2);

    syncMiniBoardPreviews({
      previews: [{ rootEl: rootA, snapshot: { sideToMove: "P2", pieces: [] }, previewKey: "A:2" }],
      registry,
      createAdapter,
    });

    assert.equal(registry.size, 1);
    assert.equal(adapterEvents.filter((event) => event.type === "render").length, 3);
    assert.equal(adapterEvents.filter((event) => event.type === "unmount").length, 1);
  });
});
