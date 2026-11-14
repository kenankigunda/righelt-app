import test from 'node:test';
import assert from 'node:assert/strict';
import {createHomeSectionReads,createHomeSectionState,sameRouteRead,homeVisitSectionShowsSkeleton} from '../shell/home-section-reads.js';
import {createNavigationHistory} from '../shell/navigation-history.js';
import {createNavigationVisitOwner} from '../shell/navigation-visit-owner.js';
import {createAccountContinuationOwner} from '../shell/account-continuation-owner.js';
import {createDestinationRouteOwner,destinationReadScope} from '../shell/destination-route-owner.js';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
import {createRouteHydration} from '../shell/route-hydration.js';

const idle=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const fixture=({renderPageSize=null}={})=>{
 let generation=1,hash='#/',id=0,total=8,visiblePageSize=3,response=async value=>value;
 const requests=[],commits=[],scrolls=[],focus=[],frames=[],timers=new Map(),pending=new Set();
 const state={currentRoute:{name:'home'},homeReadVisit:0,homeReadJob:null,pendingResponsiveHomeRead:null,homeReadRecovery:null,
  accountContinuation:null,homeReadChoice:null,routeSyncRequestId:0,inviteLoadState:null,resolvedInvite:null,routeHydrated:false,homeSectionsHydrated:false,pendingRoutePosition:null,
  homeSections:Object.fromEntries(['my','completed','other','smoke'].map(key=>[key,createHomeSectionState(key)]))};
 const readPage=async options=>{
  requests.push(options);const from=options.page*4;
  return response({page:options.page,totalGames:total,totalPages:Math.ceil(total/4),homeListRevision:1,
   games:Array.from({length:Math.max(0,Math.min(4,total-from))},(_,n)=>({id:`${options.section}-${from+n}`}))},options);
 };
 const transport={loadGamesPage:readPage,getHomeListRevision:()=>1,createHomeRead:({isCurrent})=>{
  let retired=false;
  return{readPage,getHomeListRevision:()=>1,commit(){assert.equal(retired,false);assert.equal(isCurrent(),true);commits.push(true);},retire(){retired=true;}};
 }};
 state.transport=transport;
 const hydrate=createRouteHydration(),account={snapshot:()=>({generation})};
 let controller,visitOwner,destinationOwner,continuationOwner;
 const capture=()=>{
  const read={generation,hash,routeKey:'#/',owner:transport,route:{name:'home'},homeDebug:false,homeVisit:state.homeReadVisit,
   inputs:JSON.stringify([state.homeReadVisit,false,['my','completed','other'].map(key=>[key,state.homeSections[key].page,visiblePageSize,1])])};
  read.epoch=hydrate.observe(read);continuationOwner.observeRead(read);return read;
 };
 const current=read=>sameRouteRead(read,capture());
 const assertCurrent=(read,active=()=>true)=>{if(!current(read)||!active())throw Object.assign(Error('session_changed'),{code:'session_changed'});};
 const browser={location:{get hash(){return hash;}},scrollY:240,scrollTo:value=>scrolls.push(value),
  requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},
  history:{state:null,replaceState(value,_title,next){this.state=structuredClone(value);if(next)hash=next;}}};
 const target={matches:()=>true,focus:value=>focus.push(value)};
 const appEl={querySelector:()=>target};
 const history=createNavigationHistory({history:browser.history,getHash:()=>hash,id:()=>`visit-${++id}`,
  capture:()=>({y:browser.scrollY,generation,pages:Object.fromEntries(Object.entries(state.homeSections).map(([key,value])=>[key,value.page])),focusGameId:'my-3'})});
 const render=()=>{if(renderPageSize!==null)visiblePageSize=renderPageSize;};
 const recovery=createDestinationRecovery({clock:()=>0,setTimer:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimer:key=>timers.delete(key)});
 const sync=read=>hydrate(read??capture(),active=>controller.syncSections(read??capture(),active));
 const destinationDeps={state,captureRouteRead:capture,routeReadIsCurrent:current,canHydrateRouteFromLocalState:()=>false,
  destinationRecovery:recovery,syncDestinationNotice:()=>{state.destinationLoadPresentation=recovery.update({scope:destinationReadScope(capture()),visible:true});},
  syncLiveChannels(){},render,syncRouteDataAndLiveChannels:sync,issueDiagnostics:{resolve(){},capture(){}},cancelPendingBoardContextReplay(){},
  window:browser,invitationLoadFailureKind:()=> 'retry',maybeRevealRouteTransition:()=>{if(state.routeHydrated)visitOwner.restore();}};
 destinationOwner=createDestinationRouteOwner(()=>destinationDeps);
 controller=createHomeSectionReads({state,getHomeSection:key=>state.homeSections[key],setHomeSection:(key,value)=>{state.homeSections={...state.homeSections,[key]:value};},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSectionVisiblePageSize:()=>visiblePageSize,getHomeSectionColumnCount:()=>1,
  captureRouteRead:capture,routeReadIsCurrent:current,assertCurrentRouteRead:assertCurrent,
  render,syncLiveChannels(){},startRouteSync:options=>destinationOwner.start(options),pendingHomeSectionKeys:pending,isHomeSectionPending:key=>pending.has(key),captureHomeFocus:()=>null,restoreHomeReadingPosition(){},restoreHomeFocus:()=>false,syncAnnouncement:{},
  window:browser,document:{},appEl,gameSound:{play(){}},storyDialog:{refresh(){}},
  setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),saveHomeVisit:()=>history.save()});
 continuationOwner=createAccountContinuationOwner(()=>({state,window:browser,queueResponsiveHomeSectionPageSizes:()=>controller.queueResponsive()}));
 visitOwner=createNavigationVisitOwner(()=>({state,navigationHistory:history,account,window:browser,appEl,CSS:{escape:value=>value},
  advanceHomeReadVisit:()=>controller.advanceVisit(),clearAccountContinuation:()=>{state.accountContinuation=null;state.homeReadChoice=null;},
  applyHomeVisitPages:pages=>controller.applyVisitPages(pages),startRouteSync:()=>destinationOwner.start(),render}));
 return{state,controller,history,visitOwner,destinationOwner,capture,sync,transport,requests,commits,scrolls,focus,browser,
  respond:fn=>{response=fn;},setTotal:n=>{total=n;},changeAccount:()=>{generation++;capture();},
  newVisit(){hash='#/?debug=1';history.arrive();history.replaceHash('#/');history.save();},
  pop:saved=>{browser.history.state=saved;visitOwner.pop({state:saved});},
  tickReadRetry(){const entry=[...timers.entries()].find(([,value])=>value.ms===500);assert.ok(entry,'actual Home retry must be pending');timers.delete(entry[0]);entry[1].fn();},retire(){state.homeReadJob?.retire();recovery.reset();}};
};

