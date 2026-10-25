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
 assert.match(html,/Horus/);assert.match(html,/role="group" aria-label="Horus, Blue, Computer player"/);assert.match(html,/player-kind-badge">Computer/);assert.match(html,/aria-label="Computer player"/);
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
