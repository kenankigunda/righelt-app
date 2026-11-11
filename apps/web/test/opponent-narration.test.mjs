import test from 'node:test';
import assert from 'node:assert/strict';
import {latestOpponentTurn, opponentBoardMessage} from '../shell/opponent-narration.js';
import {buildTurnReplay, buildComputerTurnReplay} from '../shell/computer-replay.js';
const game = () => ({myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},controlSeat:'Player 2',board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',selectionSnapshot:{pieces:[],sideToMove:'P1'},snapshot:{pieces:[],sideToMove:'P2'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:3}}}]});
test('human completed turn offers named narration and the existing isolated replay action',()=>{
 const g=game(),message=opponentBoardMessage(g,{}, {},{canInteract:true,identityId:'me'});
 assert.equal(message.context.text,'Guest 1 rushed from (1, 2) to (2, 3)');
 assert.equal(message.context.action.label,'Show me again');
 assert.equal(latestOpponentTurn(g).last.moveId,'a');
 assert.equal(opponentBoardMessage(g,{}, {selectedPieceId:'piece'},{canInteract:true}),null);
 assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}).frames.length,1);
 assert.equal(buildComputerTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
});
test('read only boards never receive gameplay or replay CTAs for another player',()=>{
 const g=game();g.controlSeat='Player 1';
 assert.equal(opponentBoardMessage(g,{}),'Waiting for your opponent');
 g.myRoles=[];g.moves.push({...g.moves[0],moveId:'current',turnIndex:1});assert.equal(opponentBoardMessage(g,{}).text,'Guest 1 to play');
 g.controlSeat='Player 2';assert.match(opponentBoardMessage(g,{}, {},{identityId:'me'}).context.text,/Guest 1/);
 g.pendingCommandCount=1;assert.equal(opponentBoardMessage(g,{}).text,'Guest 2 to play');
 g.inHistoryMode=true;assert.equal(opponentBoardMessage(g,{}),null);
});
test('turn ownership and forced retreat attribution use sides, including a dual-seat account',()=>{
 const g=game();g.moves.push({...g.moves[0],moveId:'defender',actorSide:'P2',turnMoveIndex:1,action:{type:'retreat',from:{row:1,col:2},to:{row:2,col:3}}});
 assert.equal(latestOpponentTurn(g).last.moveId,'a');
 const frames=buildTurnReplay({moves:g.moves,completedTurnIndex:0}).frames;
 assert.deepEqual(frames.map(frame=>frame.decisionId),['a','defender']);
 g.myRoles=['Player 1','Player 2'];assert.equal(latestOpponentTurn(g),null);
 g.computer={seats:{p1:'tau',p2:null}};assert.equal(latestOpponentTurn(g),null,'current computer configuration cannot rewrite an earlier human turn');g.moves[0].computerProof={profile:'tau'};assert.equal(latestOpponentTurn(g).side,'P1');
});
test('undone, stale and malformed decisions do not create replayable opponent turns',()=>{
 const g=game();g.moves[0].undone=true;assert.equal(latestOpponentTurn(g),null);
 g.moves[0].undone=false;g.board.state.turnIndex=2;assert.equal(latestOpponentTurn(g),null);
 g.board.state.turnIndex=1;delete g.moves[0].snapshot;assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
 g.moves[0].snapshot={};g.moves[0].turnMoveIndex=1;assert.equal(buildTurnReplay({moves:g.moves,completedTurnIndex:0}),null);
});

test("local retreat keeps its real action prompt and terminal boards stay informational",()=>{
 const g=game();g.control="opponent";assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
 g.board.state.outcome={status:"P1-wins"};assert.deepEqual(opponentBoardMessage(g,{}),{text:'Review the game in History'});
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
 assert.equal(opponentBoardMessage(g,{phase:'looking-ahead'}, {},{canInteract:false}),'Tau is thinking');
});
test('spectators can replay named guest completed turns only before the next acknowledged action',()=>{
 for(const side of ['P1','P2']){
  const g=game();g.myRoles=[];g.moves[0].actorSide=side;g.turns[0].playerSeat=side==='P1'?'Player 1':'Player 2';g.controlSeat=side==='P1'?'Player 2':'Player 1';
  const message=opponentBoardMessage(g,{});assert.equal(message.context.text,`${side==='P1'?'Guest 1':'Guest 2'} rushed from (1, 2) to (2, 3)`);assert.equal(message.context.action.label,'Show me again');
  g.moves.push({...g.moves[0],moveId:'current',turnIndex:1});assert.equal(opponentBoardMessage(g,{}).text,`${side==='P1'?'Guest 2':'Guest 1'} to play`);
  g.moves[1].undone=true;assert.equal(opponentBoardMessage(g,{}).context.action.label,'Show me again');
  g.sharedMutationsBlocked=true;assert.equal(opponentBoardMessage(g,{}).context.action.label,'Show me again');
 }
 const g=game();assert.match(opponentBoardMessage(g,{}, {},{identityId:'me'}).context.text,/Guest 1/);
});

