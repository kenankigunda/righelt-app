import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const loadHomeSectionServerPage =');
const end=source.indexOf('const loadHomeSectionPage =',start);
const script=new vm.Script(`${source.slice(start,end)};loadHomeSectionServerPage`);
const harness=responses=>{
  let state={homeListRevision:1,totalGames:1,serverPageGameIdsByPage:{0:['stale'],1:['older']}};
  let calls=0;
  const owner={loadGamesPage:async()=>responses[calls++]};
  const context=vm.createContext({getHomeSection:()=>state,setHomeSection:(_,next)=>{state=next;},
    captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},currentRoute:{debug:false},
    HOME_SECTION_SERVER_PAGE_SIZE:6,getHomeSectionVisiblePageSize:()=>6,getHomeSectionColumnCount:()=>1});
  return {load:script.runInContext(context),state:()=>state,calls:()=>calls};
};
test('a concurrent accepted Undo refreshes server counts and clears stale section pages before publication',async()=>{
  const h=harness([{homeListChanged:true,homeListRevision:2,totalGames:1,games:[{id:'reopened'}]},
    {homeListChanged:false,homeListRevision:2,page:0,totalGames:0,totalPages:0,games:[]}]);
  await h.load('completed',0);
  assert.equal(h.calls(),2); assert.equal(h.state().totalGames,0);
  assert.equal(h.state().loaded,true); assert.equal(h.state().error,null);
  assert.deepEqual(Object.keys(h.state().serverPageGameIdsByPage),['0']);
  assert.equal(h.state().serverPageGameIdsByPage[0].length,0);
});
test('continued concurrent changes fail without publishing a stale count or partial section',async()=>{
  const h=harness([{homeListChanged:true},{homeListChanged:true}]);
  await assert.rejects(h.load('completed',0),/game list changed/);
  assert.equal(h.calls(),2); assert.equal(h.state().totalGames,1);
  assert.deepEqual(h.state().serverPageGameIdsByPage,{0:['stale'],1:['older']});
});


test('a newer completed response refreshes an already-finished my section before completing the Home batch',async()=>{
  const batchStart=source.indexOf('const syncHomeSections =');
  const batchEnd=source.indexOf('const scheduleHomeListRefresh =',batchStart);
  const batchScript=new vm.Script(`${source.slice(batchStart,batchEnd)};syncHomeSections`);
  let revision=0;
  const states={my:{page:0},completed:{page:0},other:{page:0}};
  const calls=[];
  const owner={getHomeListRevision:()=>revision};
  const context=vm.createContext({appEl:null,document:{},homeFocusToRestore:null,captureHomeFocus:()=>null,
    captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},getVisibleHomeSectionKeys:()=>['my','completed','other'],
    getHomeSection:key=>states[key],setHomeSection:(key,value)=>{states[key]=value;},
    getHomeSectionVisiblePageSize:()=>6,getHomeSectionColumnCount:()=>1,
    HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:6,lastHomeBatchRevision:null,
    loadHomeSectionPage:async key=>{calls.push(key);if(key==='completed')revision=1;
      states[key]={...states[key],homeListRevision:revision,error:null,totalGames:key==='my'&&revision===0?1:0};}});
  await batchScript.runInContext(context)();
  assert.deepEqual(calls,['my','completed','other','my']);
  assert.equal(states.my.totalGames,0);
  assert.equal(states.my.homeListRevision,1);
  assert.equal(context.lastHomeBatchRevision,1);
});

