import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteHydration} from '../shell/route-hydration.js';
import {parseRouteFromHash} from '../shell/routes.js';
import {createHomeSectionReads,createHomeSectionState,sameRouteRead} from '../shell/home-section-reads.js';

function fixture({held=false,totalGames=9,storyDialog={refresh(){}}}={}) {
 const layout={size:3,columns:1},authority={generation:1},renders=[],sounds=[],requests=[],reads=[];
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),requestStarted=new Promise(resolve=>{started=resolve;});
 const ids=Array.from({length:9},(_,i)=>`control-${i}`);
 const transport={getHomeListRevision:()=>1,loadGamesPage:async options=>{
  requests.push(options);started();if(held)await gate;
  return {page:options.page,totalGames,totalPages:Math.ceil(totalGames/4),homeListRevision:1,games:ids.slice(options.page*4,options.page*4+4).map(id=>({id}))};
 }};
 const hydrate=createRouteHydration(),pending=new Set();let synced=0;
 const context={currentRoute:{name:'home',debug:false},homeReadVisit:1,homeReadJob:null,pendingResponsiveHomeRead:null,homeReadRecovery:null,accountContinuation:null,
  homeSections:Object.fromEntries(['my','completed','other','smoke'].map(key=>[key,createHomeSectionState(key)])),transport,
  homeFocusToRestore:null,pendingHomeRefresh:null,lastHomeBatchRevision:1,
  window:{location:{hash:'#/'},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}}};
 const getSection=key=>context.homeSections[key];
 const setSection=(key,value)=>{context.homeSections={...context.homeSections,[key]:value};};
 // Mutable boundary inputs feed the real route epoch and production equality.
 // A held operation cannot keep authority after account, owner, visit or intent changes.
 const capture=()=>{
  const route=parseRouteFromHash(context.window.location.hash);
  const read={generation:authority.generation,owner:context.transport,route,routeKey:route.name+':'+(route.gameId??''),homeVisit:context.homeReadVisit,homeDebug:false,
   inputs:JSON.stringify([context.homeReadVisit,false,['my','completed','other'].map(key=>[key,getSection(key).page,layout.size,layout.columns])])};
  read.epoch=hydrate.observe(read);reads.push(read);return read;
 };
 const isCurrent=read=>sameRouteRead(read,capture());
 const assertCurrent=(read,active=()=>true)=>{if(!isCurrent(read)||!active())throw Object.assign(new Error('session_changed'),{code:'session_changed'});};
 const controller=createHomeSectionReads({state:context,getHomeSection:getSection,setHomeSection:setSection,
  getHomeSectionVisiblePageSize:()=>layout.size,getHomeSectionColumnCount:()=>layout.columns,getVisibleHomeSectionKeys:()=>['my','completed','other'],
  captureRouteRead:capture,assertCurrentRouteRead:assertCurrent,routeReadIsCurrent:isCurrent,
  pendingHomeSectionKeys:pending,isHomeSectionPending:key=>pending.has(key),
  window:context.window,document:{},appEl:{},captureHomeFocus:()=>({}),
  render(){const section=getSection('my');renders.push({page:section.page,ids:[...section.gameIds],pending:pending.has('my')});},
  syncLiveChannels(){synced++;},gameSound:{play:cue=>sounds.push(cue)},scrollHomeSectionToTop(){},storyDialog,syncAnnouncement:{},
 });
 setSection('my',{...getSection('my'),page:0,totalPages:3,totalGames:9,gameIds:ids.slice(0,3),visiblePageSize:3,visibleColumnCount:1,homeListRevision:1,serverPageGameIdsByPage:{0:ids.slice(0,4)}});
 if(!held)setSection('my',{...getSection('my'),serverPageGameIdsByPage:{0:ids.slice(0,4),1:ids.slice(4,8),2:ids.slice(8)}});
 context.activate=(action='home-page-next')=>action==='home-section-retry'?controller.retry('my'):action==='home-page-prev'?controller.previous('my'):controller.next('my');
 Object.assign(context,{capture,isCurrent,setSection,syncSections:(...args)=>controller.syncSections(...args),retry:key=>controller.retry(key),scheduleRefresh:(...args)=>controller.scheduleRefresh(...args)});
 return {context,layout,authority,pending,renders,sounds,requests,reads,requestStarted,release,ids,get synced(){return synced;},get section(){return getSection('my');},snapshot(){return {page:this.section.page,pending:pending.has('my'),rendered:renders,lastError:context.window.__righeltLastError??null,synced};}};
}

