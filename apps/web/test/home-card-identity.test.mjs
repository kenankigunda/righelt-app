import test from 'node:test';
import assert from 'node:assert/strict';
import { homeCardMatchup, renderHomeCardIdentity } from '../shell/home-card-identity.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { normalizeStaticGameCard, buildStaticGameCardFromGame } from '../shell/static-game-cards.js';
const person=(id,profile,connected=true)=>({identityId:id,profile,connected});
const game=(myRole='Player 1')=>({myRole,player1:person('me',{displayName:'Red player',username:'red'}),player2:person('other',{displayName:'Blue player',username:'blue'}),previewSnapshot:{sideToMove:'P2'}});

test('configured computer identity survives manual control and fresh list/full-game cards',()=>{
 for(const [profile,{name}] of Object.entries(COMPUTER_PROFILES))for(const side of ['p1','p2'])for(const manual of [false,true])for(const marker of [undefined,null,profile==='babs'?'horus':'babs']){
  const source={...game('Both Players'),selfPlayMode:true,player1:person('me',{displayName:'Owner'}),player2:person('me',{displayName:'Owner'}),computer:{manual,seats:{p1:null,p2:null,[side]:profile}}};
  source[side==='p1'?'player1':'player2'].computerProfile=marker;
  const before=structuredClone(source);
  for(const card of [source,normalizeStaticGameCard(source),buildStaticGameCardFromGame(source)]){
   const matchup=homeCardMatchup(card,{identityId:'me'});
   assert.equal(matchup.kind,'player');assert.equal(matchup.ownSide,side==='p1'?'p2':'p1');
   const html=renderHomeCardIdentity(card,{identityId:'me'});
   assert(html.includes(`<bdi>${name}</bdi>`));assert(html.includes('Computer player'));
   assert(!html.includes('You play both sides'));assert(!html.includes('is-disconnected'));
  }
  assert.deepEqual(source,before,'card identity cannot mutate control settings');
 }
});

test('You and the opponent use actual seat colors, independent of turn or list/full-game projections',()=>{
 for(const side of ['p1','p2']){
  const input=game(side==='p1'?'Player 1':'Player 2');const identityId=side==='p1'?'me':'other';
  for(const card of [input,normalizeStaticGameCard(input),buildStaticGameCardFromGame(input)]){
   const model=homeCardMatchup(card,{identityId});assert.equal(model.ownSide,side);assert.equal(model.kind,'player');
   const html=renderHomeCardIdentity(card,{identityId});assert.match(html,new RegExp(`player-tone-${side}"><bdi>You`));
   assert.match(html,/<span>vs\.<\/span>/);assert.equal((html.match(/connection-status-icon/g)||[]).length,1);
   assert.match(html,new RegExp(`player-tone-${side==='p1'?'p2':'p1'}"><bdi>${side==='p1'?'Blue':'Red'} player`));
  }
 }
});

test('computer profile overrides owner profile, owns its real color and is always connected',()=>{
 for(const [profile,{name}]of Object.entries(COMPUTER_PROFILES))for(const computerSide of ['player1','player2']){
  const input={...game(),player1:person('me',{displayName:'Owner'}),player2:person('me',{displayName:'Owner'})};
  input[computerSide]={...input[computerSide],computerProfile:profile,connected:false};
  const before=structuredClone(input),model=homeCardMatchup(input,{identityId:'me'});
  assert.equal(model.ownSide,computerSide==='player1'?'p2':'p1');
  const html=renderHomeCardIdentity(input,{identityId:'me'});assert.match(html,new RegExp(`<bdi>${name}<`));assert.match(html,/is-connected/);assert.doesNotMatch(html,/Owner|is-disconnected|both sides/);assert.deepEqual(input,before);
 }
 const watched={...game('Viewer'),player1:{computerProfile:'babs',identityId:'owner',connected:false},player2:{computerProfile:'horus',identityId:'owner',connected:false}};
 assert.equal(homeCardMatchup(watched,{identityId:'owner'}).kind,'viewer');const html=renderHomeCardIdentity(watched,{identityId:'owner'});assert.doesNotMatch(html,/>You</);assert.equal((html.match(/is-connected/g)||[]).length,2);assert.match(html,/Babs/);assert.match(html,/Horus/);
});

