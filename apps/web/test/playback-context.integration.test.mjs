import {confirmedPlaybackMessage,playbackTurnIndicator,contextReplayAvailable,refreshFollowControls} from '../shell/playback-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDisplayedReplay,displayedReplayIsCurrent,replayArchiveMatches} from '../shell/displayed-replay.js';
import {withPushSequenceMessage,buildPushSequenceReplay} from '../shell/push-sequence-replay.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {isMappedBoardPromptHtml} from '../board/prompt-models.js';
const game=()=>({id:'g',gameplayRevision:4,myRoles:['Player 1'],player1:{identityId:'human'},player2:{identityId:'friend'},
 board:{state:{turnIndex:0,sideToMove:'P1'}},legalActions:[{type:'end_turn'}],moves:['push','retreat','follow'].map((type,index)=>({
 moveId:`m${index}`,turnIndex:0,turnMoveIndex:index,displayMoveNumber:17+index,actorSide:type==='retreat'?'P2':'P1',action:{type},
 selectionSnapshot:{pieces:[{id:'A',position:{row:1,col:index}}]},snapshot:{pieces:[{id:'A',position:{row:1,col:index+1}}]}}))});
test('captured push replay binds its exact acknowledged sequence and retires stale authority',()=>{
 const current=game(),owner={},scope='scope',descriptor=captureDisplayedReplay({source:'push-sequence',game:current,owner,scope,identityId:'human'});
 assert(descriptor);assert.equal(descriptor.source,'push-sequence');assert.deepEqual(descriptor.moveIds,['m0','m1','m2']);
 const context={owner,scope,gameId:'g',revision:4,lineageHead:'m2',visible:true};assert(displayedReplayIsCurrent(descriptor,{game:current,context}));
 assert(replayArchiveMatches(descriptor,current.moves));
 for(const change of [{owner:{}},{scope:'other'},{revision:5},{lineageHead:'other'},{visible:false}])assert.equal(displayedReplayIsCurrent(descriptor,{game:current,context:{...context,...change}}),false);
 assert.equal(displayedReplayIsCurrent(descriptor,{game:{...current,inHistoryMode:true},context}),false);
 assert.equal(replayArchiveMatches(descriptor,current.moves.filter(move=>move.moveId!=='m1')),false);
 current.moves[0].snapshot.pieces[0].position.col=99;assert.equal(descriptor.moves[0].snapshot.pieces[0].position.col,1);
});
test('push replay supplies context without replacing the finite primary prompt or opponent replay',()=>{
 const current=game(),prompt={text:'Babs is thinking'},message=withPushSequenceMessage(prompt,current,{},'human');
 assert.equal(message.text,prompt.text);assert.equal(message.context.action.id,'replay-push-sequence');assert.equal(message.rows,undefined);
 assert(isMappedBoardPromptHtml(renderBoardMessageHtml(message)));
 const opponent={text:'Select a piece or',actions:[{id:'pass',label:'Pass'}],context:{text:'Opponent moved',action:{id:'replay-computer',label:'Show me again'}}};
 assert.equal(withPushSequenceMessage(opponent,current,{},'human'),opponent);
 assert.equal(withPushSequenceMessage(prompt,current,{selectedPieceId:'A'},'human'),prompt);
});
test('push replay frames preserve recorded numbering and narration identity without inventing decisions',()=>{
 const current=game(),payload=buildPushSequenceReplay({moves:current.moves,startId:'m0',endId:'m2',gameId:'g',revision:4,lineageHead:'m2'});
 assert.deepEqual(payload.frames.map(frame=>frame.moveNumber),[17,18,19]);assert.deepEqual(payload.frames.map(frame=>frame.recordedMove.moveId),['m0','m1','m2']);
 assert.deepEqual(payload.frames.map(frame=>frame.decisionId),['m0','m1','m2']);
 current.moves[0].displayMoveNumber=99;assert.equal(payload.frames[0].recordedMove.displayMoveNumber,17);
});

