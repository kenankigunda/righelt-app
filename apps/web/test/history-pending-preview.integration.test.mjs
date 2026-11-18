import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMovePreview} from '../shell/history-preview.js';
import {selectedHistoricalRecord} from '../shell/history-narration.js';

const unit=(id,row,supplied)=>({id,owner:'P2',kind:'unit',position:{row,col:7},supplied,commanded:false});
const frame=pieces=>({pieces,turnIndex:38,sideToMove:'P1',outcome:{status:'ongoing'}});
const record=(piece,causalMoveId)=>({pieceId:piece.id,piece,position:piece.position,ownerSeat:'p2',removalPhase:'turn_settlement',reason:'loss_of_supply',causalMoveId});
const preview=(move,moves=[move])=>buildMovePreview(selectedHistoricalRecord({inHistoryMode:true,historyIndex:move.index,moves}));
const ids=p=>p.overlay.staticDestroyedPieces.map(x=>x.piece?.id).sort();

test('actual History selection keeps cumulative pending treatment independently of causal bullets',()=>{
 const moves=[[true,true],[false,true],[false,true],[false,false],[false,false]].map(([a,b],index)=>({index,moveId:`m${index}`,clientCommandId:`c${index}`,turnIndex:38,turnMoveIndex:index,action:{type:'rush'},selectionSnapshot:frame([]),snapshot:frame([unit('A',2,a),unit('B',0,b)])}));
 moves[4].inspectionSnapshot=moves[4].snapshot;moves[4].snapshot=frame([]);
 moves[4].destroyedPieces=[record(unit('A',2,false),'m1'),record(unit('B',0,false),'m3')];
 const before=structuredClone(moves);
 assert.deepEqual(moves.map(m=>ids(preview(m,moves))),[[],['A'],['A'],['A','B'],['A','B']]);
 assert.deepEqual(moves.map(m=>selectedHistoricalRecord({inHistoryMode:true,historyIndex:m.index,moves}).destroyedPieces.map(x=>x.pieceId)),[[],['A'],[],['B'],[]]);
 assert.deepEqual(moves,before);
 for(const m of moves)assert.deepEqual(preview(m,moves).overlay.animatedDestroyedPieces,[]);
});

test('restoration clears pending survivors and re-cut restores treatment despite frozen rules flags',()=>{
 const states=[false,true,false].map(displaySupplied=>frame([{...unit('survivor',2,true),displaySupplied,displayCommanded:true}]));
 const moves=states.map((snapshot,index)=>({index,moveId:`m${index}`,action:{type:'rush'},snapshot}));
 assert.deepEqual(moves.map(m=>ids(preview(m,moves))),[['survivor'],[],['survivor']]);
 assert.deepEqual(states.map(s=>s.pieces[0].supplied),[true,true,true]);
 for(const m of [moves[0],moves[2]]){
  const overlay=preview(m,moves).overlay.staticDestroyedPieces[0];
  assert.equal(overlay.supplied,false);assert.equal(overlay.commanded,true);
  assert.equal(overlay.piece.supplied,false);assert.equal(overlay.piece.commanded,true);
 }
});

test('current piece identity and position override duplicate or restored causal records',()=>{
 const old=unit('A',2,false),current={...unit('A',4,true),displaySupplied:true};
 const m={index:0,moveId:'m',action:{type:'rush'},snapshot:frame([current]),destroyedPieces:[record(old,'m'),record(old,'m')]};
 assert.deepEqual(ids(buildMovePreview(m)),[],'explicit resupply suppresses old causal evidence');
 current.displaySupplied=false;
 const p=buildMovePreview(m);assert.deepEqual(ids(p),['A']);assert.deepEqual(p.overlay.staticDestroyedPieces[0].piece.position,{row:4,col:7});
});

test('distinct stacked pending units remain distinct while commanders and missing supply are not guessed',()=>{
 const a=unit('A',2,false),b=unit('B',2,false),commander={...unit('C',3,false),kind:'commander'},unknown=unit('unknown',4,undefined);
 const m={snapshot:frame([a,b,commander,unknown]),action:{type:'rush'}};
 assert.deepEqual(ids(buildMovePreview(m)),['A','B']);
 assert.deepEqual(ids(buildMovePreview({snapshot:frame([{...a,position:null}])})),[]);
});

test('legacy explicit settlement fallback and immediate removal animation stay separate',()=>{
 const a=unit('A',2,false),immediate={...record(unit('I',5,true),'m'),removalPhase:'immediate',reason:'no_retreat'};
 const m={moveId:'m',selectionSnapshot:frame([a,immediate.piece]),destroyedPieces:[record(a,'m'),immediate]};
 const p=buildMovePreview(m);assert.deepEqual(ids(p),['A']);assert.deepEqual(p.overlay.animatedDestroyedPieces.map(x=>x.piece.id),['I']);
 assert.deepEqual(ids(buildMovePreview({snapshot:frame([{...a,supplied:undefined}]),destroyedPieces:[record(a,'m')]})),['A'],'unknown flags retain explicit evidence');
});
