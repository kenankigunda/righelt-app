import test from 'node:test';
import assert from 'node:assert/strict';
import {stampAcceptedRestoration, archiveStatements, readDecision} from '../src/decision-archive.ts';
import {createFakeD1} from './support/fake-d1.mjs';
import {createInitialGame, applyRevertToMove, applyScenarioToGame, exportScenarioFromGame} from '../src/shell-live-core.ts';
const clone = structuredClone;
function fixture() {
 const game = createInitialGame({gameId:'boundaries', identityId:'alice', selfPlayMode:true});
 game.moves = ['a','b','c'].map((id,index) => move(game,id,index));
 return game;
}
function move(game,id,index) { return {moveId:id,index,displayMoveNumber:index+1,turnIndex:Math.floor(index/2),turnMoveIndex:index%2,actorSide:'P1',at:'recorded',notation:'PASS',action:{type:'pass'},selectionSnapshot:clone(game.board.state),snapshot:clone(game.board.state),destroyedPieces:[]}; }
function fixedClock(fn) {
 const OriginalDate=globalThis.Date;
 globalThis.Date=class extends OriginalDate { constructor(...args){super(...(args.length?args:[1794000000000]));} static now(){return 1794000000000;} };
 try{return fn();}finally{globalThis.Date=OriginalDate;}
}
test('sequential Undo preserves every previously undone record under the same clock and a different requester',()=>fixedClock(()=>{
 const game=fixture(),before=clone(game);
 assert.equal(applyRevertToMove(game,'b','alice').ok,true);
 stampAcceptedRestoration(before,game,11,{targetDecisionId:'b',requesterIdentityId:'alice'});
 const previous=JSON.stringify(game.moves.slice(1));
 game.moves.push(move(game,'d',3),move(game,'e',4));const secondBefore=clone(game);
 assert.equal(applyRevertToMove(game,'a','bob').ok,true);
 assert.equal(JSON.stringify(game.moves.slice(1,3)),previous,'Earlier Undo provenance must not be replaced by the later requester');
 stampAcceptedRestoration(secondBefore,game,12,{targetDecisionId:'a',requesterIdentityId:'bob'});
 assert.equal(JSON.stringify(game.moves.slice(1,3)),previous);
 assert.deepEqual(game.moves.map(m=>m.undoEventSeq),[12,11,11,12,12]);
 assert.deepEqual(game.moves.map(m=>m.undoneByIdentityId),['bob','alice','alice','bob','bob']);
 assert.equal(game.moves[0].undoneAt,game.moves[1].undoneAt,'Different accepted groups must not depend on different times');
}));
test('legacy undone records keep missing and null provenance without renumbering repairs',()=>{
 const game=fixture();game.moves[1]={...game.moves[1],undone:true,undoneAt:null};delete game.moves[1].undoneByIdentityId;delete game.moves[1].index;delete game.moves[1].displayMoveNumber;
 const old=clone(game.moves[1]);applyRevertToMove(game,'a','bob');assert.deepEqual(game.moves[1],old);
});
test('accepted restoration persists a distinct zero-member event even when time and target are unchanged',async()=>{
 const env={DB:createFakeD1()},game=fixture();game.archiveStartRevision=0;game.moves=[];game.lastRestoration={decisionId:'archived',at:'same',undoEventSeq:20};const before=clone(game);
 stampAcceptedRestoration(before,game,21,{targetDecisionId:'archived',requesterIdentityId:'alice'});
 await env.DB.batch(archiveStatements(env,before,game,21,{targetDecisionId:'archived',requesterIdentityId:'alice'}));
 const restored=await readDecision(env,game.id,'restore-21');assert.equal(restored.eventSeq,21);assert.equal(restored.requesterIdentityId,'alice');assert.equal(restored.restorationVersion,1);assert.deepEqual(restored.restoredIds,[]);assert.equal(game.lastRestoration.undoEventSeq,21);
});
test('restoration stamping rejects malformed sequence or foreign target before assigning any group',()=>{
 for(const [seq,context]of [[0,{targetDecisionId:'a',requesterIdentityId:'alice'}],[1.5,{targetDecisionId:'a',requesterIdentityId:'alice'}],[1,{targetDecisionId:'foreign',requesterIdentityId:'alice'}],[1,{targetDecisionId:'a',requesterIdentityId:''}]]){
  const game=fixture();applyRevertToMove(game,'a','alice');const original=clone(game);
  assert.throws(()=>stampAcceptedRestoration(null,game,seq,context),/invalid_restoration_context/);assert.deepEqual(game,original);
 }
});
test('an archive cannot claim an accepted context without the exact committed sequence',()=>{
 const game=fixture();applyRevertToMove(game,'a','alice');assert.throws(()=>archiveStatements({DB:createFakeD1()},null,game,5,{targetDecisionId:'a',requesterIdentityId:'alice'}),/restoration_sequence_mismatch/);
});

test('untrusted scenario move and history claims cannot import accepted Undo provenance',()=>{
 const game=createInitialGame({gameId:'import',identityId:'alice',selfPlayMode:true});
 const scenario={formatVersion:2,id:'synthetic',title:'Imported pass',initialState:clone(game.board.state),moves:[{turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'PASS',action:{type:'pass'},undone:true,undoEventSeq:999,pendingUndoRequestId:'forged'}],savedSelection:null,lastRestoration:{decisionId:'forged',undoEventSeq:999}};
 applyScenarioToGame(game,scenario);assert.equal(game.moves.length,1);assert.equal(game.moves[0].undone,undefined);assert.equal(game.moves[0].undoEventSeq,undefined);assert.equal(game.moves[0].pendingUndoRequestId,undefined);assert.equal(game.lastRestoration,undefined);
 const exported=exportScenarioFromGame(game,{scenarioId:'again',title:'Again'});assert.equal(exported.moves[0].undoEventSeq,undefined);assert.equal(exported.moves[0].undone,undefined);
});
