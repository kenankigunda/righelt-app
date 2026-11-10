import test from 'node:test';
import assert from 'node:assert/strict';
import {humanControlledSides,owningPerspective,perspectiveActorLabel,boardTurnLabel,liveHistoryLabel,BOARD_TURN_CAPTIONS,playerDisplayName,boardTurnCaption,historyActorLabel} from '../shell/perspective-labels.js';

const game=(role='Player 1')=>({myRole:role,myRoles:[role],player1:{identityId:'red'},player2:{identityId:'blue'}});
const options={identityId:'red'};
for(const side of ['P1','P2'])test(`player perspective labels ${side} independently of side to move`,()=>{
 const g=game();
 assert.equal(boardTurnLabel(g,{sideToMove:side},options),side==='P1'?'Your turn to play':'Opponent to play');
 assert.equal(liveHistoryLabel(g,{sideToMove:side},options),`Live · Waiting on ${side==='P1'?'you':'opponent'} to move`);
 assert.deepEqual(humanControlledSides(g,options),['P1']);
});
test('captured identity and explicit roles must both match, including account changes',()=>{
 assert.deepEqual(humanControlledSides(game(),{identityId:'blue'}),[]);
 assert.deepEqual(humanControlledSides(game('Viewer'),options),[]);
 assert.deepEqual(humanControlledSides(game(),{}),[]);
 assert.deepEqual(owningPerspective(game('Viewer'),options),{kind:'viewer',sides:[]});
 assert.equal(perspectiveActorLabel(game('Viewer'),'P1',options),'Guest 1');
 assert.equal(perspectiveActorLabel(game('Viewer'),'P2',options),'Guest 2');
});
test('owned human self-play says you for both colors while a spectator sees colors',()=>{
 const g={...game(),selfPlayMode:true,player2:{identityId:'red'}};
 assert.deepEqual(humanControlledSides(g,options),['P1','P2']);
 for(const side of ['P1','P2'])assert.equal(boardTurnLabel(g,{sideToMove:side},options),'Your turn to play');
 assert.deepEqual(humanControlledSides({...g,myRole:'Viewer',myRoles:['Viewer']},options),[]);
 assert.deepEqual(humanControlledSides(g,{identityId:'spectator'}),[]);
});
test('shared computer ownership never becomes human self-play',()=>{
 const g={...game(),selfPlayMode:true,player2:{identityId:'red',computerProfile:'tau'},computer:{seats:{p2:'tau'}}};
 assert.deepEqual(humanControlledSides(g,options),['P1']);
 assert.equal(boardTurnLabel(g,{sideToMove:'P2'},options),'Opponent to play');
 const both={...g,myRole:'Both Players',myRoles:['Both Players']};
 assert.deepEqual(humanControlledSides(both,options),['P1']);
 const watch={...both,player1:{identityId:'red',computerProfile:'babs'},computer:{seats:{p1:'babs',p2:'tau'}}};
 assert.deepEqual(humanControlledSides(watch,options),[]);
 assert.equal(boardTurnLabel(watch,{sideToMove:'P1'},options),'Babs to play');
});
test('manual takeover affects current control copy without changing permanent human seats',()=>{
 const g={...game(),selfPlayMode:true,player2:{identityId:'red',computerProfile:'tau'},computer:{manual:true,seats:{p2:'tau'}},canControlComputer:true};
 assert.deepEqual(humanControlledSides(g,options),['P1']);
 assert.deepEqual(humanControlledSides(g,{...options,includeManualControl:true}),['P1','P2']);
 assert.equal(boardTurnLabel(g,{sideToMove:'P2'},options),'Your turn to play');
 assert.equal(boardTurnLabel({...g,canControlComputer:false},{sideToMove:'P2'},options),'Opponent to play');
 assert.equal(boardTurnLabel(g,{sideToMove:'P2'},{identityId:'other'}),'Tau to play');
});
test('forced retreat follows defender control even when attacker owns the turn',()=>{
 const state={sideToMove:'P2',continuation:{type:'push',phase:'retreat',attackerOwner:'P1'}};
 assert.equal(boardTurnLabel(game(),state,options),'Opponent to play');
 assert.equal(liveHistoryLabel(game(),state,options),'Live · Waiting on opponent to move');
 const follow={...state,sideToMove:'P1',continuation:{...state.continuation,phase:'follow'}};
 assert.equal(boardTurnLabel(game(),follow,options),'Your turn to play');
 assert(BOARD_TURN_CAPTIONS.includes('Your turn to play'));
 assert(BOARD_TURN_CAPTIONS.includes('Opponent to play'));
});

