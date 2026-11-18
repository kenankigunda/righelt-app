import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoomDO} from '../src/game-room-do.ts';
import {createInitialGame,applyRevertToMove,completedUndoTargetEligible} from '../src/shell-live-core.ts';
import {createFakeD1} from './support/fake-d1.mjs';
import {commander,makeState,unit} from '../../game-engine/test/helpers/state-builders.mjs';
import {resolveToStability} from '../../game-engine/src/resolve.ts';

const harness = async ({kind='playable',friend=false}={}) => {
  const DB=createFakeD1(),env={DB},state={id:{name:'completed-eligibility'}};
  let room=new GameRoomDO(state,env);
  const call=async(route,body={})=>{
    const response=await room.fetch(new Request(`https://test/${route}`,{method:'POST',headers:{'x-game-id':state.id.name},body:JSON.stringify({protocolVersion:2,identityId:'owner',...body})}));
    return {status:response.status,...await response.json()};
  };
  assert.equal((await call('create',{gameId:state.id.name,selfPlayMode:true})).ok,true);
  DB.overwriteGameState(state.id.name,game=>{
    const selected=structuredClone(game.board.state);
    if(kind==='terminal')selected.outcome={status:'p1_win',reason:'p2_commander_destroyed'};
    game.board.state.outcome={status:'p2_win',reason:'p1_commander_destroyed'};
    const move={moveId:'selected-target',index:0,displayMoveNumber:1,turnIndex:0,turnMoveIndex:0,actorSide:'P1',at:game.createdAt,notation:'Pass',action:{type:'pass'},selectionSnapshot:selected,snapshot:structuredClone(game.board.state),destroyedPieces:[]};
    if(kind==='missing')delete move.selectionSnapshot;
    if(kind==='malformed')move.selectionSnapshot={outcome:{status:'ongoing'}};
    if(kind==='imported')move.importedFrom={gameId:'source',decisionId:'original',gameplayRevision:1};
    if(kind==='undone')move.undone=true;
    game.moves=[move];game.turns[0].moveIndexes=[0];
    if(friend){game.selfPlayMode=false;game.player2={...structuredClone(game.player1),identityId:'friend'};}
    return game;
  });
  room=new GameRoomDO(state,env);
  return {DB,call,game:()=>DB.getGameState(state.id.name),restart:()=>{room=new GameRoomDO(state,env);}};
};

for(const kind of ['terminal','missing','malformed','imported','undone'])test(`completed direct Undo refuses ${kind} target without durable changes`,async()=>{
  const h=await harness({kind}),before=structuredClone(h.game());
  const response=await h.call('revert-request',{targetMoveId:'selected-target',requestId:'refusal'});
  assert.equal(response.ok,false,'Completed Undo must reject an unplayable or unverifiable target');
  assert.deepEqual(h.game(),before,'Refusal preserves all durable gameplay and evidence');
});

test('completed valid selected target reopens the same game and preserves historical decision',async()=>{
  const h=await harness(),before=structuredClone(h.game());
  const response=await h.call('revert-request',{targetMoveId:'selected-target',requestId:'valid'});
  assert.equal(response.ok,true);assert.equal(response.autoApproved,true);
  const after=h.game();assert.equal(after.id,before.id);assert.equal(after.board.state.outcome.status,'ongoing');
  assert.equal(after.gameplayRevision,before.gameplayRevision+1);assert.equal(after.moves[0].undone,true);
  assert.deepEqual(after.moves[0].selectionSnapshot,before.moves[0].selectionSnapshot);
  assert.deepEqual(after.moves[0].action,before.moves[0].action);
});

test('completed friend Undo refuses terminal target before creating a request',async()=>{
  const h=await harness({kind:'terminal',friend:true}),before=structuredClone(h.game());
  const response=await h.call('revert-request',{targetMoveId:'selected-target',requestId:'invalid-consent'});
  assert.equal(response.ok,false);assert.deepEqual(h.game(),before);
});

