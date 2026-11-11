import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteHydration} from '../shell/route-hydration.js';
import {createHomeSectionReads,createHomeSectionState,sameRouteRead,sameHomeReadScope,homeSectionShowsSkeleton,homeSectionIsEmpty} from '../shell/home-section-reads.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
const ids=Array.from({length:12},(_,i)=>`g${i}`);
const page=(section,revision=1,totalGames=3,number=0)=>({page:number,totalGames,totalPages:Math.ceil(totalGames/4),homeListRevision:revision,games:ids.slice(number*4,Math.min(totalGames,number*4+4)).map(id=>({id}))});
function fixture({states={},revision=0,readPage=async options=>page(options.section,1,3,options.page),visible=['my','completed','other'],render=()=>{},clock=callback=>{queueMicrotask(callback);return 1;}}={}) {
 const authority={generation:1,owner:null,visit:1},layout={size:3,columns:1};
 const state={homeSections:Object.fromEntries(['my','completed','other','smoke'].map(key=>[key,{...createHomeSectionState(key),...states[key]}])),homeReadJob:null,homeReadRecovery:null,accountContinuation:null,pendingResponsiveHomeRead:null,
 currentRoute:{name:'home'},homeReadVisit:1,pendingHomeRefresh:null,lastHomeBatchRevision:null,homeFocusToRestore:null,routeHydrated:false,homeSectionResizeFrame:0};
 const calls=[],pending=new Set(),restored=[],window={requestAnimationFrame:fn=>{window.frame=fn;return 1;},cancelAnimationFrame(){}};
 let responder=readPage,committedRevision=revision,serverRevision=revision;
 const owner={getHomeListRevision:()=>committedRevision,loadGamesPage:async options=>{calls.push(options);const response=await responder(options);serverRevision=response.homeListRevision??serverRevision;return response;},
 createHomeRead:({isCurrent,retainSectionFailure})=>{
  let retired=false,batchRevision=committedRevision;
  return {readPage:async options=>{if(retired||!isCurrent())throw Object.assign(Error('session_changed'),{code:'session_changed'});const response=await owner.loadGamesPage(options);if(retired||!isCurrent())throw Object.assign(Error('session_changed'),{code:'session_changed'});batchRevision=response.homeListRevision??batchRevision;return response;},
   getHomeListRevision:()=>batchRevision,commit(){assert(!retired&&isCurrent());committedRevision=batchRevision;},retire(){retired=true;},retainSectionFailure};
 }};
 authority.owner=owner;state.transport=owner;
 const hydrate=createRouteHydration();
 const getSection=key=>state.homeSections[key];
 const setSection=(key,value)=>{state.homeSections={...state.homeSections,[key]:value};};
 const capture=()=>{const read={generation:authority.generation,owner:authority.owner,homeVisit:authority.visit,route:state.currentRoute,routeKey:state.currentRoute.name,homeDebug:false,
  inputs:JSON.stringify([authority.visit,false,visible.map(key=>[key,getSection(key).page,layout.size,layout.columns])])};read.epoch=hydrate.observe(read);return read;};
 const current=read=>sameRouteRead(read,capture());
 const assertCurrent=(read,active=()=>true)=>{if(!current(read)||!active())throw Object.assign(Error('session_changed'),{code:'session_changed'});};
 const announcement={};
 const controller=createHomeSectionReads({state,getHomeSection:getSection,setHomeSection:setSection,getHomeSectionVisiblePageSize:()=>layout.size,getHomeSectionColumnCount:()=>layout.columns,getVisibleHomeSectionKeys:()=>visible,
 captureRouteRead:capture,assertCurrentRouteRead:assertCurrent,routeReadIsCurrent:current,pendingHomeSectionKeys:pending,isHomeSectionPending:key=>pending.has(key),
 captureHomeFocus:()=>({sectionKey:'completed'}),restoreHomeReadingPosition:()=>restored.push('anchor'),restoreHomeFocus:()=>{restored.push('focus');return true;},syncAnnouncement:announcement,
 appEl:{},document:{},window,gameSound:{play(){}},storyDialog:{refresh(){}},render:()=>render(h),syncLiveChannels(){},scrollHomeSectionToTop(){},startRouteSync(){},setTimeout:clock,clearTimeout(){}});
 const h={state,controller,authority,layout,owner,window,calls,pending,restored,announcement,getSection,setSection,capture,current,assertCurrent,
  respond:fn=>{responder=fn;},setRevision:value=>{committedRevision=value;serverRevision=value;},get revision(){return committedRevision;},get serverRevision(){return serverRevision;}};
 return h;
}

