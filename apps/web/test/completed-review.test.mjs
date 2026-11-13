import test from 'node:test';
import assert from 'node:assert/strict';
import {completedTurnIndex,completedTurnTitle,isCompletedWinningTurn,createCompletedReviewOwner} from '../shell/completed-review.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';

const person=(identityId,name)=>({identityId,profile:{displayName:name}});
const game=(status='p1_win',extra={})=>({
 id:'g',gameplayRevision:4,board:{state:{outcome:{status},pieces:[]}},moves:[
  {moveId:'a',turnIndex:2,undone:false},{moveId:'b',turnIndex:3,undone:true},{moveId:'c',turnIndex:4,undone:false},
 ],turns:[],player1:person('me','Kenan'),player2:person('other','Ada'),myRole:'Player 1',myRoles:['Player 1'],...extra,
});

test('completed review identifies the final active turn and names its result',()=>{
 const won=game();
 assert.equal(completedTurnIndex(won),4);
 assert.equal(completedTurnTitle(won,'me'),'You won on Turn 5');
 assert.equal(completedTurnTitle(game('draw'),'me'),'Draw on Turn 5');
 assert.equal(isCompletedWinningTurn({...won,inHistoryMode:true,historyTurnIndex:4}),true);
 assert.equal(isCompletedWinningTurn({...won,inHistoryMode:true,historyTurnIndex:2}),false);
});

test('completed review falls back to the final recorded turn without inventing an empty prepared turn',()=>{
 const completed=game('p2_win',{moves:[],turns:[{index:7,endedAt:'now',moveIndexes:[3]},{index:8,endedAt:null,moveIndexes:[]}]});
 assert.equal(completedTurnIndex(completed),7);
 assert.equal(completedTurnTitle(completed,'me'),'Ada won on Turn 8');
 assert.equal(completedTurnIndex({...completed,board:{state:{outcome:{status:'ongoing'}}}}),null);
});

test('the selected decisive turn presents the completed win or draw title while earlier turns keep Turn X',()=>{
 const recorded={moveId:'final',index:1,turnIndex:4,turnMoveIndex:0,actorSide:'P1',notation:'Move',action:{type:'move',from:{row:3,col:6},to:{row:4,col:6}},selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:{pieces:[]}};
 const won=game('p1_win',{moves:[recorded],turns:[{index:4,playerSeat:'Player 1',moveIndexes:[1]}],inHistoryMode:true,historyTurnIndex:4,historyTurnMoves:[recorded]});
 assert.equal(selectedHistoryPresentation(won,{identityId:'me'}).caption.text,'You won on Turn 5');
 assert.equal(selectedHistoryPresentation({...won,historyTurnIndex:3,historyTurnMoves:[{...recorded,turnIndex:3}]},{identityId:'me'}).caption.text,'Turn 4');
 assert.equal(selectedHistoryPresentation({...won,board:{state:{...won.board.state,outcome:{status:'draw'}}}},{identityId:'me'}).caption.text,'Draw on Turn 5');
});

test('completed review owner selects once per transport revision and leaves earlier inspected turns alone',async()=>{
 const calls=[],transport={selectHistoryTurn:value=>{calls.push(value);return Promise.resolve({...game(),inHistoryMode:true,historyTurnIndex:value.turnIndex});}};
 const owner=createCompletedReviewOwner({getTransport:()=>transport});
 const completed=game();
 await owner.sync(completed);await owner.sync(completed);
 assert.deepEqual(calls,[{gameId:'g',turnIndex:4}]);
 assert.equal(owner.sync({...completed,inHistoryMode:true,historyTurnIndex:2}),null);
 await owner.sync({...completed,gameplayRevision:5});
 assert.equal(calls.length,2);
});

test('completed review retries a resolved History failure and caches only the entered decisive turn',async()=>{
 const completed=game(),calls=[];
 const transport={selectHistoryTurn:value=>{
  calls.push(value);
  return Promise.resolve(calls.length===1?{...completed,inHistoryMode:false,historyLoading:false,historyError:'turn_not_found'}:{...completed,inHistoryMode:true,historyTurnIndex:value.turnIndex});
 }};
 const owner=createCompletedReviewOwner({getTransport:()=>transport});
 await owner.sync(completed);
 assert.deepEqual(calls,[{gameId:'g',turnIndex:4},{gameId:'g',turnIndex:4}]);
 await owner.sync(completed);
 assert.equal(calls.length,2,'a proven decisive-turn selection remains owned');
});

test('completed review retires a repeated failed selection so a later render can try again',async()=>{
 const completed=game(),calls=[];
 const transport={selectHistoryTurn:value=>{calls.push(value);return Promise.resolve({...completed,inHistoryMode:false,historyLoading:false,historyError:'turn_not_found'});}};
 const owner=createCompletedReviewOwner({getTransport:()=>transport});
 await owner.sync(completed);assert.equal(calls.length,2);
 await owner.sync(completed);assert.equal(calls.length,4);
});