test('every new playback primary prompt remains inside the finite sizing grammar',()=>{
 for(const text of ['Following the push','Babs needs help','Babs is making their move'])assert(isMappedBoardPromptHtml(renderBoardMessageHtml({text})),text);
 assert(isMappedBoardPromptHtml(renderBoardMessageHtml({text:'Babs needs help',actorName:'Babs',action:{id:'retry-confirmed-playback',label:'Retry'}})));
});

test('automatic confirmed frames use the exact visible record and fold adjacent closure without another step',async()=>{
 const {createConfirmedComputerPlayback}=await import('../shell/confirmed-computer-playback.js');
 const before={pieces:[],turnIndex:0,sideToMove:'P1'},after={pieces:[],turnIndex:0,sideToMove:'P1'},closed={pieces:[],turnIndex:1,sideToMove:'P2'};
 const step={moveId:'real',index:16,displayMoveNumber:17,turnIndex:0,turnMoveIndex:0,actorSide:'P1',computerProof:{profile:'babs'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:2}},selectionSnapshot:before,snapshot:after};
 const closure={moveId:'closure',index:17,turnIndex:0,turnMoveIndex:1,actorSide:'P1',computerProof:{profile:'babs'},action:{type:'end_turn'},selectionSnapshot:after,snapshot:closed,destroyedPieces:[{pieceId:'lost',ownerSeat:'P1',position:{row:3,col:4}}]};
 const baseline={id:'g',gameplayRevision:0,moves:[],board:{state:before}},accepted={...baseline,gameplayRevision:2,moves:[step,closure],board:{state:closed}};
 const frames=[],sounds=[],publications=[];let release;
 const queue=createConfirmedComputerPlayback({onChange:state=>publications.push(state),present:(frame,{onDisplayed})=>{frames.push(frame);assert.equal(publications.at(-1).current.frame?.recordedMove.moveId,'real','metadata publication must precede presentation');onDisplayed();onDisplayed();return new Promise(resolve=>{release=resolve;});},onMove:move=>sounds.push(move.moveId)});
 queue.observe(baseline,{scope:'owner'});queue.observe(accepted,{scope:'owner'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(frames.length,1);assert.equal(frames[0].decisionId,'real');assert.equal(frames[0].moveNumber,17);assert.equal(frames[0].recordedMove.moveId,'real');assert.deepEqual(frames[0].after,closed);assert.equal(frames[0].destroyedPieces.length,1);
 assert.equal(queue.snapshot().current.frame.recordedMove.moveId,'real');assert.deepEqual(sounds,['real']);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(frames.length,1);assert.equal(queue.snapshot().playing,false);queue.destroy();
});

test('a retained explicit closure preserves local push replay and its final recorded frame',()=>{
 const current=game(),last=current.moves.at(-1),closed={pieces:[],turnIndex:1,sideToMove:'P2'};
 current.moves.push({moveId:'closure',index:3,turnIndex:0,turnMoveIndex:3,actorSide:'P1',action:{type:'end_turn'},snapshot:closed,destroyedPieces:[{pieceId:'lost',ownerSeat:'P1',position:{row:3,col:4}}]});
 const message=withPushSequenceMessage({text:'Babs is thinking'},current,{},'human');assert.equal(message.context.action.id,'replay-push-sequence');
 const payload=buildPushSequenceReplay({moves:current.moves,startId:'m0',endId:last.moveId,gameId:'g',revision:4,lineageHead:'closure'});
 assert.equal(payload.frames.length,3);assert.deepEqual(payload.frames.at(-1).after,closed);assert.equal(payload.frames.at(-1).recordedMove.moveId,last.moveId);assert.equal(payload.frames.at(-1).destroyedPieces.length,1);
});

test('production automatic presentation publishes the recorded step and exact caption beside finite activity',async()=>{
 const {selectedHistoryPresentation}=await import('../shell/history-narration.js'),{recordedActorSide}=await import('../shell/recorded-narration.js'),{playerDisplayName}=await import('../shell/perspective-labels.js');
 const {COMPUTER_PROFILES}=await import('../generated/packages/shared-types/src/computer-play.js');
 const record={moveId:'real',index:16,displayMoveNumber:17,turnIndex:0,actorSide:'P1',computerProof:{profile:'babs'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:2}}};
 const game={id:'g',moves:[record],computer:{seats:{p1:'babs',p2:'tau'}},player1:{computerProfile:'tau'},player2:{computerProfile:'tau'},confirmedPlayback:{playing:true}},published=[];
 const context={game,selectedHistoryPresentation,recordedActorSide,playerDisplayName,COMPUTER_PROFILES,boardContextScope(){},activeDisplayedReplay:null,getBoardGame:value=>value,transport:{getGameViewModel:()=>game,getIdentityId:()=> 'human'},replayController:null,replayRequests:{snapshot:()=>null},computerSession:{snapshot:()=>({phase:'computing',profile:'tau'})},confirmedPlayback:{snapshot:()=>({current:{move:record,frame:{recordedMove:record,moveNumber:17}}})},forcedFollowWorking:()=>false,viewingScope:()=> 'scope',document:{getElementById:()=>({parentElement:{querySelector:()=>null}})},updateComputerBoardLoading(){},boardTurnCaption:()=>({text:'Live'}),acknowledgedBoardMessage:(_view,_status,options)=>published.push(options.presentationMove)};
 assert.deepEqual(playbackTurnIndicator(game,{},{step:context.confirmedPlayback.snapshot().current,identityId:'human'}),{text:'Move 17',side:'P1'});
 const message=confirmedPlaybackMessage(game,context.computerSession.snapshot(),{step:context.confirmedPlayback.snapshot().current,identityId:'human',onRecorded:context.acknowledgedBoardMessage});assert.equal(message.text,'Babs is making their move');assert.equal(published[0],record);assert(isMappedBoardPromptHtml(renderBoardMessageHtml(message)));
});