test('first Home render rebinds a layout-only read before ownership begins',async()=>{
 const f=fixture({renderPageSize:4});f.destinationOwner.start();await idle();await idle();
 assert.equal(f.state.routeHydrated,true);assert.equal(f.state.homeSectionsHydrated,true);
 assert.deepEqual(f.state.homeSections.my.gameIds,['my-0','my-1','my-2','my-3']);
 assert.ok(f.requests.length>0);assert.ok(f.requests.every(row=>row.pageSize===4));f.retire();
});

test('warm Home render rebinds and publishes the fresh measured window',async()=>{
 const f=fixture({renderPageSize:4});await f.sync();f.state.routeHydrated=true;
 assert.deepEqual(f.state.homeSections.my.gameIds,['my-0','my-1','my-2']);f.setTotal(9);
 f.destinationOwner.start();await idle();await idle();
 assert.equal(f.state.routeHydrated,true);assert.equal(f.state.homeSectionsHydrated,true);
 assert.equal(f.state.homeSections.my.totalGames,9);assert.deepEqual(f.state.homeSections.my.gameIds,['my-0','my-1','my-2','my-3']);f.retire();
});

for(const clamp of [false,true])test(`saved visit page identity stays covered until atomic publication clamp=${clamp}`,async()=>{
 const f=fixture();await f.sync();await f.controller.loadPage('my',{page:1});f.state.routeHydrated=true;f.history.save();
 const saved=structuredClone(f.browser.history.state);f.newVisit();await f.controller.loadPage('my',{page:0});
 const oldCards=[...f.state.homeSections.my.gameIds],gate=deferred();f.respond(async value=>{await gate.promise;return value;});
 if(clamp)f.setTotal(2);f.pop(saved);await idle();
 assert.equal(f.state.routeHydrated,false);assert.equal(f.state.homeSectionsHydrated,false);assert.equal(homeVisitSectionShowsSkeleton(f.state.homeSections.my,false,{homeReady:f.state.homeSectionsHydrated,routeReady:f.state.routeHydrated}),true);assert.deepEqual(f.state.homeSections.my.gameIds,oldCards);assert.deepEqual(f.scrolls,[]);
 const work=f.sync();gate.resolve();await work;await idle();
 assert.equal(f.state.routeHydrated,true);assert.equal(f.state.homeSectionsHydrated,true);assert.equal(homeVisitSectionShowsSkeleton(f.state.homeSections.my,false,{homeReady:f.state.homeSectionsHydrated,routeReady:f.state.routeHydrated}),false);
 assert.equal(f.state.homeSections.my.page,clamp?0:1);assert.deepEqual(f.state.homeSections.my.gameIds,clamp?['my-0','my-1']:['my-3','my-4','my-5']);
 assert.equal(f.scrolls.length,1);assert.equal(f.scrolls[0].top,240);assert.deepEqual(f.focus,[{preventScroll:true}]);
 assert.ok(f.requests.every(row=>row.pageSize===4),'the actual controller retains server pages of four');f.retire();
});