test('completed friend approval rechecks target evidence and preserves pending game on refusal',async()=>{
  const h=await harness({friend:true});
  const requested=await h.call('revert-request',{targetMoveId:'selected-target',requestId:'consent'});
  assert.equal(requested.pendingApproval,true);
  h.DB.overwriteGameState(h.game().id,g=>{g.moves[0].selectionSnapshot.outcome={status:'p1_win',reason:'p2_commander_destroyed'};return g;});h.restart();
  const before=structuredClone(h.game());
  const response=await h.call('revert-approve',{identityId:'friend',requestId:'consent'});
  assert.equal(response.ok,false);assert.deepEqual(h.game(),before);
});

for(const kind of ['playable','terminal'])test(`completed selected ${kind} offer proof is separate and revision-bound without persistence`,async()=>{
  const h=await harness({kind}),before=structuredClone(h.game());
  const response=await h.call('decision-snapshot',{decisionId:'selected-target',gameplayRevision:before.gameplayRevision});
  assert.equal(response.ok,true);assert.deepEqual(response.move,before.moves[0]);
  assert.deepEqual(response.undoEligibility,{gameId:before.id,decisionId:'selected-target',gameplayRevision:before.gameplayRevision,eligible:kind==='playable'});
  assert.deepEqual(h.game(),before);
  assert.equal((await h.call('decision-snapshot',{decisionId:'selected-target',gameplayRevision:before.gameplayRevision+1})).status,409);
});

test('completed Undo rejects an ongoing-labelled target that current rules immediately finish',async()=>{
  const h=await harness();
  const pieces=[];
  for(let row=0;row<10;row++)for(let col=0;col<10;col++){
    const side=col>=5?'P1':'P2';
    pieces.push(row===0&&col===9?commander('C1','P1',row,col):row===9&&col===0?commander('C2','P2',row,col):unit(`${side}-${row}-${col}`,side,row,col));
  }
  const selected=resolveToStability(makeState({sideToMove:'P2',turnIndex:4,pieces}));
  assert.equal(selected.outcome.status,'ongoing');
  h.DB.overwriteGameState(h.game().id,g=>{g.moves[0].selectionSnapshot=selected;return g;});h.restart();
  const before=structuredClone(h.game());
  const response=await h.call('revert-request',{targetMoveId:'selected-target',requestId:'current-rules'});
  assert.equal(response.ok,false,'An ongoing label does not establish playable restoration');
  assert.deepEqual(h.game(),before);
});

for(const kind of ['playable','terminal','malformed','missing'])test(`completed archived-only ${kind} target uses the same eligibility without altering source evidence`,()=>{
 const game=createInitialGame({gameId:'archived-completed',identityId:'owner',selfPlayMode:true});
 const selectionSnapshot=structuredClone(game.board.state);
 if(kind==='terminal')selectionSnapshot.outcome={status:'p1_win',reason:'p2_commander_destroyed'};
 const target={moveId:'archived-only',index:80,displayMoveNumber:81,turnIndex:4,turnMoveIndex:0,actorSide:'P1',at:game.createdAt,notation:'Pass',action:{type:'pass'},selectionSnapshot,snapshot:structuredClone(selectionSnapshot),destroyedPieces:[]};
 if(kind==='malformed')target.selectionSnapshot={outcome:{status:'ongoing'}};
 if(kind==='missing')delete target.selectionSnapshot;
 game.board.state.outcome={status:'p2_win',reason:'p1_commander_destroyed'};
 assert.equal(game.moves.length,0,'selected target exists only in the retained archive');
 const before=structuredClone(game),original=structuredClone(target);
 assert.equal(completedUndoTargetEligible(game,target.moveId,target),kind==='playable');
 assert.deepEqual(game,before,'offer probe preserves original game');assert.deepEqual(target,original);
 const restored=applyRevertToMove(game,target.moveId,'owner',target);
 assert.equal(restored.ok,kind==='playable');assert.deepEqual(target,original,'accepted or refused restoration cannot rewrite archive evidence');
 if(kind==='playable'){assert.equal(game.board.state.outcome.status,'ongoing');assert.equal(game.lastRestoration.decisionId,target.moveId);}
 else assert.deepEqual(game,before,'refusal preserves the original terminal game');
});
