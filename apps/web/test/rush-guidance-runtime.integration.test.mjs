import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBoardRuntime } from '../board/runtime/board-runtime.js';
import { analyzeRushSupplyGuidance, listLegalActions } from '../generated/packages/game-engine/src/index.js';

const state=JSON.parse(readFileSync(new URL('../scenarios/catalog.json',import.meta.url))).scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;
const legal=listLegalActions(state), result=analyzeRushSupplyGuidance(state);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  let html='', render, resolve, reject, canceled=0;
  const client={analyze:()=>new Promise((a,b)=>{resolve=a;reject=b;}),cancel:()=>canceled++,destroy:()=>canceled++};
  const adapter={mount(){},render(input){render=input;},getPieceById:(s,id)=>s.pieces.find(p=>p.id===id),getPieceAt:(s,point)=>s.pieces.find(p=>p.position.row===point.row&&p.position.col===point.col),getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null};
  const runtime=createBoardRuntime({boardAdapter:adapter,rushGuidanceClient:client,host:{
    loadPieceMoves:async(_s,id)=>({actions:legal.filter(a=>a.actorId===id),previewActions:legal.filter(a=>a.actorId===id)}),
  }});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:{get innerHTML(){return html;},set innerHTML(v){html=v;},get textContent(){return html;},set textContent(v){html=v;},addEventListener(){},removeEventListener(){}}});
  return {runtime,get html(){return html;},get render(){return render;},get canceled(){return canceled;},complete:()=>resolve(result),fail:()=>reject(new Error('timeout'))};
}

test('loading keeps legal play and sole-source completion selects the useful piece',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();
  assert.match(f.html,/Obligatory/);assert.match(f.html,/Finding rushes that restore supply/);
  assert.deepEqual(f.runtime.getLegalActions(),legal);
  f.complete();await flush();
  assert.equal(f.runtime.getSelection().selectedPieceId,'U1-7');
  assert.deepEqual(f.render.rushSupplyGuidance,result);
  assert.match(f.html,/Rush to restore supply/);
  await f.runtime.setSelectionFromAction(result.actions[0].action);
  assert.match(f.html,/Restores required supply/);
  assert.match(f.html,/Obligatory/);
});

test('guidance preserves a selection made while analysis runs',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();
  await f.runtime.setSelectionFromAction(legal.find(a=>a.actorId==='C1'));
  f.complete();await flush();assert.equal(f.runtime.getSelection().selectedPieceId,'C1');
});

test('failed analysis restores the original reconnect copy and legal highlights',async()=>{
  const f=fixture();await f.runtime.loadSnapshot(state,{legalActions:legal});await flush();f.fail();await flush();
  assert.match(f.html,/Rush to reconnect piece at/);assert.doesNotMatch(f.html,/Finding|Obligatory/);
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
  let html='';
  const runtime=createBoardRuntime({rushGuidanceClient:client,boardAdapter:{mount(){},render(){},getSelectedPieceSummary:()=>null},host:{}});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:{get innerHTML(){return html;},set innerHTML(v){html=v;},addEventListener(){},removeEventListener(){}}});
  await runtime.loadSnapshot(state,{legalActions:legal});await flush();assert.equal(jobs.length,1);
  events.get('pagehide')();events.get('pageshow')();await flush();assert.equal(jobs.length,2);
  jobs[0].reject(new Error('canceled'));await flush();assert.match(html,/Finding rushes/);
  // Several sources leave the player in control of which piece to choose.
  jobs[1].resolve({...result,actions:[...result.actions,{action:legal.find(a=>a.actorId==='C1'),immediate:false}]});
  await flush();assert.equal(runtime.getSelection().selectedPieceId,null);assert.doesNotMatch(html,/Finding/);assert.match(html,/Obligatory/);
  runtime.destroy();
});
