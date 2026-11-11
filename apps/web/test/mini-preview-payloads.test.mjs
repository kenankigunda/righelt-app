import test from "node:test";
import assert from "node:assert/strict";
import { syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { renderBoardMessageHtml } from "../board/message-presentation.js";
import { collectMountedMiniPreviewPayloads, createMiniPreviewRendering } from "../shell/mini-preview-payloads.js";
import { createHomeCardRendering } from "../shell/home-card-rendering.js";
import { createHistoryRendering } from "../shell/history-rendering.js";
import { createRenderGestureGate } from "../shell/render-gesture.js";

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
    const rendering = createMiniPreviewRendering({ payloads, escapeHtml: String });
    const reconcile = () => syncMiniBoardPreviews({
      previews: collectMountedMiniPreviewPayloads({ appEl, payloads }), registry,
      createAdapter: () => ({
        mount(options) { events.push({ type: "mount", options }); },
        render(options) { events.push({ type: "render", options }); },
        unmount() { events.push({ type: "unmount" }); },
      }),
    });
    const home = createHomeCardRendering({ toStableKey: JSON.stringify, escapeHtml: String,
      renderMiniBoardPreviewRoot: rendering.renderMiniBoardPreviewRoot });
    const history = createHistoryRendering(() => ({ getShellLayoutMode: () => "narrow",
      renderBoardMessageHtml, selectedHistoryPresentation: () => null,
      renderMiniBoardPreviewRoot: rendering.renderMiniBoardPreviewRoot, toStableKey: JSON.stringify }));
    const rootFromMarkup = (markup) => {
      const root = new Element();
      root.setAttribute("data-mini-board-preview", "");
      root.setAttribute("data-preview-id", markup.match(/data-preview-id="([^"]+)"/)[1]);
      return root;
    };
    const render = (previewId, payload = {}) => rootFromMarkup(rendering.renderMiniBoardPreviewRoot({ previewId, ...payload }));
    const renderModel = (kind, model) => rootFromMarkup(kind === "card"
      ? home.renderStaticMiniBoardCard({ card: model, statusText: "In progress" })
      : history.renderHistoryPreview(model, model.preview, kind));
    const renderOwner = (renderContent, options = {}) => {
      const scheduled = [];
      const gate = createRenderGestureGate({ render: () => renderContent(),
        schedule: callback => { scheduled.push(callback); return callback; }, cancel: () => {} });
      if (options.held) gate.begin();
      const render = () => { if (!gate.defer({ includeBoard: false })) renderContent(); };
      render.release = () => { gate.end(); for (const callback of scheduled.splice(0)) callback(); };
      return render;
    };
    run({ payloads, registry, appEl, events, render, renderModel, renderOwner, reconcile });
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


// Compose actual production render gate, Home/History renderers, registration,
// collector and registry. The DOM/adapter are external controlled sinks. Native
// app wiring is independently covered by the Home held-input acceptance journey.
test("deferred Home publication preserves mounted frame until acknowledged same-ID publication",()=>withShell(h=>{
  const oldSnapshot=Object.freeze({sideToMove:'P1',pieces:Object.freeze([])});
  const nextSnapshot=Object.freeze({sideToMove:'P2',pieces:Object.freeze([])});
  const card=snapshot=>Object.freeze({id:'same-card',previewPayload:Object.freeze({...preview,snapshot})});
  const first=card(oldSnapshot),next=card(nextSnapshot),root=h.renderModel('card',first);
  h.appEl.appendChild(root);h.reconcile();const original=h.payloads.get('home:same-card');
  let commits=0;
  const render=h.renderOwner(()=>{commits++;h.renderModel('card',next);h.reconcile();},{held:true});
  render();assert.equal(commits,0);assert.equal(h.payloads.get('home:same-card'),original);assert.equal(original.snapshot,oldSnapshot);
  render.release();assert.equal(commits,1);assert.equal(h.appEl.children[0],root);
  assert.equal(h.payloads.get('home:same-card').snapshot,nextSnapshot);
  assert.equal(h.events.filter(x=>x.type==='render').at(-1).options.snapshot,nextSnapshot);
  assert.equal(oldSnapshot.sideToMove,'P1');assert.equal(nextSnapshot.sideToMove,'P2');
}));
test("acknowledged equivalent same-ID model may replace references without duplicate adapter rendering",()=>withShell(h=>{
  const first=Object.freeze({id:'same-card',previewPayload:preview});const root=h.renderModel('card',first);h.appEl.appendChild(root);h.reconcile();
  const count=h.events.filter(x=>x.type==='render').length;
  const equivalentSnapshot=Object.freeze({sideToMove:'P1',pieces:Object.freeze([])});
  const next=Object.freeze({id:'same-card',previewPayload:Object.freeze({...preview,snapshot:equivalentSnapshot})});
  const render=h.renderOwner(()=>{h.renderModel('card',next);h.reconcile();},{});render();
  assert.equal(h.appEl.children[0],root);assert.equal(h.payloads.get('home:same-card').snapshot,equivalentSnapshot);
  assert.equal(h.events.filter(x=>x.type==='render').length,count);
}));
