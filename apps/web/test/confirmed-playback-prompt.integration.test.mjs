import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {playerDisplayName} from '../shell/perspective-labels.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('          if(view?.confirmedPlayback){'),end=source.indexOf('          if (replayFeedback?.gameId',start);
const prompt=(view,status)=>runInNewContext(`(()=>{${source.slice(start,end)}})()`,{view,status,playerDisplayName,COMPUTER_PROFILES,confirmedPlayback:{snapshot:()=>({current:{move:{actorSide:'P2'}}})}});
test('confirmed frame errors and runner intervention retain their own recovery owner',()=>{
 const game={computer:{seats:{p1:'tau',p2:'babs'}},player1:{computerProfile:'tau'},player2:{computerProfile:'babs'},confirmedPlayback:{playing:true}};
 assert.equal(prompt(game,{}).text,'Babs is making their move');
 const intervention=prompt(game,{profile:'tau',activity:{needsHelp:true}});assert.equal(intervention.text,'Tau needs help');assert.equal(intervention.action,undefined,'runner recovery must not dispatch an ineffective frame retry');
 const failed=prompt({...game,confirmedPlayback:{error:'invalid_frame'}},{profile:'tau',activity:{needsHelp:true}});assert.equal(failed.text,'Babs needs help');assert.equal(failed.action.id,'retry-confirmed-playback');
});

test('the actual board callback suppresses a future computer actor cue beside current confirmed movement',async()=>{
 const {updateComputerBoardLoading}=await import('../shell/board-message-layout.js');
 const attributes=new Map(),host={dataset:{loadingState:'processing'},hasAttribute:key=>attributes.has(key),removeAttribute:key=>attributes.delete(key)};
 const game={id:'g',computer:{seats:{p1:'tau',p2:'babs'},paused:false},computerTurn:'tau',pendingActorSide:'P1',player1:{computerProfile:'tau'},player2:{computerProfile:'babs'},confirmedPlayback:{playing:true}};
 const begin=source.indexOf('        getBoardMessage: selection => {'),finish=source.indexOf('        onBoardMessageAction:',begin),callback=source.slice(begin,finish).trim().replace(/^getBoardMessage:\s*/,'').replace(/,\s*$/,'');
 const context={game,getBoardGame:value=>value,transport:{getGameViewModel:()=>game},computerSession:{snapshot:()=>({phase:'computing',profile:'tau'})},replayRequests:{snapshot:()=>null},replayController:null,confirmedPlayback:{snapshot:()=>({current:{move:{actorSide:'P2'}}})},forcedFollowWorking:()=>false,viewingScope:()=> 'owner',document:{getElementById:()=>({parentElement:{querySelector:()=>host}})},updateComputerBoardLoading,playerDisplayName,COMPUTER_PROFILES};
 const getMessage=runInNewContext(`(${callback})`,context),message=getMessage({});assert.equal(message.text,'Babs is making their move');assert.equal(host.dataset.loadingState,'idle');
});
