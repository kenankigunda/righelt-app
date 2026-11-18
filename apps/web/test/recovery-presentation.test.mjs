import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryPresentation} from '../shell/recovery-presentation.js';

const fixture = () => {
 let viewed = 'current', reads = 0;
 const states = [
  {phase:'saving', activity:{quietRenewal:true}},
  {phase:'idle', activity:{quietRenewal:false}},
 ];
 const computerSession = {snapshot: () => {const state=states[reads++];assert.ok(state,'unexpected extra snapshot');return state;}};
 const dependencies = {
  foregroundRecoveryWait:{update:()=>0}, viewingScope:()=> 'owner', currentRoute:{name:'game',gameId:'current'},
  document:{hidden:false},getCurrentViewedGameId:()=>viewed,computerSession,
  // The actual app's separate board helper reads the session independently.
  quietComputerRenewal:game=>Boolean(game?.id===viewed&&computerSession.snapshot().activity?.quietRenewal),
 };
 return {presentation:createRecoveryPresentation(()=>dependencies),reads:()=>reads,setViewed:id=>{viewed=id;},dependencies};
};

test('recovery flags describe one coherent session observation and refresh on the next call',()=>{
 const f=fixture(),game={id:'current'};
 const first=f.presentation.options(game);
 assert.equal(first.computerSaveActive,true);
 assert.equal(first.quietComputerRenewal,true,'both flags must describe the first session observation');
 const next=f.presentation.options(game);
 assert.equal(next.computerSaveActive,false);
 assert.equal(next.quietComputerRenewal,false,'later calls must observe changed session state');
 assert.equal(f.reads(),2);
});

test('another game does not read the current computer session',()=>{
 const f=fixture();
 const unrelated=f.presentation.options({id:'other'});
 assert.equal(unrelated.computerSaveActive,false);
 assert.equal(unrelated.quietComputerRenewal,false);
 assert.equal(f.reads(),0);
 const current=f.presentation.options({id:'current'});
 assert.equal(current.computerSaveActive,true);assert.equal(current.quietComputerRenewal,true);
});

test('an unavailable computer session has no saving or quiet-renewal display',()=>{
 const f=fixture();f.dependencies.computerSession=null;
 const result=f.presentation.options({id:'current'});
 assert.equal(result.computerSaveActive,false);assert.equal(result.quietComputerRenewal,false);
});