test('saved visit page restoration cannot reveal or publish after session retirement',async()=>{
 const f=fixture();await f.sync();await f.controller.loadPage('my',{page:1});f.state.routeHydrated=true;f.history.save();const saved=structuredClone(f.browser.history.state);
 f.newVisit();await f.controller.loadPage('my',{page:0});const before=structuredClone(f.state.homeSections),commits=f.commits.length,gate=deferred();f.respond(async row=>{await gate.promise;return row;});
 f.pop(saved);await idle();const work=f.sync();work.catch(()=>{});f.changeAccount();f.retire();gate.resolve();await assert.rejects(work,{code:'session_changed'});await idle();f.visitOwner.restore();
 assert.equal(f.state.routeHydrated,false);assert.deepEqual(f.state.homeSections.my.gameIds,before.my.gameIds);assert.equal(f.commits.length,commits);assert.deepEqual(f.scrolls,[]);assert.deepEqual(f.focus,[]);assert.equal(f.state.pendingRoutePosition,null);
});

test('changing an acknowledged Home page preserves its warm-view readiness',async()=>{
 const f=fixture();await f.sync();assert.equal(f.state.homeSectionsHydrated,true);await f.controller.loadPage('my',{page:1});
 assert.equal(f.state.homeSectionsHydrated,true);assert.equal(f.state.homeSections.my.page,1);f.retire();
});

test('saved visit same-page warm503 preserves readiness and acknowledged cards',async()=>{
 const f=fixture();await f.sync();f.state.routeHydrated=true;const before=structuredClone(f.state.homeSections),commits=f.commits.length;
 f.respond(async()=>{throw Object.assign(Error('temporary_unavailable'),{code:'temporary_unavailable',status:503});});f.destinationOwner.start();await idle();
 assert.equal(f.state.routeHydrated,true);assert.equal(f.state.homeSectionsHydrated,true);assert.equal(homeVisitSectionShowsSkeleton(f.state.homeSections.my,false,{homeReady:f.state.homeSectionsHydrated,routeReady:f.state.routeHydrated}),false);assert.deepEqual(f.state.homeSections,before);assert.equal(f.commits.length,commits);f.retire();
});

