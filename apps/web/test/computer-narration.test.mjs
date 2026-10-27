import test from 'node:test';
import assert from 'node:assert/strict';
import { latestComputerTurn, computerBoardMessage, describeComputerMove } from '../shell/computer-narration.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
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

test('optimistic computer completion never exposes a human prompt before confirmation', () => {
 const g=game();g.pendingComputerSaveStartedAt=0;g.pendingComputerProfile='tau';
 assert.equal(computerBoardMessage(g,{phase:'saving'},{selectedPieceId:'p'}),'Tau is saving their move');
 g.inHistoryMode=true;assert.equal(computerBoardMessage(g,{phase:'saving'}),null);
});

test('all profiles keep thinking and save narration plain for the animated cue',()=>{
 for(const [profile,{name}]of Object.entries(COMPUTER_PROFILES)){
  const g={...game(),computerTurn:profile};
  for(const phase of ['checking','looking-ahead','saving']){
   const message=computerBoardMessage(g,{profile,phase});assert.equal(message,`${name} is thinking`);assert.doesNotMatch(message,/…|\.\.\./);
  }
  assert.equal(computerBoardMessage(g,{profile,phase:'preparing'}),`Preparing ${name}`);
  g.pendingComputerSaveStartedAt=0;assert.equal(computerBoardMessage(g,{profile,phase:'saving'}),`${name} is saving their move`);
 }
});


test('phase labels skip sub-500ms phases and preparing never includes an elapsed timer', () => {
  const g = {...game(), computerTurn:'tau'};
  for (const phase of ['checking','looking-ahead','saving']) {
    assert.equal(computerBoardMessage(g,{phase,phaseElapsedMs:499}), 'Tau is thinking');
    assert.equal(computerBoardMessage(g,{phase,phaseElapsedMs:500}), phase === 'saving' ? 'Tau is saving their move' : phase === 'checking' ? 'Tau is checking their options' : 'Tau is thinking');
  }
  assert.equal(computerBoardMessage(g,{phase:'preparing',detailed:true,elapsedMs:60000}), 'Preparing Tau');
  assert.equal(computerBoardMessage(g,{phase:'initializing-verified-runtime',detailed:true,elapsedMs:60000}), 'Preparing Tau');
});

test('pending save uses its own clock and profile even after the computer turn changes', () => {
  const g = {...game(), pendingComputerSaveStartedAt:10000, pendingComputerProfile:'babs'};
  assert.equal(computerBoardMessage(g,{profile:'tau',phase:'checking',phaseElapsedMs:30000,observedAt:10499}), 'Babs is thinking');
  assert.equal(computerBoardMessage(g,{profile:'tau',phase:'checking',phaseElapsedMs:30000,observedAt:10500}), 'Babs is saving their move');
});


test('pending journal timestamps do not conceal recovery, and same-scope captured profile remains available', () => {
 const g={...game(),pendingComputerSaveStartedAt:100,pendingComputerProfile:'babs'};
 assert.equal(computerBoardMessage(g,{phase:'recovery',profile:'tau',observedAt:60000}), 'Babs needs a hand');
 assert.equal(computerBoardMessage(g,{phase:'other-device',profile:'tau',observedAt:60000}), 'Babs is thinking');
 assert.equal(computerBoardMessage(g,{phase:'paused',profile:'tau',observedAt:60000}), 'Babs is paused');
 delete g.pendingComputerProfile;
 assert.equal(computerBoardMessage(g,{phase:'saving',profile:'tau',observedAt:60000}), 'Tau is saving their move');
});

test('an idle unacquired runner never claims it is thinking, including delayed recovery',()=>{
 const g={...game(),computerTurn:'tau'};
 assert.equal(computerBoardMessage(g,{phase:'idle',activity:{activeHere:false,showRecoveryNotice:false}}),'Waiting for Tau');
 assert.equal(computerBoardMessage(g,{phase:'idle',activity:{activeHere:false,showRecoveryNotice:true}}),'Tau needs a hand');
 assert.equal(computerBoardMessage(g,{phase:'resuming'}),'Resuming Tau');
 assert.equal(computerBoardMessage(g,{phase:'looking-ahead'}),'Tau is thinking');
 g.computer.paused=true;assert.equal(computerBoardMessage(g,{phase:'idle'}),'Tau is paused');
 g.computer.paused=false;g.pendingComputerControl=true;assert.equal(computerBoardMessage(g,{phase:'idle'}),'Updating computer play');
});
