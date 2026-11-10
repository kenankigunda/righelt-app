import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {playerDisplayName} from '../shell/perspective-labels.js';
import {confirmedPlaybackMessage,presentPlaybackBoardMessage} from '../shell/playback-presentation.js';
const prompt=(view,status)=>confirmedPlaybackMessage(view,status,{step:{move:{actorSide:'P2'}}});
test('confirmed frame errors and runner intervention retain their own recovery owner',()=>{
 const game={computer:{seats:{p1:'tau',p2:'babs'}},player1:{computerProfile:'tau'},player2:{computerProfile:'babs'},confirmedPlayback:{playing:true}};
 assert.equal(prompt(game,{}).text,'Babs is making their move');
 const intervention=prompt(game,{profile:'tau',activity:{needsHelp:true}});assert.equal(intervention.text,'Tau needs help');assert.equal(intervention.action,undefined,'runner recovery must not dispatch an ineffective frame retry');
 const failed=prompt({...game,confirmedPlayback:{error:'invalid_frame'}},{profile:'tau',activity:{needsHelp:true}});assert.equal(failed.text,'Babs needs help');assert.equal(failed.action.id,'retry-confirmed-playback');
});

test('production playback presentation suppresses a future actor cue beside confirmed movement',async()=>{
 const attributes=new Map(),host={dataset:{loadingState:'processing'},hasAttribute:key=>attributes.has(key),removeAttribute:key=>attributes.delete(key)};
 const game={id:'g',computer:{seats:{p1:'tau',p2:'babs'},paused:false},computerTurn:'tau',pendingActorSide:'P1',player1:{computerProfile:'tau'},player2:{computerProfile:'babs'},confirmedPlayback:{playing:true}};
 const message=presentPlaybackBoardMessage(game,{phase:'computing',profile:'tau'},{activityHost:host,scope:'owner',step:{move:{actorSide:'P2'}}});assert.equal(message.text,'Babs is making their move');assert.equal(host.dataset.loadingState,'idle');
});
