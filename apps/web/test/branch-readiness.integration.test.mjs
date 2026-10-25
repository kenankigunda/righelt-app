import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const getBranchReadiness =');
const end=source.indexOf('const branchDialog =',start);
assert.ok(start>0&&end>start);
const script=new vm.Script(`${source.slice(start,end)};getBranchReadiness`);
const harness=()=>{
 const sourceGame={sharedMutationsBlocked:true};
 const preparation={state:'ready',message:''};
 const calls=[];
 const context=vm.createContext({pendingBranch:{sourceGameId:'source'},readinessForChoice:(owner,opponent)=>{calls.push([owner,opponent]);return preparation;},transport:{getGameViewModel:id=>{assert.equal(id,'source');return sourceGame;}}});
 return{context,sourceGame,preparation,calls,readiness:script.runInContext(context)};
};
test('branch chooser reads current local recovery readiness and retains preparation priority',()=>{
 const h=harness();
 assert.equal(h.readiness('self').state,'preparing');assert.equal(h.readiness('self').message,'Updating this game');
 h.preparation.state='error';h.preparation.message='Opponent could not prepare';
 assert.equal(h.readiness('babs'),h.preparation);
 h.preparation.state='preparing';h.preparation.message='Preparing Babs';
 assert.equal(h.readiness('babs'),h.preparation);
 h.sourceGame.sharedMutationsBlocked=false;h.preparation.state='ready';
 assert.equal(h.readiness('self'),h.preparation);
 // A later recovery is read immediately rather than relying on a cached ready
 // value or an independent server projection that cannot reflect this page.
 h.sourceGame.sharedMutationsBlocked=true;
 assert.equal(h.readiness('self').state,'preparing');
 assert.ok(h.calls.every(([owner])=>owner==='branch'));
});

const dialogEnd=source.indexOf('const opponentSession =',end);
const dialogScript=new vm.Script(`${source.slice(end,dialogEnd)};branchDialog`);
const startHarness=()=>{
 const h=harness(),opened=[],launched=[];
 Object.assign(h.context,{getBranchReadiness:h.readiness,createModal:()=>{},createRematchDialog:options=>options,prepareOpponent:()=>{},preparation:{cancel(){}},account:{canPlay:()=>true},COMPUTER_PROFILES:{babs:{}},buildGameHash:id=>`#/game/${id}`,window:{location:{pathname:'/',search:''},open:(...args)=>opened.push(args)}});
 h.context.transport.launchHistoryBranch=payload=>{launched.push(payload);return{result:{game:{id:'branch'}},committed:Promise.resolve()};};
 return{...h,opened,launched,dialog:dialogScript.runInContext(h.context)};
};
test('branch activation rechecks local recovery before any operation or popup',async()=>{
 const h=startHarness();
 await assert.rejects(h.dialog.onStart({opponent:'self',side:'p2'},{isCurrent:()=>true}),/Updating this game/);
 assert.equal(h.launched.length,0);assert.equal(h.opened.length,0);
 h.sourceGame.sharedMutationsBlocked=false;
 await h.dialog.onStart({opponent:'self',side:'p2'},{isCurrent:()=>true});
 assert.equal(h.launched.length,1);assert.equal(h.launched[0].sourceGameId,'source');assert.equal(h.launched[0].creatorSide,'p2');assert.equal(h.launched[0].selfPlayMode,true);
 assert.deepEqual(h.opened,[['/#/game/branch','_blank','noopener']]);
});
for(const cancelled of ['account','dialog'])test(`branch readiness cannot bypass ${cancelled} cancellation`,async()=>{
 const h=startHarness();h.sourceGame.sharedMutationsBlocked=false;
 if(cancelled==='account')h.context.account.canPlay=()=>false;
 await assert.rejects(h.dialog.onStart({opponent:'self',side:'p1'},{isCurrent:()=>cancelled!=='dialog'}),/Sign in/);
 assert.equal(h.launched.length,0);assert.equal(h.opened.length,0);
});
