import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestructionTransitions} from '../shell/destruction-transitions.js';
import {buildDestroyedPieceOverlays} from '../shell/history-preview.js';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';

const record=(id)=>({eventId:`command:${id}`,pieceId:id,position:{row:6,col:4},reason:'loss_of_supply',piece:{id,owner:'P1',kind:'unit',position:{row:6,col:4},supplied:false,commanded:false}});
const game=(records=[])=>({id:'g',moves:[{clientCommandId:'command',destroyedPieces:records}]});

test('new live records play once, including append on turn completion and pending confirmation',()=>{
 const t=createDestructionTransitions();
 assert.deepEqual(t.update(game()).effects,[]);
 assert.equal(t.update({...game(),pendingMoves:[{clientCommandId:'command',destroyedPieces:[record('A')]}]}).effects.length,1);
 assert.equal(t.update(game([record('A')])).effects.length,0);
 assert.equal(t.update(game([record('A'),record('B')])).effects.length,1);
 assert.equal(t.update(game([record('A'),record('B')])).effects.length,0);
});

test('initial load, reconnect, history exit, rollback and another game never replay old live events',()=>{
 const t=createDestructionTransitions();
 assert.equal(t.update(game([record('A')])).effects.length,0);
 assert.equal(t.update(game([record('A'),record('B')]),{reset:true}).effects.length,0);
 assert.equal(t.update({...game([record('A'),record('B')]),inHistoryMode:true}).clear,true);
 assert.equal(t.update({...game([record('A'),record('B')]),inHistoryMode:true}).clear,false,'benign notifications preserve an active history replay');
 assert.equal(t.update(game([record('A'),record('B')])).effects.length,0);
 assert.equal(t.update(game()).clear,true);
 assert.equal(t.update({...game([record('A')]),id:'another'}).effects.length,0);
});

test('history overlay uses removed piece identity and its actual removal square',()=>{
 const r=record('A');r.position={row:2,col:2};r.kind='unit';
 const [overlay]=buildDestroyedPieceOverlays({destroyedPieceRecords:[r],preActionSnapshot:{pieces:[{id:'other',kind:'commander',owner:'P2',position:r.position}]}});
 assert.equal(overlay.piece.id,'A');
 assert.equal(overlay.kind,'unit');
 assert.deepEqual(overlay.piece.position,{row:2,col:2});
});

test('runtime deduplicates confirmations and expires consecutive effects independently',async()=>{
 const original={now:Date.now,set:globalThis.setTimeout,clear:globalThis.clearTimeout};
 let now=1000;let timer;const renders=[];
 Date.now=()=>now;globalThis.setTimeout=(fn,delay)=>(timer={fn,delay});globalThis.clearTimeout=()=>{};
 try {
  const runtime=createBoardRuntime({boardAdapter:{mount(){},destroy(){},render:p=>renders.push(p),getSelectedPieceSummary:()=>null},host:{}});
  runtime.bindElements({boardEl:{},overlayLinesEl:{}});
  await runtime.loadSnapshot({pieces:[],sideToMove:'P1',turnIndex:0,continuation:null},{legalActions:[]});
  runtime.showRemovalEffects([record('A')]);
  now+=1000;
  runtime.showRemovalEffects([record('A'),record('B')]);
  assert.deepEqual(renders.at(-1).removalEffects.map(e=>e.startedAt),[1000,2000]);
  now=3400;timer.fn();
  assert.deepEqual(renders.at(-1).removalEffects.map(e=>e.pieceId),['B']);
  assert.equal(timer.delay,1000);
  now=4400;timer.fn();
  assert.deepEqual(renders.at(-1).removalEffects,[]);
  runtime.showRemovalEffects([record('A')]);
  assert.deepEqual(renders.at(-1).removalEffects,[],'an expired confirmation does not restart playback');
  runtime.clearRemovalEffects();
 }finally{Date.now=original.now;globalThis.setTimeout=original.set;globalThis.clearTimeout=original.clear;}
});

test('recovery establishes a silent baseline and preserves no live effects',()=>{
 const t=createDestructionTransitions();t.update(game());
 const catchingUp=t.update({...game([record('A')]),recovering:true});
 assert.deepEqual(catchingUp.effects,[]);assert.equal(catchingUp.clear,true);
 assert.deepEqual(t.update(game([record('A')])).effects,[]);
 assert.equal(t.update(game([record('A'),record('B')])).effects.length,1);
});
