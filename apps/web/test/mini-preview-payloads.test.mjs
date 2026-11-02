import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { syncMiniBoardPreviews } from "../board/mini-board-preview.js";

// Exercise the real shell boundary without booting its network/board runtime.
// The optional import also lets this exact test run on the pre-fix shell.
const helperUrl = new URL("../shell/mini-preview-payloads.js", import.meta.url);
const helpers = existsSync(helperUrl) ? await import(helperUrl.href) : {};
const shellSource = readFileSync(new URL("../shell/app.js", import.meta.url), "utf8");
const shellFunction = (name) => {
  const start = shellSource.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `actual shell function ${name} exists`);
  const end = shellSource.indexOf("\n};", start);
  assert.ok(end > start, `actual shell function ${name} ends`);
  return shellSource.slice(start, end + 3);
};
const historyRendererStart = shellSource.indexOf("const renderHistoryPreview = ");
assert.ok(historyRendererStart >= 0);
const historyRenderer = shellSource.slice(historyRendererStart, shellSource.indexOf(";\n", historyRendererStart) + 1);

class Element {
  children = [];
  attributes = new Map();
  classList = { add() {}, remove() {} };
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll(selector) {
    assert.equal(selector, "[data-mini-board-preview]");
    return this.children.flatMap((child) => [
      ...(child.attributes.has("data-mini-board-preview") ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const withShell = (run) => {
  const oldDocument = globalThis.document;
  const oldHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
  try {
    const payloads = new Map();
    const registry = new Map();
    const appEl = new Element();
    const events = [];
    const boundary = new Function(
      "appEl", "renderedMiniBoardPreviewPayloads", "miniBoardPreviewRegistry",
      "syncMiniBoardPreviews", "createEngineBoardAdapter", "assertGameBoardAdapter",
      "escapeHtml", "collectMountedMiniPreviewPayloads",
      "getStaticCardPreviewPayload", "toStableKey", "getShellLayoutMode",
      ["registerMiniBoardPreview", "renderMiniBoardPreviewRoot", "reconcileMiniBoardPreviews", "renderStaticMiniBoardCard"]
        .map(shellFunction).join("\n") + "\n" + historyRenderer
        + "\nreturn { renderMiniBoardPreviewRoot, reconcileMiniBoardPreviews, renderStaticMiniBoardCard, renderHistoryPreview };",
    )(appEl, payloads, registry, syncMiniBoardPreviews, () => ({
      mount(options) { events.push({ type: "mount", options }); },
      render(options) { events.push({ type: "render", options }); },
      unmount() { events.push({ type: "unmount" }); },
    }), () => {}, (value) => String(value), helpers.collectMountedMiniPreviewPayloads,
    () => { throw new Error("test cards must supply retained previewPayload"); }, JSON.stringify, () => "narrow");
    const rootFromMarkup = (markup) => {
      const root = new Element();
      root.setAttribute("data-mini-board-preview", "");
      root.setAttribute("data-preview-id", markup.match(/data-preview-id="([^"]+)"/)[1]);
      return root;
    };
    const render = (previewId, payload = {}) => rootFromMarkup(boundary.renderMiniBoardPreviewRoot({ previewId, ...payload }));
    const renderModel = (kind, model) => rootFromMarkup(kind === "card"
      ? boundary.renderStaticMiniBoardCard({ card: model, statusText: "In progress" })
      : boundary.renderHistoryPreview(model, model.preview, kind));
    run({ payloads, registry, appEl, events, render, renderModel, reconcile: boundary.reconcileMiniBoardPreviews });
  } finally {
    globalThis.document = oldDocument;
    globalThis.HTMLElement = oldHTMLElement;
  }
};

const snapshot = Object.freeze({ sideToMove: "P1", pieces: Object.freeze([]) });
const preview = Object.freeze({ snapshot, previewKey: "same", overlay: Object.freeze({ mode: "none" }) });

test("100 historical registrations retain only the mounted registered ID", () => withShell((h) => {
  let mounted;
  for (let index = 0; index < 100; index++) mounted = h.render(`history:${index}`, preview);
  const retained = h.payloads.get("history:99");
  h.appEl.appendChild(mounted);
  h.reconcile();
  assert.deepEqual([...h.payloads.keys()], ["history:99"]);
  assert.equal(h.payloads.get("history:99"), retained);
  assert.equal(h.events.find((event) => event.type === "render").options.snapshot, snapshot);
}));

test("retained, hidden and closing DOM keeps exact payloads without rerender or extra adapter work", () => withShell((h) => {
  const roots = ["retained", "hidden", "closing"].map((id) => h.render(id, preview));
  roots[1].setAttribute("hidden", "");
  roots[2].setAttribute("class", "is-closing");
  h.appEl.replaceChildren(...roots);
  const payloads = [...h.payloads.values()];
  h.reconcile();
  const initialEvents = h.events.length;
  h.render("uncommitted", preview);
  h.reconcile();
  assert.deepEqual([...h.payloads.keys()], ["retained", "hidden", "closing"]);
  [...h.payloads.values()].forEach((payload, index) => assert.equal(payload, payloads[index]));
  assert.equal(h.events.length, initialEvents, "same roots/key do not remount or render");
}));

test("duplicate roots share a payload but retain independent adapter lifetimes", () => withShell((h) => {
  const first = h.render("shared", preview);
  const second = h.render("shared", preview);
  const payload = h.payloads.get("shared");
  h.appEl.replaceChildren(first, second);
  h.reconcile();
  assert.equal(h.registry.size, 2);
  assert.equal(h.payloads.size, 1);
  h.appEl.replaceChildren(second);
  h.reconcile();
  assert.equal(h.payloads.get("shared"), payload);
  assert.equal(h.registry.size, 1);
  assert.equal(h.events.filter((event) => event.type === "unmount").length, 1);
  h.appEl.replaceChildren();
  h.reconcile();
  assert.equal(h.payloads.size, 0);
  assert.equal(h.registry.size, 0);
}));

test("loading/route replacement retires old payloads and navigation away releases all roots", () => withShell((h) => {
  h.appEl.appendChild(h.render("old", preview));
  h.reconcile();
  h.appEl.replaceChildren(h.render("loading", { snapshot: null, previewKey: "loading" }));
  h.reconcile();
  assert.deepEqual([...h.payloads.keys()], ["loading"]);
  assert.equal(h.registry.size, 1);
  assert.equal(h.events.filter((event) => event.type === "render").length, 1);
  h.appEl.replaceChildren();
  h.reconcile();
  assert.equal(h.payloads.size, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.events.filter((event) => event.type === "unmount").length, 2);
}));

test("speculative/outside-app markup and unregistered mounted IDs acquire no ownership", () => withShell((h) => {
  const outside = new Element();
  outside.appendChild(h.render("outside", preview));
  h.render("speculative", preview);
  const unknown = new Element();
  unknown.setAttribute("data-mini-board-preview", "");
  unknown.setAttribute("data-preview-id", "unknown");
  h.appEl.appendChild(unknown);
  h.reconcile();
  assert.equal(h.payloads.size, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.events.length, 0);
}));

test("all active payload fields retain identity and unchanged keys still suppress rendering", () => withShell((h) => {
  const fields = Object.freeze({ ...preview,
    selection: Object.freeze({ selectedPieceId: "piece", source: null, target: null }),
    legalActions: Object.freeze([]), selectedPieceId: "piece",
    selectedPieceMoves: Object.freeze([]), selectedPieceMovePreviews: Object.freeze([]),
    currentActionType: "rush", selectedPieceOverlayPhase: "actionPreviews", sizeVariant: "compact",
  });
  const root = h.render("active", fields);
  h.appEl.appendChild(root);
  const payload = h.payloads.get("active");
  h.reconcile();
  assert.equal(h.payloads.get("active"), payload);
  const rendered = h.events.find((event) => event.type === "render").options;
  for (const field of Object.keys(fields).filter((field) => !["previewKey", "sizeVariant"].includes(field))) {
    assert.equal(payload[field], fields[field]);
    assert.equal(rendered[field], fields[field]);
  }
  h.render("active", fields); // Fresh registration, same committed root and preview key.
  const refreshed = h.payloads.get("active");
  h.reconcile();
  assert.equal(h.payloads.get("active"), refreshed);
  assert.equal(h.events.filter((event) => event.type === "render").length, 1);
  h.render("active", { ...fields, previewKey: "changed" });
  h.reconcile();
  assert.equal(h.events.filter((event) => event.type === "render").length, 2);
  assert.equal(h.events.filter((event) => event.type === "mount").length, 1);
}));

for (const kind of ["card", "live-history", "archived-history"]) {
  test(`${kind} reopens by registering fresh payloads from unchanged retained models`, () => withShell((h) => {
    // Static cards retain previewPayload; live/archive selected History retains a preview.
    const model = Object.freeze(kind === "card"
      ? { id: kind, previewPayload: preview }
      : { id: kind, preview });
    const before = JSON.stringify(model);
    const sourcePayload = model.previewPayload ?? model.preview;
    const id = kind === "card" ? `home:${kind}` : kind;
    h.appEl.appendChild(h.renderModel(kind, model));
    const original = h.payloads.get(id);
    h.reconcile();
    h.appEl.replaceChildren();
    h.reconcile();
    assert.equal(h.payloads.size, 0);
    h.appEl.appendChild(h.renderModel(kind, model));
    const reopened = h.payloads.get(id);
    assert.notEqual(reopened, original, "actual renderer re-registers after retirement");
    h.reconcile();
    assert.equal(h.payloads.get(id), reopened);
    assert.equal(reopened.snapshot, sourcePayload.snapshot);
    assert.equal(reopened.overlay, sourcePayload.overlay);
    assert.equal(model.previewPayload ?? model.preview, sourcePayload);
    assert.equal(JSON.stringify(model), before);
    assert.equal(h.events.filter((event) => event.type === "mount").length, 2);
    assert.equal(h.events.filter((event) => event.type === "unmount").length, 1);
  }));
}
