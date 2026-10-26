import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {createEngineBoardAdapter} from '../board-adapters/engine-board-adapter.js';
import {updateComputerBoardLoading} from '../shell/board-message-layout.js';

const noop=()=>{};
const preview=()=>({value:'',get innerHTML(){return this.value;},set innerHTML(value){this.value=value;},get textContent(){return this.value;},set textContent(value){this.value=value;},querySelectorAll:()=>[],addEventListener:noop,removeEventListener:noop});
const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[{id:'C1',owner:'P1',kind:'commander',position:{row:3,col:3},supplied:true,commanded:true}]};
const project={type:'project',actorId:'C1',from:{row:3,col:3},to:{row:5,col:3}};

test('status-only refresh follows an admission gate without reloading state or losing selection',async()=>{
 let blocked=true,submissions=0,pieceReads=0;
 const label=preview(),adapter=createEngineBoardAdapter();
 const runtime=createBoardRuntime({boardAdapter:{...adapter,mount:noop,render:noop},host:{canInteract:()=>!blocked,loadPieceMoves:async()=>{pieceReads++;return {state,actions:[project],previewActions:[project]};},applyAction:async()=>{submissions++;}},controls:{getBoardMessage:()=>blocked?'Waiting for the game':null}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot(state,{legalActions:[{type:'pass'},project]});
 const canonical=runtime.getState(),legal=runtime.getLegalActions();
 assert.equal(label.value,'Waiting for the game');assert.doesNotMatch(label.value,/<button/);
 blocked=false;runtime.refreshStatus();
 assert.match(label.value,/Select a piece/);assert.match(label.value,/data-board-preview-action="pass"/);
 blocked=true;runtime.refreshStatus();
 assert.equal(label.value,'Waiting for the game');assert.doesNotMatch(label.value,/<button/);
 blocked=false;runtime.refreshStatus();
 assert.match(label.value,/data-board-preview-action="pass"/);
 assert.strictEqual(runtime.getState(),canonical);assert.strictEqual(runtime.getLegalActions(),legal);
 await runtime.loadSnapshot(state,{legalActions:legal,selectionState:{selectedPieceId:'C1',source:project.from,target:null}});
 const selection=structuredClone(runtime.getSelection()),reads=pieceReads;
 assert.equal(selection.selectedPieceId,'C1');assert(reads>0);
 assert.match(label.value,/Select a move/);
 for(const gate of [true,false,true,false]){
  blocked=gate;runtime.refreshStatus();
  assert.deepEqual(runtime.getSelection(),selection);
  assert.equal(pieceReads,reads,'changing status must not reload selection moves');
  assert.doesNotMatch(label.value,/data-board-preview-action="pass"/);
  if(gate){assert.equal(label.value,'Waiting for the game');assert.doesNotMatch(label.value,/<button/);}
  else assert.match(label.value,/Select a move/);
 }
 assert.equal(submissions,0);
});

test('status-only refresh preserves a separate ongoing computer cue operation',async()=>{
 let blocked=true;
 const cue={dataset:{loadingState:'idle'},hasAttribute(name){return name==='data-loading-key'&&this.dataset.loadingKey!==undefined;},removeAttribute(){delete this.dataset.loadingKey;}};
 const label=preview(),adapter=createEngineBoardAdapter();
 const game={id:'status-game',computer:{},computerTurn:'horus',board:{state}};
 const runtime=createBoardRuntime({boardAdapter:{...adapter,mount:noop,render:noop},host:{canInteract:()=>!blocked},controls:{getBoardMessage:()=>{
  updateComputerBoardLoading(cue,game,{phase:'checking'},{scope:'account-1'});
  return blocked?'Waiting for the game':null;
 }}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot(state,{legalActions:[{type:'pass'}]});
 const key=cue.dataset.loadingKey;assert(key);assert.equal(cue.dataset.loadingState,'pending');
 for(const gate of [false,true,false]){blocked=gate;runtime.refreshStatus();assert.equal(cue.dataset.loadingKey,key);assert.equal(cue.dataset.loadingState,'pending');}
 assert.match(label.value,/data-board-preview-action="pass"/);
});

test('a required defender retains legal retreat previews across a temporary recovery gate',async()=>{
 let blocked=true,hover,click,submissions=0;
 const label=preview(),adapter=createEngineBoardAdapter();
 const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
 const snapshot={boardSize:10,sideToMove:'P2',turnIndex:0,outcome:{status:'ongoing'},continuation:{type:'push',owner:'P2',attackerOwner:'P1',phase:'retreat',attackerId:'A1',pushedPieceId:'D1'},pieces:[piece('C1','P1','commander',3,1),piece('C2','P2','commander',4,4),piece('A1','P1','unit',4,2),piece('D1','P2','unit',4,2)]};
 const retreat={type:'retreat',actorId:'D1',from:{row:4,col:2},to:{row:3,col:2}},other={...retreat,to:{row:5,col:2}};
 const runtime=createBoardRuntime({boardAdapter:{...adapter,mount:options=>{hover=options.onCellHoverStart;click=options.onCellClick;},render:noop},host:{canSelect:()=>true,canInteract:()=>!blocked,applyAction:async()=>{submissions++;},loadPieceMoves:async()=>({state:snapshot,actions:[retreat,other],previewActions:[retreat,other]})},controls:{getSupportsHover:()=>true}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot(snapshot,{legalActions:[retreat,other]});
 assert.equal(runtime.getSelection().selectedPieceId,'D1');
 click(retreat.to);click(retreat.to);
 assert.equal(runtime.getSelection().selectedPieceId,null,'blocked empty-square inspection clears the forced selection');
 assert.equal(submissions,0,'uncertain delivery cannot submit the next action');
 blocked=false;runtime.refreshStatus();hover(retreat.to);
 assert.deepEqual(runtime.getSelection().target,retreat.to,'admission restoration reinstates the required defender before selecting its legal destination');
});
