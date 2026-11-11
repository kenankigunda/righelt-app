import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {renderCoordinateChip} from '../board/coordinate-chip.js';
import {BOARD_PROMPT} from '../board/prompt-models.js';
import {getPushRetreatPrompt,requiredRushContext,opponentInspectionPrompt,annotateRushSourceCells,buildHistoryRemovalEffects} from '../board/guidance-presentation.js';
import {getSelectedPieceExplanation,SELECTED_CONTINUATION_LABELS} from '../board/piece-explanations.js';
import {createDestructionTransitions} from '../shell/destruction-transitions.js';
const inventory=JSON.parse(readFileSync(new URL('../../../docs/design/action-first-piece-copy.json',import.meta.url),'utf8'));
const text=html=>html.replace(/<[^>]+>/g,'').replace(/\((\d+,\s*\d+)\)/g,'$1').replace(/\.$/,'');
const noop=()=>{};
async function ordinary({opponent=false,coordinate=true,reason=null}={}){
 let html='',context=null;const label={addEventListener:noop,removeEventListener:noop,get innerHTML(){return html},set innerHTML(value){html=value},get textContent(){return html},set textContent(value){html=value}};
 const point={row:4,col:2},piece={id:'A',owner:opponent?'P2':'P1',kind:'unit',position:coordinate?point:null,supplied:true,commanded:true};
 const preview=reason?{type:'move',actorId:'A',from:point,to:{row:4,col:3},legal:false,blockedReason:reason}:null;
 const runtime=createBoardRuntime({controls:{onBoardContext:value=>context=value},boardAdapter:{mount:noop,render:noop,getPieceById:(snapshot,id)=>snapshot.pieces.find(p=>p.id===id),getSelectedPieceSummary:()=>({details:{owner:piece.owner}})},host:{canInteract:()=>true,loadPieceMoves:async()=>({actions:[],previewActions:preview?[preview]:[]})}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot({sideToMove:'P1',turnIndex:0,pieces:[piece]},{legalActions:[],selectionState:{selectedPieceId:'A',source:coordinate?point:null,target:preview?.to??null}});await new Promise(setImmediate);
 const result=context?renderBoardMessageHtml(context.message):html;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');try{Object.defineProperty(globalThis,'document',{configurable:true,value:{removeEventListener:noop}});runtime.destroy();}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
 return result;
}
test('all28 guidance inventory rows retain their actual finite, context, accessibility or metadata owner',async()=>{
 assert.equal(inventory.rows.length,28);const results=new Map();
 results.set(1,getPushRetreatPrompt({continuation:{type:'push',phase:'retreat',pushedPieceId:'A'},pieces:[{id:'A',position:{row:4,col:2}}]},'A',renderCoordinateChip));
 for(const [row,supplied,commanded] of [[2,true,false],[3,false,true],[4,false,false]])results.set(row,getSelectedPieceExplanation({id:'A',supplied,commanded},{})+' for piece at 4, 2');
 results.set(5,await ordinary({opponent:true}));
 results.set(6,opponentInspectionPrompt(null,renderCoordinateChip));results.set(7,await ordinary());
 for(const [row,reason]of [[8,'SUPPLY_DESTINATION_UNSUPPLIED'],[9,'PUSH_STRENGTH_TOO_WEAK'],[10,'UNKNOWN_PRIVATE_RULE']])results.set(row,await ordinary({reason}));
 const state={continuation:{type:'rush'},pieces:[{id:'A',position:{row:4,col:2}}]};
 const required=requiredRushContext(state,{interactive:true,canPresentActions:()=>undefined,getUnsuppliedPieceIds:()=>['A'],getPieceById:()=>state.pieces[0],formatCoordinate:point=>`${point.row}, ${point.col}`});
 assert.equal(required.mandatory,true);assert.equal(required.kind,'required-rush');assert.equal(BOARD_PROMPT.requiredRush,'Select a rush to restore supply');assert.match(renderBoardMessageHtml(required.message),/Rush to restore supply.*4, 2/);results.set(11,null);
 results.set(12,SELECTED_CONTINUATION_LABELS.rushBlocker+' 9, 9');
 let accessible;annotateRushSourceCells({actions:[{action:{actorId:'A'}}],findPieceById:()=>state.pieces[0],snapshot:state,cells:new Map([['4,2',{classList:{add:noop},setAttribute:(name,value)=>{assert.equal(name,'aria-label');accessible=value;}}]]),coordKey:point=>`${point.row},${point.col}`});results.set(13,accessible);
 for(const [row,reason]of [[14,'loss_of_supply'],[15,'no_retreat']]){const transitions=createDestructionTransitions();transitions.update({id:'g',moves:[]});const record={eventId:'e',pieceId:'A',position:{row:4,col:2},reason,piece:state.pieces[0]};const effect=transitions.update({id:'g',moves:[{clientCommandId:'c',destroyedPieces:[record]}]}).effects[0];assert.equal(effect.eventId,'e');assert.equal(effect.reason,reason);results.set(row,effect.message);}
 results.set(16,buildHistoryRemovalEffects([{row:4,col:2}])[0].message);
 for(let row=17;row<=28;row++){const name=inventory.rows[row-1].case,frozen=name.startsWith('Frozen'),type=name.toLowerCase().includes('rush')?'rush':'push',missing=name.split('missing ')[1],supplied=missing==='command',commanded=missing==='supply';const piece={id:'A',supplied,commanded};const snapshot={continuation:{type,...(frozen?{frozenPieceStatesById:{A:{supplied,commanded}}}:{})}};results.set(row,getSelectedPieceExplanation(frozen?{...piece,displaySupplied:true,displayCommanded:true}:piece,snapshot)+' for piece at 4, 2');}
 assert.equal(results.size,28);for(const [row,result]of results){if(row===11)continue;assert.equal(text(result),text(inventory.rows[row-1].after),`inventory row${row}: ${inventory.rows[row-1].case}`);}
 // Context explanations retain real chips, while the ordinary opponent primary
 // remains the current finite/context architecture's existing placement.
 for(const row of [1,5,7,8,9,10])assert.match(results.get(row),/board-preview-coordinate-chip/);
});


test('actual guidance context guards avoid reading unavailable or noninteractive state',()=>{
 const fail=()=>{throw Error('unreachable presentation dependency');};
 for(const [state,interactive,permission]of[[null,true,true],[{continuation:{type:'rush'}},false,true],[{continuation:null},true,true],[{continuation:{type:'rush'}},true,false]]){
  assert.equal(requiredRushContext(state,{interactive,canPresentActions:()=>permission,getUnsuppliedPieceIds:fail,getPieceById:fail,formatCoordinate:fail}),null);
 }
 assert.equal(getPushRetreatPrompt({continuation:{type:'push',phase:'follow'}},null,fail),null);
 assert.equal(getPushRetreatPrompt({continuation:{type:'push',phase:'retreat'},pieces:[]},null,fail),null);
 assert.equal(opponentInspectionPrompt(null,fail),'Opponent’s supply and command lines');
 const state={pieces:[]};assert.doesNotThrow(()=>annotateRushSourceCells({actions:[{action:{actorId:'missing'}}],snapshot:state,cells:new Map(),findPieceById:()=>null,coordKey:fail}));
});
