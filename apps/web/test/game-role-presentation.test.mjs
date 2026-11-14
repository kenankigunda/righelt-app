import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderGameParticipantLabel,
  renderGameParticipantReferences,
  renderGameRoleLabel,
  renderGameRoleLine,
} from '../shell/game-role-presentation.js';

const person = (identityId, profile = undefined, extra = {}) => ({identityId, ...(profile ? {profile} : {}), ...extra});

test('summary role uses canonical account and anonymous participant identities without exposing seat labels', () => {
  const named = {player1:person('owner',{displayName:'PlayerName',username:'owner'}),player2:person('other',{displayName:'Opponent'})};
  assert.match(renderGameRoleLabel('Player 1',named), /<bdi dir="auto">PlayerName<\/bdi>/);
  assert.match(renderGameRoleLabel('Player 1',named), /class="player-tone-p1" aria-label="PlayerName, Red"/);
  assert.doesNotMatch(renderGameRoleLabel('Player 1',named), />Player 1</);
  assert.match(renderGameRoleLine({...named,myRole:'Player 1'}), /^Role: [\s\S]*>PlayerName<\/bdi>/);

  const oneGuest = {player1:person('guest'),player2:person('named',{displayName:'Maya'})};
  assert.match(renderGameRoleLabel('Player 1',oneGuest), />Guest<\/bdi>/);
  const twoGuests = {player1:person('guest-1'),player2:person('guest-2')};
  assert.match(renderGameRoleLabel('Player 1',twoGuests), />Guest 1<\/bdi>/);
  assert.match(renderGameRoleLabel('Player 2',twoGuests), />Guest 2<\/bdi>/);
});

test('computer, dual-seat, viewer and guest summaries retain their distinct semantics', () => {
  const humanComputer = {player1:person('owner',{displayName:'Owner'}),player2:person('owner',undefined,{computerProfile:'babs'}),computer:{seats:{p1:null,p2:'babs'}}};
  assert.match(renderGameRoleLabel('Player 1',humanComputer), /class="player-tone-p1"[^>]*><bdi dir="auto">Owner<\/bdi>/);
  assert.match(renderGameRoleLabel('Player 2',humanComputer), />Owner<\/bdi>/, 'shared computer authority still presents the human participant');
  const watched={player1:person('owner',undefined,{computerProfile:'tau'}),player2:person('owner',undefined,{computerProfile:'babs'}),computer:{seats:{p1:'tau',p2:'babs'}}};
  assert.match(renderGameRoleLabel('Player 1',watched), /watching computers/);
  assert.match(renderGameRoleLabel('Player 1',watched), /aria-label="watching computers, Red and Blue"/);
  const self={player1:person('owner'),player2:person('owner')};
  assert.match(renderGameRoleLabel('Player 1',self), /both players/);
  assert.match(renderGameRoleLabel('Both Players',self), /both players/);
  assert.equal(renderGameRoleLabel('Viewer',self),'<strong>Viewer</strong>');
  assert.equal(renderGameRoleLabel('Guest',self),'<strong>Guest</strong>');
});

test('summary identity escapes visible and accessible names without changing the game model', () => {
  const game={player1:person('owner',{displayName:'<You & Me>'}),player2:person('other',{displayName:'Other'})};
  const before=structuredClone(game),html=renderGameRoleLabel('Player 1',game);
  assert.match(html,/aria-label="&lt;You &amp; Me&gt;, Red"/);
  assert.match(html,/<bdi dir="auto">&lt;You &amp; Me&gt;<\/bdi>/);
  assert.deepEqual(game,before);
});

test('active-turn and latest summary text use canonical participant identities instead of seat labels', () => {
  const twoGuests={player1:person('guest-1'),player2:person('guest-2')};
  assert.match(renderGameParticipantLabel('Player 2',twoGuests), /class="player-tone-p2" aria-label="Guest 2, Blue"/);
  assert.match(renderGameParticipantLabel('Player 2',twoGuests), /<bdi dir="auto">Guest 2<\/bdi>/);
  assert.equal(
    renderGameParticipantReferences('Turn 1 ended. Player 2 to play',twoGuests),
    'Turn 1 ended. <strong class="player-tone-p2" aria-label="Guest 2, Blue"><bdi dir="auto">Guest 2</bdi></strong> to play',
  );
  assert.doesNotMatch(renderGameParticipantReferences('Player 1 passed. Player 2 to play',twoGuests), /Player [12]/);

  const named={player1:person('owner',{displayName:'<Owner>'}),player2:person('other',{username:'rival&friend'})};
  const html=renderGameParticipantReferences('Player 1 passed. Player 2 to play',named);
  assert.match(html, /&lt;Owner&gt;/);
  assert.match(html, /rival&amp;friend/);
  assert.match(html, /<bdi dir="auto">/);
  assert.doesNotMatch(html, /<Owner>|rival&friend/);
});

test('active-turn and latest summary text use the viewer-relative naming hierarchy', () => {
  const self={
    myRole:'Both Players',myRoles:['Both Players'],selfPlayMode:true,
    player1:person('owner'),player2:person('owner'),
  };
  for(const role of ['Player 1','Player 2']){
    const html=renderGameParticipantLabel(role,self,{identityId:'owner'});
    assert.match(html,/>You<\/bdi>/);
    assert.match(html,new RegExp(`aria-label="You, ${role==='Player 1'?'Red':'Blue'}"`));
    assert.doesNotMatch(html,/Guest [12]/);
  }
  assert.equal(
    renderGameParticipantReferences('Turn 8 ended. Player 1 to play',self,{identityId:'owner'}),
    'Turn 8 ended. <strong class="player-tone-p1" aria-label="You, Red"><bdi dir="auto">You</bdi></strong> to play',
  );

  const oneGuest={myRole:'Player 1',player1:person('viewer'),player2:person('other')};
  assert.match(renderGameParticipantLabel('Player 2',oneGuest,{identityId:'viewer'}),/>Guest<\/bdi>/);
  assert.doesNotMatch(renderGameParticipantLabel('Player 2',oneGuest,{identityId:'viewer'}),/>Guest 2<\/bdi>/);

  const spectator={player1:person('guest-1'),player2:person('guest-2')};
  assert.match(renderGameParticipantLabel('Player 1',spectator,{identityId:'watcher'}),/>Guest 1<\/bdi>/);
  assert.match(renderGameParticipantLabel('Player 2',spectator,{identityId:'watcher'}),/>Guest 2<\/bdi>/);

  const named={player1:person('viewer'),player2:person('named',{displayName:'\u202eRival'})};
  const namedHtml=renderGameParticipantLabel('Player 2',named,{identityId:'viewer'});
  assert.match(namedHtml,/<bdi dir="auto">\u202eRival<\/bdi>/);
  assert.doesNotMatch(namedHtml,/>Guest/);
});
