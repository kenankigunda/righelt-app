import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import { createRenderGestureGate, preserveBoardFocus } from "../shell/render-gesture.js";

test("background renders keep a pressed control until activation, cancellation or drag end", () => {
  const jobs = new Map(),
    renders = [];
  let id = 0;
  const gate = createRenderGestureGate({
    render: (options) => renders.push(options),
    schedule: (fn) => {
      jobs.set(++id, fn);
      return id;
    },
    cancel: (id) => jobs.delete(id),
  });
  assert.equal(gate.defer({ includeBoard: false }), false);
  gate.begin();
  assert.equal(gate.defer({ includeBoard: true }), true);
  assert.equal(gate.defer({ includeBoard: false, animatePanels: false }), true);
  gate.end();
  assert.equal(
    renders.length,
    0,
    "release does not render before click handlers run",
  );
  assert.equal(gate.defer({ includeBoard: false, animatePanels: false }), true);
  for (const fn of jobs.values()) fn();
  jobs.clear();
  assert.deepEqual(renders, [{ includeBoard: true, animatePanels: false }]);
  assert.equal(gate.defer({}), false);
  gate.begin();
  gate.defer({ includeBoard: false });
  gate.end();
  gate.begin();
  assert.equal(jobs.size, 0, "new gesture cancels old delayed flush");
  gate.end();
  for (const fn of jobs.values()) fn();
  jobs.clear();
  assert.equal(renders.length, 2);
  gate.destroy();
});


test("board renders preserve the keyboard coordinate without overriding new focus or navigation", () => {
  for (const mode of ["replace", "connected", "dialog", "other-game", "disabled"]) {
    const body = {}, modal = {}, calls = [];
    const cell = { matches: () => true, dataset: { row: "2", col: "3" }, isConnected: true };
    const replacement = { dataset: { row: "2", col: "3" }, disabled: mode === "disabled", focus: options => calls.push(options) };
    const document = { activeElement: cell, body, querySelectorAll: () => [replacement] };
    let gameId = "original";
    const result = preserveBoardFocus({ document, getGameId: () => gameId }, () => {
      cell.isConnected = mode === "connected";
      document.activeElement = mode === "dialog" ? modal : mode === "connected" ? cell : body;
      if (mode === "other-game") gameId = "different";
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(calls, mode === "replace" ? [{ preventScroll: true }] : [], mode);
  }
});


// Execute the actual app event registrations with the real gate. The scheduler
// models its existing next-task release; it never synthesizes an activation.
const registeredGesture = async () => {
  const source = await readFile(new URL('../shell/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('const renderGesture = createRenderGestureGate(');
  const end = source.indexOf('// Background shell updates', start);
  assert.ok(start > 0 && end > start);
  const listeners = new Map(), jobs = new Map(), renders = [];
  let serial = 0;
  const window = {addEventListener(type, callback) { const list = listeners.get(type) ?? []; list.push(callback); listeners.set(type, list); }};
  const document = {visibilityState:'visible', addEventListener:window.addEventListener};
  const appEl = {contains:target => target?.inside !== false};
  const sandbox = {window, document, appEl, render:options => renders.push(options), createRenderGestureGate:({render}) => createRenderGestureGate({render,schedule:fn => {jobs.set(++serial,fn);return serial;},cancel:id=>jobs.delete(id)})};
  vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+'\nglobalThis.actualGate=renderGesture;', sandbox);
  const target = ({inside=true,control=true}={}) => ({inside,closest(selector){assert.equal(selector,'button, a, [data-action]');return control?this:null;}});
  return {gate:sandbox.actualGate,renders,jobs,window,document,target,emit(type,event={}){for(const fn of listeners.get(type)??[])fn(event);},flush(){const work=[...jobs.values()];jobs.clear();for(const fn of work)fn();}};
};

test('registered legacy mouse press keeps the control mounted until activation', async () => {
  const h=await registeredGesture(),target=h.target();
  h.emit('mousedown',{target});
  assert.equal(h.gate.defer({includeBoard:true}),true,'actual mouse handler must hold the original control');
  h.emit('mouseup',{target});assert.equal(h.renders.length,0);
  h.emit('click',{target});assert.equal(h.renders.length,0,'release waits until original click dispatch completes');
  h.flush();assert.equal(h.renders.length,1);assert.equal(h.renders[0].includeBoard,true);assert.equal(h.gate.defer({}),false);
});

test('registered pointer and compatibility mouse events share one release', async () => {
  const h=await registeredGesture(),target=h.target();
  h.emit('pointerdown',{target});h.emit('mousedown',{target});assert.equal(h.gate.defer({includeBoard:true}),true);
  h.emit('pointerup',{target});h.emit('mouseup',{target});h.emit('click',{target});assert.equal(h.jobs.size,1);h.flush();assert.equal(h.renders.length,1);
  h.emit('mousedown',{target});h.gate.defer({includeBoard:false});h.emit('mouseup',{target});h.emit('mousedown',{target});assert.equal(h.jobs.size,0,'new press cancels prior release');h.emit('mouseup',{target});h.flush();assert.equal(h.renders.length,2);
});

test('registered mouse fallback excludes outside and noncontrol targets and releases on cancellation', async () => {
  for(const options of [{inside:false},{control:false}]){const h=await registeredGesture();h.emit('mousedown',{target:h.target(options)});assert.equal(h.gate.defer({}),false);}
  for(const type of ['pointercancel','touchcancel','lostpointercapture','blur','visibilitychange']){
    const h=await registeredGesture();h.emit('mousedown',{target:h.target()});assert.equal(h.gate.defer({includeBoard:true}),true);
    if(type==='visibilitychange')h.document.visibilityState='hidden';
    h.emit(type,{target:type==='blur'?h.window:h.target()});h.flush();assert.equal(h.renders.length,1,type);assert.equal(h.gate.defer({}),false);
  }
});
