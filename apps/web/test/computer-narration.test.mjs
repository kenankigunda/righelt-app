import test from 'node:test';
import assert from 'node:assert/strict';
import { latestComputerTurn, computerBoardMessage, describeComputerMove } from '../shell/computer-narration.js';
const move={moveId:'m',turnIndex:0,computerProof:{profile:'tau'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:3}}};
const game=()=>({computer:{seats:{p1:'tau',p2:null}},board:{state:{turnIndex:1}},turns:[{index:0,status:'complete'},{index:1,status:'active'}],moves:[move]});
test('narration and replay CTA belong to completed preceding computer turn until selection',()=>{
  const g=game();assert.equal(latestComputerTurn(g).last.moveId,'m');
  const message=computerBoardMessage(g,{});
  assert.equal(message.text,'Tau rushed a piece from (1, 2) to (2, 3)');assert.equal(message.action.label,'Show me again');
  assert.equal(computerBoardMessage(g,{}, {selectedPieceId:'piece'}),null);
  g.board.state.turnIndex=2;assert.equal(computerBoardMessage(g,{}),null);
  g.moves[0]={...move,undone:true};assert.equal(latestComputerTurn(g),null);
});
test('thinking overrides human selection and historical boards do not show live prompts',()=>{
  const g=game();g.computerTurn='tau';
  assert.equal(computerBoardMessage(g,{phase:'looking-ahead'},{selectedPieceId:'p'}),'Tau is thinking');
  g.inHistoryMode=true;assert.equal(computerBoardMessage(g,{phase:'looking-ahead'}),null);
  assert.equal(describeComputerMove({...move,action:{type:'pass'}}),'Tau passed');
});