const schedulerStart=source.indexOf('const scheduleHomeListRefresh =');
const schedulerEnd=source.indexOf('const scheduleResponsiveHomeSectionPageSizes =',schedulerStart);
const schedulerScript=new vm.Script(`${source.slice(schedulerStart,schedulerEnd)};scheduleHomeListRefresh`);
test('an update after the final Home revision is captured schedules one trailing successful batch',async()=>{
  let revision=1,calls=0;
  const owner={getHomeListRevision:()=>revision};
  const context=vm.createContext({currentRoute:{name:'home'},pendingHomeRefresh:null,lastHomeBatchRevision:0,transport:owner,
    homeFocusToRestore:null,captureHomeFocus:()=>null,appEl:null,document:{},
    captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},routeReadIsCurrent:()=>true,
    getVisibleHomeSectionKeys:()=>['my'],getHomeSection:()=>({error:null}),window:{},
    syncHomeSections:async()=>{calls++;context.lastHomeBatchRevision=revision;},
    render:()=>{if(calls===1){revision=2;context.reentrant();}}});
  const schedule=schedulerScript.runInContext(context);context.reentrant=schedule;
  schedule();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);assert.equal(context.lastHomeBatchRevision,2);
  assert.equal(context.pendingHomeRefresh,null);
});
test('a failed Home batch does not turn its trailing edge into a tight automatic retry',async()=>{
  let calls=0;
  const owner={getHomeListRevision:()=>2};
  const context=vm.createContext({currentRoute:{name:'home'},pendingHomeRefresh:null,lastHomeBatchRevision:0,transport:owner,
    homeFocusToRestore:null,captureHomeFocus:()=>null,appEl:null,document:{},
    captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},routeReadIsCurrent:()=>true,window:{},
    render:()=>assert.equal(context.pendingHomeRefresh,null,'final presentation runs after batch ownership settles'),
    syncHomeSections:async()=>{calls++;throw Error('offline');}});
  schedulerScript.runInContext(context)();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.equal(context.pendingHomeRefresh,null);
  assert.equal(context.window.__righeltLastError,'offline');
});

test('a pending Home refresh retains existing cards and counts instead of replacing them with empty state',async()=>{
 let release;
 const held=new Promise(resolve=>release=resolve);
 const states={my:{page:0,loaded:true,totalGames:1,gameIds:['live']},completed:{page:0,loaded:true,totalGames:1,gameIds:['finished']},other:{page:0,loaded:true,totalGames:0,gameIds:[]}};
 const owner={getHomeListRevision:()=>1};
 const batchStart=source.indexOf('const syncHomeSections =');
 const batchEnd=source.indexOf('const scheduleHomeListRefresh =',batchStart);
 const context=vm.createContext({appEl:null,document:{},homeFocusToRestore:null,captureHomeFocus:()=>null,
  captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},getVisibleHomeSectionKeys:()=>['my','completed','other'],
  getHomeSection:key=>states[key],setHomeSection:(key,value)=>{states[key]=value;},
  getHomeSectionVisiblePageSize:()=>6,getHomeSectionColumnCount:()=>1,HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:6,lastHomeBatchRevision:null,
  loadHomeSectionPage:async key=>{await held;states[key]={...states[key],homeListRevision:1};}});
 const pending=new vm.Script(`${source.slice(batchStart,batchEnd)};syncHomeSections`).runInContext(context)();
 assert.deepEqual(states.my.gameIds,['live']);assert.equal(states.my.totalGames,1);
 assert.deepEqual(states.completed.gameIds,['finished']);assert.equal(states.completed.totalGames,1);
 release();await pending;
});

test('a section with a confirmed zero count settles independently of another loading section',()=>{
 const start=source.indexOf('const renderHomeGameSection =');
 const end=source.indexOf('const scrollHomeSectionToTop =',start);
 let section={title:'Your completed games',loaded:true,error:null,gameIds:[],totalGames:0};
 const context=vm.createContext({getHomeSection:()=>section,isHomeSectionPending:()=>false,routeHydrated:false,
  renderHomeSectionSkeleton:()=>'<loading>',transport:{getHomeGameCard:()=>null}});
 const render=new vm.Script(`${source.slice(start,end)};renderHomeGameSection`).runInContext(context);
 assert.equal(render('completed'),'');
 section={...section,loaded:false};assert.equal(render('completed'),'<loading>');
});

test('settled one-page Home restores reading intent even when final markup is unchanged',()=>{
 const start=source.indexOf('const restoreHomeReadingIntent =');
 const end=source.indexOf('const scheduleResponsiveHomeSectionPageSizes =',start);
 const calls=[];const capture={sectionKey:'completed'};
 const context=vm.createContext({currentRoute:{name:'home'},homeFocusToRestore:capture,routeHydrated:true,pendingHomeRefresh:Promise.resolve(),
  getVisibleHomeSectionKeys:()=>['my','completed'],isHomeSectionPending:()=>false,appEl:{},document:{},syncAnnouncement:{},
  restoreHomeReadingPosition:()=>calls.push('anchor'),restoreHomeFocus:()=>{calls.push('focus');return true;}});
 const restore=new vm.Script(`${source.slice(start,end)};restoreHomeReadingIntent`).runInContext(context);
 restore({patched:true});assert.deepEqual(calls,['anchor']);assert.equal(context.homeFocusToRestore,capture);
 restore({patched:false});assert.deepEqual(calls,['anchor']);
 context.pendingHomeRefresh=null;restore({patched:false});
 assert.deepEqual(calls,['anchor','anchor','focus']);assert.equal(context.homeFocusToRestore,null);
 assert.equal(context.syncAnnouncement.textContent,'Your game lists were updated.');
});

