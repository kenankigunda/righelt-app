import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gameInlayModel,renderGameInlay} from '../shell/game-inlay.js';
import {gameTitleModel,renderGameTitle} from '../shell/game-title.js';
import {createHomeCardRendering} from '../shell/home-card-rendering.js';
import {renderPlayerEmblem} from '../shell/player-emblem.js';

const person=(identityId,displayName,extra={})=>({identityId,profile:{displayName},connected:true,...extra});
const game=(overrides={})=>({id:'game-known',myRole:'Player 1',player1:person('red','Red name'),player2:person('blue','Blue name'),...overrides});

test('matchup identity follows the saved viewer perspective rather than turn or control',()=>{
 const red=gameTitleModel(game(),{identityId:'red'});
 assert.equal(red.text,'You vs. Blue name');
 assert.deepEqual(red.seats.map(seat=>[seat.side,seat.label,seat.owned]),[['p1','You',true],['p2','Blue name',false]]);
 const blue=gameTitleModel(game({myRole:'Player 2'}),{identityId:'blue'});
 assert.equal(blue.text,'You vs. Red name');
 assert.deepEqual(blue.seats.map(seat=>seat.side),['p2','p1']);
 const viewer=gameTitleModel(game({myRole:'Viewer'}),{identityId:'viewer'});
 assert.equal(viewer.text,'Red name vs. Blue name');
 assert.deepEqual(viewer.seats.map(seat=>seat.side),['p1','p2']);
 const manual=game({myRole:'Both Players',canControlComputer:true,computer:{manual:true,seats:{p1:null,p2:'horus'}},player2:{...person('red','Red name'),computerProfile:'horus'}});
 assert.equal(gameTitleModel(manual,{identityId:'red'}).text,'You vs. Horus');
});

test('self-play, watched self-play, anonymous seats and empty seats have explicit identity copy',()=>{
 const self=game({myRole:'Both Players',selfPlayMode:true,player2:person('red','Red name')});
 assert.equal(gameTitleModel(self,{identityId:'red'}).text,'You play both sides');
 assert.equal(gameTitleModel({...self,myRole:'Viewer'},{identityId:'watcher'}).text,'Red name plays both sides');
 const guests=game({player1:{identityId:'one',connected:true},player2:{identityId:'two',connected:true},myRole:'Viewer'});
 assert.equal(gameTitleModel(guests,{identityId:'watcher'}).text,'Guest 1 vs. Guest 2');
 const open=game({player2:null});
 assert.equal(gameTitleModel(open,{identityId:'red'}).text,'You vs. Open seat');
});

test('rendered identity escapes names, isolates direction, and limits presence to Home',()=>{
 const unsafe=game({createdAt:'2026-11-13T23:30:00Z',player2:person('blue','<img dir=rtl>')});
 const quiet=renderGameTitle(unsafe,{identityId:'red'});
 assert.match(quiet,/<bdi dir="auto">&lt;img dir=rtl&gt;<\/bdi>/);
 assert.doesNotMatch(quiet,/connection-status-icon/);
 assert.doesNotMatch(quiet,/game-known/);
 assert.match(quiet,/aria-hidden="true" focusable="false"/);
 assert.match(quiet,/class="game-date-inlay"/);
 assert.equal((quiet.match(/class="player-emblem"/g)||[]).length,2);
 const home=renderGameTitle(unsafe,{identityId:'red',presence:true});
 assert.equal((home.match(/connection-status-icon/g)||[]).length,1);
 const viewer=renderGameTitle({...unsafe,myRole:'Viewer'},{identityId:'viewer',presence:true});
 assert.equal((viewer.match(/connection-status-icon/g)||[]).length,2);
});

test('player marks follow stable identities rather than seat color or display name',()=>{
 const first=renderGameTitle(game({createdAt:'2026-11-13T23:30:00Z',player1:{...person('stable','First name'),profile:{username:'same-user',displayName:'First name'}}}),{identityId:'stable'});
 const changed=renderGameTitle(game({createdAt:'2026-11-13T23:30:00Z',myRole:'Player 2',player1:{...person('stable','Renamed'),profile:{username:'same-user',displayName:'Renamed'}}}),{identityId:'blue'});
 const stableMark=renderPlayerEmblem('account:same-user');
 assert.ok(first.includes(stableMark));
 assert.ok(changed.includes(stableMark));
 assert.doesNotMatch(stableMark,/player-p1|player-p2|currentColor/);
});

test('game identity remains anchored to immutable createdAt after later activity',()=>{
 const createdAt='2026-02-10T20:15:00.000Z',updatedAt='2027-09-21T04:45:00.000Z';
 const initial=renderGameTitle(game({createdAt,updatedAt,lastMoveAt:createdAt,moveCount:0}),{identityId:'red'});
 const later=renderGameTitle(game({createdAt,updatedAt,lastMoveAt:updatedAt,moveCount:19,gameplayRevision:12}),{identityId:'red'});
 const createdLabel=new Intl.DateTimeFormat(undefined,{dateStyle:'long',timeStyle:'short'}).format(new Date(createdAt));
 const updatedLabel=new Intl.DateTimeFormat(undefined,{dateStyle:'long',timeStyle:'short'}).format(new Date(updatedAt));
 assert.ok(initial.includes(`aria-label="Started ${createdLabel}, `));
 assert.ok(!initial.includes(updatedLabel));
 assert.equal(later,initial);
});

test('Tessera v1 has stable known answers and bounded independent SVG instances',()=>{
 const answers=new Map([
  ['game-000000000000000000000000000000000000','e979118e5856d538f641642a82e1bc01657a5a6d751c1489b5bcb726dbd8cf23'],
  ['game-7865daf77ce12f75f7baa3f542c589ddb9e9','99c0334b18a980a1418ab51b68756340d5027d0342c8654067b707ae67a52512'],
 ]);
 for(const [id,expected] of answers){
  const model=gameInlayModel(id);
  assert.equal(model.version,1);
  assert.equal(model.tiles.length,9);
  assert.equal(createHash('sha256').update(JSON.stringify(model)).digest('hex'),expected);
  for(const tile of model.tiles)for(const point of [...tile.points,...tile.grain])for(const coordinate of point)assert.ok(coordinate>=0&&coordinate<=36);
  const svg=renderGameInlay(id);
  assert.doesNotMatch(svg,/\bid=|clip-path|url\(/);
 }
 assert.notDeepEqual(gameInlayModel([...answers.keys()][0]),gameInlayModel([...answers.keys()][1]));
 assert.throws(()=>gameInlayModel(''),/stable game ID/);
});

test('actual Home card consumes one shared title and never exposes the raw game ID',()=>{
 const rendering=createHomeCardRendering({
  getTransport:()=>({getIdentityId:()=> 'red'}),toStableKey:JSON.stringify,escapeHtml:String,
  renderMiniBoardPreviewRoot:()=>'<div></div>',buildGameHash:id=>`#/game/${id}`,
  getCurrentFlyoutState:()=>({}),formatClientDateTime:String,
 });
 const html=rendering.renderHomeGameCard({...game(),previewSnapshot:{sideToMove:'P1',pieces:[],outcome:{status:'ongoing'}},confirmedOutcomeStatus:'ongoing',eventSeq:1,gameplayRevision:1,moveCount:0,createdAt:'now'});
 assert.equal((html.match(/game-identity-title/g)||[]).length,1);
 assert.match(html,/>You<\/bdi>[\s\S]*vs\.[\s\S]*>Blue name<\/bdi>/);
 assert.doesNotMatch(html,/>game-known</);
});