test('production Follow controls refresh stable context controls on start, finish and retirement',async()=>{
 const {createBoardContextStore,renderBoardContext}=await import('../shell/board-context.js');
 const store=createBoardContextStore(),context={key:'stable-ack',gameId:'g',message:{text:'Recorded push'},replay:{gameId:'g'}};
 assert(store.update('acknowledged',context));
 let working=true,queued=0,html='',blocked=false,refreshes=0;
 const scope={forcedFollowWorking:()=>working,forcedFollowSession:{snapshot:()=>({working})},confirmedPlayback:{snapshot:()=>({playing:false})},replayController:{snapshot:()=>({playing:false})},replayRequests:{snapshot:()=>null},canReplayDisplayed:()=>true,boardRuntime:{setInteractionBlocked:value=>{blocked=value;},refreshStatus:()=>{refreshes++;}},queueBoardContextRefresh:()=>{queued++;}};
 const enabled=descriptor=>contextReplayAvailable({descriptor,followWorking:working,playbackPlaying:false,replayPending:null,replayPlaying:false,canReplay:scope.canReplayDisplayed});
 const update=()=>refreshFollowControls({boardRuntime:scope.boardRuntime,followWorking:working,replayPlaying:false,playbackPlaying:false,refreshContext:scope.queueBoardContextRefresh});
 const render=()=>{html=renderBoardContext(store.channel('acknowledged'),{replayEnabled:enabled(context.replay)});};
 const flush=()=>{if(queued){queued=0;render();}};
 render();assert.match(html,/ disabled/);
 for(const next of [false,true,false]){
  working=next;assert.equal(store.update('acknowledged',context),false,'unchanged record does not request a render');
  update();flush();assert.equal(blocked,next);
  assert.equal(/ disabled/.test(html),next,'actual Follow callback must publish current replay availability');
  assert.match(html,/data-board-context-key="stable-ack"/);
 }
 assert.equal(refreshes,3);assert.equal(store.channel('acknowledged').key,'stable-ack');
 assert.equal(store.isDismissed('stable-ack'),false);
});
