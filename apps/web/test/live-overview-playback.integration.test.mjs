import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTurnOverview,liveTurnOverviewOverlay} from '../shell/live-turn-overview.js';
const state={turnIndex:1,sideToMove:'P2',pieces:[],outcome:{status:'ongoing'}};
const live=()=>({id:'g',gameplayRevision:2,myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},controlSeat:'Player 2',board:{state},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:3}},selectionSnapshot:{...state,turnIndex:0},snapshot:state}]});
for(const phase of ['confirmed-view','confirmed-frame','manual-replay','forced-follow'])test(`actual display callback keeps ${phase} above an eligible authoritative next-turn overview`,()=>{
 const game=live(),overview=createLiveTurnOverview({loadMoves:()=>{throw Error('cached');}});overview.sync(game,{identityId:'me',scope:'account'});
 let displaying=false;
 const read=selection=>liveTurnOverviewOverlay(selection,{game:displaying&&phase==='confirmed-view'?{...game,confirmedPlayback:{playing:true}}:game,overview,
  confirmedPlayback:{snapshot:()=>({playing:displaying&&phase==='confirmed-frame'})},replayController:{snapshot:()=>({playing:displaying&&phase==='manual-replay'})},forcedFollow:()=>displaying&&phase==='forced-follow'});
 assert.equal(read({}).mode,'recorded-turn');
 for(const inspection of [{kind:'command'},{kind:'supply'},{kind:'combined'}])assert.equal(read({inspection}),null);
 assert.equal(read({selectedPieceId:'opponent'}),null);assert.equal(read({}).mode,'recorded-turn');
 const before=structuredClone(game);displaying=true;assert.equal(read({}),null,'live aggregate must not replace a displayed recorded frame');
 displaying=false;assert.equal(read({}).mode,'recorded-turn','ordinary live overview returns when recorded presentation settles');assert.deepEqual(game,before);
});