for(const continued of [false,true])test(`cold parallel membership churn gets one settled batch repair continued=${continued}`,async()=>{
 const batchStart=source.indexOf('const syncHomeSections ='),batchEnd=source.indexOf('const scheduleHomeListRefresh =',batchStart);
 const states={my:{page:0,totalGames:7},completed:{page:0},other:{page:0}},calls={my:0,completed:0,other:0};let revision=0;
 const owner={getHomeListRevision:()=>revision};
 const context=vm.createContext({appEl:null,document:{},homeFocusToRestore:null,captureHomeFocus:()=>null,captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSection:key=>states[key],setHomeSection:(key,value)=>states[key]=value,
  getHomeSectionVisiblePageSize:()=>3,getHomeSectionColumnCount:()=>1,HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:3,lastHomeBatchRevision:null,
  loadHomeSectionPage:async key=>{calls[key]++;if(key==='my'&&(calls.my===1||continued))throw Object.assign(Error('Your game list changed. Try again.'),{code:'home_list_changed'});
   if(key==='completed'&&calls.completed===1)revision=5;if(key==='other'&&calls.other===1)revision=9;
   states[key]={...states[key],loaded:true,error:null,refreshUnsettled:false,homeListRevision:revision,totalGames:key==='my'?6:3};}});
 await new vm.Script(`${source.slice(batchStart,batchEnd)};syncHomeSections`).runInContext(context)();
 assert.deepEqual(calls,{my:2,completed:2,other:1});assert.equal(states.my.error,continued?true:null);assert.equal(states.my.totalGames,continued?7:6);
 assert.equal(context.lastHomeBatchRevision,9);
});

for(const newerSize of [null,3,4])test(`an older Home background read preserves the latest completed page intent size=${newerSize}`,async()=>{
 const begin=source.indexOf('const loadHomeSectionServerPage ='),finish=source.indexOf('const syncResponsiveHomeSectionPageSizes =',begin);
 let state={page:0,loaded:true,totalGames:9,homeListRevision:1,visiblePageSize:3,visibleColumnCount:1,serverPageGameIdsByPage:{},gameIds:['g0','g1','g2'],animationToken:0};
 let release;const held=new Promise(resolve=>release=resolve),ids=Array.from({length:9},(_,i)=>`g${i}`);
 const owner={getHomeListRevision:()=>1,loadGamesPage:()=>held};
 const context=vm.createContext({currentRoute:{debug:false},captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},getHomeSection:()=>state,setHomeSection:(_,next)=>state=next,
  getHomeSectionVisiblePageSize:()=>3,getHomeSectionColumnCount:()=>1,HOME_SECTION_SERVER_PAGE_SIZE:6,
  getHomeSectionRequiredServerPages:({totalGames,visiblePageSize,page})=>totalGames?Array.from(new Set(Array.from({length:Math.min(visiblePageSize,totalGames-page*visiblePageSize)},(_,i)=>Math.floor((page*visiblePageSize+i)/6)))):[],
  hasHomeSectionServerPages:(section,pages)=>pages.every(page=>Object.hasOwn(section.serverPageGameIdsByPage,page)),
  getHomeSectionSafePage:(total,size,page)=>Math.max(0,Math.min(page,Math.ceil(total/size)-1)),getHomeSectionVisibleTotalPages:(total,size)=>Math.ceil(total/size),
  getHomeSectionVisibleGameIdsFromCache:(section,{page,visiblePageSize})=>Array.from({length:Math.min(visiblePageSize,section.totalGames-page*visiblePageSize)},(_,i)=>{const index=page*visiblePageSize+i;return section.serverPageGameIdsByPage[Math.floor(index/6)]?.[index%6];}),gameSound:{play(){}}});
 const load=new vm.Script(`${source.slice(begin,finish)};loadHomeSectionPage`).runInContext(context);
 const pending=load('completed',{page:newerSize?0:1,direction:'none'});
 if(newerSize)state={...state,page:1,visiblePageSize:newerSize,visibleColumnCount:2,serverPageGameIdsByPage:{0:ids.slice(0,6),1:ids.slice(6)},gameIds:ids.slice(newerSize,newerSize*2)};
 release({homeListRevision:1,homeListChanged:false,page:0,totalPages:2,totalGames:9,games:ids.slice(0,6).map(id=>({id}))});await pending;
 assert.equal(state.page,1);assert.equal(state.visiblePageSize,newerSize??3);
 assert.deepEqual(Array.from(state.gameIds),ids.slice(newerSize??3,(newerSize??3)*2));
 if(newerSize)assert.deepEqual(Array.from(state.serverPageGameIdsByPage[1]),ids.slice(6));
});

