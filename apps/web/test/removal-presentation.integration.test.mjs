import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,createInitialState} from '../generated/packages/game-engine/src/index.js';
import {destructionRecords} from '../generated/packages/game-engine/src/removals.js';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {createShellBoardHost} from '../board/hosts/shell-host.js';
import {createGameSound} from '../shell/sound.js';
import {createConfirmedRemovalPresentation} from '../shell/removal-presentation.js';

const piece=(id,owner,row,col,kind='unit')=>({id,owner,position:{row,col},kind,supplied:true,commanded:true});
function removalFixture(){
 const before={...createInitialState(),pieces:[piece('C1','P1',3,6,'commander'),piece('C2','P2',4,2,'commander'),piece('A1','P1',4,1),piece('A2','P1',3,1),piece('B1','P1',3,2),piece('B2','P2',5,2),piece('B3','P1',4,3)]};
 const action={type:'push',actorId:'A1',from:{row:4,col:1},to:{row:4,col:2}},events=[];
 const after=applyAction(before,action,{onRemoval:event=>events.push(event)}).state;
 return{before,after,action,records:destructionRecords(events,'accepted-operation')};
}
async function setup({audioState='running',muted=false}={}){
 const real=removalFixture(),events=[],sources=[];let now=0,visible=true,view={id:'g',currentSnapshot:real.before,pendingMoves:[],legalActions:[real.action],currentTurn:{playerSeat:'Player 1'}},unmounted=false;
 const audio={state:audioState,currentTime:0,sampleRate:8000,destination:{},resume:()=>Promise.resolve(),suspend:()=>Promise.resolve(),createBuffer:(_,length)=>({getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>{const n={connect(){},disconnect(){},start(){events.push({kind:'crack',time:now});},stop(){},onended:null};sources.push(n);return n;},createBiquadFilter:()=>({connect(){},disconnect(){},frequency:{},Q:{}}),createGain:()=>({connect(){},disconnect(){},gain:{}})};
 const sound=createGameSound({createAudio:()=>audio});sound.gesture();if(muted)sound.toggle();
 const host=createShellBoardHost({gameId:'g',canInteract:()=>true,getGameView:()=>view,transport:{getGameViewModel:()=>view,applyGameAction:async()=>({accepted:true,state:real.after,removedPieces:real.records})}});
 const runtime=createBoardRuntime({host,boardAdapter:{mount(){},unmount(){unmounted=true;},render(payload){assert.equal(unmounted,false,'retirement never renders an unmounted adapter');events.push({kind:'render',time:now,effects:structuredClone(payload.removalEffects)});},getSelectedPieceSummary:()=>null}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{}});await runtime.loadSnapshot(real.before,{legalActions:[real.action]});
 const owner=createConfirmedRemovalPresentation({getScope:()=> 'account1:g',eligible:()=>visible,present:effects=>runtime.showRemovalEffects(effects,real.before),pending:effects=>runtime.setPendingRemovalEffects(effects,real.before),clear:()=>runtime.clearRemovalEffects(),consume:(game,options)=>sound.presentedRemovals(game,{...options,silent:true}),cue:(game,options)=>sound.presentedRemovals(game,options),cancelSound:sound.cancelDestruction});
 const baseline={id:'g',moves:[],board:{state:real.before}};owner.update(baseline);
 return{real,runtime,owner,events,sources,sound,audio,baseline,setTime:t=>now=t,setEligible:value=>visible=value,setView:value=>view=value,async dispose(){owner.dispose();const old=Object.getOwnPropertyDescriptor(globalThis,'document');try{Object.defineProperty(globalThis,'document',{configurable:true,value:{removeEventListener(){}}});runtime.destroy();}finally{if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;}}};
}

test('actual engine to shell pending result stays static and silent, then confirmed owner starts visual and crack together',async()=>{
 const f=await setup();try{
  assert(f.real.records.some(record=>record.pieceId==='C2'&&record.reason==='no_retreat'));
  const before=JSON.stringify(f.baseline),pending={id:'g',currentSnapshot:f.real.after,pendingMoves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],legalActions:[],currentTurn:{playerSeat:'Player 1'}};
  f.setTime(10);f.setView(pending);await f.runtime.submitCurrentAction(f.real.action);f.owner.update(f.baseline,{view:pending});
  const projected=f.events.filter(event=>event.kind==='render').at(-1).effects;assert(projected.length>0);assert(projected.every(effect=>effect.pending));assert.equal(f.events.filter(event=>event.kind==='crack').length,0);
  const accepted={id:'g',moves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],board:{state:f.real.after}};
  f.setTime(527);await f.runtime.loadSnapshot(f.real.after,{legalActions:[]});f.owner.update(accepted,{sequence:2});
  const crack=f.events.findIndex(event=>event.kind==='crack');assert(crack>0);assert.equal(f.events[crack].time,527);assert.equal(f.events[crack-1].kind,'render');assert.equal(f.events[crack-1].time,527);assert(f.events[crack-1].effects.some(effect=>effect.pieceId==='C2'&&!effect.pending));
  f.owner.update(accepted,{sequence:3});assert.equal(f.events.filter(event=>event.kind==='crack').length,1);assert.equal(JSON.stringify(f.baseline),before);
 }finally{await f.dispose();}
});

for(const unavailable of ['muted','suspended'])test('confirmed visual does not wait for '+unavailable+' audio and late activation never catches up',async()=>{
 const f=await setup({muted:unavailable==='muted',audioState:unavailable==='suspended'?'suspended':'running'});try{const accepted={id:'g',moves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],board:{state:f.real.after}};await f.runtime.loadSnapshot(f.real.after,{legalActions:[]});f.owner.update(accepted,{sequence:2});assert(f.events.some(event=>event.kind==='render'&&event.effects.some(effect=>!effect.pending)));assert.equal(f.events.filter(event=>event.kind==='crack').length,0);if(unavailable==='muted')f.sound.toggle();f.audio.state='running';f.sound.gesture();f.owner.update(accepted,{sequence:3});assert.equal(f.events.filter(event=>event.kind==='crack').length,0);}finally{await f.dispose();}
});

test('receipt consumption and confirmed computer display share dedupe without a second live crack',async()=>{
 const f=await setup();try{const move={moveId:'confirmed-computer',actorSide:'P1',computerProof:{profile:'tau'},clientCommandId:'accepted-operation',destroyedPieces:f.real.records,snapshot:f.real.after};const accepted={id:'g',myRoles:['Player 2'],computer:{seats:{p1:'tau'}},moves:[move],board:{state:f.real.after}};
  f.setEligible(false);f.owner.update(accepted,{sequence:2});f.sound.observe({type:'event_appended',reason:'move_recorded',eventSeq:2,game:accepted},{deferDestruction:true,silent:true});assert.equal(f.events.filter(e=>e.kind==='crack').length,0);
  f.setTime(527);f.sound.displayed(move,accepted,{scope:'account:g'});f.sound.displayed(move,accepted,{scope:'account:g'});assert.equal(f.events.filter(e=>e.kind==='crack').length,1);
  f.setEligible(true);f.owner.update(accepted,{sequence:3});f.sound.observe({type:'event_appended',reason:'move_recorded',eventSeq:3,game:accepted},{deferDestruction:true,silent:true});assert.equal(f.events.filter(e=>e.kind==='crack').length,1);
 }finally{await f.dispose();}
});