test('human name fallback, vacant seats and guest presence remain explicit and escaped',()=>{
 const input=game();input.player2=person('other',{username:'username'},false);assert.match(renderHomeCardIdentity(input),/<bdi>username<\/bdi>/);assert.match(renderHomeCardIdentity(input),/is-disconnected/);
 delete input.player2.profile;assert.match(renderHomeCardIdentity(input),/<bdi>Guest<\/bdi>/);assert.match(renderHomeCardIdentity(input),/Guest disconnected/);
 input.player2=null;assert.match(renderHomeCardIdentity(input),/Open seat open to join/);assert.match(renderHomeCardIdentity(input),/is-open/);
 input.player2=person('other',{displayName:'<img onerror="bad"> & \'quoted\'',username:'ignored'});
 const html=renderHomeCardIdentity(input);assert.doesNotMatch(html,/<img|onerror="bad"|ignored/);assert.match(html,/&lt;img onerror=&quot;bad&quot;&gt; &amp; &#39;quoted&#39;/);
 input.player2.computerProfile='invalid';assert.match(renderHomeCardIdentity(input),/&lt;img/);
});

test('viewers, guests, unknown roles and changed accounts never inherit a seat from a turn or identity alone',()=>{
 for(const role of ['Viewer','Guest','Unknown',undefined]){
  const input=game(role);input.myRole=role;
  const html=renderHomeCardIdentity(input,{identityId:'me'});assert.doesNotMatch(html,/>You</);assert.match(html,/Red player/);assert.match(html,/Blue player/);assert.equal((html.match(/connection-status-icon/g)||[]).length,2);
 }
 assert.equal(homeCardMatchup(game(),{identityId:'new-account'}).kind,'viewer');
 const empty=renderHomeCardIdentity({myRole:'Player 1',previewSnapshot:{sideToMove:'P1'}});assert.doesNotMatch(empty,/>You</);assert.equal((empty.match(/is-open/g)||[]).length,2);
});

test('genuine self-play is distinct from shared computer ownership and watched self-play',()=>{
 const input={...game(),player2:person('me',{displayName:'Red player'})};
 for(const role of ['Player 1','Player 2','Both Players'])assert.match(renderHomeCardIdentity({...input,myRole:role},{identityId:'me'}),/You play both sides/);
 const watched=renderHomeCardIdentity({...input,myRole:'Viewer'},{identityId:'watcher'});assert.match(watched,/Both sides/);assert.doesNotMatch(watched,/>vs\.</);assert.equal((watched.match(/connection-status-icon/g)||[]).length,2);assert.match(watched,/player-tone-p1/);assert.match(watched,/player-tone-p2/);
 assert.doesNotMatch(renderHomeCardIdentity(input,{identityId:'new-account'}),/You play/);
});


test('explicit Both Players ownership with one computer uses the human seat after real card normalization',()=>{
 for(const side of ['player1','player2']){
  const source={myRole:'Both Players',player1:person('me',{displayName:'Owner'}),player2:person('me',{displayName:'Owner'})};source[side].computerProfile='horus';
  for(const card of [source,normalizeStaticGameCard(source),buildStaticGameCardFromGame(source)]){
   const html=renderHomeCardIdentity(card,{identityId:'me'});assert.match(html,/You/);assert.match(html,/Horus/);assert.match(html,new RegExp(`player-tone-${side==='player1'?'p2':'p1'}"><bdi>You`));assert.match(html,/aria-label="Computer player"/);assert.doesNotMatch(html,/Horus connected|both sides/);
   for(const myRole of ['Viewer','Guest'])assert.doesNotMatch(renderHomeCardIdentity({...card,myRole},{identityId:'me'}),/>You</);
   assert.doesNotMatch(renderHomeCardIdentity(card,{identityId:'different'}),/>You</);assert.doesNotMatch(renderHomeCardIdentity(card),/>You</);
  }
 }
});