test('actual standalone Next publishes its own page and clears pending before rendering the settled page',async()=>{
 const f=fixture();await f.context.activate();
 assert.equal(f.section.page,1);assert.deepEqual(Array.from(f.section.gameIds),f.ids.slice(3,6));
 assert.equal(f.pending.has('my'),false,JSON.stringify(f.snapshot()));
 assert.equal(f.renders.at(-1).page,1);assert.equal(f.renders.at(-1).pending,false);assert.equal(f.synced,1);
 assert.equal(f.requests.length,0,'cached publication needs no network or timing allowance');
});

test('actual page publication changes the read input while keeping authority identity',async()=>{
 const f=fixture(),before=f.context.capture();await f.context.activate();const current=f.context.capture();
 assert.notEqual(before.inputs,current.inputs);assert.equal(before.owner,current.owner);assert.equal(before.epoch,current.epoch);assert.equal(before.generation,current.generation);
});

for(const kind of ['generation','owner','visit','layout','page','route'])test(`held actual loader refuses publication after foreign ${kind} change`,async()=>{
 const f=fixture({held:true}),pending=f.context.activate();await f.requestStarted;
 if(kind==='generation')f.authority.generation++;
 if(kind==='owner')f.context.transport={getHomeListRevision:()=>1};
 if(kind==='visit')f.context.homeReadVisit++;
 if(kind==='layout'){f.layout.size=6;f.layout.columns=2;}
 if(kind==='page')f.context.setSection('my',{...f.section,page:2,gameIds:f.ids.slice(6)});
 if(kind==='route'){f.context.window.location.hash='#/game/foreign';f.context.currentRoute=parseRouteFromHash('#/game/foreign');}
 f.release();await pending;
 assert.equal(f.section.page,kind==='page'?2:0);assert.equal(f.context.window.__righeltLastError,'session_changed');
 assert.equal(f.requests.length,1);assert.equal(f.section.serverPageGameIdsByPage[1],undefined,'stale read cannot publish its cache');
});

// These execute the same native-delegate branch with held real loader promises.
test('held standalone Next settles the successful published page',async()=>{
 const f=fixture({held:true}),work=f.context.activate();await f.requestStarted;
 assert.equal(f.pending.has('my'),true);f.release();await work;
 assert.equal(f.section.page,1);assert.deepEqual(Array.from(f.section.gameIds),f.ids.slice(3,6));
 assert.equal(f.pending.has('my'),false);assert.equal(f.renders.at(-1).page,1);assert.equal(f.synced,1);
});
test('actual Previous settles its own reverse page',async()=>{
 const f=fixture();f.context.setSection('my',{...f.section,page:1,gameIds:f.ids.slice(3,6)});
 await f.context.activate('home-page-prev');assert.equal(f.section.page,0);assert.equal(f.pending.has('my'),false);
 assert.equal(f.renders.at(-1).page,0);assert.equal(f.synced,1);assert.deepEqual(f.sounds,['page-back']);
});
test('actual Retry may clamp its own acknowledged page and clear pending',async()=>{
 const f=fixture({held:true,totalGames:2});
 f.context.setSection('my',{...f.section,page:2,gameIds:f.ids.slice(6),serverPageGameIdsByPage:{}});
 const work=f.context.activate('home-section-retry');await f.requestStarted;f.release();await work;
 assert.equal(f.section.page,0);assert.equal(f.section.totalPages,1);assert.equal(f.pending.has('my'),false);
 assert.equal(f.renders.at(-1).page,0);assert.equal(f.renders.at(-1).pending,false);
});


test('Home construction does not refresh its later-initialized dialog, while a settled read failure refreshes the live owner',async()=>{
 let dialog;
 const refreshed=[];
 const f=fixture({storyDialog:{refresh:()=>dialog.refresh()}});
 assert.deepEqual(refreshed,[],'constructing Home must not access the later dialog');
 dialog={refresh(){refreshed.push(this);}};
 const failure=Object.assign(new Error('closed read'),{code:'session_changed'});
 f.context.transport.createHomeRead=()=>({readPage:async()=>{throw failure;},retire(){}});
 await assert.rejects(f.context.syncSections(),error=>error===failure);
 assert.equal(refreshed.length,1,'the settled read failure refreshes once');
 assert.equal(refreshed[0],dialog,'refresh preserves the current live dialog receiver');
});


