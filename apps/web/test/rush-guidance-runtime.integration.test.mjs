import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import { createBoardRuntime } from '../board/runtime/board-runtime.js';
import { analyzeRushSupplyGuidance, listLegalActions, createInitialState, getRushUnsuppliedPieceIds } from '../generated/packages/game-engine/src/index.js';

const state=JSON.parse(readFileSync(new URL('../scenarios/catalog.json',import.meta.url))).scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;
const legal=listLegalActions(state), result=analyzeRushSupplyGuidance(state);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(controls={},onRender=()=>{}) {
  let html='', context=null, render, resolve, reject, canceled=0;
  const client={analyze:()=>new Promise((a,b)=>{resolve=a;reject=b;}),cancel:()=>canceled++,destroy:()=>canceled++};
  const adapter={mount(){},render(input){onRender(input);render=input;},getPieceById:(s,id)=>s.pieces.find(p=>p.id===id),getPieceAt:(s,point)=>s.pieces.find(p=>p.position.row===point.row&&p.position.col===point.col),getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null};
  const runtime=createBoardRuntime({boardAdapter:adapter,rushGuidanceClient:client,controls:{...controls,onBoardContext:value=>{context=value;}},host:{
    loadPieceMoves:async(_s,id)=>({actions:legal.filter(a=>a.actorId===id),previewActions:legal.filter(a=>a.actorId===id)}),
  }});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:{get innerHTML(){return html;},set innerHTML(v){html=v;},get textContent(){return html;},set textContent(v){html=v;},addEventListener(){},removeEventListener(){}}});
  return {runtime,get html(){return html;},get contextHtml(){return context?renderBoardMessageHtml(context.message):'';},get render(){return render;},get canceled(){return canceled;},complete:(value=result)=>resolve(value),fail:(error=new Error('timeout'))=>reject(error)};
}

test('loading keeps legal play and sole-source completion selects the useful piece',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();
  assert.match(f.html,/Obligatory/);assert.match(f.contextHtml,/Finding rushes that restore supply/);
  assert.deepEqual(f.runtime.getLegalActions(),legal);
  f.complete();await flush();
  assert.equal(f.runtime.getSelection().selectedPieceId,'U1-7');
  assert.deepEqual(f.render.rushSupplyGuidance,result);
  assert.doesNotMatch(f.html,/Rush to restore supply|Obligatory/,'automatic selection replaces the complete global warning');
  await f.runtime.setSelectionFromAction(result.actions[0].action);
  assert.match(f.contextHtml,/Restores required supply/);
  assert.doesNotMatch(f.html,/Obligatory|Rush to restore supply/);
  assert.equal((f.html.match(/class="board-message-row"/g)||[]).length,0,'short confirmation stays in the Board prompt');
  assert.match(f.contextHtml,/Restores required supply/,'known effect remains available in context');
});

test('guidance preserves a selection made while analysis runs',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();
  await f.runtime.setSelectionFromAction(legal.find(a=>a.actorId==='C1'));
  f.complete();await flush();assert.equal(f.runtime.getSelection().selectedPieceId,'C1');
});

test('failed analysis preserves all required-piece copy and retry without changing legal highlights',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();f.fail();await flush();
  assert.match(f.contextHtml,/Rush to restore supply/);assert.match(f.html,/Obligatory/);assert.doesNotMatch(f.html,/Finding/);assert.match(f.contextHtml,/Hints unavailable/);assert.match(f.html,/Try again/);
  assert.equal(f.render.rushSupplyGuidance,null);assert.deepEqual(f.runtime.getLegalActions(),legal);
});

test('late guidance cannot repaint a newer snapshot or history view',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();
  await f.runtime.loadSnapshot({...state,continuation:null},{legalActions:[],overlayMode:'recorded-action'});
  f.complete();await flush();assert.equal(f.render.rushSupplyGuidance,null);assert.doesNotMatch(f.html,/Obligatory/);
  assert.ok(f.canceled>=2);
});

test('pageshow restarts guidance without a selection and rejects a canceled same-snapshot generation',async t=>{
  const originalDocument=globalThis.document,originalWindow=globalThis.window;
  const events=new Map();globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.window={addEventListener:(type,handler)=>events.set(type,handler),removeEventListener(){}};
  t.after(()=>{globalThis.document=originalDocument;globalThis.window=originalWindow;});
  const jobs=[];
  const client={analyze:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject})),cancel(){},destroy(){}};
  let html='',context=null;
  const runtime=createBoardRuntime({rushGuidanceClient:client,boardAdapter:{mount(){},render(){},getPieceById:(snapshot,id)=>snapshot.pieces.find(piece=>piece.id===id),getSelectedPieceSummary:()=>null},controls:{onBoardContext:value=>{context=value;}},host:{}});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:{get innerHTML(){return html;},set innerHTML(v){html=v;},addEventListener(){},removeEventListener(){}}});
  await runtime.loadSnapshot(state,{legalActions:legal});await flush();assert.equal(jobs.length,1);
  events.get('pagehide')();events.get('pageshow')();await flush();assert.equal(jobs.length,2);
  jobs[0].reject(new Error('canceled'));await flush();assert.match(renderBoardMessageHtml(context.message),/Finding rushes/);
  // Several sources leave the player in control of which piece to choose.
  jobs[1].resolve({...result,actions:[...result.actions,{action:legal.find(a=>a.actorId==='C1'),immediate:false}]});
  await flush();assert.equal(runtime.getSelection().selectedPieceId,null);assert.doesNotMatch(html,/Finding|board-rush-guidance-sizing/);assert.match(html,/Obligatory/);
  runtime.destroy();
});

