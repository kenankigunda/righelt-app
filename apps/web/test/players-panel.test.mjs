import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPlayersPanel} from '../shell/players-panel.js';
const game={id:'game',myRole:'Player 1',player1:{identityId:'me'},player2:{identityId:'other',profile:{displayName:'Ada',username:'ada'}},viewers:[]};
test('seat emblems replace numbered seat labels and identity remains a profile action',()=>{
 const html=renderPlayersPanel(game,{identityId:'me'});
 assert.match(html,/<bdi>You<\/bdi>/);assert.match(html,/<bdi>Ada<\/bdi>/);
 assert.match(html,/aria-label="You, Red, Disconnected"/);assert.match(html,/data-player-side="p2"/);
 assert.match(html,/No viewers/);assert.doesNotMatch(html,/Player [12]|Guest player/);
 assert.match(html,/data-username="ada"/);
});
test('self play uses You for both human seats while computers retain their name and badge',()=>{
 const self={...game,selfPlayMode:true,myRole:'Both Players',player2:{identityId:'me'}};
 assert.equal((renderPlayersPanel(self,{identityId:'me'}).match(/<bdi>You<\/bdi>/g)||[]).length,2);
 const html=renderPlayersPanel({...self,player2:{identityId:'me',computerProfile:'horus'}},{identityId:'me'});
 assert.match(html,/Horus/);assert.match(html,/aria-label="Horus, Blue, Needs attention"/);assert.match(html,/player-kind-badge">Computer/);assert.match(html,/data-action="toggle-computer-card"/);
});
test('viewer summary expands the full ordered profile list with stable keys',()=>{
 const view={...game,viewers:[{identityId:'b',profile:{username:'bo'}},{identityId:'me'},{identityId:'guest'}]};
 const collapsed=renderPlayersPanel(view,{identityId:'me'});
 assert.match(collapsed,/aria-label="Viewers: You, bo, and 1 guest"/);assert.match(collapsed,/aria-expanded="false"/);assert.match(collapsed,/id="viewers-game" hidden/);
 assert.doesNotMatch(collapsed,/data-testid="participant-viewer"/);
 const expanded=renderPlayersPanel(view,{identityId:'me',expanded:true});
 assert.equal((expanded.match(/data-testid="participant-viewer"/g)||[]).length,3);
 assert.match(expanded,/data-profile-key="viewer:me"/);assert.match(expanded,/aria-expanded="true"/);
});
test('vacant seats keep invitation status and malicious names cannot inject markup',()=>{
 const html=renderPlayersPanel({...game,player2:null,player1:{identityId:'other',profile:{displayName:'<script>',username:'a'}},viewers:[{profile:{displayName:'<img>',username:'b'}}]},{pendingSeat:'blue'});
 assert.match(html,/Awaiting player/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<script>|<img>/);
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
