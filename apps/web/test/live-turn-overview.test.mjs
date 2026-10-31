import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTurnOverview} from '../shell/live-turn-overview.js';
const snapshot=(turnIndex=1)=>({turnIndex,sideToMove:'P2',pieces:[],outcome:{status:'ongoing'}});
const game=()=>({id:'g',gameplayRevision:2,myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},controlSeat:'Player 2',board:{state:snapshot()},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:3}},selectionSnapshot:snapshot(0),snapshot:snapshot()}]});
const options={identityId:'me',scope:'account:1'};
const idle=()=>new Promise(resolve=>setImmediate(resolve));
test('completed opponent overview is visual only and returns after temporary inspection',()=>{
 const g=game(),before=structuredClone(g),overview=createLiveTurnOverview({loadMoves:()=>{throw Error('cached');}});
 overview.sync(g,options);assert.equal(overview.overlay().mode,'recorded-turn');
 assert.equal(overview.overlay({selectedPieceId:'opponent'}),null);
 overview.selected({id:'opponent',owner:'P1'});assert.equal(overview.overlay({inspection:{kind:'supply'}}),null);
 assert.equal(overview.overlay().mode,'recorded-turn');assert.deepEqual(g,before);
});
test('any explicit own piece selection dismisses for the visit, independent of legal moves',()=>{
 const g=game(),overview=createLiveTurnOverview({loadMoves:()=>[]});
 overview.sync(g,options);overview.selected({id:'blocked',owner:'P2'});
 assert.equal(overview.overlay(),null);overview.sync({...g,gameplayRevision:3},options);assert.equal(overview.overlay(),null);
 overview.leave();overview.sync(g,options);assert.equal(overview.overlay().mode,'recorded-turn');
 overview.selected({owner:'P2'});overview.sync(g,{...options,scope:'account:2'});assert.equal(overview.overlay().mode,'recorded-turn');
});
test('reopening after own acknowledged or pending actions retains normal live view',()=>{
 for(const pending of [false,true]){
  const g=game(),action={moveId:'mine',turnIndex:1,actorSide:'P2'};
  if(pending)g.pendingMoves=[action];else g.moves.push(action);
  const overview=createLiveTurnOverview({loadMoves:()=>[]});overview.sync(g,options);assert.equal(overview.overlay(),null);
 }
});
test('a new completed opponent turn resets the prior visit dismissal',()=>{
 const g=game(),overview=createLiveTurnOverview({loadMoves:()=>[]});overview.sync(g,options);overview.selected({owner:'P2'});
 g.board.state=snapshot(3);g.turns.push({index:2,playerSeat:'Player 1',status:'complete'});g.moves.push({...g.moves[0],moveId:'new',turnIndex:2});
 overview.sync(g,options);assert.equal(overview.overlay().mode,'recorded-turn');
});
test('viewers, self-play, continuations, history and terminal games never receive the live overview',()=>{
 for(const alter of [g=>{g.myRoles=[];g.player2.identityId='someone';},g=>{g.selfPlayMode=true;g.myRoles=['Player 1','Player 2'];g.player1.identityId='me';},g=>{g.board.state.continuation={type:'push',phase:'retreat',attackerOwner:'P2'};},g=>{g.inHistoryMode=true;},g=>{g.board.state.outcome={status:'p1_win'};}]){
  const g=game();alter(g);const overview=createLiveTurnOverview({loadMoves:()=>[]});overview.sync(g,options);assert.equal(overview.overlay(),null);
 }
});
test('background hydration is scoped and a failed visual read never blocks or modifies play',async()=>{
 let release,calls=0,changes=0;const g=game();delete g.moves[0].snapshot;
 const full={...g.moves[0],snapshot:snapshot()};
 const overview=createLiveTurnOverview({loadMoves:()=>{calls++;return new Promise(resolve=>release=resolve);},onChange:()=>changes++});
 overview.sync(g,options);overview.sync(g,options);await idle();assert.equal(calls,1);
 overview.selected({owner:'P2'});release([full]);await idle();assert.equal(overview.overlay(),null);assert.equal(changes,0);
 overview.leave();overview.sync(g,options);await idle();overview.leave();release([full]);await idle();assert.equal(overview.overlay(),null);
 const failing=createLiveTurnOverview({loadMoves:async()=>{throw Error('offline');}}),before=structuredClone(g);
 failing.sync(g,options);await idle();assert.equal(failing.overlay(),null);assert.deepEqual(g,before);
});
test('computer-owned identity still shows only the opposing computer turn to its human side',()=>{
 const g=game();g.player1.identityId='me';g.player1.computerProfile='horus';g.computer={seats:{p1:'horus',p2:null}};g.myRoles=['Player 1','Player 2'];
 const overview=createLiveTurnOverview({loadMoves:()=>[]});overview.sync(g,options);assert.equal(overview.overlay().mode,'recorded-turn');
});

test('reopened summary-only turns hydrate a visual aggregate without changing the live game',async()=>{
 const g=game(),full=structuredClone(g.moves[0]);delete g.moves[0].snapshot;delete g.moves[0].selectionSnapshot;
 const before=structuredClone(g);let calls=0,changes=0;
 const overview=createLiveTurnOverview({loadMoves:async request=>{calls++;assert.equal(request.gameId,g.id);assert.equal(request.turnIndex,0);assert.equal(request.revision,2);assert.equal(request.isCurrent(),true);return[full];},onChange:()=>changes++});
 overview.sync(g,options);assert.equal(overview.overlay(),null);await idle();
 assert.equal(overview.overlay().mode,'recorded-turn');assert.equal(changes,1);
 overview.sync(g,options);await idle();assert.equal(calls,1);assert.deepEqual(g,before);
});
