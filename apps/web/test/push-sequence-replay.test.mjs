import test from 'node:test';
import assert from 'node:assert/strict';
import { latestLocalPushSequence,buildPushSequenceReplay,withPushSequenceMessage } from '../shell/push-sequence-replay.js';
const state=col=>({pieces:[{id:'A',position:{row:4,col}}]});
const moves=()=>['move','push','retreat','follow','follow','move'].map((type,index)=>({moveId:`m${index}`,turnIndex:index===5?1:0,turnMoveIndex:index,actorSide:type==='retreat'||index===5?'P2':'P1',action:{type},selectionSnapshot:state(index),snapshot:state(index+1)}));
const game=()=>({id:'g',moves:moves(),player1:{identityId:'human'},player2:{identityId:'friend'},legalActions:[{type:'pass'}],board:{state:{turnIndex:1}}});

test('push replay selects only its acknowledged push, retreat and follows from a larger turn',()=>{
  const current=game(),source=latestLocalPushSequence(current,'human');assert.deepEqual(source.moves.map(move=>move.moveId),['m1','m2','m3','m4']);
  const payload=buildPushSequenceReplay({...source,moves:current.moves,gameId:'g',revision:8,lineageHead:'m5'});
  assert.deepEqual(payload.frames.map(frame=>frame.decisionId),['m1','m2','m3','m4']);
  current.moves[1].snapshot.pieces[0].position.col=99;assert.equal(payload.frames[0].after.pieces[0].position.col,2);
});

test('sequence replay rejects missing, undone, disjoint or incomplete acknowledgement frames',()=>{
  const current=game(),options={moves:current.moves,startId:'m1',endId:'m4'};
  assert.equal(buildPushSequenceReplay({...options,moves:current.moves.filter(move=>move.moveId!=='m3')}),null);
  assert.equal(buildPushSequenceReplay({...options,moves:current.moves.map(move=>move.moveId==='m2'?{...move,snapshot:null}:move)}),null);
  assert.equal(buildPushSequenceReplay({...options,moves:current.moves.map(move=>move.moveId==='m2'?{...move,undone:true}:move)}),null);
  assert.equal(buildPushSequenceReplay({...options,endId:'m5'}),null);
});

test('local sequence replay remains available while a computer thinks, without replacing opponent-turn replay',()=>{
  const current=game(),message=withPushSequenceMessage('Horus is thinking',current,{},'human');
  assert.equal(message.action.id,'replay-push-sequence');assert.equal(message.rows[1].text,'Horus is thinking');
  const opponent={text:'Your opponent moved',action:{id:'replay-computer',label:'Show me again'}};
  assert.equal(withPushSequenceMessage(opponent,current,{},'human'),opponent);
  assert.equal(withPushSequenceMessage(null,current,{selectedPieceId:'A'},'human'),null);
  assert.equal(latestLocalPushSequence({...current,moves:[...current.moves,{...current.moves[5],moveId:'new-human',actorSide:'P1'}]},'human'),null);
});
