import test from 'node:test';
import assert from 'node:assert/strict';
import {homeCardResult} from '../shell/home-card-result.js';
const card = (status='p2_win') => ({eventSeq:8,gameplayRevision:3,confirmedOutcomeStatus:status,
  myRole:'Player 1',myRoles:['Player 1','Player 2'],player1:{identityId:'owner'},player2:{identityId:'owner',computerProfile:'tau'}});
test('completed card names the actual winning seat and personal outcome despite shared bot ownership',()=>{
  const loss=homeCardResult(card(),{identityId:'owner'});
  assert.equal(loss.label,'Tau won'); assert.equal(loss.detail,'You lost'); assert.equal(loss.winnerSide,'P2');
  const win=homeCardResult(card('p1_win'),{identityId:'owner'});
  assert.equal(win.label,'You won'); assert.equal(win.detail,null);
});
test('self-play uses side names without personal win or loss and viewers retain actual names',()=>{
  const self=card(); self.selfPlayMode=true; delete self.player2.computerProfile;
  assert.equal(homeCardResult(self,{identityId:'owner'}).label,'Blue won');
  assert.equal(homeCardResult(self,{identityId:'owner'}).detail,null);
  assert.equal(homeCardResult(card(),{identityId:'someone-else'}).label,'Tau won');
  assert.equal(homeCardResult(card(),{identityId:'someone-else'}).detail,null);
});
test('unconfirmed, unknown, draw and missing participants never invent a winner',()=>{
  assert.equal(homeCardResult({...card(),eventSeq:null}).kind,'unknown');
  assert.equal(homeCardResult({...card(),eventSeq:-1}).kind,'unknown');
  assert.equal(homeCardResult(card('future_status')).kind,'unknown');
  assert.equal(homeCardResult(card('draw')).label,'Draw');
  assert.equal(homeCardResult({...card(),player2:null}).label,'Blue won');
  assert.equal(homeCardResult(card('ongoing')).kind,'ongoing');
});
test('two anonymous players use the shared numbered names',()=>{
  const guests=card(); guests.player2={identityId:'other'}; guests.myRoles=['Player 1'];
  assert.equal(homeCardResult(guests,{identityId:'owner'}).label,'Guest 2 won');
});

test('pending terminal previews claim no winner and pending Undo preserves an acknowledged result',()=>{
  const predicted={...card('ongoing'),pendingPreviewSnapshot:{outcome:{status:'p1_win'}}};
  assert.deepEqual(homeCardResult(predicted,{identityId:'owner'}),{kind:'pending',label:'Confirming result…',action:'View game'});
  const reverting={...card('p2_win'),pendingPreviewSnapshot:{outcome:{status:'ongoing'}}};
  assert.equal(homeCardResult(reverting,{identityId:'owner'}).label,'Tau won');
  assert.equal(homeCardResult(reverting,{identityId:'owner'}).action,'Review game');
});
