import test from 'node:test';
import assert from 'node:assert/strict';
import {latestOpponentTurn, opponentBoardMessage} from '../shell/opponent-narration.js';
import {buildTurnReplay, buildComputerTurnReplay} from '../shell/computer-replay.js';
const game = () => ({myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},controlSeat:'Player 2',board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',selectionSnapshot:{pieces:[],sideToMove:'P1'},snapshot:{pieces:[],sideToMove:'P2'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:3}}}]});
test('human completed turn offers role narration and the existing isolated replay action',()=>{
 const g=game(),message=opponentBoardMessage(g,{}, {},{canInteract:true,identityId:'me'});
 assert.equal(message.text,'Your opponent rushed a piece from (1, 2) to (2, 3)');
 assert.equal(message.action.label,'Show me again');
 assert.equal(latestOpponentTurn(g).last.moveId,'a');
 assert.equal(opponentBoardMessage(g,{}, {selectedPieceId:'piece'},{canInteract:true}),null);
 assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}).frames.length,1);
 assert.equal(buildComputerTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
});
test('read only boards never receive gameplay or replay CTAs for another player',()=>{
 const g=game();g.controlSeat='Player 1';
 assert.equal(opponentBoardMessage(g,{}),'Waiting for your opponent');
 g.myRoles=[];g.moves.push({...g.moves[0],moveId:'current',turnIndex:1});assert.equal(opponentBoardMessage(g,{}),'Red to play');
 g.controlSeat='Player 2';assert.equal(opponentBoardMessage(g,{}, {},{identityId:'me'}),'Your turn');
 g.pendingCommandCount=1;assert.equal(opponentBoardMessage(g,{}),'Saving your move');
 g.inHistoryMode=true;assert.equal(opponentBoardMessage(g,{}),null);
});
test('turn ownership and forced retreat attribution use sides, including a dual-seat account',()=>{
 const g=game();g.moves.push({...g.moves[0],moveId:'defender',actorSide:'P2',turnMoveIndex:1,action:{type:'retreat',from:{row:1,col:2},to:{row:2,col:3}}});
 assert.equal(latestOpponentTurn(g).last.moveId,'a');
 const frames=buildTurnReplay({moves:g.moves,completedTurnIndex:0}).frames;
 assert.deepEqual(frames.map(frame=>frame.decisionId),['a','defender']);
 g.myRoles=['Player 1','Player 2'];assert.equal(latestOpponentTurn(g),null);
 g.computer={seats:{p1:'tau',p2:null}};assert.equal(latestOpponentTurn(g).side,'P1');
});
test('undone, stale and malformed decisions do not create replayable opponent turns',()=>{
 const g=game();g.moves[0].undone=true;assert.equal(latestOpponentTurn(g),null);
 g.moves[0].undone=false;g.board.state.turnIndex=2;assert.equal(latestOpponentTurn(g),null);
 g.board.state.turnIndex=1;delete g.moves[0].snapshot;assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
 g.moves[0].snapshot={};g.moves[0].turnMoveIndex=1;assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
});

test("local retreat keeps its real action prompt and terminal boards stay informational",()=>{
 const g=game();g.control="opponent";assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
 g.board.state.outcome={status:"P1-wins"};assert.equal(opponentBoardMessage(g,{}),"Game complete");
});
test('selection and line inspection precede every generic opponent or computer status',()=>{
 for(const canInteract of [false,true])for(const selection of [{selectedPieceId:'piece'},{inspection:{kind:'supply',owner:'P1'}}]){
  const g=game();assert.equal(opponentBoardMessage(g,{},selection,{canInteract}),null);
  g.computer={seats:{p1:'tau'}};g.computerTurn='tau';assert.equal(opponentBoardMessage(g,{},selection,{canInteract}),null);
 }
});
test('local rush, follow and forced retreat keep their real action prompts without stale replay',()=>{
 for(const continuation of [{type:'rush'},{type:'push',phase:'follow'},{type:'push',phase:'retreat',attackerOwner:'P1'}]){
  const g=game();g.board.state.continuation=continuation;
  assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
  g.computer={seats:{p1:'tau'}};assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
 }
 const g=game();g.computer={seats:{p1:'tau'}};g.computerTurn='tau';g.board.state.continuation={type:'rush'};
 assert.equal(opponentBoardMessage(g,{}, {},{canInteract:false}),'Tau is thinking');
});
test('spectators can replay Red or Blue completed turns only before the next acknowledged action',()=>{
 for(const side of ['P1','P2']){
  const g=game();g.myRoles=[];g.moves[0].actorSide=side;g.turns[0].playerSeat=side==='P1'?'Player 1':'Player 2';g.controlSeat=side==='P1'?'Player 2':'Player 1';
  const message=opponentBoardMessage(g,{});assert.equal(message.text,`${side==='P1'?'Red':'Blue'} rushed a piece from (1, 2) to (2, 3)`);assert.equal(message.action.label,'Show me again');
  g.moves.push({...g.moves[0],moveId:'current',turnIndex:1});assert.equal(opponentBoardMessage(g,{}),`${side==='P1'?'Blue':'Red'} to play`);
  g.moves[1].undone=true;assert.equal(opponentBoardMessage(g,{}).action.label,'Show me again');
  g.sharedMutationsBlocked=true;assert.equal(opponentBoardMessage(g,{}),'Waiting for the game');
 }
 const g=game();assert.equal(opponentBoardMessage(g,{}, {},{identityId:'me'}),'Your turn');
});

test('optimistic computer terminal saves finish before confirmed game-complete narration',()=>{
 const g=game();g.computer={seats:{p1:'tau'}};g.pendingComputerProfile='tau';g.pendingComputerSaveStartedAt=123;g.board.state.outcome={status:'p1_win'};
 assert.equal(opponentBoardMessage(g,{}),'Tau is saving their move');delete g.pendingComputerSaveStartedAt;
 assert.equal(opponentBoardMessage(g,{}),'Game complete');
});
test('legal untouched local turns offer Pass beside human and computer narration only',()=>{
 for(const computer of [false,true]){
  const g=game();g.legalActions=[{type:'pass'}];
  if(computer){g.computer={seats:{p1:'tau'}};g.moves[0].computerProof={profile:'tau'};}
  const message=opponentBoardMessage(g,{}, {},{canInteract:true});assert.equal(message.action.label,'Show me again');assert.deepEqual(message.actions.map(action=>action.id),['pass','replay-computer']);
  delete g.legalActions;assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}).actions,undefined);
  g.legalActions=[{type:'pass'}];assert.equal(opponentBoardMessage(g,{}, {},{canInteract:false}).actions,undefined);
  g.board.state.continuation={type:'rush'};assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
 }
});
