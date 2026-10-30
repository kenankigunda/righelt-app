import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const startSource=source.slice(source.indexOf('const startRouteSync ='),source.indexOf('const syncRouteDataPassive ='));
const idle=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=(route='game')=>{
 let calls=0,release,now=0,id=0,current={generation:1,epoch:1,routeKey:route,inputs:'x',route:{name:route,gameId:'g'}};
 const timers=new Map(),context={destinationLoadPresentation:null,homeSectionsHydrated:false,canHydrateRouteFromLocalState:()=>false,routeSyncRequestId:0,inviteLoadState:null,resolvedInvite:null,routeHydrated:false,window:{},issueDiagnostics:{resolve(){}},syncLiveChannels(){},render(){context.syncDestinationNotice();},maybeRevealRouteTransition(){if(context.routeHydrated)context.revealed=true;},captureRouteRead:()=>current,routeReadIsCurrent:read=>read===current,destinationReadScope:read=>`${read.generation}:${read.epoch}:${read.routeKey}`,invitationLoadFailureKind:()=> 'retry',syncRouteDataAndLiveChannels:async()=>{calls++;if(calls===1)throw Object.assign(Error('unavailable'),{status:503});await new Promise(resolve=>release=resolve);}};
 const recovery=createDestinationRecovery({clock:()=>now,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:key=>timers.delete(key),onRetry:()=>context.start()});
 Object.assign(context,{destinationRecovery:recovery,syncDestinationNotice:()=>context.destinationLoadPresentation=recovery.update({scope:context.destinationReadScope(current),visible:true})});
 vm.runInNewContext(`${startSource};globalThis.start=startRouteSync;`,context);
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

test('changing an acknowledged Home page preserves its warm-view readiness',()=>{
 const setter=source.slice(source.indexOf('const setHomeSection ='),source.indexOf('const getHomeSectionVisibleTotalPages ='));
 const context={homeSectionsHydrated:true,homeSections:{my:{page:0,gameIds:['g']}}};
 vm.runInNewContext(`${setter};setHomeSection('my',{page:1,gameIds:['g2']});`,context);
 assert.equal(context.homeSectionsHydrated,true);assert.equal(context.homeSections.my.page,1);
});

test('confirmed cold terminal destinations retire live reads while transient and usable destinations retain them',()=>{
 const segment=source.slice(source.indexOf('const syncLiveChannels ='),source.indexOf('const navigateTo ='));
 const ids=[],context={currentRoute:{name:'game',gameId:'g'},transport:{getGameViewModel:()=>null},destinationLoadPresentation:{kind:'missing'},shouldLiveSyncRoute:()=>true,syncStore:{setActiveGameId:id=>ids.push(id)},resetRouteWsStatus(){}};
 vm.runInNewContext(`${segment};globalThis.sync=syncLiveChannels;`,context);context.sync();assert.equal(ids.at(-1),null);
 context.destinationLoadPresentation={kind:'retry'};context.sync();assert.equal(ids.at(-1),'g');
 context.destinationLoadPresentation={kind:'auth'};context.transport.getGameViewModel=()=>({id:'g'});context.sync();assert.equal(ids.at(-1),'g');
});