test('spectator captions use player names, computer names and distinct anonymous guest labels',()=>{
 const g={...game('Viewer'),player1:{identityId:'red',profile:{displayName:'Renée 石'}},player2:{identityId:'blue'}};
 assert.equal(playerDisplayName(g,'P1'),'Renée 石');assert.equal(playerDisplayName(g,'P2'),'Guest');
 assert.deepEqual(boardTurnCaption(g,{sideToMove:'P1'},options),{text:'Renée 石 to play',side:'P1',name:'Renée 石',suffix:' to play'});
 assert.equal(liveHistoryLabel(g,{sideToMove:'P2'},options),'Live · Waiting on Guest to move');
 const computers={...game('Viewer'),computer:{seats:{p1:'horus',p2:'tau'}}};
 assert.equal(boardTurnLabel(computers,{sideToMove:'P1'},options),'Horus to play');
 const blue={...game('Player 2')};assert.equal(boardTurnLabel(blue,{sideToMove:'P2'},{identityId:'blue'}),'Your turn to play');
 assert.equal(boardTurnLabel(blue,{sideToMove:'P1'},{identityId:'blue'}),'Opponent to play');
});

test('duplicate human identity alone cannot declare both-side self-play',()=>{
 const g={...game(),myRoles:['Player 1','Player 2'],player2:{identityId:'red'}};
 assert.deepEqual(humanControlledSides(g,options),['P1']);
 assert.deepEqual(humanControlledSides({...g,myRole:'Both Players',myRoles:['Both Players']},options),[]);
});

test('computer history actors keep their plain name while current-turn copy stays relative',()=>{
 const g={...game(),player2:{identityId:'red',computerProfile:'horus'},computer:{seats:{p2:'horus'}}};
 assert.equal(boardTurnLabel(g,{sideToMove:'P2'},options),'Opponent to play');
 assert.equal(historyActorLabel(g,{actorSide:'P2'},options),'Horus');
 assert.equal(historyActorLabel(g,{actorSide:'P1'},options),'Guest');
 assert.equal(historyActorLabel(game(),{actorSide:'P2'},options),'Guest 2');
 assert.equal(historyActorLabel(game(),{actorSide:'P2',computerProof:{profile:'tau'}},options),'Tau');
});

test('a shared computer-owner primary role resolves the actual human blue seat',()=>{
 const g={...game(),player1:{identityId:'red',computerProfile:'babs'},player2:{identityId:'red'},computer:{seats:{p1:'babs'}}};
 assert.deepEqual(humanControlledSides(g,options),['P2']);
 assert.equal(boardTurnLabel(g,{sideToMove:'P2'},options),'Your turn to play');
 assert.deepEqual(humanControlledSides({...g,myRole:'Viewer',myRoles:['Viewer']},options),[]);
});

test('an account named Guest remains its name and an open seat does not number the guest',()=>{
 const named={...game('Viewer'),player1:{identityId:'red',profile:{displayName:'Guest',username:'guest-account'}}};
 assert.equal(playerDisplayName(named,'P1'),'Guest');assert.equal(playerDisplayName(named,'P2'),'Guest');
 assert.equal(playerDisplayName({...game('Viewer'),player2:null},'P1'),'Guest');
 assert.equal(historyActorLabel(game(),{},options),'Next player');
});

test('canonical player references keep names, fixed guest seats and nonvisual ownership separate', async()=>{
 const {playerIdentityLabel}=await import('../shell/perspective-labels.js');
 const named={...game(),player1:{identityId:'red',profile:{displayName:'Red <&> שלום'}},player2:{identityId:'blue',profile:{displayName:'Red <&> שלום'}}};
 assert.deepEqual(playerIdentityLabel(named,'p1',options),{text:'Red <&> שלום',side:'P1',color:'Red',accessibleName:'Red <&> שלום, you, Red'});
 assert.deepEqual(playerIdentityLabel(named,'P2',options),{text:'Red <&> שלום',side:'P2',color:'Blue',accessibleName:'Red <&> שלום, Blue'});
 assert.equal(playerIdentityLabel(game(),'P1',options).text,'Guest 1');
 assert.equal(playerIdentityLabel({...named,player1:{identityId:'red'}},'P1',options).text,'Guest');
 assert.equal(historyActorLabel(named,{actorSide:'P1'},options),'Red <&> שלום');
 assert.equal(historyActorLabel(game(),{actorSide:'P2'},options),'Guest 2');
 assert.deepEqual(playerIdentityLabel(named,'unknown',options),{text:'Player',side:null,color:null,accessibleName:'Player'});
});
