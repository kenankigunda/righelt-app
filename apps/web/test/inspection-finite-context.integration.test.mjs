import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {isMappedBoardPromptHtml} from '../board/prompt-models.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
const noop=()=>{};
function fixture({atSupply=false,units=false}={}){
 const commander={id:'C',kind:'commander',owner:'P1',position:atSupply?{row:0,col:9}:{row:4,col:4},supplied:true,commanded:true};
 const blue={id:'BC',kind:'commander',owner:'P2',position:{row:5,col:5},supplied:true,commanded:true};
 const unit={id:'U',kind:'unit',owner:'P1',position:{row:4,col:5},supplied:true,commanded:true};
 const state={boardSize:10,sideToMove:'P2',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[commander,blue,...(units?[unit]:[])],
  artifacts:{supply:[{player:'P1',shortestPathByPieceId:{C:atSupply?[commander.position]:[commander.position,{row:0,col:9}]}},{player:'P2',shortestPathByPieceId:{BC:[blue.position,{row:9,col:0}]}}],command:{shortestPathToCommanderByPieceId:units?{U:[unit.position,commander.position]}:{}}}};
 let html='',context;const label={dataset:{},get innerHTML(){return html;},set innerHTML(value){html=value;},get textContent(){return html;},set textContent(value){html=value;},setAttribute:noop,removeAttribute:noop,addEventListener:noop,removeEventListener:noop};
 const renders=[];const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:view=>renders.push(view),getPieceById:(s,id)=>s.pieces.find(p=>p.id===id),getSelectedPieceSummary:()=>({details:{owner:'P1'}})},controls:{onBoardContext:value=>{context=value;}},host:{canPresentActions:()=>false,canInteract:()=>false,loadPieceMoves:async()=>({actions:[],previewActions:[]})}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 return {runtime,state,commander,label,renders,get context(){return context;},get html(){return html;},select:()=>runtime.loadSnapshot(state,{legalActions:[],selectionState:{selectedPieceId:'C',source:commander.position,target:null}})};
}
for(const mode of ['supply-only','own-source','mixed-affiliations'])test(`actual ${mode} commander inspection keeps a finite prompt and full structured context`,async()=>{
 const f=fixture({atSupply:mode==='own-source',units:mode==='mixed-affiliations'}),before=structuredClone(f.state);await f.select();
 if(mode==='mixed-affiliations')f.runtime.toggleNetworkInspection('supply',{owner:'P2'});
 assert.equal(isMappedBoardPromptHtml(f.html),true,'inspection guidance must use existing finite Board grammar');assert.notEqual(f.label.dataset.promptUnmapped,'true');
 const detail=renderBoardMessageHtml(f.context?.message??{});
 if(mode==='supply-only')assert.match(detail,/Supply line for commander at.*No connected units/);
 if(mode==='own-source')assert.match(detail,/At its supply point.*No connected units/);
 if(mode==='mixed-affiliations')assert.match(detail,/Blue supply lines and Red command lines/);
 assert.deepEqual(f.state,before);assert.deepEqual(f.runtime.getLegalActions(),[]);
 if(mode!=='mixed-affiliations')assert.deepEqual(f.context.message.coordinates,[f.commander.position]);
});
