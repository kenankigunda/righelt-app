import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComputerPlayerCard} from '../shell/computer-player-card.js';
import {computerActivity} from '../shell/computer-activity.js';

const labels={here:'Active here',idle:'Waiting for a turn',paused:'Paused',elsewhere:'Active in another tab',resuming:'Resuming',attention:'Needs help',finished:'Game finished',moving:'Making their move'};
test('every approved state has one decorative combined icon and one complete row name',()=>{
 for(const [state,label] of Object.entries(labels))for(const side of ['P1','P2']){
  const html=renderComputerPlayerCard({computerProfile:'horus'},{gameId:'g',side,expanded:true,activity:{state,label,showResume:false}});
  const name=`Horus, ${side==='P1'?'Red':'Blue'}, Computer player, ${label}`;
  assert.ok(html.includes(`aria-label="${name}"`));assert.ok(html.includes(`data-tooltip="${name}"`));
  assert.match(html,new RegExp(`data-computer-activity="${state}" aria-hidden="true"`));
  assert.equal((html.match(/computer-status-badge/g)||[]).length,1);
  assert.doesNotMatch(html,/connection-status-icon|player-kind-icon|aria-description|role="img"/);
  assert.doesNotMatch(html,new RegExp(`>${label}<`));
  assert.equal((html.match(/<button /g)||[]).length,1);
 }
});
test('expansion retains recovery permissions without repeating ordinary status words',()=>{
 const html=renderComputerPlayerCard({computerProfile:'tau'},{gameId:'g',side:'P2',expanded:true,activity:{state:'resuming',label:'Resuming',showResume:true,disabledReason:'Resuming computer play…'}});
 assert.match(html,/aria-expanded="true"/);assert.match(html,/>Resume here<\/button>/);
 assert.match(html,/disabled aria-describedby="computer-details-g-P2-reason"/);
 assert.match(html,/<span class="sr-only" id="computer-details-g-P2-reason">Resuming computer play…<\/span>/);
 const permission=renderComputerPlayerCard({computerProfile:'tau'},{gameId:'g',side:'P2',expanded:true,activity:{state:'paused',label:'Paused',showResume:true,disabledReason:'Only the game owner can resume computer play.'}});
 assert.match(permission,/>Only the game owner can resume computer play\.<\/span>/);
});
test('actual activity outputs drive presentation without changing control or resume decisions',()=>{
 const game={canControlComputer:true,computer:{ownerId:'owner',seats:{p1:null,p2:'horus'},lease:{deviceId:'here',expiresAt:2000}},board:{state:{sideToMove:'P2',turnIndex:1,outcome:{status:'ongoing'}}}};
 for(const mutation of [{},{computer:{...game.computer,paused:true}},{computer:{...game.computer,lease:{deviceId:'elsewhere',expiresAt:2000}}},{board:{state:{...game.board.state,outcome:{status:'p1_win'}}}}]){
  const activity=computerActivity({game:{...game,...mutation},identityId:'owner',deviceId:'here',authenticated:true,visible:true,now:1000});
  const before=structuredClone(activity);
  const html=renderComputerPlayerCard({computerProfile:'horus'},{gameId:'g',side:'P2',expanded:true,activity});
  assert.ok(html.includes(`data-computer-activity="${activity.state}"`));
  assert.equal(html.includes('>Resume here</button>'),Boolean(activity.showResume));
  assert.deepEqual(activity,before);
 }
});
test('activity text and unrecognized presentation states cannot inject markup',()=>{
 const html=renderComputerPlayerCard({computerProfile:'horus'},{gameId:'g" onclick="bad',side:'P2',activity:{state:'"><script>bad</script>',label:'Needs <help> & "care"',showResume:false}});
 assert.match(html,/data-computer-activity="attention"/);assert.match(html,/Needs &lt;help&gt; &amp; &quot;care&quot;/);assert.doesNotMatch(html,/<script>| onclick="bad/);
});
