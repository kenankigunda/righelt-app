import test from 'node:test';
import assert from 'node:assert/strict';
import {historySnapshot,assertHistorySnapshot,assertHistoryPreserved} from '../history-continuity.mjs';
const game = () => ({id:'retained',moves:[1,2].map(n=>({moveId:`move-${n}`,action:{type:'MOVE',to:{row:n,col:3}},selectionSnapshot:{turnIndex:n},snapshot:{turnIndex:n+1},extraPersistedField:{value:n}})),turns:[{index:1,moveIndexes:[0]},{index:2,moveIndexes:[1]}],board:{state:{turnIndex:3,pieces:[{id:'commander',row:2}]}}});
test('snapshot is lossless for complete ordered history and board but ignores reader state',()=>{
 const original=game(),snapshot=historySnapshot(original);
 const current={...original,viewers:[{connected:true}],myRoles:[],currentSnapshot:{turnIndex:1},updatedAt:'later',ownershipMode:'legacy_guest'};
 assertHistoryPreserved(current,snapshot);
 original.moves[0].extraPersistedField.value=99;
 assert.equal(snapshot.moves[0].extraPersistedField.value,1,'snapshot cannot alias mutable source');
 assert.throws(()=>assertHistoryPreserved(original,snapshot),/changed across upgrade/);
});
test('same-count action corruption, reordered history, board and turn changes all fail',()=>{
 const snapshot=historySnapshot(game());
 for(const mutate of [g=>g.moves.reverse(),g=>g.moves[0].action.to.row++,g=>g.moves[0].moveId='replacement',g=>g.moves[0].snapshot.turnIndex++,g=>g.board.state.pieces[0].row++,g=>g.turns.reverse(),g=>delete g.moves[0].extraPersistedField]){
  const current=game();mutate(current);assert.equal(current.moves.length,snapshot.moves.length);
  assert.throws(()=>assertHistoryPreserved(current,snapshot),/changed across upgrade/);
 }
});
test('missing, old and malformed evidence cannot fall back to move counts',()=>{
 for(const snapshot of [undefined,null,{historyCount:2},{...historySnapshot(game()),version:0},{...historySnapshot(game()),moves:[{moveId:'partial'}]},{...historySnapshot(game()),board:{}},{...historySnapshot(game()),turns:null}])assert.throws(()=>assertHistoryPreserved(game(),snapshot));
 assert.throws(()=>historySnapshot({id:'x',moves:[],turns:[]}));
 assertHistorySnapshot(historySnapshot({...game(),moves:[]}));
});