test('a manual read repairs only stale healthy section counts and preserves pages/errors',async()=>{
 const begin=source.indexOf('const syncHomeSections ='),end=source.indexOf('const scheduleHomeListRefresh =',begin);
 const states={my:{page:2,loaded:true,totalGames:10,homeListRevision:1},completed:{page:1,loaded:true,totalGames:1,homeListRevision:2},other:{page:3,loaded:true,totalGames:8,homeListRevision:1,error:true}};
 const calls=[];const owner={getHomeListRevision:()=>2};
 const context=vm.createContext({appEl:null,document:{},homeFocusToRestore:null,captureHomeFocus:()=>null,captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSection:key=>states[key],setHomeSection:(key,value)=>states[key]=value,lastHomeBatchRevision:1,
  HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:3,loadHomeSectionPage:async(key,{page})=>{calls.push([key,page]);states[key]={...states[key],homeListRevision:2,totalGames:9};}});
 const result=await new vm.Script(`${source.slice(begin,end)};syncHomeSections`).runInContext(context)({onlyStale:true});
 assert.equal(result.healthySettled,true);
 assert.deepEqual(calls,[['my',2]]);assert.equal(states.my.totalGames,9);assert.equal(states.completed.page,1);assert.equal(states.other.error,true);assert.equal(states.other.totalGames,8);
});

test('manual Home reads wait for the existing refresh owner before a stale-only pass',async()=>{
 const begin=source.indexOf('const stabilizeAfterHomeRead ='),end=source.indexOf('const restoreHomeReadingIntent =',begin);
 let release;const existing=new Promise(resolve=>release=resolve);const calls=[];
 const context=vm.createContext({pendingHomeRefresh:existing,assertCurrentRouteRead:read=>calls.push(read),scheduleHomeListRefresh:async options=>calls.push(options.onlyStale)});
 const run=new vm.Script(`${source.slice(begin,end)};stabilizeAfterHomeRead`).runInContext(context);
 const read={};const pending=run(read);await Promise.resolve();assert.equal(calls.length,1);
 release();await pending;assert.deepEqual(calls,[read,read,true,read]);
 for(const marker of ['home-section-retry','home-page-prev']){
  const block=source.slice(source.indexOf(`if (action === "${marker}"`),source.indexOf('\n  if (action ===',source.indexOf(`if (action === "${marker}"`)+1));
  assert.match(block,/stabilizeAfterHomeRead\(read\)/);
 }
 assert.match(source.slice(source.indexOf('const scheduleResponsiveHomeSectionPageSizes ='),source.indexOf('const renderGesture =')),/stabilizeAfterHomeRead\(read\)/);
});

test('leaving Home retires only its presentation read owner and pending section controls',()=>{
 const begin=source.indexOf('const preparePanelTransition ='),end=source.indexOf('const getCurrentFlyoutState =',begin);
 const keys=new Set(['completed']);const context=vm.createContext({pendingHomeSectionKeys:keys,pendingHomeRefresh:{},homeFocusToRestore:{},replayController:null});
 const prepare=new vm.Script(`${source.slice(begin,end)};preparePanelTransition`).runInContext(context);
 prepare({name:'home'},{name:'tutorial'});
 assert.equal(keys.size,0);assert.equal(context.pendingHomeRefresh,null);assert.equal(context.homeFocusToRestore,null);
 const nextOwner={};context.pendingHomeRefresh=nextOwner;keys.add('my');
 prepare({name:'tutorial'},{name:'tutorial'});
 assert.equal(context.pendingHomeRefresh,nextOwner);assert.equal(keys.has('my'),true);
});

