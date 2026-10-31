import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPlayersPanel,renderViewersPanel} from '../shell/players-panel.js';
const game={id:'game',myRole:'Player 1',player1:{identityId:'me'},player2:{identityId:'other',profile:{displayName:'Ada',username:'ada'}},viewers:[]};
test('seat emblems replace numbered seat labels and identity remains a profile action',()=>{
 const html=renderPlayersPanel(game,{identityId:'me'});
 assert.match(html,/<bdi>You<\/bdi>/);assert.match(html,/<bdi>Ada<\/bdi>/);
 assert.match(html,/aria-label="You, Red, Disconnected"/);assert.match(html,/data-player-side="p2"/);
 assert.doesNotMatch(html,/Viewers|No viewers/);assert.doesNotMatch(html,/Player [12]|Guest player/);
 assert.match(html,/data-username="ada"/);
});
test('anonymous self play disambiguates both guests while computers retain their identity',()=>{
 const self={...game,selfPlayMode:true,myRole:'Both Players',player2:{identityId:'me'}};
 assert.match(renderPlayersPanel(self,{identityId:'me'}),/<bdi>Guest 1<\/bdi>/);
 assert.match(renderPlayersPanel(self,{identityId:'me'}),/<bdi>Guest 2<\/bdi>/);
 const html=renderPlayersPanel({...self,player2:{identityId:'me',computerProfile:'horus'}},{identityId:'me'});
 assert.match(html,/Horus/);assert.match(html,/aria-label="Horus, Blue, Needs attention"/);assert.match(html,/player-kind-icon" title="Computer"/);assert.match(html,/data-action="toggle-computer-card"/);
});
test('viewer section has static empty and singular identities, with native disclosure only for two or more',()=>{
 const empty=renderViewersPanel(game,{icon:kind=>`<svg data-icon="${kind}"></svg>`});
 assert.match(empty,/<h3 tabindex="-1">Viewers<\/h3>/);assert.match(empty,/>None<\/span>/);assert.match(empty,/data-icon="players"/);assert.doesNotMatch(empty,/<details|account-none/);
 const one=renderViewersPanel({...game,viewers:[game.player2]});assert.match(one,/data-testid="participant-viewer"/);assert.match(one,/>Ada<\/bdi>/);assert.doesNotMatch(one,/<details|<summary/);
 const view={...game,viewers:[{identityId:'b',profile:{username:'bo'}},{identityId:'me'},{identityId:'guest'}]};
 const collapsed=renderViewersPanel(view,{identityId:'me'});
 assert.match(collapsed,/<details[^>]+data-viewer-disclosure/);assert.match(collapsed,/<summary data-action="viewer-disclosure">/);assert.match(collapsed,/You, bo and 1 other/);assert.doesNotMatch(collapsed,/<details[^>]+ open/);
 const expanded=renderViewersPanel(view,{identityId:'me',expanded:true});
 assert.equal((expanded.match(/data-testid="participant-viewer"/g)||[]).length,3);
 assert.match(expanded,/data-profile-key="viewer:me"/);assert.match(expanded,/<details[^>]+ open/);assert.match(expanded,/>3 viewers<\/span>/);
});
test('vacant seats keep invitation status and malicious names cannot inject markup',()=>{
 const html=renderPlayersPanel({...game,player2:null,player1:{identityId:'other',profile:{displayName:'<script>',username:'a'}},viewers:[{profile:{displayName:'<img>',username:'b'}}]},{pendingSeat:'blue'});
 assert.match(html,/Awaiting player/);assert.match(html,/&lt;script&gt;/);assert.match(renderViewersPanel({...game,viewers:[{profile:{displayName:'<img>',username:'b'}}]}),/&lt;img&gt;/);assert.doesNotMatch(html,/<script>|<img>/);
});

test('computer rows expose local activity and an immediate deliberate recovery action',()=>{
 const computer={...game,player2:{computerProfile:'horus',identityId:'me'}};
 for(const label of ['Active in another tab','Resuming','Paused','Needs attention']){
  const html=renderPlayersPanel(computer,{identityId:'me',expandedComputers:new Set(['P2']),computerActivity:{state:'attention',label,showResume:true,disabledReason:label==='Resuming'?'Resuming computer play…':null}});
  assert.match(html,/data-action="toggle-computer-card"/);assert.match(html,/aria-expanded="true"/);
  assert.ok(html.includes(`Horus, Blue, ${label}`));assert.match(html,/>Resume here<\/button>/);
  if(label==='Resuming')assert.match(html,/disabled aria-describedby=/);
 }
 const active=renderPlayersPanel(computer,{identityId:'me',expandedComputers:new Set(['P2']),computerActivity:{state:'here',label:'Active here',activeHere:true,showResume:false}});
 assert.match(active,/Active here/);assert.doesNotMatch(active,/Resume here/);
});

test('both computer seats receive the same session status and independent accessible disclosures',()=>{
 const html=renderPlayersPanel({...game,player1:{computerProfile:'babs'},player2:{computerProfile:'horus'}},{expandedComputers:new Set(['P1','P2']),computerActivity:{state:'paused',label:'Paused',showResume:true,disabledReason:'Only the game owner can resume computer play.'}});
 assert.equal((html.match(/>Resume here<\/button>/g)||[]).length,2);
 assert.match(html,/Babs, Red, Paused/);assert.match(html,/Horus, Blue, Paused/);
 assert.match(html,/computer-details-game-P1/);assert.match(html,/computer-details-game-P2/);
 assert.equal((html.match(/disabled aria-describedby=/g)||[]).length,2);
});

test('configured computer seats remain recoverable when manual projections omit the computer marker',()=>{
 for(const marker of [undefined,null])for(const both of [false,true]){
  const html=renderPlayersPanel({...game,computer:{manual:true,paused:true,seats:{p1:both?'babs':null,p2:'horus'}},player1:{identityId:'me',computerProfile:marker},player2:{identityId:'me',computerProfile:marker}},{identityId:'me',expandedComputers:new Set(['P1','P2']),computerActivity:{state:'paused',label:'Paused',showResume:true,disabledReason:null}});
  assert.match(html,/Horus, Blue, Paused/);assert.equal((html.match(/>Resume here<\/button>/g)||[]).length,both?2:1);
  if(both)assert.match(html,/Babs, Red, Paused/);else assert.match(html,/<bdi>You<\/bdi>/);
 }
});

test('both guest names are visible to their owner and viewers without losing ownership labels',()=>{
 const guests={...game,player1:{identityId:'me',connected:true},player2:{identityId:'other',connected:true}};
 for(const identityId of ['me','viewer']){
  const html=renderPlayersPanel(guests,{identityId});
  assert.match(html,/<bdi>Guest 1<\/bdi>/);assert.match(html,/<bdi>Guest 2<\/bdi>/);assert.doesNotMatch(html,/<bdi>You<\/bdi>|<bdi>Guest<\/bdi>/);
  assert.match(html,new RegExp(`aria-label="Guest 1${identityId==='me'?', you':''}, Red, Connected"`));
 }
 const namedSelf={...game,selfPlayMode:true,myRole:'Both Players',player1:{identityId:'me',profile:{displayName:'Ada'}},player2:{identityId:'me',profile:{displayName:'Ada'}}};
 assert.equal((renderPlayersPanel(namedSelf,{identityId:'me'}).match(/<bdi>You<\/bdi>/g)||[]).length,2);
});
test('computer kind is a small native icon with accessible type and finished controls stay absent',()=>{
 const html=renderPlayersPanel({...game,player2:{identityId:'me',computerProfile:'horus'}},{identityId:'me',expandedComputers:new Set(['P2']),computerActivity:{state:'finished',label:'Game finished',showResume:false}});
 assert.match(html,/aria-description="Computer player"/);assert.match(html,/player-kind-icon/);assert.match(html,/<svg class="righelt-icon"/);assert.doesNotMatch(html,/>Computer<|Resume here/);assert.match(html,/Game finished/);
});
