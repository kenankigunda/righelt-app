import test from 'node:test';
import assert from 'node:assert/strict';
import {computerActivityActorSide,activityActorSide,activityStateActorSide,undoApprovalActorSide,setActivityActor} from '../shell/activity-affiliation.js';
import {updateComputerBoardLoading} from '../shell/board-message-layout.js';
import {renderGameAlertCard} from '../shell/game-alert.js';
import {renderComputerProgress} from '../shell/computer-view.js';

for(const side of ['P1','P2'])test(`${side} saving remains affiliated to its queued actor after the turn advances`,()=>{
 const next=side==='P1'?'P2':'P1';
 const game={pendingActorSide:side,pendingCommandCount:1,board:{state:{sideToMove:next}},controlSeat:next==='P1'?'Player 1':'Player 2'};
 assert.equal(activityActorSide(game),side);
 assert.equal(activityActorSide(game,{thinking:true}),side);
 assert.equal(activityActorSide({...game,pendingActorSide:null,pendingMoves:[{actorSide:side}]}),side);
 assert.equal(activityActorSide({...game,pendingActorSide:null}),null,'Unknown pending actor never borrows the next turn');
});
test('retreat actor comes from defender authority for original and projected snapshots',()=>{
 for(const sideToMove of ['P1','P2']){
  const snapshot={sideToMove,continuation:{type:'push',phase:'retreat',attackerOwner:'P1'}};
  assert.equal(activityActorSide({pendingCommandCount:1,pendingMoves:[{actorSide:'P1',selectionSnapshot:snapshot}]}),'P2');
  assert.equal(activityActorSide({computerTurn:'babs',board:{state:snapshot}},{thinking:true}),'P2');
 }
});
test('thinking actor uses actual control seat, and ordinary unknown loading stays unaffiliated',()=>{
 assert.equal(activityActorSide({computerTurn:'tau',controlSeat:'Player 2',board:{state:{sideToMove:'P1'}}},{thinking:true}),'P2');
 assert.equal(activityActorSide({board:{state:{sideToMove:'P1'}}}),null);
 assert.equal(activityActorSide({computerTurn:'babs',board:{state:{sideToMove:'P1'}}},{thinking:true}),'P1');
});
test('affiliation patches only its attribute while a board cue retains its operation identity',()=>{
 const host={dataset:{loadingState:'idle'},hasAttribute(name){return name==='data-loading-key'&&this.dataset.loadingKey!==undefined;},removeAttribute(){delete this.dataset.loadingKey;}};
 const game={id:'g',computer:{paused:false},computerTurn:'babs',controlSeat:'Player 2'};
 updateComputerBoardLoading(host,game,{phase:'looking-ahead'},{scope:'account'});
 const key=host.dataset.loadingKey;assert.equal(host.dataset.activitySide,'P2');
 updateComputerBoardLoading(host,{...game,computerTurn:null,pendingComputerSaveStartedAt:0,pendingCommandCount:1,pendingActorSide:'P2',controlSeat:'Player 1'},{phase:'saving'},{scope:'account'});
 assert.equal(host.dataset.loadingKey,key);assert.equal(host.dataset.activitySide,'P2');
 updateComputerBoardLoading(host,{...game,computerTurn:null,pendingComputerSaveStartedAt:0,pendingCommandCount:1},{phase:'saving'},{scope:'account'});
 assert.equal(host.dataset.activitySide,'P2','Same operation retains known original actor during metadata handoff');
 updateComputerBoardLoading(host,{...game,computerTurn:null},{phase:'idle'},{scope:'account'});
 assert.equal(host.dataset.activitySide,undefined);assert.equal(host.dataset.loadingKey,undefined);
 setActivityActor(host,'P1');setActivityActor(host,'invalid');assert.equal(host.dataset.activitySide,undefined);
});
test('notification and computer progress expose only validated actor attributes',()=>{
 assert.match(renderGameAlertCard({activity:'processing',actorSide:'P2'}),/data-activity-side="P2"/);
 assert.doesNotMatch(renderGameAlertCard({actorSide:'P1" onclick="bad'}),/data-activity-side/);
 const game={computer:{seats:{p1:null,p2:'babs'},modelId:'initial-1554',manual:false,takeoverTurn:null},canControlComputer:true,computerTurn:null,pendingActorSide:'P2',pendingCommandCount:1,board:{state:{sideToMove:'P1'}}};
 assert.match(renderComputerProgress(game,{phase:'saving',phaseElapsedMs:20000,elapsedMs:20000,profile:'babs'}),/data-activity-side="P2"/);
});

test('undo waiting uses the responding player rather than requester or current turn',()=>{
 const game={player1:{identityId:'red'},player2:{identityId:'blue'},board:{state:{sideToMove:'P1'}}};
 assert.equal(undoApprovalActorSide(game,{requesterIdentityId:'red'}),'P2');
 assert.equal(undoApprovalActorSide(game,{requesterIdentityId:'blue'}),'P1');
 assert.equal(undoApprovalActorSide(game,{requesterIdentityId:'unknown'}),null);
 assert.equal(undoApprovalActorSide({...game,player2:{identityId:'red'}},{requesterIdentityId:'red'}),null);
 assert.equal(undoApprovalActorSide(game,null),null);
 assert.equal(activityStateActorSide({sideToMove:'P2',continuation:{type:'push',phase:'retreat',attackerOwner:'P1'}}),'P2');
});


test('named computer activity never inherits a pending human color',()=>{
 for(const computerSide of ['P1','P2']){
  const humanSide=computerSide==='P1'?'P2':'P1';
  const game={computer:{seats:{p1:computerSide==='P1'?'horus':null,p2:computerSide==='P2'?'horus':null}},computerTurn:'horus',pendingActorSide:humanSide,pendingCommandCount:1,controlSeat:humanSide,board:{state:{sideToMove:humanSide}}};
  assert.equal(computerActivityActorSide(game,{}),computerSide);
  assert.equal(computerActivityActorSide({...game,computerTurn:null,pendingComputerProfile:'horus',pendingComputerSaveStartedAt:0},{}),computerSide);
  assert.equal(activityActorSide(game),humanSide,'the separate human save cue retains its own actor');
 }
});


test('computer message profile and cue agree during a profile/status handoff',()=>{
 const game={computer:{seats:{p1:'tau',p2:'horus'}},computerTurn:'horus',controlSeat:'Player 2'};
 assert.equal(computerActivityActorSide(game,{profile:'tau',phase:'looking-ahead'}),'P1');
 assert.equal(computerActivityActorSide({...game,pendingComputerSaveStartedAt:0,pendingComputerProfile:'horus'},{profile:'tau',phase:'saving'}),'P2');
});