test('responsive Home layout preserves a failed section without another network read',async()=>{
 const begin=source.indexOf('const syncResponsiveHomeSectionPageSizes ='),end=source.indexOf('const syncHomeSections =',begin);
 let state={error:true,page:1,visiblePageSize:4,visibleColumnCount:2,totalGames:8,gameIds:['kept']},loads=0;
 const context=vm.createContext({getVisibleHomeSectionKeys:()=>['other'],getHomeSection:()=>state,setHomeSection:(_,value)=>state=value,
  getHomeSectionColumnCount:()=>1,getHomeSectionVisiblePageSize:()=>3,loadHomeSectionPage:async()=>{loads++;throw Error('failed section must remain manual');},getHomeSectionCachedGameIndex:()=>4});
 const changed=await new vm.Script(`${source.slice(begin,end)};syncResponsiveHomeSectionPageSizes`).runInContext(context)();
 assert.equal(changed,true);assert.equal(loads,0);assert.equal(state.error,true);assert.equal(state.visiblePageSize,3);assert.equal(state.visibleColumnCount,1);
 assert.deepEqual(state.gameIds,['kept']);
});

test('an authoritative background Home update stabilizes stale sections without resetting manual errors',async()=>{
 let observed;
 const owner={getHomeListRevision:()=>2};
 const context=vm.createContext({currentRoute:{name:'home'},pendingHomeRefresh:null,lastHomeBatchRevision:1,transport:owner,
  homeFocusToRestore:null,captureHomeFocus:()=>null,appEl:null,document:{},captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},routeReadIsCurrent:()=>true,window:{},
  getVisibleHomeSectionKeys:()=>['my','other'],getHomeSection:key=>({error:key==='other'}),render:()=>{},syncHomeSections:async options=>{observed=options.onlyStale;context.lastHomeBatchRevision=2;}});
 const schedule=schedulerScript.runInContext(context);await schedule();
 assert.equal(observed,true);
});

test('a preserved failed section does not swallow a newer healthy-list update at the trailing edge',async()=>{
 let revision=1,calls=0;
 const owner={getHomeListRevision:()=>revision};
 const context=vm.createContext({currentRoute:{name:'home'},pendingHomeRefresh:null,lastHomeBatchRevision:0,transport:owner,
  homeFocusToRestore:null,captureHomeFocus:()=>null,appEl:null,document:{},captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},routeReadIsCurrent:()=>true,window:{},queueMicrotask,
  getVisibleHomeSectionKeys:()=>['my','other'],getHomeSection:key=>({error:key==='other'}),
  syncHomeSections:async()=>{calls++;context.lastHomeBatchRevision=revision;if(calls===1)queueMicrotask(()=>{revision=2;context.reentrant();});return{healthySettled:true};},
  render:()=>{}});
 const schedule=schedulerScript.runInContext(context);context.reentrant=schedule;schedule();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,2);assert.equal(context.lastHomeBatchRevision,2);assert.equal(context.pendingHomeRefresh,null);
});

test('a Home batch retains a failed read identity without discarding healthy sections',async()=>{
 const begin=source.indexOf('const syncHomeSections ='),end=source.indexOf('const scheduleHomeListRefresh =',begin);
 const original=Object.assign(Error('local_api_unavailable'),{code:'local_api_unavailable',status:503,diagnosticEvidence:{serverBuild:'continuation-test-build'}});
 const states={my:{page:0},completed:{page:0},other:{page:0}};
 const owner={getHomeListRevision:()=>1};
 const context=vm.createContext({appEl:null,document:{},homeFocusToRestore:null,captureHomeFocus:()=>null,captureRouteRead:()=>({owner}),assertCurrentRouteRead:()=>{},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSection:key=>states[key],setHomeSection:(key,value)=>states[key]=value,lastHomeBatchRevision:null,
  HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:3,getHomeSectionVisiblePageSize:()=>3,getHomeSectionColumnCount:()=>1,
  loadHomeSectionPage:async key=>{if(key==='other')throw original;states[key]={...states[key],homeListRevision:1,totalGames:4,loaded:true};}});
 const result=await new vm.Script(`${source.slice(begin,end)};syncHomeSections`).runInContext(context)();
 assert.equal(result.error,original);assert.equal(result.healthySettled,false);
 assert.equal(states.my.totalGames,4);assert.equal(states.completed.totalGames,4);assert.equal(states.other.error,true);
});
