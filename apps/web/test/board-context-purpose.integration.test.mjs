import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgedContextPurpose, runtimeContextPurpose} from '../shell/board-context-purpose.js';
import {opponentBoardMessage} from '../shell/opponent-narration.js';
import {computerBoardMessage} from '../shell/computer-narration.js';
import {publishAcknowledgedBoardMessage} from '../shell/playback-presentation.js';
import {createBoardContextStore} from '../shell/board-context.js';
import {createBoardContextOwner} from '../shell/board-context-owner.js';

const game = () => ({id:'g',gameplayRevision:7,myRoles:['Player 2'],controlSeat:'Player 2',
 player1:{identityId:'other',profile:{displayName:'Maya'}},player2:{identityId:'me',profile:{displayName:'Kenan'}},
 board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],
 moves:[{moveId:'accepted',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',
  selectionSnapshot:{pieces:[],sideToMove:'P1'},snapshot:{pieces:[],sideToMove:'P2'},
  action:{type:'rush',from:{row:1,col:2},to:{row:2,col:3}}}]});
const publish = (view, options = {}) => {
 const store=createBoardContextStore(),transport={getIdentityId:()=> 'me'},preferences=[];
 publishAcknowledgedBoardMessage(view,{}, {identityId:'me',canInteract:true,...options}, {
  boardContexts:store,queueBoardContextRefresh(){},transport,boardContextScope:()=> 'owned-scope',document:{hidden:false},notificationStack:{prefer(...value){preferences.push(value);}},
 });
 return {context:store.channel('acknowledged'),store,preferences};
};

test('actual acknowledged human and computer producers mark incoming purpose and recorded owner',()=>{
 const human=game(),before=JSON.stringify(human),message=opponentBoardMessage(human,{}, {},{identityId:'me',canInteract:true});
 assert.equal(message.context.purpose,'incoming-narration');assert.equal(message.context.actorSide,'P1');
 assert.equal(message.context.actorName,'Maya');assert.equal(message.context.text,'Maya rushed from (1, 2) to (2, 3)');
 const {context}=publish(human);assert.equal(context.purpose,'incoming-narration');assert.equal(context.actorSide,'P1');
 assert.deepEqual(context.replay.moveIds,['accepted']);assert.equal(context.replay.revision,7);
 const computer={...game(),computer:{seats:{p1:'tau'}},moves:[{...human.moves[0],computerProof:{profile:'tau'}}]};
 const summary=computerBoardMessage(computer,{});assert.equal(summary.purpose,'incoming-narration');assert.equal(summary.actorName,'Tau');assert.equal(summary.actorSide,'P1');
 assert.equal(JSON.stringify(human),before,'presentation does not alter saved moves or authority');
});

test('confirmed playback synthetic record is incoming while actual frozen History stays Board history',()=>{
 const live=game(),before=JSON.stringify(live);
 const automatic=publish(live,{presentationMove:live.moves[0]}).context;
 assert.equal(automatic.purpose,'incoming-narration');assert.equal(automatic.actorSide,'P1');assert.equal(automatic.replay,null);
 const selected={...live,inHistoryMode:true,historyIndex:0};
 const history=publish(selected).context;assert.equal(history.purpose,'selected-history');assert.equal(history.message.text,'Maya rushed from (1, 2) to (2, 3)');assert.equal(history.replay,null);
 assert.equal(JSON.stringify(live),before);
});

test('presentation classification never infers purpose from prose, channel, or replay button',()=>{
 for(const text of ['Maya rushed','Game complete','Incoming move','needs help']){
  assert.equal(acknowledgedContextPurpose({message:{text,action:{id:'replay-computer'}}}),'board-context');
 }
 assert.equal(acknowledgedContextPurpose({message:{purpose:'local-sequence',text:'Push sequence'}}),'local-sequence');
 assert.equal(acknowledgedContextPurpose({selectedHistory:true,recordedMove:{moveId:'a'},message:{purpose:'incoming-narration'}}),'selected-history');
 assert.equal(acknowledgedContextPurpose({message:{purpose:'not-a-contract'}}),'board-context');
});

