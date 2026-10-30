import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';

const noop=()=>{};
const fixture=()=>{
 const piece={id:'A',owner:'P1',kind:'unit',position:{row:4,col:4},supplied:true,commanded:true};
 const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece]};
 const move={type:'move',actorId:'A',from:piece.position,to:{row:4,col:5}};
 const queries=[],views=[];let click,interactive=true;
 const label={innerHTML:'',textContent:'',setAttribute:noop,removeAttribute:noop,addEventListener:noop,removeEventListener:noop};
 const runtime=createBoardRuntime({boardAdapter:{mount:({onCellClick})=>{click=onCellClick;},render:view=>views.push(view),
  getPieceAt:(snapshot,at)=>snapshot.pieces.find(p=>p.position.row===at.row&&p.position.col===at.col),
  getPieceById:(snapshot,id)=>snapshot.pieces.find(p=>p.id===id),
  getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null,
  nextSelectionForCell:({snapshot,clickedCoord})=>{const selected=snapshot.pieces.find(p=>p.position.row===clickedCoord.row&&p.position.col===clickedCoord.col);return {selection:{selectedPieceId:selected?.id??null,source:selected?.position??null,target:null},nextActionType:'move'};}},
  host:{asyncPieceMoves:true,canSelect:()=>true,canInteract:()=>interactive,loadPieceMoves:(snapshot,pieceId)=>new Promise(resolve=>queries.push({snapshot,pieceId,resolve}))}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 return {runtime,piece,state,move,queries,views,label,click:at=>click(at??piece.position),gate:value=>{interactive=value;runtime.refreshStatus();},
  selected:actions=>runtime.loadSnapshot(state,{legalActions:actions,selectionState:{selectedPieceId:'A',source:piece.position,target:null}}),
  finish:previews=>queries.forEach(query=>query.resolve({state,actions:previews.filter(a=>a.legal!==false),previewActions:previews}))};
};

test('own selection keeps move intent before and after deferred blocked-only previews',async()=>{
 const f=fixture(),loading=f.selected([]);
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'actionPreviews');
 assert.match(f.label.innerHTML,/Select a move for piece at/);
 assert.doesNotMatch(f.label.innerHTML,/Supply and command lines|No moves/);
 f.finish([{...f.move,legal:false,blockedReason:'SUPPLY_DESTINATION_UNSUPPLIED'}]);await loading;
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'actionPreviews');
 assert.match(f.label.innerHTML,/Select a move for piece at/);
});

test('an explicit inspection toggle during a deferred query survives its result',async()=>{
 const f=fixture(),loading=f.selected([]);
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'actionPreviews');
 f.click();assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'supplyCommand');
 assert.match(f.label.innerHTML,/Supply and command lines for piece at/);
 f.finish([f.move]);await loading;
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'supplyCommand');
 assert.match(f.label.innerHTML,/Supply and command lines for piece at/);
});

test('the synchronous legal subset is visible before a full preview query completes',async()=>{
 const f=fixture(),loading=f.selected([f.move]);
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'actionPreviews');
 assert.deepEqual(f.views.at(-1).selectedPieceMovePreviews,[f.move]);
 f.finish([f.move]);await loading;
});

test('No moves appears only after the complete empty result is known',async()=>{
 const f=fixture(),loading=f.selected([]);
 assert.doesNotMatch(f.label.innerHTML,/No moves/);
 f.finish([]);await loading;
 assert.match(f.label.innerHTML,/No moves/);
});

test('a native piece click starts one preview query and repeated reloads share it',async()=>{
 const f=fixture();await f.runtime.loadSnapshot(f.state,{legalActions:[]});
 f.click();const repeated=f.runtime.reloadSelectedPieceMoves();
 assert.equal(f.queries.length,1);
 f.finish([f.move]);await repeated;
});

test('a late unique ordinary move does not choose a target without explicit input',async()=>{
 const f=fixture();await f.runtime.loadSnapshot(f.state,{legalActions:[]});f.click();
 const loading=f.runtime.reloadSelectedPieceMoves();
 assert.match(f.label.innerHTML,/Select a move for piece at/);
 f.finish([f.move]);await loading;
 assert.equal(f.runtime.getSelection().target,null);
 assert.match(f.label.innerHTML,/Select a move for piece at/);
 await f.runtime.reloadSelectedPieceMoves();
 assert.equal(f.runtime.getSelection().target,null,'a background cache hit also cannot choose a target');
});