test('a concurrent accepted Undo refreshes server counts and clears stale section pages before publication',async()=>{
 let n=0;const h=fixture({states:{completed:{homeListRevision:1,totalGames:1,serverPageGameIdsByPage:{0:['stale'],1:['older']}}},readPage:async()=>++n===1?{homeListChanged:true}:page('completed',2,0)});
 await h.controller.loadServerPage('completed',0);const section=h.getSection('completed');
 assert.equal(h.calls.length,2);assert.equal(section.totalGames,0);assert.equal(section.loaded,true);assert.equal(section.error,null);assert.deepEqual(Object.keys(section.serverPageGameIdsByPage),['0']);assert.equal(section.serverPageGameIdsByPage[0].length,0);
});
test('continued concurrent changes fail without publishing a stale count or partial section',async()=>{
 const h=fixture({states:{completed:{homeListRevision:1,totalGames:1,serverPageGameIdsByPage:{0:['stale'],1:['older']}}},readPage:async()=>({homeListChanged:true})});
 await assert.rejects(h.controller.loadServerPage('completed',0),/game list changed/);assert.equal(h.calls.length,2);assert.equal(h.getSection('completed').totalGames,1);assert.deepEqual(h.getSection('completed').serverPageGameIdsByPage,{0:['stale'],1:['older']});
});
test('a newer completed response refreshes an already-finished my section before completing the Home batch',async()=>{
 let revision=0;const h=fixture({readPage:async({section,page:number})=>{if(section==='completed')revision=1;return page(section,revision,section==='my'&&revision===0?1:0,number);}});
 await h.controller.syncSections();assert.deepEqual(h.calls.map(x=>x.section),['my','completed','other','my']);assert.equal(h.getSection('my').totalGames,0);assert.equal(h.getSection('my').homeListRevision,1);assert.equal(h.state.lastHomeBatchRevision,1);
});
test('an update after the final Home revision is captured schedules one trailing successful batch',async()=>{
 let rendered=false;const h=fixture({revision:1,render:()=>{if(!rendered){rendered=true;h.setRevision(2);h.controller.scheduleRefresh();}}});
 h.respond(async options=>page(options.section,h.revision,3,options.page));h.controller.scheduleRefresh();await flush();await flush();
 assert.equal(h.calls.length,6);assert.equal(h.state.lastHomeBatchRevision,2);assert.equal(h.state.pendingHomeRefresh,null);
});
test('a failed Home batch does not turn its trailing edge into a tight automatic retry',async()=>{
 const h=fixture({revision:2,visible:['my'],readPage:async()=>{throw Error('offline');},render:()=>assert.equal(h.state.pendingHomeRefresh,null)});
 h.controller.scheduleRefresh();await flush();assert.equal(h.calls.length,1);assert.equal(h.state.pendingHomeRefresh,null);assert.equal(h.window.__righeltLastError,'offline');
});
test('a pending Home refresh retains existing cards and counts instead of replacing them with empty state',async()=>{
 const held=deferred(),h=fixture({states:{my:{loaded:true,totalGames:1,gameIds:['live']},completed:{loaded:true,totalGames:1,gameIds:['finished']}},readPage:async options=>{await held.promise;return page(options.section);}});
 const work=h.controller.syncSections();assert.deepEqual(h.getSection('my').gameIds,['live']);assert.equal(h.getSection('my').totalGames,1);assert.deepEqual(h.getSection('completed').gameIds,['finished']);assert.equal(h.getSection('completed').totalGames,1);held.resolve();await work;
});
test('a section with a confirmed zero count settles independently of another loading section',()=>{
 const section={loaded:true,gameIds:[],totalGames:0};assert.equal(homeSectionShowsSkeleton(section,false),false);assert.equal(homeSectionIsEmpty(section,[]),true);assert.equal(homeSectionShowsSkeleton({...section,loaded:false},false),true);
});
test('settled one-page Home restores reading intent even when final markup is unchanged',()=>{
 const h=fixture(),capture={sectionKey:'completed'};h.state.homeFocusToRestore=capture;h.state.routeHydrated=true;h.state.pendingHomeRefresh=Promise.resolve();
 h.controller.restoreReading({patched:true});assert.deepEqual(h.restored,['anchor']);assert.equal(h.state.homeFocusToRestore,capture);
 h.controller.restoreReading({patched:false});assert.deepEqual(h.restored,['anchor']);h.state.pendingHomeRefresh=null;h.controller.restoreReading({patched:false});assert.deepEqual(h.restored,['anchor','anchor','focus']);assert.equal(h.state.homeFocusToRestore,null);assert.equal(h.announcement.textContent,'Your game lists were updated.');
});
for(const continued of [false,true])test(`cold parallel membership churn gets one settled batch repair continued=${continued}`,async()=>{
 let revision=0;const counts={my:0,completed:0,other:0};const h=fixture({states:{my:{totalGames:7}},readPage:async({section,page:number})=>{
 counts[section]++;if(section==='my'&&(counts.my===1||continued))throw Object.assign(Error('Your game list changed. Try again.'),{code:'home_list_changed'});
 if(section==='completed'&&counts.completed===1)revision=5;if(section==='other'&&counts.other===1)revision=9;return page(section,revision,section==='my'?6:3,number);
 }});const before=structuredClone(h.state.homeSections),work=h.controller.syncSections();
 if(continued){await assert.rejects(work,{code:'home_list_changed'});assert.deepEqual(h.state.homeSections,before);assert.equal(h.state.homeReadRecovery.error.code,'home_list_changed');assert.equal(h.state.lastHomeBatchRevision,null);}
 else{await work;assert.equal(h.getSection('my').error,null);assert.equal(h.getSection('my').totalGames,6);assert.equal(h.state.lastHomeBatchRevision,9);}
 assert.deepEqual(counts,{my:2,completed:2,other:1});
});
for(const newerSize of [null,3,4])test(`an older Home background read preserves the latest completed page intent size=${newerSize}`,async()=>{
 const held=deferred();const h=fixture({revision:1,visible:['completed'],states:{completed:{loaded:true,totalGames:9,homeListRevision:1,gameIds:ids.slice(0,3)}},readPage:async options=>{if(h.calls.length===1)await held.promise;return page(options.section,1,9,options.page);}});
 const read=h.capture();const adapter={read,getSection:h.getSection,setSection:h.setSection,assertCurrent:()=>{assert(sameHomeReadScope(read,h.capture()));}};
 const work=h.controller.loadPage('completed',{page:newerSize?0:1,adapter});
 if(newerSize)h.setSection('completed',{...h.getSection('completed'),page:1,visiblePageSize:newerSize,visibleColumnCount:2,serverPageGameIdsByPage:{0:ids.slice(0,4),1:ids.slice(4,8),2:ids.slice(8,9)},gameIds:ids.slice(newerSize,newerSize*2)});
 held.resolve();await work;const section=h.getSection('completed');assert.equal(section.page,1);assert.equal(section.visiblePageSize,newerSize??3);assert.deepEqual(section.gameIds,ids.slice(newerSize??3,(newerSize??3)*2));if(newerSize)assert.deepEqual(section.serverPageGameIdsByPage[1],ids.slice(4,8));
});
test('a manual read repairs only stale healthy section counts and preserves pages/errors',async()=>{
 const h=fixture({revision:2,states:{my:{page:2,loaded:true,totalGames:10,homeListRevision:1},completed:{page:1,loaded:true,totalGames:1,homeListRevision:2},other:{page:3,loaded:true,totalGames:8,homeListRevision:1,error:true}},readPage:async options=>page(options.section,2,9,options.page)});
 const result=await h.controller.syncSections(undefined,undefined,{onlyStale:true});assert.equal(result.healthySettled,true);assert.deepEqual(h.calls.map(x=>x.section),['my','my']);assert.equal(h.getSection('my').totalGames,9);assert.equal(h.getSection('completed').page,1);assert.equal(h.getSection('other').error,true);assert.equal(h.getSection('other').totalGames,8);
});
test('manual Home reads wait for the existing refresh owner before a stale-only pass',async()=>{
 const existing=deferred(),h=fixture({revision:1,visible:['my']});h.state.pendingHomeRefresh=existing.promise;
 const work=h.controller.stabilize(h.capture());await Promise.resolve();assert.equal(h.calls.length,0);h.state.pendingHomeRefresh=null;existing.resolve();await work;assert.equal(h.calls.length,1);assert.equal(h.state.lastHomeBatchRevision,1);
});
test('leaving Home retires only its presentation read owner and pending section controls',()=>{
 const h=fixture();h.pending.add('completed');h.state.pendingHomeRefresh={};h.state.homeFocusToRestore={};h.controller.leaveHome({name:'home'},{name:'tutorial'});assert.equal(h.pending.size,0);assert.equal(h.state.pendingHomeRefresh,null);assert.equal(h.state.homeFocusToRestore,null);
 const owner={};h.state.pendingHomeRefresh=owner;h.pending.add('my');h.controller.leaveHome({name:'tutorial'},{name:'tutorial'});assert.equal(h.state.pendingHomeRefresh,owner);assert.equal(h.pending.has('my'),true);
});
test('responsive Home layout preserves a failed section without another network read',async()=>{
 const h=fixture({visible:['other'],states:{other:{error:true,page:1,visiblePageSize:4,visibleColumnCount:2,totalGames:8,gameIds:['kept']}},readPage:()=>assert.fail('failed section must remain manual')});
 assert.equal(await h.controller.syncResponsive(),true);assert.equal(h.calls.length,0);const section=h.getSection('other');assert.equal(section.error,true);assert.equal(section.visiblePageSize,3);assert.equal(section.visibleColumnCount,1);assert.deepEqual(section.gameIds,['kept']);
});
test('an authoritative background Home update stabilizes stale sections without resetting manual errors',async()=>{
 const h=fixture({revision:2,visible:['my','other'],states:{other:{error:true}}});await h.controller.scheduleRefresh();assert.deepEqual(h.calls.map(x=>x.section),['my']);assert.equal(h.getSection('other').error,true);
});
test('a preserved failed section does not swallow a newer healthy-list update at the trailing edge',async()=>{
 let changed=false;const h=fixture({revision:1,visible:['my','other'],states:{other:{error:true}},render:()=>{if(!changed){changed=true;h.setRevision(2);h.controller.scheduleRefresh();}}});h.respond(async options=>page(options.section,h.revision));h.controller.scheduleRefresh();await flush();await flush();assert.deepEqual(h.calls.map(x=>x.section),['my','my']);assert.equal(h.state.lastHomeBatchRevision,2);assert.equal(h.state.pendingHomeRefresh,null);assert.equal(h.getSection('other').error,true);
});
test('a Home batch retains a failed read identity without discarding healthy sections',async()=>{
 const original=Object.assign(Error('local_api_unavailable'),{code:'local_api_unavailable',status:503,diagnosticEvidence:{serverBuild:'continuation-test-build'}});const h=fixture({readPage:async options=>{if(options.section==='other')throw original;return page(options.section,1,4,options.page);}});
 const result=await h.controller.syncSections();assert.equal(result.error,original);assert.equal(result.healthySettled,false);assert.equal(h.getSection('my').totalGames,4);assert.equal(h.getSection('completed').totalGames,4);assert.equal(h.getSection('other').error,true);
});
for(const churn of [false,true])test(`a visible Home page retains every required server page across newly learned membership churn=${churn}`,async()=>{
 let revision=1,count=0;const h=fixture({revision:1,visible:['my'],states:{my:{loaded:true,totalGames:5,homeListRevision:1,visiblePageSize:3,visibleColumnCount:3,serverPageGameIdsByPage:{0:ids.slice(0,4)},gameIds:ids.slice(0,3)}},readPage:async options=>{if(churn||++count===1)revision++;return page(options.section,revision,5,options.page);}});h.layout.columns=3;
 if(churn){await assert.rejects(h.controller.loadPage('my',{page:1,direction:'next'}),/game list changed/);assert.ok(h.calls.length<=4,'membership churn must remain bounded');assert.deepEqual(h.getSection('my').gameIds,ids.slice(0,3));}
 else{await h.controller.loadPage('my',{page:1,direction:'next'});assert.deepEqual(h.getSection('my').gameIds,['g3','g4']);assert.equal(h.getSection('my').page,1);assert.equal(h.calls.length,2);}
});
