import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDisplayedReplay,displayedReplayIsCurrent,displayedReplayMatchesPreviousTurnEpisode} from '../shell/displayed-replay.js';
import {buildTurnReplay} from '../shell/computer-replay.js';

const state=row=>({turnIndex:1,sideToMove:'P2',pieces:[{id:'piece',owner:'P2',kind:'unit',position:{row,col:3}}],outcome:{status:'ongoing'}});
function fixture(){
 const first={moveId:'imported-one',index:7,displayMoveNumber:8,turnIndex:1,turnMoveIndex:0,actorSide:'P2',action:{type:'move',from:{row:6,col:3},to:{row:5,col:3}},selectionSnapshot:state(6),snapshot:state(5),importedFrom:{gameId:'source',decisionId:'original-one'}};
 const second={moveId:'local-two',index:8,displayMoveNumber:9,turnIndex:1,turnMoveIndex:1,actorSide:'P2',action:{type:'move',from:{row:5,col:3},to:{row:4,col:3}},selectionSnapshot:state(5),snapshot:state(4)};
 const owner={},game={id:'destination',gameplayRevision:4,inHistoryMode:true,historyIndex:null,historyTurnIndex:1,historyTurnMoves:[first,second],moves:[first,second,{moveId:'live-head',turnIndex:3}],board:{state:{...state(2),turnIndex:4}}};
 const context={owner,scope:'account/visit',gameId:'destination',revision:4,lineageHead:'live-head',visible:true,viewGeneration:17};
 return {owner,game,context,capture:()=>captureDisplayedReplay({game,owner,scope:context.scope,source:'imported-turn',viewGeneration:context.viewGeneration})};
}

test('an imported turn captures the entire saved selected turn including its local continuation',()=>{
 const {game,capture}=fixture(),descriptor=capture();
 assert.ok(descriptor,'the approved selected imported turn must have a replay');
 assert.equal(descriptor.source,'imported-turn');assert.equal(descriptor.turnIndex,1);
 assert.deepEqual(descriptor.moveIds,['imported-one','local-two']);
 const payload=buildTurnReplay({moves:descriptor.moves,completedTurnIndex:descriptor.turnIndex,gameId:descriptor.gameId,revision:descriptor.revision,lineageHead:descriptor.lineageHead});
 assert.deepEqual(payload.frames.map(frame=>frame.decisionId),['imported-one','local-two']);
 assert.deepEqual(payload.frames[0].before,state(6));assert.deepEqual(payload.frames.at(-1).after,state(4));
 game.historyTurnMoves[0].snapshot.pieces[0].position.row=9;
 assert.equal(descriptor.moves[0].snapshot.pieces[0].position.row,5,'captured saved records cannot follow later view mutation');
});

test('only an explicit imported source may replay selected History, with current owner and intent',()=>{
 const {owner,game,context,capture}=fixture(),descriptor=capture();assert.ok(descriptor);
 assert.equal(captureDisplayedReplay({game,owner,scope:context.scope}),null,'live replay eligibility stays unchanged');
 assert.equal(displayedReplayIsCurrent(descriptor,{game,context}),true);
 for(const delta of [{owner:{}},{scope:'other-visit'},{revision:5},{lineageHead:'new-head'},{visible:false},{viewGeneration:18}]){
  assert.equal(displayedReplayIsCurrent(descriptor,{game,context:{...context,...delta}}),false,JSON.stringify(delta));
 }
 for(const delta of [{inHistoryMode:false},{historyTurnIndex:2},{historyIndex:7,historyTurnIndex:null},{gameplayRevision:5}]){
  assert.equal(displayedReplayIsCurrent(descriptor,{game:{...game,...delta},context}),false,JSON.stringify(delta));
 }
 const replacement=structuredClone(game);replacement.historyTurnMoves[1].moveId='replacement';
 assert.equal(displayedReplayIsCurrent(descriptor,{game:replacement,context}),false);
 assert.equal(displayedReplayIsCurrent(descriptor,{game,context:{...context,viewGeneration:19}}),false,'away and back to the same turn must not revive old intent');
 assert.equal(displayedReplayMatchesPreviousTurnEpisode(descriptor,'account:destination:1:local-two'),false,'selected History must not become the live Previous turn episode');
});

test('incomplete, undone or unrelated selected turn records cannot be substituted with live replay',()=>{
 for(const change of [g=>g.historyTurnMoves=[],g=>delete g.historyTurnMoves[0].selectionSnapshot,g=>delete g.historyTurnMoves[1].snapshot,g=>g.historyTurnMoves[1].turnMoveIndex=3,g=>g.historyTurnMoves[1].turnIndex=2,g=>g.historyTurnMoves[0].undone=true,g=>delete g.historyTurnMoves[0].importedFrom,g=>g.historyTurnMoves[0].importedFrom.decisionId='']){
  const {game,capture}=fixture();change(game);assert.equal(capture(),null);
 }
});
