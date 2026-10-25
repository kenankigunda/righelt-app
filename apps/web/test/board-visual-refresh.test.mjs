import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
const noop=()=>{};
test('layout refresh rerenders visual geometry without transport, selection, status cue or removal-clock changes',async t=>{
 const previousDocument=globalThis.document;globalThis.document={removeEventListener:noop};
 const renders=[];let requests=0,statusCalls=0;
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,unmount:noop,render:value=>renders.push(value),getSelectedPieceSummary:()=>null},host:{canInteract:()=>false,loadLegalActions:()=>{requests++;},loadPieceMoves:()=>{requests++;},applyAction:()=>{requests++;}},controls:{getBoardMessage:()=>{statusCalls++;return 'Tau is thinking';}}});
 t.after(()=>{runtime.destroy();globalThis.document=previousDocument;});runtime.refreshVisuals();assert.equal(renders.length,0);
 runtime.bindElements({boardEl:{},overlayLinesEl:{}});
 const state={sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'},pieces:[{id:'A',owner:'P1',kind:'unit',position:{row:4,col:4},supplied:true,commanded:true}]};
 await runtime.loadSnapshot(state,{legalActions:[],selectionState:{selectedPieceId:'A',selectedSource:{row:4,col:4},selectedTarget:null}});
 runtime.showRemovalEffects([{eventId:'effect',pieceId:'removed',position:{row:5,col:5},reason:'loss_of_supply'}],state);
 const before={state:structuredClone(runtime.getState()),selection:structuredClone(runtime.getSelection()),overlay:structuredClone(runtime.getOverlay()),effect:renders.at(-1).removalEffects[0],statusCalls};
 const count=renders.length;runtime.refreshVisuals();assert.equal(renders.length,count+1);assert.equal(requests,0);assert.equal(statusCalls,before.statusCalls);
 assert.deepEqual(runtime.getState(),before.state);assert.deepEqual(runtime.getSelection(),before.selection);assert.deepEqual(runtime.getOverlay(),before.overlay);assert.deepEqual(renders.at(-1).removalEffects[0],before.effect);
 runtime.destroy();const finished=renders.length;runtime.refreshVisuals();assert.equal(renders.length,finished);
});