test('same-visit popstate and utility URL replacement retain the valid Home batch',async()=>{
 const f=fixture(),gate=deferred();f.respond(async row=>{await gate.promise;return row;});const work=f.sync();await idle();const job=f.state.homeReadJob,visit=f.state.homeReadVisit;const reading={gameId:'retained'};f.state.homeFocusToRestore=reading;
 f.pop(structuredClone(f.browser.history.state));f.history.replaceHash('#/?debug=1');f.history.replaceHash('#/');f.pop(structuredClone(f.browser.history.state));
 assert.equal(f.state.homeReadJob,job);assert.equal(f.state.homeReadVisit,visit);assert.equal(f.state.homeFocusToRestore,reading);gate.resolve();await work;assert.deepEqual(f.state.homeSections.my.gameIds,['my-0','my-1','my-2']);f.retire();
});

test('a distinct same-hash cold visit retires the old batch and choice before a fresh read',async()=>{
 const f=fixture();f.history.save();const first=structuredClone(f.browser.history.state);f.newVisit();const gate=deferred();f.respond(async row=>{await gate.promise;return row;});
 const old=f.sync();old.catch(()=>{});await idle();const job=f.state.homeReadJob;f.state.accountContinuation={...f.capture(),intent:{action:'create-self-play'},running:false};
 f.pop(structuredClone(f.browser.history.state));assert.notEqual(f.state.accountContinuation,null);assert.equal(f.state.homeReadJob,job);
 f.state.homeFocusToRestore={gameId:'obsolete'};f.pop(first);assert.equal(f.state.homeFocusToRestore,null);const fresh=f.sync();assert.equal(f.state.accountContinuation,null);assert.notEqual(f.state.homeReadJob,job);gate.resolve();await assert.rejects(old,{code:'session_changed'});await fresh;await idle();assert.equal(f.state.homeSectionsHydrated,true);assert.equal(f.commits.length,1);f.retire();
});

test('older-account same-hash visit cannot restore pages or retire the current Home batch',async()=>{
 const f=fixture();f.history.save();const first=structuredClone(f.browser.history.state);f.newVisit();f.changeAccount();const gate=deferred();f.respond(async row=>{await gate.promise;return row;});const work=f.sync();await idle();const job=f.state.homeReadJob,before=structuredClone(f.state.homeSections);
 f.pop(first);assert.equal(f.state.homeReadJob,job);assert.deepEqual(f.state.homeSections,before);gate.resolve();await work;assert.equal(f.commits.length,1);f.retire();
});

test('a failed requested saved page publishes its truthful error rather than healthy old-page cards',async()=>{
 const f=fixture();await f.sync();await f.controller.loadPage('my',{page:1});f.state.routeHydrated=true;f.history.save();const saved=structuredClone(f.browser.history.state);
 f.newVisit();await f.controller.loadPage('my',{page:0});const oldCards=[...f.state.homeSections.my.gameIds],oldCache=structuredClone(f.state.homeSections.my.serverPageGameIdsByPage);assert.deepEqual(oldCards,['my-0','my-1','my-2']);
 f.respond(async(value,options)=>{if(options.section==='my')throw Object.assign(Error('temporary_unavailable'),{code:'temporary_unavailable',status:503});return value;});
 f.pop(saved);const work=f.sync();await idle();assert.equal(f.state.routeHydrated,false);assert.equal(f.state.homeSectionsHydrated,false);f.tickReadRetry();const result=await work;await idle();
 assert.equal(result.healthySettled,false);assert.equal(f.state.homeSections.my.page,1);assert.equal(f.state.homeSections.my.error,true,'the app must take its unchanged truthful error surface, not render healthy cards');
 assert.deepEqual(f.state.homeSections.my.gameIds,[],'mismatched old-page display IDs are not the requested page');assert.deepEqual(f.state.homeSections.my.serverPageGameIdsByPage,oldCache,'acknowledged server cache remains intact');assert.equal(f.state.homeSections.other.error,null);assert.equal(f.state.homeSections.completed.error,null);
 assert.equal(f.commits.length,2,'one original full batch and one guarded partial publication');f.respond(async value=>value);await f.controller.retry('my');assert.equal(f.state.homeSections.my.error,null);assert.deepEqual(f.state.homeSections.my.gameIds,['my-3','my-4','my-5']);assert.equal(f.state.homeSections.my.pendingVisitPage,undefined,'successful Retry acknowledges the requested page');f.retire();
});