test('a late hint failure with no remaining required pieces preserves optional rush and legal End turn',async()=>{
 const snapshot=structuredClone(state),f=fixture();
 await f.runtime.loadSnapshot(snapshot,{legalActions:[...legal,{type:'end_turn'}]});await flush();
 // Exercise the defensive repaint boundary while a pending hint fails: the
 // latest piece collection is now a real supplied optional continuation.
 const current=f.runtime.getState();current.pieces=createInitialState().pieces;
 current.continuation={type:'rush',owner:'P1',rushedPieceIds:[],chainLength:1};
 assert.deepEqual(getRushUnsuppliedPieceIds(current),[]);
 f.fail();await flush();
 assert.match(f.html,/Select a rush/);assert.match(f.html,/End turn/);
 assert.doesNotMatch(f.html,/Hints unavailable|Try again|Obligatory|restore supply to the pieces at/);
});

test('guidance observation preserves failed copy/legal actions and a throwing sink cannot affect rendering',async t=>{
 const previous=globalThis.document;globalThis.document={removeEventListener(){}};t.after(()=>{globalThis.document=previous;});
 for(const throws of [false,true]){
  const events=[];const f=fixture({onGuidanceDiagnostic:event=>{events.push(event);if(throws)throw Error('sink unavailable');}});
  await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();f.fail(Object.assign(new Error('private raw payload'),{code:'rules_budget_exceeded'}));await flush();
  assert.match(f.contextHtml,/Hints unavailable/);assert.deepEqual(f.runtime.getLegalActions(),legal);
  const failed=events.filter(event=>event.phase==='failed');assert.equal(failed.length,1);assert.equal(failed[0].code,'rules_budget_exceeded');assert.equal(failed[0].stage,'request');
  assert.equal(JSON.stringify(failed).includes('private raw payload'),false);
  f.runtime.refreshVisuals();assert.equal(events.filter(event=>event.phase==='failed').length,1);
  f.runtime.destroy();
 }
});


test('a success-publication exception is attributed to presentation rather than worker analysis',async t=>{
 const previous=globalThis.document;globalThis.document={removeEventListener(){}};t.after(()=>{globalThis.document=previous;});
 const events=[];let fail=true;const f=fixture({onGuidanceDiagnostic:event=>events.push(event)},input=>{if(fail&&input.rushSupplyGuidance){fail=false;throw Error('private renderer details');}});
 await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();f.complete();await flush();
 const failed=events.find(event=>event.phase==='failed');assert.ok(failed);assert.equal(failed.stage,'presentation');assert.equal(failed.code,'unavailable');
 let baselineFailure=true;const baseline=fixture({},input=>{if(baselineFailure&&input.rushSupplyGuidance){baselineFailure=false;throw Error('same presentation failure');}});
 await baseline.runtime.loadSnapshot(state,{legalActions:legal});await flush();baseline.complete();await flush();
 assert.equal(f.html,baseline.html,'observation must preserve the original selected confirmation after publication fails');
 assert.equal(f.contextHtml,baseline.contextHtml,'observation preserves the current finite Board context');
 assert.deepEqual(f.runtime.getSelection(),baseline.runtime.getSelection());assert.match(f.html,/Confirm/);
 assert.deepEqual(f.runtime.getLegalActions(),legal);f.runtime.destroy();baseline.runtime.destroy();
});


test('an empty current analysis result records validation failure without losing required actions or context',async t=>{
 const previous=globalThis.document;globalThis.document={removeEventListener(){}};t.after(()=>{globalThis.document=previous;});
 const events=[],f=fixture({onGuidanceDiagnostic:event=>events.push(event)});
 await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();f.complete({actions:[]});await flush();
 const failed=events.filter(event=>event.phase==='failed');assert.equal(failed.length,1);
 assert.equal(failed[0].stage,'result-validation');assert.equal(failed[0].code,'empty_rush_guidance');
 assert.deepEqual(f.runtime.getLegalActions(),legal);assert.equal(f.render.rushSupplyGuidance,null);
 assert.match(f.contextHtml,/Hints unavailable/);assert.match(f.html,/Try again/);
 f.runtime.destroy();assert.equal(events.at(-1).phase,'retired');
});
