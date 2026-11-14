import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGameSummaryPanel} from '../shell/game-summary-panel.js';

const render=(game,identityId='owner')=>renderGameSummaryPanel(game,{
  identityId,formatDateTime:()=> 'Oct 25, 2026, 4:17 AM',
});

test('Game summary renders saved participants and slots without exposing seat tokens',()=>{
  const summary=render({
    id:'known',createdAt:'date',myRole:'Viewer',notifications:['Turn 1 ended. Player 2 to play'],
    player1:{identityId:'guest-1'},player2:{identityId:'guest-2'},
    currentTurn:{index:0,playerSeat:'Player 1',moveIndexes:[]},
  });
  assert.match(summary,/game-identity-title/);
  assert.match(summary,/Guest 1[\s\S]*vs\.[\s\S]*Guest 2/);
  assert.doesNotMatch(summary,/>known</);
  assert.match(summary,/Started Oct 25/);
  assert.match(summary,/Active turn: 1 · [\s\S]*Guest 1/);
  assert.match(summary,/Latest: Turn 1 ended. [\s\S]*Guest 2[\s\S]* to play/);
  assert.doesNotMatch(summary,/Player [12]/);
  assert.equal((summary.match(/<p class="small"/g)||[]).length,4);
  assert.match(summary,/section-stack/);assert.match(summary,/section-followup/);
});

test('Game summary resolves both self-play seats to You from explicit viewer identity',()=>{
  const self=render({
    id:'self',createdAt:'date',myRole:'Both Players',myRoles:['Both Players'],selfPlayMode:true,
    notifications:['Turn 8 ended. Player 1 to play'],player1:{identityId:'owner'},player2:{identityId:'owner'},
    currentTurn:{index:8,playerSeat:'Player 2',moveIndexes:[]},
  });
  assert.match(self,/Active turn: 9 · [\s\S]*aria-label="You, Blue"[\s\S]*>You<\/bdi>/);
  assert.match(self,/Latest: Turn 8 ended. [\s\S]*aria-label="You, Red"[\s\S]*>You<\/bdi>[\s\S]* to play/);
  assert.doesNotMatch(self,/>Guest [12]<\/bdi>/);
});

test('Game summary renders its saved role through the participant contract',()=>{
  const summary=render({
    id:'role',createdAt:'date',myRole:'Player 1',notifications:[],
    player1:{identityId:'owner',profile:{displayName:'Kenan'}},
    player2:{identityId:'other',profile:{displayName:'Ada'}},
    currentTurn:null,
  });
  assert.match(summary,/Role: <strong class="player-tone-p1"[^>]*><bdi dir="auto">Kenan<\/bdi><\/strong>/);
  assert.doesNotMatch(summary,/Role:\s*Player 1/);
});

test('Game summary escapes dates and arbitrary notification text',()=>{
  const html=renderGameSummaryPanel({
    id:'unsafe',createdAt:'date',myRole:'Viewer',notifications:['<script>Ready</script>'],
    player1:{identityId:'one'},player2:{identityId:'two'},currentTurn:null,
  },{identityId:'viewer',formatDateTime:()=>'<unsafe>'});
  assert.match(html,/Started &lt;unsafe&gt;/);
  assert.match(html,/Latest: &lt;script&gt;Ready&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|<unsafe>/);
});
