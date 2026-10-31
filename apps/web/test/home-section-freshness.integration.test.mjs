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
