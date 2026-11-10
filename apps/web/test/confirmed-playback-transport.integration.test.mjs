import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createInitialState,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
const fixture=()=>{const state=resolveToStability(createInitialState(),{artifactMode:'full'}),turn={index:0,playerSeat:'Player 1',status:'active',moveIndexes:[]};return {id:'g',createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',gameplayRevision:0,board:{state},turns:[turn],currentTurn:turn,moves:[],player1:{identityId:'owner'},player2:{identityId:'other'},myRole:'Player 1',legalActions:listLegalActions(state)};};
test('display ownership changes only the view and blocks human admission until cleared',async t=>{
 const storage=new Map([['righelt.identity.id.v1','owner']]),store=createLiveTransportStore({storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},fetcher:async()=>{throw Error('No request belongs to a blocked human action');}});t.after(()=>store.retire());
 const game=fixture();store.applyLiveGameUpdate({game,eventSeq:1});const prior=structuredClone(game);prior.board.state.turnIndex=-1;prior.moves=[{moveId:'displayed'}];
 store.setComputerDisplay('g',{pending:true,game:prior,error:null});const view=store.getGameViewModel('g');assert.equal(view.board.state.turnIndex,-1);assert.equal(view.canRecordMove,false);assert.equal(view.confirmedPlayback.playing,true);assert.deepEqual(store.getAuthoritativeGame('g').board.state,game.board.state);
 await assert.rejects(store.applyGameAction({gameId:'g',state:game.board.state,action:{type:'pass'}}),{code:'playback_in_progress'});
 store.setComputerDisplay('g',null);assert.equal(store.getGameViewModel('g').confirmedPlayback,undefined);assert.equal(store.getGameViewModel('g').board.state.turnIndex,0);
});
