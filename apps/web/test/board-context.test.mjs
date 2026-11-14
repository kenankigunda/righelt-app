import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardContextStore,renderBoardContext} from '../shell/board-context.js';
import {captureDisplayedReplay,displayedReplayIsCurrent,replayArchiveMatches} from '../shell/displayed-replay.js';
import {createNotificationStack} from '../shell/notification-state.js';
import {boardPromptSizingModels,isMappedBoardPromptHtml} from '../board/prompt-models.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';

const notice=(key,text,extra={})=>({key,gameId:'game',message:{text},...extra});
test('piece help and acknowledgment retain independent dismissal and announcement identities',()=>{
 const store=createBoardContextStore();
 store.update('acknowledged',notice('turn','Opponent moved',{replay:{key:'turn'}}));
 store.update('piece',notice('piece','No supply'));
 assert.deepEqual(store.items('game').map(x=>x.key),['turn','piece']);
 assert.equal(store.takeAnnouncement('turn'),'Opponent moved');assert.equal(store.takeAnnouncement('turn'),null);
 assert(store.dismiss('piece'));
 for(const transient of [true,false,true])store.update('piece',notice('piece','Another hover reason',{transient}));
 assert.deepEqual(store.items('game').map(x=>x.key),['turn']);assert.equal(store.takeAnnouncement('piece'),null);
 store.update('piece',notice('another-piece','No command'));
 assert.deepEqual(store.items('game').map(x=>x.key),['turn','another-piece']);
 assert.equal(store.channel('acknowledged').replay.key,'turn');
 assert(store.dismiss('turn'));assert(store.isDismissed('turn'));assert.equal(store.get('turn').replay.key,'turn');
 store.update('acknowledged',notice('next-turn','Opponent pushed',{replay:{key:'next-turn'}}));
 assert.equal(store.takeAnnouncement('next-turn'),'Opponent pushed');
});
test('logical piece scope admits an unannounced hover preview without resetting a prior dismissal',()=>{
 const store=createBoardContextStore();store.update('piece',{key:'scope',gameId:'game',message:null});assert.equal(store.items('game').length,0);
 store.update('piece',notice('scope','Destination would have no supply',{transient:true}));
 assert.equal(store.items('game').length,1);assert.equal(store.takeAnnouncement('scope'),null);
 store.dismiss('scope');store.update('piece',{key:'scope',gameId:'game',message:null});store.update('piece',notice('scope','Different target',{transient:true}));assert.equal(store.items('game').length,0);
});
test('mandatory coordinates stay present and nondismissible, with owner controls outside the scrolling body',()=>{
 const store=createBoardContextStore(),context=notice('required','Restore supply for pieces at (1, 2), (3, 4)',{mandatory:true,message:{text:'Restore supply for pieces at (1, 2), (3, 4)',coordinates:[{row:1,col:2},{row:3,col:4}]}});
 store.update('piece',context);assert.equal(store.dismiss('required'),false);assert.equal(store.items('game').length,1);
 const html=renderBoardContext(context);assert(!html.includes('board-context-dismiss'));assert(html.includes('Required piece coordinates'));assert.equal((html.match(/class="board-preview-coordinate-chip /g)||[]).length,2);
 const replay=renderBoardContext(notice('"<unsafe>','<unsafe>',{replay:{}}),{replayEnabled:true});
 assert(replay.indexOf('</div>')<replay.indexOf('data-action="replay-board-context"'));assert(replay.includes('Show me again'));assert(replay.includes('ui-dismiss-button'));assert(replay.includes('&lt;unsafe&gt;'));assert(!replay.includes('<unsafe>'));
});
test('one Board owner preserves required guidance and acknowledged History tie-breaks runtime fallback',()=>{
 const store=createBoardContextStore();
 store.update('acknowledged',notice('outcome','You won',{purpose:'selected-history'}));
 store.update('piece',notice('runtime','Recorded move',{purpose:'selected-history'}));
 assert.deepEqual(store.items('game').map(item=>item.key),['outcome']);
 store.update('piece',notice('required','Restore supply',{purpose:'required-continuation',mandatory:true}));
 assert.deepEqual(store.items('game').map(item=>item.key),['required']);
});
const accepted=()=>({id:'game',gameplayRevision:4,myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'move',turnIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:2}}}]});
test('replay descriptor binds the visible accepted turn and rejects newer undisplayed authority',()=>{
 const owner={},game=accepted(),context={owner,scope:'scope',gameId:'game',revision:4,lineageHead:'move',visible:true};
 const descriptor=captureDisplayedReplay({game,owner,scope:'scope',identityId:'me'});
 assert.equal(descriptor.turnIndex,0);assert.deepEqual(descriptor.moveIds,['move']);assert(displayedReplayIsCurrent(descriptor,{game,context}));
 for(const change of [{revision:5},{lineageHead:'new'},{owner:{}},{scope:'new'},{visible:false}])assert.equal(displayedReplayIsCurrent(descriptor,{game,context:{...context,...change}}),false);
 assert.equal(displayedReplayIsCurrent(descriptor,{game:{...game,inHistoryMode:true},context}),false);
 assert.equal(displayedReplayIsCurrent(descriptor,{game:{...game,gameplayRevision:5},context}),false);
 game.moves[0].action.to.row=9;assert.equal(descriptor.moves[0].action.to.row,2);
 assert(replayArchiveMatches(descriptor,[...descriptor.moves,{moveId:'elsewhere',turnIndex:1}]));
 assert.equal(replayArchiveMatches(descriptor,[...descriptor.moves,{moveId:'substitute',turnIndex:0}]),false);
 assert.equal(captureDisplayedReplay({game:{...game,gameplayRevision:undefined},owner,scope:'scope',identityId:'me'}),null);
});
test('explicit piece preference respects focused and urgent notices and explicit cycling',()=>{
 let held=null;const stack=createNotificationStack({getInteractionKey:()=>held}),ack={key:'ack'},piece={key:'piece'},urgent={key:'urgent',priority:'urgent'};
 assert.equal(stack.order('game',[ack])[0].key,'ack');stack.prefer('game','piece');held='ack';assert.equal(stack.order('game',[ack,piece])[0].key,'ack');
 held=null;assert.equal(stack.order('game',[ack,piece])[0].key,'piece');assert.equal(stack.order('game',[ack,piece,urgent])[0].key,'urgent');
 assert.equal(stack.order('game',[ack,piece,urgent])[0].key,'urgent');assert(stack.advance('game',[ack,piece,urgent]));stack.prefer('game','piece');assert.equal(stack.order('game',[ack,piece,urgent])[0].key,'ack');
});
test('sizing grammar includes native recovery controls, obligations and actual coordinate width',()=>{
 const models=boardPromptSizingModels({boardSize:1000}),html=models.map(m=>renderBoardMessageHtml(m,{sizing:true})).join('');
 for(const label of ['Cancel replay','Try again','Dismiss','Stop replay','End turn','Obligatory','Babs is saving their move','Horus needs a hand','999'])assert(html.includes(label));
 assert(html.includes('Confirm <strong>move commander to'));assert(!html.includes('data-board-message-action='));
});