test('runtime required, inspection, historical and replay descriptors keep independent Board purposes',()=>{
 assert.equal(runtimeContextPurpose({mandatory:true,kind:'inspection'}),'required-continuation');
 assert.equal(runtimeContextPurpose({kind:'replay-progress'}),'replay-progress');
 assert.equal(runtimeContextPurpose({kind:'history'}),'selected-history');
 for(const kind of ['inspection','piece-explanation','rush-effect','rush-hints','rush-loading','no-moves','blocked-move'])assert.equal(runtimeContextPurpose({kind}),'piece-inspection');
 assert.equal(runtimeContextPurpose({kind:'acknowledged',message:{text:'Incoming move'}}),'board-context');
});

test('purpose and owner changes update the same context without reviving dismissal or announcement',()=>{
 const store=createBoardContextStore(),context={key:'same',gameId:'g',purpose:'incoming-narration',actorSide:'P1',message:{text:'Maya passed'}};
 assert.equal(store.update('acknowledged',context),true);assert.equal(store.update('acknowledged',context),false);
 assert.equal(store.takeAnnouncement('same'),'Maya passed');assert.equal(store.dismiss('same'),true);
 assert.equal(store.update('acknowledged',{...context,purpose:'selected-history',actorSide:'P2'}),true);
 assert.equal(store.isDismissed('same'),true);assert.equal(store.takeAnnouncement('same'),null);
});

test('actual context owner retires both purposes on scope changes without mutating recorded state',()=>{
 const store=createBoardContextStore(),transport={},live=game(),before=JSON.stringify(live);let key='account1:game:live';
 const owner=createBoardContextOwner({store,getScope:()=>({owner:transport,key})});const token=owner.capture();
 store.update('acknowledged',{key:'incoming',gameId:'g',purpose:'incoming-narration',message:{text:'Maya passed'}});
 store.update('piece',{key:'required',gameId:'g',purpose:'required-continuation',mandatory:true,message:{text:'Follow'}});
 key='account2:game:live';assert.equal(owner.current(token),false);assert.equal(store.channel('acknowledged'),null);assert.equal(store.channel('piece'),null);
 assert.equal(JSON.stringify(live),before);owner.retire();
});

test('mixed Push defender Retreat and Follow use the recorded turn owner after manual or temporary control',()=>{
 for(const mode of ['manual','temporary']){
  const local={...game(),myRoles:['Player 1','Player 2'],canControlComputer:true,controlSeat:'Player 2',
   player1:{identityId:'me',profile:{displayName:'Maya'},computerProfile:null},player2:{identityId:'me',profile:{displayName:'Kenan'},computerProfile:null},
   computer:{seats:{p1:null,p2:'tau'},manual:mode==='manual',takeoverTurn:mode==='temporary'?0:null},computerTurn:null,
   moves:[
    {moveId:'push',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'push',actorId:'attacker',from:{row:4,col:3},to:{row:4,col:4}},selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:{sideToMove:'P2',pieces:[]}},
    {moveId:'retreat',index:1,turnIndex:0,turnMoveIndex:1,actorSide:'P2',computerProof:{profile:'tau'},action:{type:'retreat',actorId:'defender',from:{row:4,col:4},to:{row:3,col:4}},selectionSnapshot:{sideToMove:'P2',pieces:[]},snapshot:{sideToMove:'P1',pieces:[]}},
    {moveId:'follow',index:2,turnIndex:0,turnMoveIndex:2,actorSide:'P1',action:{type:'follow',actorId:'follower',from:{row:4,col:2},to:{row:4,col:3}},selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:{sideToMove:'P2',pieces:[]}},
   ]};
  const before=JSON.stringify(local);
  assert.equal(computerBoardMessage(local,{}),null,'a computer defender is not the owner of this human Push turn');
  assert.equal(opponentBoardMessage(local,{}, {},{identityId:'me',canInteract:true}),null,'a recorded local human turn cannot become incoming because a defender was computer-controlled');
  assert.equal(publish(local).context.purpose,'local-sequence','the complete local Push replay remains Board content');
  const genuine={...local,computer:{...local.computer,seats:{p1:'tau',p2:null}},moves:local.moves.map(move=>({...move,computerProof:move.actorSide==='P1'?{profile:'tau'}:undefined}))};
  const priorComputer=opponentBoardMessage(genuine,{}, {},{identityId:'me',canInteract:true}).context;
  assert.equal(priorComputer.purpose,'incoming-narration');assert.equal(priorComputer.actorName,'Tau');assert.equal(priorComputer.actorSide,'P1');
  assert.equal(priorComputer.text,'Tau pushed onto (4, 4) and had 1 piece follow');
  assert.equal(JSON.stringify(local),before,'control changes never rewrite recorded ownership or action chronology');
 }
});