test('an initially synchronous unique legal target keeps its existing behavior',async()=>{
 const f=fixture();await f.runtime.loadSnapshot(f.state,{legalActions:[f.move]});f.click();
 assert.deepEqual(f.runtime.getSelection().target,f.move.to);
 f.finish([f.move]);await f.runtime.reloadSelectedPieceMoves();
});

test('identical authoritative refresh preserves a pending query and explicit inspection',async()=>{
 const f=fixture(),loading=f.selected([]);f.click();
 await f.runtime.loadSnapshot(structuredClone(f.state),{legalActions:[],resetSelection:false});
 assert.equal(f.queries.length,1);
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'supplyCommand');
 f.finish([f.move]);await loading;
 assert.equal(f.views.at(-1).selectedPieceOverlayPhase,'supplyCommand');
 await f.runtime.loadSnapshot(structuredClone(f.state),{legalActions:[],resetSelection:false});
 await f.runtime.reloadSelectedPieceMoves();
 assert.equal(f.queries.length,1,'completed exact-input previews remain reusable');
});

test('changed authoritative inputs fence pending results and completed preview reuse',async()=>{
 const f=fixture(),loading=f.selected([]);
 const changed={...f.state,turnIndex:1};
 const next=f.runtime.loadSnapshot(changed,{legalActions:[],resetSelection:false,selectionState:{selectedPieceId:'A',source:f.piece.position,target:null}});
 assert.equal(f.queries.length,2);
 f.queries[0].resolve({state:f.state,actions:[f.move],previewActions:[f.move]});await loading;
 assert.deepEqual(f.views.at(-1).selectedPieceMovePreviews,[]);
 f.queries[1].resolve({state:changed,actions:[],previewActions:[]});await next;
 assert.match(f.label.innerHTML,/No moves/);
});

test('changed legality invalidates a completed preview even at the same position',async()=>{
 const f=fixture(),loading=f.selected([]);f.finish([f.move]);await loading;
 const next=f.runtime.loadSnapshot(f.state,{legalActions:[f.move],resetSelection:false,selectionState:{selectedPieceId:'A',source:f.piece.position,target:null}});
 assert.equal(f.queries.length,2);
 f.queries[1].resolve({state:f.state,actions:[],previewActions:[]});await next;
 assert.match(f.label.innerHTML,/No moves/);
});

test('changing the selected actor fences the previous actor result',async()=>{
 const f=fixture(),other={...f.piece,id:'B',position:{row:5,col:5}};f.state.pieces.push(other);
 const loading=f.selected([]);f.click(other.position);assert.equal(f.queries.length,2);
 f.queries[0].resolve({state:f.state,actions:[f.move],previewActions:[f.move]});await loading;
 assert.equal(f.runtime.getSelection().selectedPieceId,'B');
 assert.deepEqual(f.views.at(-1).selectedPieceMovePreviews,[]);
 const blocked={...f.move,actorId:'B',from:other.position,legal:false};
 f.queries[1].resolve({state:f.state,actions:[],previewActions:[blocked]});await f.runtime.reloadSelectedPieceMoves();
 assert.deepEqual(f.views.at(-1).selectedPieceMovePreviews,[blocked]);
});

test('a commander enters combined inspection while previews are pending and skips an empty command step',async()=>{
 const f=fixture();f.piece.kind='commander';const loading=f.selected([]);
 f.click();assert.equal(f.runtime.getInspection()?.kind,'combined');
 assert.match(f.label.innerHTML,/Supply and command lines for piece at/);
 f.finish([]);await loading;
 assert.equal(f.runtime.getInspection()?.kind,'combined');
 f.click();assert.equal(f.runtime.getInspection(),null);
 assert.match(f.label.innerHTML,/No moves/);
});

test('the full commander cycle is independent of pending previews and transient admission',async()=>{
 const f=fixture();f.piece.kind='commander';
 f.state.pieces.push({...f.piece,id:'B',kind:'unit',position:{row:4,col:5}});
 f.state.artifacts={command:{shortestPathToCommanderByPieceId:{B:[{row:4,col:5},f.piece.position]}}};
 const loading=f.selected([]);f.gate(false);
 f.click();assert.equal(f.runtime.getInspection()?.kind,'combined');
 f.click();assert.equal(f.runtime.getInspection()?.kind,'command');
 f.finish([]);await loading;
 assert.equal(f.runtime.getInspection()?.kind,'command');
 f.click();assert.equal(f.runtime.getInspection(),null);assert.match(f.label.innerHTML,/No moves/);
 assert.equal(f.queries.length,1);
});