test('bounded context storage never evicts the current dismissed acknowledgment',()=>{
 const store=createBoardContextStore();store.update('acknowledged',notice('turn','Opponent moved',{replay:{key:'turn'}}));store.dismiss('turn');store.takeAnnouncement('turn');
 for(let i=0;i<160;i++){const key=`piece-${i}`;store.update('piece',notice(key,'Reason'));store.dismiss(key);}
 assert.equal(store.channel('acknowledged').replay.key,'turn');assert(store.isDismissed('turn'));assert(!store.items('game').some(item=>item.key==='turn'));
});

test('unknown producer text and narration are not silently accepted as mapped short prompts',()=>{
 assert.equal(isMappedBoardPromptHtml('Unexpected short prompt'),false);
 assert.equal(isMappedBoardPromptHtml('Your opponent moved a piece'),false);
 assert.equal(isMappedBoardPromptHtml(renderBoardMessageHtml({text:'Select a retreat for piece at (1, 2)',coordinates:[{row:1,col:2}]})),true);
 assert.equal(isMappedBoardPromptHtml(renderBoardMessageHtml({text:'Étoile 星 to play',actorName:'Étoile 星'})),true);
 assert.equal(isMappedBoardPromptHtml('Replay · 1000 of 2000'),false);
});

 test('retirement clears retained entries, dismissal and announcement across both channels',()=>{
 const store=createBoardContextStore();store.update('acknowledged',notice('turn','Opponent moved'));store.update('piece',notice('piece','Reason'));
 assert.equal(store.takeAnnouncement('turn'),'Opponent moved');assert(store.dismiss('piece'));store.clear();
 assert.equal(store.get('turn'),null);assert.equal(store.channel('piece'),null);assert(!store.isDismissed('piece'));
 store.update('acknowledged',notice('turn','Opponent moved'));assert.equal(store.takeAnnouncement('turn'),'Opponent moved');
 });