test('optimistic computer terminal saves finish before confirmed game-complete narration',()=>{
 const g=game();g.computer={seats:{p1:'tau'}};g.pendingComputerProfile='tau';g.pendingComputerSaveStartedAt=123;g.board.state.outcome={status:'p1_win'};
 assert.equal(opponentBoardMessage(g,{}),'Tau is saving their move');delete g.pendingComputerSaveStartedAt;
 assert.deepEqual(opponentBoardMessage(g,{}),{text:'Review the game in History'});
});
test('legal untouched local turns offer Pass beside human and computer narration only',()=>{
 for(const computer of [false,true]){
  const g=game();g.legalActions=[{type:'pass'}];
  if(computer){g.computer={seats:{p1:'tau'}};g.moves[0].computerProof={profile:'tau'};}
  const message=opponentBoardMessage(g,{}, {},{canInteract:true});assert.equal(message.context.action.label,'Show me again');assert.equal(message.text,'Select a piece or');assert.deepEqual(message.actions.map(action=>action.id),['pass']);assert.equal(message.action,undefined);
  delete g.legalActions;assert.deepEqual(opponentBoardMessage(g,{}, {},{canInteract:true}).actions,[]);
  g.legalActions=[{type:'pass'}];assert.equal(opponentBoardMessage(g,{}, {},{canInteract:false}).actions[0].id,'pass');
  g.board.state.continuation={type:'rush'};assert.equal(opponentBoardMessage(g,{}, {},{canInteract:true}),null);
 }
});

test('incoming narration preserves participant names for spectators and human owners',()=>{
 const g=game();g.myRoles=[];g.player1.profile={displayName:'Étoile 星'};g.player2.profile={username:'BlueMoon'};
 const message=opponentBoardMessage(g,{});assert.equal(message.context.text,'Étoile 星 rushed from (1, 2) to (2, 3)');assert.equal(message.context.action.label,'Show me again');assert.equal(message.context.actorName,'Étoile 星');
 g.moves.push({...g.moves[0],moveId:'current',turnIndex:1});assert.equal(opponentBoardMessage(g,{}).text,'BlueMoon to play');
 assert.equal(opponentBoardMessage(g,{}, {},{identityId:'me'}).context.text,'Étoile 星 rushed from (1, 2) to (2, 3)');
 g.controlSeat='Player 1';assert.equal(opponentBoardMessage(g,{}, {},{identityId:'me'}),'Waiting for your opponent');
 const actorSides=g.moves.map(move=>move.actorSide);assert.deepEqual(actorSides,['P1','P1']);
});

test('a pending computer control is not described as saving a human move',()=>{
 const g={...game(),pendingCommandCount:1,pendingComputerControl:true};
 assert.match(opponentBoardMessage(g,{}).context.text,/Guest 1/);
 g.pendingComputerControl=false;assert.match(opponentBoardMessage(g,{}).context.text,/Guest 1/);
});


test('quiet renewal keeps actual opponent narration and replay while the interaction fence preserves disabled Pass',()=>{
 const g=game();g.computer={seats:{p1:'babs',p2:null}};g.moves[0].computerProof={profile:'babs'};g.legalActions=[{type:'pass'}];
 const status={phase:'idle',activity:{quietRenewal:true}},options={canInteract:true,identityId:'me'};
 const before=opponentBoardMessage(g,status,{},options);assert.match(before.context.text,/Babs rushed/);assert.equal(before.actions[0].id,'pass');
 g.pendingComputerControl=true;g.pendingCommandCount=1;g.sharedMutationsBlocked=true;options.canInteract=false;
 const held=opponentBoardMessage(g,status,{},options);
 assert.equal(held.text,before.text);assert.equal(held.context.text,before.context.text);assert.deepEqual(held.context.action,{id:'replay-computer',label:'Show me again'});
 assert.equal(held.actions[0].id,'pass');assert.equal(g.sharedMutationsBlocked,true);
 assert.equal(opponentBoardMessage(g,{phase:'idle',activity:{quietRenewal:false}},{},options).context.text,before.context.text);
 g.moves=[];g.turns=[];assert.equal(opponentBoardMessage(g,status,{},options),null,'no completed turn leaves the normal selection prompt in charge');
});

test('terminal authority takes precedence over stale computer work while inspection stays available',()=>{
 for(const status of ['p1_win','p2_win','draw']){
 const g=game();Object.assign(g,{computer:{seats:{p1:'tau'}},computerTurn:'tau'});g.board.state.outcome={status};
 assert.deepEqual(opponentBoardMessage(g,{phase:'saving'}),{text:'Review the game in History'});
 assert.equal(opponentBoardMessage(g,{}, {selectedPieceId:'piece'}),null);
 assert.equal(opponentBoardMessage({...g,inHistoryMode:true},{}),null);
 }
});


test('completed games keep their finite Board prompt without a redundant notification context',()=>{
 for(const terminal of [{status:'finished'},{board:{state:{turnIndex:1,sideToMove:'P2',outcome:{status:'p1_win'}}}}]){
  const g={...game(),...terminal};
  const before=structuredClone(g);
  assert.deepEqual(opponentBoardMessage(g,{}, {},{canInteract:false,identityId:'me'}),{text:'Review the game in History'});
  assert.deepEqual(g,before,'presentation does not alter completed game authority');
  assert.equal(opponentBoardMessage(g,{}, {selectedPieceId:'piece'}),null);
  assert.equal(opponentBoardMessage(g,{}, {inspection:{kind:'supply',owner:'P1'}}),null);
  assert.equal(opponentBoardMessage({...g,inHistoryMode:true},{}),null);
 }
});
