import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
const noop=()=>{};
for(const id of ['pass','end-turn'])test(`actual runtime keeps blocked ${id} node and native availability stable across no-op refreshes`,async t=>{
 let allowed=true,disabled=false,click,htmlWrites=0;const writes=[],labelText={textContent:id==='pass'?'Pass':'End turn'},text={nodeType:3,nodeValue:'Choose '};
 const button={dataset:{boardMessageAction:id},children:[{},labelText],querySelector:()=>labelText,get disabled(){return disabled;},set disabled(value){writes.push(value);disabled=value;}};
 const label={firstChild:text,childNodes:[text,button],querySelectorAll:()=>[button],addEventListener:(type,fn)=>{if(type==='click')click=fn;},removeEventListener:noop,get innerHTML(){return ''},set innerHTML(_value){htmlWrites++;}};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>allowed,getMutationSurface:()=>({pulsing:true,phaseMs:325,episodeId:'incident'})},controls:{getBoardMessage:()=>({text:'Choose',action:{id,label:labelText.textContent}})}});
 t.after(()=>{const saved=Object.getOwnPropertyDescriptor(globalThis,'document');try{Object.defineProperty(globalThis,'document',{configurable:true,value:{removeEventListener:noop}});runtime.destroy();}finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete globalThis.document;}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});await runtime.loadSnapshot({sideToMove:'P1',turnIndex:0,pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
 assert.deepEqual(writes,[]);allowed=false;runtime.refreshStatus();assert.equal(button.disabled,true);assert.deepEqual(writes,[true]);assert.equal(button.dataset.mutationUnavailable,'true');assert.equal(button.dataset.mutationPulse,'true');
 for(let i=0;i<4;i++)runtime.refreshStatus();assert.deepEqual(writes,[true],'blocked status refresh never writes a temporary false');assert.equal(label.childNodes[1],button);assert.equal(htmlWrites,0);assert.equal(typeof click,'function');
 allowed=true;runtime.refreshStatus();runtime.refreshStatus();assert.deepEqual(writes,[true,false]);assert.equal(label.childNodes[1],button);assert.equal(button.dataset.mutationUnavailable,undefined);assert.equal(button.dataset.mutationPulse,undefined);
 runtime.setInteractionBlocked(true);runtime.refreshStatus();runtime.refreshStatus();assert.deepEqual(writes,[true,false,true]);runtime.setInteractionBlocked(false);runtime.refreshStatus();assert.deepEqual(writes,[true,false,true,false]);
});