for(const manualRetry of [false,true])test(`a held healthy background read preserves ${manualRetry?'the successful manual Retry':'the untouched section failure'}`,async()=>{
 const f=fixture();
 let releaseBackground,backgroundStarted;
 const gate=new Promise(resolve=>{releaseBackground=resolve;});
 const started=new Promise(resolve=>{backgroundStarted=resolve;});
 f.context.setSection('my',{...f.section,homeListRevision:0});
 for(const key of ['completed','other'])f.context.setSection(key,{...f.context.homeSections[key],loaded:true,error:true});
 const batchRequests=[];
 f.context.transport.createHomeRead=()=>({
  async readPage(options){batchRequests.push(options.section);backgroundStarted();await gate;return {page:0,totalGames:2,totalPages:1,homeListRevision:1,games:[{id:'healthy-a'},{id:'healthy-b'}]};},
  getHomeListRevision:()=>1,commit(){},retire(){},
 });
 const background=f.context.syncSections(f.context.capture(),()=>true,{onlyStale:true});
 await started;
 let retry;
 if(manualRetry){
  retry=f.context.retry('completed');
  await new Promise(setImmediate);
  assert.equal(f.context.homeSections.completed.error,null,'manual Retry really published before background release');
  assert.deepEqual(f.context.homeSections.completed.gameIds,f.ids.slice(0,3));
 }
 releaseBackground();
 await background;await retry;
 assert.deepEqual(batchRequests,['my'],'the background reads only its healthy stale section');
 assert.deepEqual(f.context.homeSections.my.gameIds,['healthy-a','healthy-b']);
 assert.equal(f.context.homeSections.completed.error,manualRetry?null:true);
 if(manualRetry)assert.deepEqual(f.context.homeSections.completed.gameIds,f.ids.slice(0,3),'the successful manual publication survives the later batch');
 assert.equal(f.context.homeSections.other.error,true,'an unrelated failed section is not cleared or retried');
 assert.deepEqual(f.requests.map(request=>request.section),manualRetry?['completed']:[]);
});


test('an unread healthy section keeps its older revision and the existing trailing refresh settles it once',async()=>{
 const f=fixture();let revision=1;
 f.context.transport.getHomeListRevision=()=>revision;
 f.context.setSection('my',{...f.section,homeListRevision:0});
 f.context.setSection('completed',{...f.context.homeSections.completed,loaded:true,error:null,homeListRevision:1,totalGames:1,gameIds:['retained-completed']});
 f.context.setSection('other',{...f.context.homeSections.other,loaded:true,error:true});
 const requests=[];let batches=0;
 f.context.transport.createHomeRead=()=>{
  const stagedChange=batches++===0?1:0;
  return {
   async readPage(options){requests.push(options.section);return {page:0,totalGames:1,totalPages:1,homeListRevision:revision+stagedChange,games:[{id:options.section+'-current'}]};},
   getHomeListRevision:()=>revision+stagedChange,commit(){revision+=stagedChange;},retire(){},
  };
 };
 await f.context.syncSections(f.context.capture(),()=>true,{onlyStale:true});
 assert.equal(revision,2);
 assert.equal(f.context.homeSections.my.homeListRevision,2);
 assert.equal(f.context.homeSections.completed.homeListRevision,1,'an unread section cannot acquire the new revision');
 assert.deepEqual(f.context.homeSections.completed.gameIds,['retained-completed']);
 assert.notEqual(f.context.lastHomeBatchRevision,2,'the remaining healthy section must retain a refresh obligation');
 await f.context.scheduleRefresh();await new Promise(setImmediate);
 assert.deepEqual(requests,['my','completed']);assert.equal(batches,2);
 assert.equal(f.context.homeSections.completed.homeListRevision,2);
 assert.deepEqual(f.context.homeSections.completed.gameIds,['completed-current']);
 assert.equal(f.context.lastHomeBatchRevision,2);
 assert.equal(f.context.homeSections.other.error,true,'the unrelated failed section is still a manual recovery');
});
