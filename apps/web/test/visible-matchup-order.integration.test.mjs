import test from 'node:test';
import assert from 'node:assert/strict';
import {gameTitleModel,renderGameTitle} from '../shell/game-title.js';
import {renderHomeCardIdentity} from '../shell/home-card-identity.js';
import {createHomeCardRendering} from '../shell/home-card-rendering.js';
import {renderGameSummaryPanel} from '../shell/game-summary-panel.js';
import {renderResultPanel} from '../shell/result-panel.js';
import {documentTitleForRoute} from '../shell/document-title.js';

const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true});
const fixture=()=>({id:'role-order',createdAt:'2026-11-17T20:15:00Z',myRole:'Player 2',myRoles:['Player 2'],player1:person('red','Maya'),player2:person('blue','Ada'),notifications:[],moves:[],turns:[],currentTurn:{index:0,playerSeat:'Player 1',moveIndexes:[]},previewSnapshot:{sideToMove:'P1',pieces:[],outcome:{status:'ongoing'}},confirmedOutcomeStatus:'ongoing',eventSeq:1,gameplayRevision:1,moveCount:0});
const titleSides=html=>[...html.matchAll(/class="game-title-player player-tone-(p[12])"/g)].map(match=>match[1]);
const transportFor=(game,identityId)=>({getIdentityId:()=>identityId,getAuthoritativeGame:()=>game});

test('visible matchup model preserves role order while You follows the saved Blue human seat',()=>{
 for(const computer of [false,true]){
  const game=fixture();
  if(computer){game.player1={...person('blue','Owner'),computerProfile:'babs'};game.computer={manual:true,seats:{p1:'babs',p2:null}};game.myRole='Both Players';game.myRoles=['Player 1','Player 2'];}
  const before=structuredClone(game),model=gameTitleModel(game,{identityId:'blue'});
  assert.deepEqual(model.seats.map(({side,label,owned})=>({side,label,owned})),[{side:'p1',label:computer?'Babs':'Maya',owned:false},{side:'p2',label:'You',owned:true}]);
  assert.equal(model.text,computer?'Babs vs. You':'Maya vs. You');
  assert.deepEqual(game,before);
 }
});

test('actual Home, Game summary and result renderers keep Red before Blue for the Blue owner',()=>{
 const game=fixture(),before=structuredClone(game),transport=transportFor(game,'blue');
 const home=createHomeCardRendering({getTransport:()=>transport,toStableKey:JSON.stringify,escapeHtml:String,renderMiniBoardPreviewRoot:()=>'<div></div>',buildGameHash:id=>`#/game/${id}`,getCurrentFlyoutState:()=>({}),formatClientDateTime:String});
 const completed={...game,board:{state:{outcome:{status:'p1_win',reason:'p2_commander_destroyed'}}}};
 const outputs=[renderGameTitle(game,{identityId:'blue'}),home.renderHomeGameCard(game),renderGameSummaryPanel(game,{identityId:'blue'}),renderResultPanel({id:game.id},{transport:transportFor(completed,'blue'),escapeHtml:String})];
 for(const html of outputs){
  assert.deepEqual(titleSides(html),['p1','p2']);
  assert.ok(html.indexOf('>Maya</bdi>')<html.indexOf('>You</bdi>'));
 }
 assert.deepEqual(game,before);
});

test('older Home identity renderer preserves role order, ownership labels and opponent presence',()=>{
 const game=fixture(),before=structuredClone(game),html=renderHomeCardIdentity(game,{identityId:'blue'});
 assert.deepEqual([...html.matchAll(/<strong class="player-tone-(p[12])"/g)].map(match=>match[1]),['p1','p2']);
 assert.match(html,/aria-label="Ada, you, Blue"/);
 assert.equal((html.match(/connection-status-icon/g)??[]).length,1);
 assert.ok(html.indexOf('>Maya</bdi>')<html.indexOf('>You</bdi>'));
 assert.deepEqual(game,before);
});

test('Blue-owner browser title retains the separate opponent-only contract',()=>{
 const game=fixture();
 assert.equal(documentTitleForRoute({routeName:'game',game,identityId:'blue',timeZone:'UTC'}),'vs. Maya | Nov 17 evening | Righelt');
 const before=structuredClone(game);
 assert.equal(documentTitleForRoute({routeName:'game',game:{...game,myRole:'Viewer',myRoles:['Viewer']},identityId:'spectator',timeZone:'UTC'}),'Maya vs. Ada | Nov 17 evening | Righelt');
 assert.deepEqual(game,before);
});
