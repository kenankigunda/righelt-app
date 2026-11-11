import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
import {createDestinationRouteOwner,destinationReadScope,terminalColdDestination} from '../shell/destination-route-owner.js';

const idle=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=(route='game')=>{
 let calls=0,release,now=0,id=0,current={generation:1,epoch:1,routeKey:route,inputs:'x',route:{name:route,gameId:'g'}};
 const timers=new Map(),context={cancelPendingBoardContextReplay(){},destinationLoadPresentation:null,homeSectionsHydrated:false,canHydrateRouteFromLocalState:()=>false,routeSyncRequestId:0,inviteLoadState:null,resolvedInvite:null,routeHydrated:false,window:{},issueDiagnostics:{resolve(){},capture(){}},syncLiveChannels(){},render(){context.syncDestinationNotice();},maybeRevealRouteTransition(){if(context.routeHydrated)context.revealed=true;},captureRouteRead:()=>current,routeReadIsCurrent:read=>read===current,destinationReadScope,invitationLoadFailureKind:()=> 'retry',syncRouteDataAndLiveChannels:async()=>{calls++;if(calls===1)throw Object.assign(Error('unavailable'),{status:503});await new Promise(resolve=>release=resolve);}};
 const recovery=createDestinationRecovery({clock:()=>now,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:key=>timers.delete(key),onRetry:()=>context.start()});
 Object.assign(context,{destinationRecovery:recovery,syncDestinationNotice:()=>context.destinationLoadPresentation=recovery.update({scope:context.destinationReadScope(current),visible:true})});
 const owner=createDestinationRouteOwner(()=>({...context,state:context}));context.start=owner.start;
 return {context,recovery,calls:()=>calls,release:()=>release(),change:()=>current={...current,epoch:2,routeKey:'other'},retry:()=>{const timer=[...timers.values()].find(timer=>timer.at===500);assert.ok(timer);now=500;timer.fn();}};
};
for(const route of ['game','home'])test(`a failed ${route} read keeps destination covered and automatically recovers without declaring readiness`,async()=>{
 const f=fixture(route);f.context.start({renderStart:false});await idle();assert.equal(f.calls(),1);assert.equal(f.context.routeHydrated,false);assert.equal(f.context.revealed,undefined);
 f.retry();await idle();assert.equal(f.calls(),2);assert.equal(f.context.routeHydrated,false);f.release();await idle();assert.equal(f.context.routeHydrated,true);assert.equal(f.context.revealed,true);assert.equal(f.recovery.currentScope(),undefined);
});
test('a superseded route response cannot reveal or settle the newer destination',async()=>{
 const f=fixture();f.context.start();await idle();f.retry();await idle();f.change();f.recovery.reset();f.release();await idle();assert.equal(f.context.routeHydrated,false);assert.equal(f.context.revealed,undefined);
});

for(const route of ['game','home'])test(`a failed warm ${route} refresh preserves a usable destination while retrying quietly`,async()=>{
 const f=fixture(route);f.context.canHydrateRouteFromLocalState=()=>true;f.context.homeSectionsHydrated=true;f.context.start();await idle();
 assert.equal(f.context.routeHydrated,true);assert.equal(f.context.revealed,true);
 const state=f.context.syncDestinationNotice();assert.equal(state.show,false);assert.equal(state.blocked,false);
 f.retry();await idle();assert.equal(f.calls(),2);f.release();await idle();assert.equal(f.context.routeHydrated,true);
});

test('confirmed cold terminal destinations retire live reads while transient and usable destinations retain them',()=>{
 const presentation={kind:'missing'},route={name:'game',gameId:'g'};
 assert.equal(terminalColdDestination({route,game:null,presentation}),true);
 assert.equal(terminalColdDestination({route,game:null,presentation:{kind:'retry'}}),false);
 assert.equal(terminalColdDestination({route,game:{id:'g'},presentation:{kind:'auth'}}),false);
});

test('responsive and page inputs retain destination recovery ownership within the same route authority',()=>{
 const context={scope:destinationReadScope};
 const read={generation:1,epoch:2,routeKey:'#/game/g',inputs:'mobile-page2'};
 assert.equal(context.scope(read),context.scope({...read,inputs:'desktop-page1'}));
 const home={...read,routeKey:'#/'};assert.equal(context.scope(home),context.scope({...home,inputs:'resized-home'}));
 for(const change of [{generation:2},{epoch:3},{routeKey:'#/game/other'}])assert.notEqual(context.scope(read),context.scope({...read,...change}));
});

test('actual destination scope retires old same-hash Home retry and foreground age only for a distinct visit',()=>{
 const context={scope:destinationReadScope};
 let now=0,id=0;const timers=new Map(),recovery=createDestinationRecovery({clock:()=>now,setTimer:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimer:key=>timers.delete(key)});
 const read={generation:1,epoch:2,routeKey:'#/',homeVisit:4,inputs:'columns1'};
 const scope=context.scope(read);recovery.begin(scope);recovery.update({scope,visible:true});now=15000;
 assert.equal(recovery.update({scope:context.scope({...read,inputs:'columns2-page1'}),visible:true}).actions,true);
 recovery.fail(scope,{status:503});assert.ok(timers.size>0);
 const next=context.scope({...read,homeVisit:5});
 assert.equal(recovery.update({scope:next,visible:true}),null);assert.equal(timers.size,0,'old retry and foreground timers are retired');
 recovery.begin(next);assert.equal(recovery.update({scope:next,visible:true}).elapsed,0);assert.equal(recovery.update({scope:next,visible:true}).show,false);recovery.reset();
});

test('an invitation read does not borrow game or Home readiness before its own response',async()=>{
 const f=fixture('invite');f.context.canHydrateRouteFromLocalState=()=>true;f.context.homeSectionsHydrated=true;
 f.context.start();assert.equal(f.context.routeHydrated,false);assert.equal(f.context.resolvedInvite,null);
 await idle();assert.equal(f.context.inviteLoadState.status,'error');assert.equal(f.context.routeHydrated,true);f.recovery.reset();
});
