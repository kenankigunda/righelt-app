import {getPendingRemovalEffects} from '../shell/pending-removal-effects.js';
import {readFileSync} from 'node:fs';
import {projectOptimisticGame} from '../shell/optimistic-live.js';
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
async function setup({audioState='running',muted=false,motionPreference=null}={}){
 const real=removalFixture(),events=[],sources=[];let now=0,visible=true,view={id:'g',currentSnapshot:real.before,pendingMoves:[],legalActions:[real.action],currentTurn:{playerSeat:'Player 1'}},unmounted=false;
 const audio={state:audioState,currentTime:0,sampleRate:8000,destination:{},resume:()=>Promise.resolve(),suspend:()=>Promise.resolve(),createBuffer:(_,length)=>({getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>{const n={connect(){},disconnect(){},start(){events.push({kind:'crack',time:now});},stop(){},onended:null};sources.push(n);return n;},createBiquadFilter:()=>({connect(){},disconnect(){},frequency:{},Q:{}}),createGain:()=>({connect(){},disconnect(){},gain:{}})};
 const sound=createGameSound({createAudio:()=>audio});sound.gesture();if(muted)sound.toggle();
 const host=createShellBoardHost({gameId:'g',canInteract:()=>true,getGameView:()=>view,transport:{getGameViewModel:()=>view,getAuthoritativeGame:()=>baseline,applyGameAction:async()=>({accepted:true,state:real.after,removedPieces:real.records})}});
 const runtime=createBoardRuntime({host,motionPreference,boardAdapter:{mount(){},unmount(){unmounted=true;},render(payload){assert.equal(unmounted,false,'retirement never renders an unmounted adapter');events.push({kind:'render',time:now,effects:structuredClone(payload.removalEffects)});},getSelectedPieceSummary:()=>null}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{}});await runtime.loadSnapshot(real.before,{legalActions:[real.action]});
 const owner=createConfirmedRemovalPresentation({getScope:()=> 'account1:g',eligible:()=>visible,present:(effects,options)=>runtime.showRemovalEffects(effects,real.before,options),pending:effects=>runtime.setPendingRemovalEffects(effects,real.before),clear:()=>runtime.clearRemovalEffects(),consume:(game,options)=>sound.presentedRemovals(game,{...options,silent:true}),cue:(game,options)=>sound.presentedRemovals(game,options),cancelSound:sound.cancelDestruction});
 const baseline={id:'g',moves:[],board:{state:real.before}};owner.update(baseline);
 return{real,runtime,owner,events,sources,sound,audio,baseline,host,setTime:t=>now=t,setEligible:value=>visible=value,setView:value=>view=value,async dispose(){owner.dispose();const old=Object.getOwnPropertyDescriptor(globalThis,'document');try{Object.defineProperty(globalThis,'document',{configurable:true,value:{removeEventListener(){}}});runtime.destroy();}finally{if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;}}};
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

for(const additionalPending of [false,true])test('confirmation replaces pending and confirmed effects in one Board commit'+(additionalPending?' while retaining another pending command':''),async()=>{
 const f=await setup();try{
  const pending={id:'g',currentSnapshot:f.real.after,pendingMoves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],legalActions:[],currentTurn:{playerSeat:'Player 1'}};
  f.setView(pending);await f.runtime.submitCurrentAction(f.real.action);f.owner.update(f.baseline,{view:pending});
  // submitCurrentAction already published the accepted snapshot. The live
  // authoritative subscriber refreshes admission without reloading it.
  f.runtime.refreshStatus();
  const accepted={id:'g',moves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],board:{state:f.real.after}};
  const otherPiece=f.real.after.pieces.find(piece=>piece.id==='B1');assert(otherPiece);
  const other={eventId:'later:B1',pieceId:'B1',piece:otherPiece,position:otherPiece.position,reason:'loss_of_supply'};
  const view={...accepted,currentSnapshot:f.real.after,pendingMoves:additionalPending?[{clientCommandId:'later',destroyedPieces:[other]}]:[]};
  const start=f.events.length;f.setTime(527);f.owner.update(accepted,{view,sequence:2});
  const events=f.events.slice(start),renders=events.filter(event=>event.kind==='render');
  assert.equal(renders.length,1,'pending retirement and confirmed flash publish atomically');
  assert.deepEqual(renders[0].effects.filter(effect=>effect.pending).map(effect=>effect.pieceId),additionalPending?['B1']:[]);
  assert(renders[0].effects.some(effect=>effect.pieceId==='C2'&&!effect.pending));
  assert.equal(events.filter(event=>event.kind==='crack').length,1);
  assert.equal(events.findIndex(event=>event.kind==='render')<events.findIndex(event=>event.kind==='crack'),true);
 }finally{await f.dispose();}
});

test('reduced motion consumes a confirmed pending removal without leaving a transient visual',async()=>{
 const motionPreference={matches:true,addEventListener(){},removeEventListener(){}};
 const f=await setup({motionPreference});try{
  const pending={id:'g',currentSnapshot:f.real.after,pendingMoves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],legalActions:[],currentTurn:{playerSeat:'Player 1'}};
  f.setView(pending);await f.runtime.submitCurrentAction(f.real.action);f.owner.update(f.baseline,{view:pending});
  assert(f.events.filter(event=>event.kind==='render').at(-1).effects.every(effect=>effect.pending));
  const accepted={id:'g',moves:[{clientCommandId:'accepted-operation',destroyedPieces:f.real.records}],board:{state:f.real.after}};
  f.setTime(527);await f.runtime.loadSnapshot(f.real.after,{legalActions:[]});f.owner.update(accepted,{sequence:2});
  assert.deepEqual(f.events.filter(event=>event.kind==='render').at(-1).effects,[]);
  assert.equal(f.events.filter(event=>event.kind==='crack').length,1);
  f.owner.update(accepted,{sequence:3});
  assert.equal(f.events.filter(event=>event.kind==='crack').length,1);
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


test('pending turn settlement retains newly removed pieces annotated on an already recorded move',async()=>{
 const f=await setup();try{
  const record=f.real.records.find(record=>record.pieceId==='C2');assert(record);
  // End turn annotates an acknowledged move rather than adding pendingMoves.
  const acknowledged={moveId:'recorded-move',clientCommandId:'recorded-command',destroyedPieces:[]};
  f.baseline.moves=[acknowledged];
  const view={id:'g',currentSnapshot:f.real.after,pendingMoves:[],pendingCommandCount:1,moves:[{...acknowledged,destroyedPieces:[record]}],legalActions:[],currentTurn:{playerSeat:'Player 1'}};
  const original=JSON.stringify(f.baseline);f.setView(view);
  assert.deepEqual(f.host.getPendingRemovalEffects().map(record=>record.pieceId),['C2']);
  await f.runtime.loadSnapshot(f.real.after,{legalActions:[]});f.owner.update(f.baseline,{view});
  const effects=f.events.filter(event=>event.kind==='render').at(-1).effects;
  assert.equal(effects.length,1);assert.equal(effects[0].pieceId,'C2');assert.equal(effects[0].pending,true);
  assert.equal(f.events.filter(event=>event.kind==='crack').length,0);
  const accepted={...f.baseline,moves:view.moves,board:{state:f.real.after}};
  f.setTime(527);f.setView({...view,pendingCommandCount:0});f.owner.update(accepted,{view:{...view,pendingCommandCount:0},sequence:2});
  const confirmed=f.events.filter(event=>event.kind==='render').at(-1).effects;
  assert.equal(confirmed.length,1);assert.equal(Boolean(confirmed[0].pending),false);assert.equal(f.events.filter(event=>event.kind==='crack').length,1);
  assert.equal(JSON.stringify(f.baseline),original);
 }finally{await f.dispose();}
});


test('pending turn settlement from the real projector preserves both lost-supply units until confirmation',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url)));
 const initial={id:'settlement',myRole:'Player 2',moves:[],board:{state:fixture.initialState},player1:{identityId:'other'},player2:{identityId:'owner'},turns:[{index:15,playerSeat:'Player 2',status:'active',startedAt:0,moveIndexes:[]}]};
 const first=projectOptimisticGame({authoritativeGame:initial,identityId:'owner',queue:[{kind:'apply',clientCommandId:'recorded-rush',queuedAt:1,action:fixture.action}]});assert.equal(first.ok,true);
 const acknowledged={...first.game,moves:first.game.pendingMoves.map(move=>({...move,pending:false})),pendingMoves:[],pendingCommandCount:0};
 const before=JSON.stringify(acknowledged);
 const settlement=projectOptimisticGame({authoritativeGame:acknowledged,identityId:'owner',queue:[{kind:'end_turn',clientCommandId:'pending-end-turn',queuedAt:2}]});assert.equal(settlement.ok,true);
 assert.deepEqual(settlement.game.pendingMoves,[]);
 assert.deepEqual(settlement.game.moves[0].destroyedPieces.map(record=>record.pieceId),['U1-2','U1-3']);
 const host=createShellBoardHost({gameId:'settlement',transport:{getGameViewModel:()=>settlement.game,getAuthoritativeGame:()=>acknowledged}});
 assert.deepEqual(host.getPendingRemovalEffects().map(record=>record.pieceId),['U1-2','U1-3']);
 const pending=[],presented=[],cues=[];
 const owner=createConfirmedRemovalPresentation({getScope:game=>game.id,eligible:()=>true,present:(effects,options)=>presented.push({effects,pendingEffects:options.pendingEffects}),pending:effects=>pending.push(effects),clear(){},consume(){},cue:()=>cues.push('crack'),cancelSound(){}});
 owner.update(acknowledged);owner.update(acknowledged,{view:settlement.game});
 assert.deepEqual(pending.at(-1).map(record=>record.pieceId),['U1-2','U1-3']);assert.equal(presented.length,0);assert.equal(cues.length,0);
 const accepted={...settlement.game,pendingCommandCount:0};owner.update(accepted,{sequence:2});
 assert.equal(presented.length,1);assert.deepEqual(presented[0].pendingEffects,[]);assert.deepEqual(presented[0].effects.map(record=>record.pieceId),['U1-2','U1-3']);assert.equal(cues.length,1);
 owner.update(accepted,{sequence:3});assert.equal(presented.length,1);assert.equal(cues.length,1);assert.equal(JSON.stringify(acknowledged),before);owner.dispose();
});


test('pending recorded removals exclude confirmed, retired, undone and other-game records',()=>{
 const a={eventId:'accepted:A',pieceId:'A'},b={eventId:'pending:B',pieceId:'B'};
 const authoritative={id:'g',moves:[{moveId:'m',destroyedPieces:[a]}]};
 const view={id:'g',pendingCommandCount:1,pendingMoves:[],moves:[{moveId:'m',destroyedPieces:[a,b]}]};
 assert.deepEqual(getPendingRemovalEffects(view,authoritative),[b]);
 assert.deepEqual(getPendingRemovalEffects({...view,pendingMoves:[{moveId:'p',destroyedPieces:[b]}]},authoritative),[b]);
 assert.deepEqual(getPendingRemovalEffects({...view,pendingCommandCount:0},authoritative),[]);
 assert.deepEqual(getPendingRemovalEffects(view,{...authoritative,id:'other'}),[]);
 assert.deepEqual(getPendingRemovalEffects({...view,moves:[{...view.moves[0],undone:true}]},authoritative),[]);
 assert.deepEqual(getPendingRemovalEffects(view,{id:'g',moves:view.moves}),[]);
});
