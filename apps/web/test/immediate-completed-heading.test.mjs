import test from 'node:test';
import assert from 'node:assert/strict';
import {boardTurnCaption,liveHistoryLabel} from '../shell/perspective-labels.js';
import {playbackTurnIndicator} from '../shell/playback-presentation.js';
import {completedTurnIndex} from '../shell/game-lifecycle.js';

const game=(status='p1_win')=>({id:'finished',player1:{identityId:'me',profile:{displayName:'Red name'}},player2:{identityId:'other',profile:{displayName:'Blue name'}},board:{state:{sideToMove:'P2',turnIndex:57,outcome:{status}}},moves:[],turns:[],terminalOutcome:{decisive:{turnIndex:56}}});
for(const [status,title,side] of [['p1_win','You won on Turn 57','P1'],['p2_win','Blue name won on Turn 57','P2'],['draw','Draw on Turn 57',null]])test(`${status} displays the final title before history or replay preparation`,()=>{
 const finished=game(status),caption=boardTurnCaption(finished,finished.board.state,{identityId:'me'});
 assert.equal(caption.text,title);assert.equal(caption.side,side);assert.equal(caption.neutralSuffix,true);
 assert.equal(liveHistoryLabel(finished,finished.board.state,{identityId:'me'}),title);
 assert.equal(playbackTurnIndicator({...finished,historyLoading:true,confirmedPlayback:{playing:true}},finished.board.state,{identityId:'me',step:{frame:{recordedMove:{action:{type:'rush'},actorSide:'P2'}}}}).text,title);
 assert.equal(completedTurnIndex(finished),56,'finish turn comes from the decisive command, not the newly opened turn');
});
test('retained completed boards use saved board turn without a generic completion heading',()=>{
 const finished=game();delete finished.terminalOutcome;
 assert.equal(boardTurnCaption(finished,finished.board.state,{identityId:'viewer'}).text,'Red name won on Turn 58');
});
test('computer result naming does not turn its owner into the winner label',()=>{
 const finished=game('p2_win');finished.computer={seats:{p1:null,p2:'horus'}};finished.player2.identityId='me';
 assert.equal(boardTurnCaption(finished,finished.board.state,{identityId:'me'}).text,'Horus won on Turn 57');
});

test('an incomplete legacy finished marker cannot manufacture a draw',()=>{
 assert.equal(boardTurnCaption({status:'finished'},null,{}).text,'Result unavailable');
});
