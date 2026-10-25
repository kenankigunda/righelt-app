import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBoardView, createViewingIntent } from '../shell/viewing-state.js';

const snapshot = (side='P1',turnIndex=2) => ({sideToMove:side,turnIndex,pieces:[],continuation:null,outcome:{status:'ongoing'}});
test('narrow Board restores the live snapshot, controller and authority without mutating History', () => {
  const game={inHistoryMode:true,historyIndex:0,currentSnapshot:snapshot('P2',1),board:{state:snapshot()},liveCurrentSnapshot:snapshot(),turns:[{index:2,playerSeat:'Player 1',moveIndexes:[]}],player1:{identityId:'human'},player2:{identityId:'other'},legalActions:[{type:'pass'}],canRecordMove:false};
  const live=deriveBoardView(game,{narrow:true,identityId:'human'});
  assert.equal(live.currentSnapshot.turnIndex,2); assert.equal(live.inHistoryMode,false);
  assert.equal(live.controlSeat,'Player 1'); assert.equal(live.canRecordMove,true);
  assert.equal(game.currentSnapshot.turnIndex,1); assert.equal(game.inHistoryMode,true);
  assert.equal(deriveBoardView(game,{narrow:false}),game);
  game.sharedMutationsBlocked=true;
  assert.equal(deriveBoardView(game,{narrow:true,identityId:'human'}).canRecordMove,false);
});
test('undo returns only after authoritative acceptance and unchanged viewing intent', () => {
  for(const browse of [false,true]) {
    const intent=createViewingIntent(), token=intent.beginUndo('g',{targetMoveId:'m',revision:1,scope:'account'});
    const accepted={gameplayRevision:2,moves:[{moveId:'m',undone:true}]};
    assert.equal(intent.observeUndo('g',accepted,'account'),false);
    intent.commitUndo('g',token);
    if(browse){intent.navigate('g');intent.navigate('g');}
    assert.equal(intent.observeUndo('g',accepted,'account'),!browse);
    assert.equal(intent.observeUndo('g',accepted,'account'),false);
  }
});
test('undo scope, request replacement, pending approval and failure cannot trigger stale return', () => {
  const intent=createViewingIntent();
  const old=intent.beginUndo('g',{targetMoveId:'old',revision:1,scope:'a'});
  const current=intent.beginUndo('g',{targetMoveId:'new',revision:2,scope:'a'});
  intent.commitUndo('g',old);
  assert.equal(intent.observeUndo('g',{gameplayRevision:3,moves:[{moveId:'new',undone:true}]},'a'),false);
  intent.commitUndo('g',current);
  assert.equal(intent.observeUndo('g',{gameplayRevision:3,moves:[{moveId:'new',undone:true}],pendingRevertRequest:{}},'a'),false);
  assert.equal(intent.observeUndo('g',{gameplayRevision:3,moves:[{moveId:'new',undone:true}]},'b'),false);
});
test('scroll memory is isolated by game/panel and cleared on account change', () => {
  const intent=createViewingIntent();intent.saveScroll('g','history',200);intent.saveScroll('g','board',-5);
  assert.equal(intent.scrollTop('g','history'),200);assert.equal(intent.scrollTop('g','board'),0);assert.equal(intent.scrollTop('other','history'),0);
  intent.clear();assert.equal(intent.scrollTop('g','history'),0);
});
