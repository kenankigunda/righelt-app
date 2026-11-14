import {createDestinationRouteOwner,destinationReadScope,destinationLiveGameId} from '../shell/destination-route-owner.js';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
import {createNavigationHistory} from '../shell/navigation-history.js';
import {createAccountContinuationOwner} from '../shell/account-continuation-owner.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as homeReads from '../shell/home-section-reads.js';
import {IDBFactory} from 'fake-indexeddb';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createCommandJournal} from '../shell/command-journal.js';
import {createRouteHydration} from '../shell/route-hydration.js';
import {parseRouteFromHash,buildHashForRoute,buildGameHash,FLYOUT_KEYS} from '../shell/routes.js';
import {createInitialState,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
import {classifyWebTestFile} from './test-layers.mjs';
import {getEligibleRematchResult} from '../shell/game-result.js';

// Execute the actual app routines with controlled browser boundaries, following
// game-render-hydration.integration.test.mjs. No duplicate recovery algorithm.
const source = readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const part = (start,end) => {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing app source boundary: ${start}`);
  return source.slice(a,b);
};
// Remaining VM routines cover legacy account/route/create behavior. All Home
// reads, cache math, retries and responsive ownership invoke imported production code.
const homeFixtureWiring = `
const getVisibleHomeSectionKeys = (route=currentRoute) => route?.debug ? ['my','completed','other','smoke'] : ['my','completed','other'];
const getHomeSection = key => homeSections[key] ?? createHomeSectionState(key);
const setHomeSection = (key,value) => { homeSections={...homeSections,[key]:value}; };
const homeSectionReads = createHomeSectionReads({
 state:{
  get transport(){return transport;},
  get homeSections(){return homeSections;},set homeSections(value){homeSections=value;},
  get homeReadVisit(){return homeReadVisit;},set homeReadVisit(value){homeReadVisit=value;},
  get homeReadJob(){return homeReadJob;},set homeReadJob(value){homeReadJob=value;},
  get pendingResponsiveHomeRead(){return pendingResponsiveHomeRead;},set pendingResponsiveHomeRead(value){pendingResponsiveHomeRead=value;},
  get homeReadRecovery(){return homeReadRecovery;},set homeReadRecovery(value){homeReadRecovery=value;},
  get accountContinuation(){return accountContinuation;},set accountContinuation(value){accountContinuation=value;},
  get currentRoute(){return currentRoute;},set currentRoute(value){currentRoute=value;},
  get pendingHomeRefresh(){return pendingHomeRefresh;},set pendingHomeRefresh(value){pendingHomeRefresh=value;},
  get lastHomeBatchRevision(){return lastHomeBatchRevision;},set lastHomeBatchRevision(value){lastHomeBatchRevision=value;},
  get homeFocusToRestore(){return homeFocusToRestore;},set homeFocusToRestore(value){homeFocusToRestore=value;},
  get routeHydrated(){return routeHydrated;},set routeHydrated(value){routeHydrated=value;},
  get homeSectionsHydrated(){return homeSectionsHydrated;},set homeSectionsHydrated(value){homeSectionsHydrated=value;},
  get homeSectionResizeFrame(){return homeSectionResizeFrame;},set homeSectionResizeFrame(value){homeSectionResizeFrame=value;},
 },
 getHomeSection:(...args)=>getHomeSection(...args),
 setHomeSection:(...args)=>setHomeSection(...args),
 getHomeSectionVisiblePageSize:(...args)=>getHomeSectionVisiblePageSize(...args),
 getHomeSectionColumnCount:(...args)=>getHomeSectionColumnCount(...args),
 getVisibleHomeSectionKeys:(...args)=>getVisibleHomeSectionKeys(...args),
 captureRouteRead:(...args)=>captureRouteRead(...args),
 assertCurrentRouteRead:(...args)=>assertCurrentRouteRead(...args),
 routeReadIsCurrent:(...args)=>routeReadIsCurrent(...args),
 render:(...args)=>render(...args),
 syncLiveChannels:(...args)=>syncLiveChannels(...args),
 startRouteSync:(...args)=>startRouteSync(...args),
 isHomeSectionPending:(...args)=>isHomeSectionPending(...args),
 captureHomeFocus:(...args)=>captureHomeFocus(...args),
 scrollHomeSectionToTop(){},restoreHomeReadingPosition(){},restoreHomeFocus(){return false;},
 resumeAccountContinuation:(pending,settlement)=>retryAccountContinuation({expectedPending:pending,settlement}),
 pendingHomeSectionKeys,gameSound,storyDialog,appEl,document,window,syncAnnouncement:{},
});
const applyHomeVisitPages=(...args)=>homeSectionReads.applyVisitPages(...args);
const syncHomeSections=(...args)=>homeSectionReads.syncSections(...args);
const scheduleHomeListRefresh=(...args)=>homeSectionReads.scheduleRefresh(...args);
const scheduleResponsiveHomeSectionPageSizes=(...args)=>homeSectionReads.scheduleResponsive(...args);
const queueResponsiveHomeSectionPageSizes=(...args)=>homeSectionReads.queueResponsive(...args);
`;
const script = new vm.Script([
  'let accountContinuation=null,accountContinuationError=false,accountContinuationIncidentId=null;',
  part('let homeReadJob = null;','const hydrateRoute ='),
  'let routeHydrated=false,homeSectionsHydrated=false,routeSyncRequestId=0,inviteLoadState=null,resolvedInvite=null,homeSectionResizeFrame=0,pendingRoutePosition=null,destinationLoadPresentation=null;',
  "let homeFocusToRestore=null,pendingHomeRefresh=null,lastHomeBatchRevision=null; let homeSections=Object.fromEntries(['my','completed','other','smoke'].map(key=>[key,createHomeSectionState(key)]));",
  part('const pendingHomeSectionKeys =','let lastRenderedMarkup ='),
  part('const isHomeSectionPending =','const renderButtonStateAttributes ='),
  homeFixtureWiring,
  part('const routeReadKey =','let destinationNoticeEl='),
  part('const destinationRouteOwner=','const syncScenarioCatalog ='),
  part('const navigateTo =','let previousLayoutMode ='),
  part('const renderHomeStartButton =','const renderHomeGameSection ='),
  `const explicitStart=(action,actionEl={})=>{${part('  if (action === "create-game" || action === \'create-self-play\') {','  if (action === "launch-history-branch"')}};`,
  `globalThis.home={readState:()=>({routeHydrated,routeSyncRequestId,lastError:window.__righeltLastError}),startSync:startRouteSync,retrySection:async(actionEl)=>homeSectionReads.retry(actionEl.getAttribute('data-home-section')),sync:()=>syncRouteDataAndLiveChannels(),capture:captureRouteRead,noteVisit:observeHomeReadVisit,navigate:navigateTo,
    transitions:()=>({pending:homeReadTransitions.length,trusted:homeReadTransitionsTrusted,visit:homeReadVisit}),
    continue:completeAccountContinuation,retry:retryAccountContinuation,clear:clearAccountContinuation,
    start:explicitStart,startButton:renderHomeStartButton,retryable:homeReadMayRetry,
    sections:()=>structuredClone(homeSections),
    seed:sections=>{homeSections=structuredClone(sections);},
    changePage:(key,page)=>{setHomeSection(key,{...getHomeSection(key),page});captureRouteRead();},
    recovery:()=>homeReadRecovery,pending:()=>accountContinuation,
    settlement:()=>homeReadJob?.settled,pendingRefresh:()=>Boolean(pendingHomeRefresh),active:()=>Boolean(homeReadJob),scheduleResponsive:scheduleResponsiveHomeSectionPageSizes};`,
].join('\n'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let n=0;n<12;n++)await new Promise(setImmediate);};
const observe=promise=>{promise.catch(()=>{});return promise;};
const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const snapshot=()=>{
  const state=resolveToStability(createInitialState(),{artifactMode:'full'});
  const turn={index:0,playerSeat:'Player 1',status:'active',moveIndexes:[]};
  return{id:'created',ownershipMode:'account_v1',gameplayRevision:0,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',board:{state},currentSnapshot:state,currentTurn:turn,turns:[turn],moves:[],
    player1:{identityId:'reader'},player2:{identityId:'reader'},viewers:[],pendingJoinRequests:[],selfPlayMode:true,myRole:'Player 1',myRoles:['Player 1','Player 2'],canRecordMove:true,canEndTurn:true,legalActions:listLegalActions(state)};
};
const card=(id,count=0)=>({id,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',moveCount:count});
const pageBody=(section,id=`${section}-new`,count=7,page=0)=>({ok:true,section,page,pageSize:4,totalGames:count,totalPages:Math.ceil(count/4),games:[card(id,42)]});
const section=(title,id)=>({title,page:0,totalPages:1,totalGames:1,gameIds:[id],serverPage:0,serverTotalPages:1,serverPageGameIds:[id],serverPageGameIdsByPage:{0:[id]},visiblePageSize:1,visibleColumnCount:1,slideDirection:'none',animationToken:3});

async function fixture(t,{journalAdapter,seed=true,authEnabled=true}={}) {
  const calls=[],writes=[],events=[],creations=[],responsiveWorks=[];
  const auth={enabled:authEnabled,session:{authenticated:authEnabled,account:authEnabled?{id:'reader'}:null,contextId:authEnabled?'a'.repeat(64):null}};
  const journal=createCommandJournal({indexedDB:new IDBFactory(),databaseName:'home-read-fixture'});
  const durable=journalAdapter?journalAdapter(journal):journal;
  let responder=async({section})=>Response.json(pageBody(section,`${section}-cached`,1));
  const game=snapshot();
  const store=createLiveTransportStore({storage:memory(),auth,commandJournal:durable,shouldDeferCommandSend:()=>true,
    fetcher:async(url,init={})=>{
      const parsed=new URL(url,'http://fixture');
      if(init.method==='POST'&&parsed.pathname==='/api/shell/games/review-previews')return Response.json({ok:true,items:[]});
      if(init.method==='POST'){writes.push({url,body:JSON.parse(init.body)});return Response.json({ok:true,protocolVersion:2,eventSeq:1,game});}
      if(parsed.pathname==='/api/shell/games'){
        const request={section:parsed.searchParams.get('section'),page:Number(parsed.searchParams.get('page')),debug:parsed.searchParams.get('debug'),signal:init.signal};
        calls.push(request);return responder(request);
      }
      return Response.json({ok:true,protocolVersion:2,eventSeq:1,game});
    }});
  store.subscribe(event=>events.push(event));
  t.after(async()=>{store.retire();await journal.close();});
  if(seed)for(const key of ['my','completed','other'])await store.loadGamesPage({section:key,pageSize:6});
  calls.length=0;
  // Match the sync store's synchronous operation-handle boundary while keeping
  // the actual live transport creation request, not a synthetic write counter.
  const transport={...store,createGame:options=>{const committed=store.createGame(options);creations.push(committed);return{result:{id:game.id},committed};}};
  // Queue real oldURL/newURL hash transitions without delivering events until
  // the test asks. The app's actual navigateTo and registered handler run below.
  const hashEvents=[],listeners=new Map();let href='http://fixture/#/',hashWriteProbe=null;
  const location={get href(){return href;},get hash(){return new URL(href).hash;},set hash(value){
    const oldURL=href,next=new URL(href);next.hash=value;hashWriteProbe?.({oldURL,newURL:next.href});href=next.href;
    if(oldURL!==href)hashEvents.push({oldURL,newURL:href});
  }};
  const frames=new Map();let frameId=0;
  const browser={location,scrollTo(){},addEventListener:(name,handler)=>listeners.set(name,handler),
    requestAnimationFrame:callback=>{const id=++frameId;frames.set(id,()=>{
      const returned=callback();
      if(returned?.then){responsiveWorks.push(returned);returned.catch(()=>{});}
      return returned;
    });return id;},cancelAnimationFrame:id=>frames.delete(id)};
  let generation=1,pageSize=1,columnCount=1,clicks=0,renders=0,refreshes=0,renderProbe=()=>{};
  const destinationRecovery=createDestinationRecovery({setTimer:()=>null,clearTimer(){}});
  const context=vm.createContext({createDestinationRouteOwner,destinationReadScope,destinationLiveGameId,destinationRecovery,syncDestinationNotice(){},...homeReads,createAccountContinuationOwner,Error,captureHomeFocus:()=>null,document:{},cancelPendingBoardContextReplay(){},pendingBoardContextReplay:null,structuredClone,URL,URLSearchParams,SYNC_TIMING,createRouteHydration,
    hydrateRoute:createRouteHydration(),window:browser,currentRoute:parseRouteFromHash('#/'),transport,
    account:{snapshot:()=>({generation}),canPlay:()=>true},
    parseRouteFromHash,buildHashForRoute,FLYOUT_KEYS,HOME_SECTION_SERVER_PAGE_SIZE:4,HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:1,
    getHomeSectionVisiblePageSize:()=>pageSize,getHomeSectionColumnCount:()=>columnCount,
    setTimeout:(...args)=>setTimeout(...args),clearTimeout:(...args)=>clearTimeout(...args),
    render:()=>{renders++;renderProbe();},syncLiveChannels:()=>{},gameSound:{play(){},leaveGame(){},cancelPreview(){}},
    issueDiagnostics:{capture:()=> 'fixture-incident',resolve(){}},
    storyDialog:{refresh:()=>{refreshes++;},open(){},close(){}},
    appEl:{querySelector:()=>({click:()=>{clicks++;}})},CSS:{escape:value=>value},
    getEligibleRematchResult,rematchDialog:{open(){},close(){}},startGameEntryRouteTransition(){},
    buildGameHash,getCurrentFlyoutState:()=>({}),openFriendInvite(){},
    // Controlled layout/presentation boundaries; routing strings and ownership
    // decisions use production routes, navigateTo, event handler and hydration.
    normalizeRouteFlyoutState:route=>route,preparePanelTransition(){},closeHeaderMenu(){},syncFlyoutRenderOrder(){},
    isFlyoutOnlyRouteChange:(a,b)=>a.name===b.name&&a.gameId===b.gameId&&FLYOUT_KEYS.some(key=>a[key]!==b[key]),
    joinFeedback:{clear(){}},inlineProfiles:{close(){}},resultPresentation:{clear(){}},
    hostInvite:null,inviteVisit:0,activeResultGameId:null,pendingResultReviewFocus:null,routeTransition:null,restoreHomePending:false,
    prefersReducedMotion:()=>false,retireTutorialSave(){},syncRouteTransitionForCurrentRoute(){},maybeRevealRouteTransition(){},
    invitationLoadFailureKind:()=> 'retry',
  });
  browser.history={state:null,replaceState(state,_title,hash){this.state=state;if(hash!==undefined)location.hash=hash;}};
  context.navigationHistory=createNavigationHistory({history:browser.history,getHash:()=>location.hash,capture:()=>({y:0,generation}),id:()=>String(++frameId)});
  script.runInContext(context);
  const h=context.home;
  h.seed({my:section('My games','my-cached'),completed:section('Your completed games','completed-cached'),other:section('Other games','other-cached'),smoke:section('Deploy smoke player','smoke-cached')});
  return{h,store,journal,auth,calls,writes,events,creations,context,hashEvents,responsiveWorks,
    onHashWrite:probe=>{hashWriteProbe=probe;},
    deliver:event=>listeners.get('hashchange')(event),
    deliverNext:()=>{const event=hashEvents.shift();assert.ok(event,'queued hashchange');listeners.get('hashchange')(event);return event;},
    browserNavigate:hash=>{browser.location.hash=hash;},
    // A released held server response also answers a bounded freshness reread
    // of that exact page. Calls remain fully counted; aborted owners cannot reuse it.
    respond:fn=>{const held=new Map();responder=request=>{
      const key=`${request.section}:${request.page}`,prior=held.get(key);
      if(prior&&!prior.signal.aborted)return prior.response.then(response=>response.clone());
      const value=fn(request);
      if(value?.then){const response=Promise.resolve(value);held.set(key,{signal:request.signal,response});return response.then(result=>result.clone());}
      return value;
    };},clicks:()=>clicks,renders:()=>renders,refreshes:()=>refreshes,
    change(kind){if(kind==='account')generation++;if(kind==='route'){browser.location.hash='#/game/created';context.currentRoute={name:'game',gameId:'created'};}
      if(kind==='transport')context.transport={...transport};if(kind==='inputs')pageSize=2;h.capture();},
    setColumns:value=>{columnCount=value;h.capture();},
    changeColumnsBeforeScheduling:value=>{columnCount=value;},
    onRender:probe=>{renderProbe=probe;},
    flushScheduledFrames:()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();},
    setPageSize:value=>{pageSize=value;h.capture();},
  };
}

test('Home recovery is registered as integration coverage',()=>{
  assert.equal(classifyWebTestFile('home-read-recovery.integration.test.mjs'),'integration');
});

test('a changed section/card remains private while the other section is held, then both publish together',async t=>{
  const f=await fixture(t),held=deferred();
  const before=JSON.stringify(f.h.sections()),old=f.store.getHomeGameCard('my-cached');
  f.respond(({section})=>section==='other'?held.promise:Response.json(pageBody(section)));
  const work=observe(f.h.sync());await flush();
  assert.equal(JSON.stringify(f.h.sections()),before);
  assert.deepEqual(f.store.getHomeGameCard('my-cached'),old);
  assert.equal(f.store.getHomeGameCard('my-new'),null);
  assert.equal(f.events.length,0,'no page-level publication notification');
  held.resolve(Response.json(pageBody('other')));await work;
  const after=f.h.sections();
  assert.equal(after.my.totalGames,7);assert.equal(after.other.totalGames,7);
  assert.deepEqual(after.my.gameIds,['my-new']);assert.deepEqual(after.other.gameIds,['other-new']);
  assert.equal(f.store.getHomeGameCard('my-new').moveCount,42);
  assert.equal(f.store.getHomeGameCard('other-new').moveCount,42);
  assert.equal(after.smoke.totalGames,0);assert.equal(f.writes.length,0);
});

test('a failed peer section preserves every live page/count/cache through the one retry',async t=>{
  const f=await fixture(t),failure=deferred();t.mock.timers.enable({apis:['setTimeout']});
  const before=JSON.stringify(f.h.sections());let retry=false;
  f.respond(({section})=>retry?Response.json(pageBody(section)):section==='other'?failure.promise:Response.json(pageBody(section)));
  const work=observe(f.h.sync());await flush();failure.resolve(Response.json({error:'temporarily_unavailable'},{status:503}));await flush();
  const episode=f.h.recovery();assert.ok(episode);assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.store.getHomeGameCard('my-new'),null);assert.equal(f.calls.length,3);
  t.mock.timers.tick(499);await flush();assert.equal(f.calls.length,3);
  retry=true;t.mock.timers.tick(1);await work;
  assert.equal(f.calls.length,8);assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
});

test('initial 5s timeout then 500ms retry restores an explicit retained Start and never replays intent',async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});let retry=false;
  f.respond(({section})=>retry?Response.json(pageBody(section)):new Promise(()=>{}));
  const work=f.h.continue({hash:'#/',action:'create-self-play'});await flush();
  t.mock.timers.tick(5000);await flush();
  assert.ok(f.calls.every(call=>call.signal.aborted),'the entire failed attempt is retired');
  assert.match(f.h.startButton(),/disabled/);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  retry=true;t.mock.timers.tick(500);await work;
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);assert.equal(f.h.pending(),null);
  assert.match(f.h.startButton(),/data-action="create-self-play"/);assert.doesNotMatch(f.h.startButton(),/disabled/);
  f.h.start('create-self-play');await Promise.all(f.creations);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.selfPlayMode,true);
});

test('two failed attempts are bounded and explicit Try again retains one episode and cached inspection',async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
  const before=JSON.stringify(f.h.sections());
  f.respond(()=>new Promise(()=>{}));
  const work=observe(f.h.sync());await flush();t.mock.timers.tick(5000);await flush();
  const episode=f.h.recovery();t.mock.timers.tick(500);await flush();t.mock.timers.tick(5000);await flush();
  await assert.rejects(work,{code:'request_timeout'});
  assert.equal(f.calls.length,6);assert.equal(f.h.recovery(),episode);assert.equal(episode.error.code,'request_timeout');
  assert.equal(JSON.stringify(f.h.sections()),before);assert.ok(f.store.getHomeGameCard('my-cached'));
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,6);assert.equal(f.h.active(),false);
  f.respond(({section})=>Response.json(pageBody(section)));await f.h.sync();
  assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
});

for(const phase of ['read','delay'])for(const kind of ['account','route','transport','inputs'])test(`${kind} change during ${phase} cancels the owner and late completion cannot publish/restart`,async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
  const before=JSON.stringify(f.h.sections()),held=[];
  f.respond(()=>{const d=deferred();held.push(d);return d.promise;});
  const work=observe(f.h.sync());await flush();
  if(phase==='delay'){t.mock.timers.tick(5000);await flush();assert.ok(f.h.recovery());}
  f.change(kind);await flush();
  await assert.rejects(work,{code:'session_changed'});
  for(let i=0;i<held.length;i++)held[i].resolve(Response.json(pageBody(f.calls[i].section)));
  t.mock.timers.tick(20000);await flush();
  assert.equal(f.calls.length,3);assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.store.getHomeGameCard('my-new'),null);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});

for(const [kind,response,code] of [
  ['auth',()=>Response.json({error:'invalid_credentials'},{status:401}),'invalid_credentials'],
  ['protocol',()=>Response.json({error:'upgrade_required'},{status:409}),'upgrade_required'],
  ['protocol on 503',()=>Response.json({error:'upgrade_required'},{status:503}),'upgrade_required'],
  ['storage on 503',()=>Response.json({error:'storage_reset'},{status:503}),'storage_reset'],
  ['schema',()=>Response.json({ok:true,games:null,page:0,totalGames:1,totalPages:1}),'invalid_home_page'],
  ['storage',()=>{throw Object.assign(new Error('storage_reset'),{code:'storage_reset'});},'storage_reset'],
])test(`${kind} failure does not retry or mutate cached sections/cards`,async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});const before=JSON.stringify(f.h.sections());
  f.respond(response);await assert.rejects(f.h.sync(),{code});
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,3);
  assert.equal(JSON.stringify(f.h.sections()),before);assert.ok(f.h.recovery().error);assert.equal(f.writes.length,0);
});

test('network rejection gets exactly one retry with a fresh abort controller',async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});let retry=false;
  f.respond(({section})=>{if(!retry)throw new TypeError('Failed to fetch');return Response.json(pageBody(section));});
  const work=observe(f.h.sync());await flush();assert.equal(f.calls.length,3);
  const first=f.calls.map(call=>call.signal);assert.ok(first.every(signal=>signal.aborted));
  retry=true;t.mock.timers.tick(500);await work;assert.equal(f.calls.length,8);
  assert.ok(f.calls.slice(3).every(call=>!first.includes(call.signal)));assert.equal(f.writes.length,0);
});

test('same-identity supersession and retirement fence even a fetcher that ignores abort',async t=>{
  const f=await fixture(t),held=deferred();f.respond(()=>held.promise);
  const old=f.store.createHomeRead(),work=observe(old.readPage({section:'my'}));await flush();
  const next=f.store.createHomeRead();await assert.rejects(work,{code:'session_changed'});
  assert.ok(f.calls[0].signal.aborted);held.resolve(Response.json(pageBody('my','obsolete')));await flush();
  assert.throws(()=>old.commit(),{code:'session_changed'});assert.equal(f.store.getHomeGameCard('obsolete'),null);
  f.respond(({section})=>Response.json(pageBody(section,'current')));await next.readPage({section:'my'});next.commit();
  assert.equal(f.store.getHomeGameCard('current').id,'current');assert.throws(()=>next.commit(),{code:'session_changed'});
});

test('transport batch cannot commit while a required request is pending or after explicit retirement',async t=>{
  const f=await fixture(t),held=deferred();f.respond(()=>held.promise);
  const batch=f.store.createHomeRead(),work=observe(batch.readPage({section:'my'}));await flush();
  assert.throws(()=>batch.commit(),{code:'home_read_incomplete'});batch.retire();await assert.rejects(work,{code:'session_changed'});
  assert.throws(()=>batch.commit(),{code:'session_changed'});held.resolve(Response.json(pageBody('my')));await flush();assert.equal(f.store.getHomeGameCard('my-new'),null);
});

test('journal hydration starts independently and a held journal does not delay Home commit',async t=>{
  const hold=deferred();let gated=false,entered=0;
  const f=await fixture(t,{journalAdapter:journal=>({...journal,list:async(...args)=>{entered++;if(gated)await hold.promise;return journal.list(...args);}})});
  gated=true;const before=entered;f.respond(({section})=>Response.json(pageBody(section)));
  await f.h.sync();assert.ok(entered>before);assert.ok(f.store.getHomeGameCard('my-new'));
  assert.equal(f.writes.length,0);hold.resolve();await flush();assert.equal(f.writes.length,0);
});

test('retiring Home cannot roll back an independently admitted durable command or duplicate its identity',async t=>{
  const f=await fixture(t);await f.store.loadGame('created');
  const game=f.store.getAuthoritativeGame('created');
  const admitted=await f.store.applyGameAction({gameId:game.id,state:game.board.state,action:game.legalActions[0]});
  assert.equal(admitted.accepted,true);
  const before=await f.journal.list('reader','created');assert.equal(before.length,1);
  f.respond(()=>new Promise(()=>{}));const batch=f.store.createHomeRead(),work=observe(batch.readPage({section:'my'}));await flush();batch.retire();
  await assert.rejects(work,{code:'session_changed'});await flush();
  assert.deepEqual(await f.journal.list('reader','created'),before);
  assert.equal(f.store.getGameViewModel('created').pendingCommandCount,1);assert.equal(f.writes.length,0);
});

test('standalone pagination still publishes immediately and awaits its independently owned journal pass',async t=>{
  const hold=deferred();let gated=false;
  const f=await fixture(t,{journalAdapter:journal=>({...journal,list:async(...args)=>{if(gated)await hold.promise;return journal.list(...args);}})});
  gated=true;f.respond(({section})=>Response.json(pageBody(section,'standalone')));
  let done=false;const work=f.store.loadGamesPage({section:'my'}).then(value=>{done=true;return value;});await flush();
  assert.ok(f.store.getHomeGameCard('standalone'));assert.equal(done,false);
  hold.resolve();const result=await work;assert.equal(result.games[0].id,'standalone');assert.equal(done,true);
});

test('successful normal authenticated continuation keeps its existing replay policy outside recovery',async t=>{
  const f=await fixture(t);f.respond(({section})=>Response.json(pageBody(section)));
  await f.h.continue({hash:'#/',action:'create-self-play'});
  assert.equal(f.clicks(),1);assert.equal(f.h.recovery(),null);assert.equal(f.h.pending(),null);
});


test('successful count shrink clamps only its own staged page without becoming a stale read',async t=>{
  const f=await fixture(t);f.h.changePage('my',12);
  f.respond(({section})=>Response.json(pageBody(section,`${section}-remaining`,1,0)));
  await f.h.sync();assert.equal(f.h.sections().my.page,0);
  assert.deepEqual(f.h.sections().my.gameIds,['my-remaining']);assert.equal(f.h.recovery(),null);
});

test('page filling stages all required server pages and their counts before whole publication',async t=>{
  const f=await fixture(t),held=deferred();f.setPageSize(8);
  const before=JSON.stringify(f.h.sections());
  f.respond(({section,page})=>{
    const body={...pageBody(section,undefined,9,page),games:Array.from({length:page===0?6:3},(_,n)=>card(`${section}-${page*6+n}`))};
    return section==='other'&&page===1?held.promise:Response.json(body);
  });
  const work=observe(f.h.sync());await flush();assert.equal(f.calls.length,9);
  assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('my-6'),null);
  held.resolve(Response.json({...pageBody('other',undefined,9,1),games:[6,7,8].map(n=>card(`other-${n}`))}));await work;
  for(const key of ['my','completed','other']){
    const value=f.h.sections()[key];assert.equal(value.totalGames,9);assert.equal(value.visiblePageSize,8);
    assert.deepEqual(Object.keys(value.serverPageGameIdsByPage),['0','1']);
    assert.deepEqual(value.gameIds,Array.from({length:8},(_,n)=>`${key}-${n}`));
  }
});


test('journal storage failure does not retry Home or delay its independent presentation commit',async t=>{
  let failed=false;
  const f=await fixture(t,{journalAdapter:journal=>({...journal,list:(...args)=>failed?Promise.reject(Object.assign(new Error('journal_unavailable'),{code:'journal_unavailable'})):journal.list(...args)})});
  t.mock.timers.enable({apis:['setTimeout']});failed=true;
  f.respond(({section})=>Response.json(pageBody(section)));await f.h.sync();await flush();
  assert.ok(f.store.getHomeGameCard('my-new'));assert.equal(f.calls.length,5);
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,5);assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
});

for(const scope of ['context','session','current predicate','retired transport'])test(`transport batch fences ${scope} changes even with the same displayed identity`,async t=>{
  const f=await fixture(t),held=deferred();let current=true;f.respond(()=>held.promise);
  const batch=f.store.createHomeRead({isCurrent:()=>current}),work=observe(batch.readPage({section:'my'}));await flush();
  if(scope==='context')f.auth.session.contextId='b'.repeat(64);
  if(scope==='session')f.auth.session={...f.auth.session};
  if(scope==='current predicate')current=false;
  if(scope==='retired transport')f.store.retire();
  held.resolve(Response.json(pageBody('my','forbidden')));
  await assert.rejects(work,{code:'session_changed'});assert.throws(()=>batch.commit(),{code:'session_changed'});
  assert.equal(f.store.getHomeGameCard('forbidden'),null);assert.equal(f.writes.length,0);
});


// Route-gap regressions invoke ACTUAL app navigation and the registered
// hashchange handler. None of these are observed failing-first in Cloud19.
const holdHomePages=f=>{
  const pending=[];f.respond(request=>{const d=deferred();pending.push({...request,...d});return d.promise;});
  return pending;
};
const releaseHomePages=(pending,label)=>{for(const request of pending)request.resolve(Response.json(pageBody(request.section,`${request.section}-${label}`)));};
const assertNoOldPublication=(f,before,label='obsolete')=>{
  assert.equal(JSON.stringify(f.h.sections()),before);
  for(const key of ['my','completed','other'])assert.equal(f.store.getHomeGameCard(`${key}-${label}`),null);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
};

test('actual navigateTo away/back retires before mutation and old completion before event delivery cannot publish',async t=>{
  const f=await fixture(t),pending=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();assert.equal(pending.length,3);
  let mutations=0;f.onHashWrite(()=>{mutations++;assert.equal(f.h.active(),false,'actual hash setter must see the old owner already retired');assert.ok(pending.every(request=>request.signal.aborted));});
  f.h.navigate('#/game/created');
  assert.equal(f.h.active(),false,'retirement is synchronous before any hashchange');
  assert.ok(pending.every(request=>request.signal.aborted));
  // Resolve while away, then return in the same JS task before promise/event
  // delivery. Without the synchronous boundary the final Home hash looks valid.
  releaseHomePages(pending,'obsolete');f.h.navigate('#/');
  assert.equal(f.context.window.location.hash,'#/');assert.equal(f.hashEvents.length,2);
  await assert.rejects(old,{code:'session_changed'});await flush();
  assertNoOldPublication(f,before);assert.equal(f.h.transitions().visit,2);assert.equal(mutations,2);
});

test('two exact late app-owned FIFO events do not cancel a fresh whole Home read',async t=>{
  const f=await fixture(t),oldPages=holdHomePages(f);
  const old=observe(f.h.sync());await flush();f.h.navigate('#/game/created');f.h.navigate('#/');
  await assert.rejects(old,{code:'session_changed'});
  const freshPages=holdHomePages(f),fresh=observe(f.h.sync());await flush();
  const visit=f.h.transitions().visit;assert.equal(f.h.transitions().pending,2);
  assert.equal(f.hashEvents[0].oldURL,'http://fixture/#/');assert.equal(f.hashEvents[0].newURL,'http://fixture/#/game/created');
  assert.equal(f.hashEvents[1].oldURL,'http://fixture/#/game/created');assert.equal(f.hashEvents[1].newURL,'http://fixture/#/');
  f.deliverNext();f.deliverNext();await flush();
  assert.equal(f.h.transitions().visit,visit);assert.equal(f.h.transitions().pending,0);
  assert.ok(f.h.active());assert.ok(freshPages.every(request=>!request.signal.aborted));assert.equal(f.calls.length,6);
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshPages,'fresh');await fresh;await flush();
  for(const key of ['my','completed','other']){
    assert.equal(f.store.getHomeGameCard(`${key}-obsolete`),null);
    assert.deepEqual(f.h.sections()[key].gameIds,[`${key}-fresh`]);assert.ok(f.store.getHomeGameCard(`${key}-fresh`));
  }
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});

test('browser-owned away/back events remain unmatched and invalidate same-URL Home ownership',async t=>{
  const f=await fixture(t),pending=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();const oldOwned=pending.slice();f.browserNavigate('#/game/created');f.browserNavigate('#/');
  assert.equal(f.h.transitions().pending,0);f.deliverNext();f.deliverNext();
  await assert.rejects(old,{code:'session_changed'});releaseHomePages(oldOwned,'obsolete');await flush();
  assertNoOldPublication(f,before);assert.equal(f.h.transitions().visit,2);
});

for(const negative of ['out-of-order','duplicate','exact oldURL mismatch'])test(`${negative} hashchange cannot acknowledge or revive the wrong Home visit`,async t=>{
  const f=await fixture(t),oldPages=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();f.h.navigate('#/game/created');f.h.navigate('#/');await assert.rejects(old,{code:'session_changed'});
  const [away,back]=f.hashEvents.splice(0);
  const freshPages=holdHomePages(f),fresh=observe(f.h.sync());await flush();const freshOwned=freshPages.slice();assert.equal(freshOwned.length,3);
  if(negative==='duplicate'){f.deliver(away);f.deliver(back);await flush();assert.ok(f.h.active());}
  const visit=f.h.transitions().visit;
  if(negative==='out-of-order')f.deliver(back);
  if(negative==='duplicate')f.deliver(back);
  if(negative==='exact oldURL mismatch')f.deliver({...away,oldURL:'http://fixture/other-path#/'});
  await assert.rejects(fresh,{code:'session_changed'});assert.ok(f.h.transitions().visit>visit);
  assert.ok(freshOwned.every(request=>request.signal.aborted));
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshOwned,'obsolete');await flush();
  assertNoOldPublication(f,before);
});

test('transition FIFO overflow remains bounded and falls back to conservative event invalidation',async t=>{
  const f=await fixture(t),oldPages=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();
  for(let n=0;n<64;n++)f.h.navigate(n%2===0?'#/game/created':'#/');
  await assert.rejects(old,{code:'session_changed'});
  assert.equal(f.h.transitions().pending,0);assert.equal(f.h.transitions().trusted,false);
  const freshPages=holdHomePages(f),fresh=observe(f.h.sync());await flush();const freshOwned=freshPages.slice();
  f.deliverNext();await assert.rejects(fresh,{code:'session_changed'});
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshOwned,'obsolete');await flush();assertNoOldPublication(f,before);
});

test('actual no-op and utility-only navigation retain a valid Home read without a restart',async t=>{
  const f=await fixture(t),pending=holdHomePages(f),work=observe(f.h.sync());await flush();const visit=f.h.transitions().visit;
  f.h.navigate('#/');await flush();assert.equal(f.hashEvents.length,0);
  f.h.navigate('#/?scenarios=1');assert.equal(f.hashEvents.length,1);f.deliverNext();await flush();
  assert.equal(f.h.transitions().visit,visit);assert.equal(f.h.transitions().pending,0);assert.equal(f.calls.length,3);
  assert.ok(pending.every(request=>!request.signal.aborted));releaseHomePages(pending,'current');await work;
  assert.deepEqual(f.h.sections().my.gameIds,['my-current']);assert.equal(f.writes.length,0);
});

test('matched late app events cannot undo an account-generation cancellation',async t=>{
  const f=await fixture(t),oldPages=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();f.h.navigate('#/game/created');f.h.navigate('#/');await assert.rejects(old,{code:'session_changed'});
  const freshPages=holdHomePages(f),fresh=observe(f.h.sync());await flush();
  f.change('account');await assert.rejects(fresh,{code:'session_changed'});f.deliverNext();f.deliverNext();
  // Only complete requests owned by the canceled generations. Any new current
  // generation route read started by the event handler stays held independently.
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshPages.slice(0,3),'obsolete');await flush();
  assertNoOldPublication(f,before);assert.ok(freshPages.slice(0,3).every(request=>request.signal.aborted));
});

// The actual open-debug Home handler updates local utility state before it
// synchronizes reads; the URL can still be the plain Home route.
test('local Home Debug intent retains smoke reads when the URL has no Debug parameter',async t=>{
  const f=await fixture(t);
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  assert.equal(f.context.window.location.hash,'#/');
  f.respond(({section})=>Response.json(pageBody(section)));
  await f.h.sync();
  assert.deepEqual(f.calls.map(call=>call.section).sort(),['completed','completed','my','my','other','other','smoke']);
  assert.ok(f.calls.every(call=>call.debug==='1'));
  assert.deepEqual(f.h.sections().smoke.gameIds,['smoke-new']);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});


test('closing local Home Debug retires a held read before any section publishes',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const work=observe(f.h.sync());await flush();
  assert.equal(held.length,4);
  f.context.currentRoute={...f.context.currentRoute,debug:false};f.h.capture();
  assert.ok(held.every(request=>request.signal.aborted));
  for(const request of held)request.resolve(Response.json(pageBody(request.section)));
  await assert.rejects(work,{code:'session_changed'});
  assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.store.getHomeGameCard('smoke-new'),null);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});

test('a game URL cannot inherit stale local Home Debug visibility',async t=>{
  const f=await fixture(t),before=JSON.stringify(f.h.sections());
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  f.browserNavigate('#/game/created');
  const read=f.h.capture();
  assert.equal(read.route.name,'game');assert.equal(read.route.gameId,'created');
  assert.equal(read.homeDebug,false);
  await f.h.sync();
  assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});


test('responsive Home input retirement restarts the current local Debug read',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());
  try{
    await flush();assert.equal(held.length,4);
    f.changeColumnsBeforeScheduling(2);
    f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted),'the actual capture retires every old request');
    assert.equal(JSON.stringify(f.h.sections()),before,'old partial data remains private');
    f.flushScheduledFrames();await flush();
    const fresh=held.slice(4);
    assert.equal(fresh.length,4,'responsive retirement must start a fresh complete current Home read');
    assert.deepEqual(fresh.map(request=>request.section).sort(),['completed','my','other','smoke']);
    assert.ok(fresh.every(request=>request.debug==='1'&&!request.signal.aborted));
    for(const request of fresh)request.resolve(Response.json(pageBody(request.section)));
    await flush();
    assert.deepEqual(f.h.sections().smoke.gameIds,['smoke-new']);
    assert.ok(f.renders()>0,'the current local Debug view reaches publication');
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section)));
    await Promise.allSettled([old]);await flush();
  }
});


test('responsive debounce owes one atomic full read with the latest measured columns',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());
  try{
    await flush();assert.equal(held.length,4);
    const initial=f.h.capture();
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    f.changeColumnsBeforeScheduling(3);f.h.scheduleResponsive();
    const latest=f.h.capture();
    assert.equal(latest.epoch,initial.epoch,'input changes never advance route authority');
    assert.equal(latest.homeVisit,initial.homeVisit);
    assert.ok(held.every(request=>request.signal.aborted));
    assert.equal(JSON.stringify(f.h.sections()),before);
    f.flushScheduledFrames();await flush();
    const fresh=held.slice(4);assert.equal(fresh.length,4);
    assert.deepEqual(fresh.map(request=>request.section).sort(),['completed','my','other','smoke']);
    assert.ok(fresh.every(request=>request.debug==='1'&&!request.signal.aborted));
    for(const request of held.slice(0,4))request.resolve(Response.json(pageBody(request.section,'obsolete')));
    await flush();assert.equal(JSON.stringify(f.h.sections()),before);
    const first=fresh.find(request=>request.section==='my');
    first.resolve(Response.json(pageBody('my')));await flush();
    assert.equal(JSON.stringify(f.h.sections()),before,'fresh partial batch remains private');
    assert.equal(f.store.getHomeGameCard('my-new'),null);
    for(const request of fresh)if(request!==first)request.resolve(Response.json(pageBody(request.section)));
    await flush();
    for(const key of ['completed','my','other','smoke']){
      assert.deepEqual(f.h.sections()[key].gameIds,[`${key}-new`]);
      assert.equal(f.h.sections()[key].visibleColumnCount,3);
    }
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
    f.flushScheduledFrames();await flush();assert.equal(held.length,8,'debounce intent consumed once');
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section)));
    await Promise.allSettled([old]);await flush();
  }
});

for(const changed of ['account','transport','route','visit'])test(`responsive pending replacement cannot cross a ${changed} change`,async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());
  try{
    await flush();assert.equal(held.length,4);
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted));
    const pending=f.h.capture();
    if(changed==='visit'){
      // Real app navigation advances the visit synchronously, before the two
      // queued hashchange events; no unrelated navigation read is launched.
      f.h.navigate('#/game/created');f.h.navigate('#/');
      assert.equal(f.context.window.location.hash,'#/');
      const returned=f.h.capture();
      assert.equal(returned.epoch,pending.epoch,'no intermediate authority capture');
      assert.notEqual(returned.homeVisit,pending.homeVisit,'identical URL is a new visit');
    }else f.change(changed);
    f.flushScheduledFrames();await flush();
    assert.equal(held.length,4,'stale intent must not request a replacement');
    assert.equal(f.h.active(),false);
    for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));
    await Promise.allSettled([old]);await flush();
    assert.equal(JSON.stringify(f.h.sections()),before);
    assert.equal(f.store.getHomeGameCard('obsolete'),null);
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section)));
    await Promise.allSettled([old]);await flush();
  }
});

test('a newer current full Home read survives an older pending responsive intent',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());let newer;
  try{
    await flush();assert.equal(held.length,4);
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted));
    newer=observe(f.h.sync());await flush();
    const fresh=held.slice(4);assert.equal(fresh.length,4);assert.equal(f.h.active(),true);
    f.flushScheduledFrames();await flush();
    assert.equal(held.length,8,'no duplicate or replacement of the newer job');
    assert.equal(f.h.active(),true);assert.ok(fresh.every(request=>!request.signal.aborted));
    for(const request of fresh)request.resolve(Response.json(pageBody(request.section)));
    await newer;assert.deepEqual(f.h.sections().smoke.gameIds,['smoke-new']);
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section)));
    await Promise.allSettled([old,newer]);await flush();
  }
});

test('responsive pagination without an active full read keeps independent section publication',async t=>{
  const f=await fixture(t),held=deferred();
  const seed={my:section('My games','my-cached'),other:section('Other games','other-cached'),smoke:section('Deploy smoke player','smoke-cached')};
  seed.my.serverPageGameIdsByPage={};seed.other.serverPageGameIdsByPage={};f.h.seed(seed);
  f.setPageSize(2);
  f.respond(({section})=>section==='other'?held.promise:Response.json(pageBody(section,`${section}-standalone`,1)));
  try{
    assert.equal(f.h.active(),false);f.h.scheduleResponsive();f.flushScheduledFrames();await flush();
    assert.deepEqual(f.calls.map(request=>request.section),['my','completed','other']);
    assert.deepEqual(f.h.sections().my.gameIds,['my-standalone']);
    assert.deepEqual(f.h.sections().other.gameIds,['other-cached']);
    assert.equal(f.h.active(),false,'standalone pagination does not become a full batch');
    assert.notEqual(f.store.getHomeGameCard('my-standalone'),null);
    held.resolve(Response.json(pageBody('other','other-standalone',1)));await flush();
    assert.deepEqual(f.h.sections().other.gameIds,['other-standalone']);
    assert.equal(f.h.sections().my.visiblePageSize,2);assert.equal(f.h.sections().other.visiblePageSize,2);
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{held.resolve(Response.json(pageBody('other','other-standalone',1)));await flush();}
});


test('a newer completed Home read fulfills the pending responsive obligation through RAF',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());let newer;
  try{
    await flush();assert.equal(held.length,4);
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted));
    newer=observe(f.h.sync());await flush();
    const fresh=held.slice(4);assert.equal(fresh.length,4);
    assert.deepEqual(fresh.map(request=>request.section).sort(),['completed','my','other','smoke']);
    assert.ok(fresh.every(request=>request.debug==='1'&&!request.signal.aborted));
    for(const request of fresh)request.resolve(Response.json(pageBody(request.section)));
    await newer;await flush();assert.equal(f.h.active(),false);
    for(const key of ['completed','my','other','smoke'])assert.deepEqual(f.h.sections()[key].gameIds,[`${key}-new`]);
    const committed=JSON.stringify(f.h.sections()),events=f.events.length,renders=f.renders();
    // A same-input debounce after completion must preserve fulfilled status.
    f.h.scheduleResponsive();f.flushScheduledFrames();await flush();
    assert.equal(held.length,8,'old4 + newer3 only: no third full read');
    assert.equal(f.h.active(),false);
    assert.equal(JSON.stringify(f.h.sections()),committed);
    assert.equal(f.events.length,events);assert.equal(f.renders(),renders,'no standalone pagination fallback');
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));
    await Promise.allSettled([old,newer]);await flush();
  }
});

for(const outcome of ['terminal','exhausted'])test(`a newer ${outcome} Home failure fulfills resize intent without an extra automatic read`,async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  t.mock.timers.enable({apis:['setTimeout']});
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());let newer;
  try{
    await flush();assert.equal(f.calls.length,4);
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted));
    f.respond(()=>outcome==='terminal'
      ? Response.json({error:'invalid_credentials'},{status:401})
      : Response.json({error:'temporary_unavailable'},{status:503}));
    newer=observe(f.h.sync());
    const failed=assert.rejects(newer,outcome==='terminal'?{code:'invalid_credentials'}:/temporary_unavailable/);
    await flush();assert.equal(f.calls.length,8,'newer first attempt follows old4');
    if(outcome==='exhausted'){t.mock.timers.tick(500);await flush();}
    await failed;assert.equal(f.h.active(),false);
    const expected=outcome==='terminal'?8:12;assert.equal(f.calls.length,expected);
    assert.ok(f.h.recovery().error);assert.equal(JSON.stringify(f.h.sections()),before);
    const renders=f.renders(),events=f.events.length;
    f.flushScheduledFrames();await flush();
    assert.equal(f.calls.length,expected,'RAF must not grant another full read or retry cycle');
    assert.equal(f.h.active(),false);assert.equal(JSON.stringify(f.h.sections()),before);
    assert.equal(f.events.length,events);assert.equal(f.renders(),renders,'no standalone partial fallback');
    t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,expected);
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));
    await Promise.allSettled([old,newer]);await flush();
  }
});

test('fresh input retirement resets a fulfilled responsive obligation for the newer job',async t=>{
  const f=await fixture(t),held=[];
  f.context.currentRoute={...f.context.currentRoute,debug:true};
  const before=JSON.stringify(f.h.sections());
  f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
  const old=observe(f.h.sync());let newer;
  try{
    await flush();assert.equal(held.length,4);
    f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
    newer=observe(f.h.sync());await flush();assert.equal(held.length,8);
    f.changeColumnsBeforeScheduling(3);f.h.scheduleResponsive();
    assert.ok(held.every(request=>request.signal.aborted));
    assert.equal(JSON.stringify(f.h.sections()),before);
    f.flushScheduledFrames();await flush();
    const fresh=held.slice(8);assert.equal(fresh.length,4,'latest retired job owes its own replacement');
    assert.ok(fresh.every(request=>request.debug==='1'&&!request.signal.aborted));
    for(const request of fresh)request.resolve(Response.json(pageBody(request.section)));
    await flush();
    for(const key of ['completed','my','other','smoke']){
      assert.deepEqual(f.h.sections()[key].gameIds,[`${key}-new`]);
      assert.equal(f.h.sections()[key].visibleColumnCount,3);
    }
    f.flushScheduledFrames();await flush();assert.equal(held.length,12);
    assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  }finally{
    for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));
    await Promise.allSettled([old,newer]);await flush();
  }
});

test('capture-only Home input retirement owes one current atomic replacement without a resize event',async t=>{
 const f=await fixture(t),held=[];
 f.context.currentRoute={...f.context.currentRoute,debug:true};
 const before=JSON.stringify(f.h.sections());
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
 const old=observe(f.h.sync());
 try{
  await flush();assert.equal(held.length,4);
  assert.deepEqual(held.map(request=>request.section).sort(),['completed','my','other','smoke']);
  // Existing helper changes only measured layout input then invokes the actual
  // captureRouteRead. Do not call the responsive/window-resize scheduler.
  f.setColumns(2);
  assert.ok(held.every(request=>request.signal.aborted));
  assert.equal(f.h.active(),false);
  assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  f.flushScheduledFrames();await flush();
  const fresh=held.slice(4);
  assert.equal(fresh.length,4,'capture-only input retirement must replace all three sections');
  assert.ok(fresh.every(request=>request.debug==='1'&&!request.signal.aborted));
  for(const request of fresh)request.resolve(Response.json(pageBody(request.section)));
  await flush();
  for(const key of ['completed','my','other','smoke']){
   assert.deepEqual(f.h.sections()[key].gameIds,[`${key}-new`]);
   assert.equal(f.h.sections()[key].visibleColumnCount,2);
  }
  assert.equal(f.h.active(),false);assert.ok(f.renders()>0);
  f.flushScheduledFrames();await flush();assert.equal(held.length,8);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
 }finally{
  for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));
  await Promise.allSettled([old]);await flush();
 }
});

for(const kind of ['account','transport','route','visit'])test(`capture-only replacement cannot cross ${kind} retirement`,async t=>{
 const f=await fixture(t),held=[];f.context.currentRoute={...f.context.currentRoute,debug:true};
 const before=JSON.stringify(f.h.sections());f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});const old=observe(f.h.sync());
 try{
  await flush();assert.equal(held.length,4);f.setColumns(2);assert.ok(held.every(r=>r.signal.aborted));
  if(kind==='visit'){f.h.noteVisit();f.h.capture();}else f.change(kind);
  f.flushScheduledFrames();await flush();assert.equal(held.length,4);
  assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.h.active(),false);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
 }finally{for(const r of held)r.resolve(Response.json(pageBody(r.section,'obsolete')));await Promise.allSettled([old]);await flush();}
});

test('repeated capture-only inputs replace once for the latest layout',async t=>{
 const f=await fixture(t),held=[];f.context.currentRoute={...f.context.currentRoute,debug:true};
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});const old=observe(f.h.sync());
 try{
  await flush();assert.equal(held.length,4);f.setColumns(2);f.setColumns(3);
  assert.ok(held.every(r=>r.signal.aborted));f.flushScheduledFrames();await flush();const fresh=held.slice(4);assert.equal(fresh.length,4);
  for(const r of fresh)r.resolve(Response.json(pageBody(r.section)));await flush();
  for(const key of ['completed','my','other','smoke'])assert.equal(f.h.sections()[key].visibleColumnCount,3);
  f.flushScheduledFrames();await flush();assert.equal(held.length,8);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
 }finally{for(const r of held)r.resolve(Response.json(pageBody(r.section,'obsolete')));await Promise.allSettled([old]);await flush();}
});

for(const newerActive of [false,true])test(`RAF validation preserves a newly discovered input obligation with newerActive=${newerActive}`,async t=>{
 const f=await fixture(t),held=[];f.context.currentRoute={...f.context.currentRoute,debug:true};
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});const old=observe(f.h.sync());let newer;
 try{
  await flush();assert.equal(held.length,4);f.setColumns(2);
  if(newerActive){newer=observe(f.h.sync());await flush();assert.equal(held.length,8);}
  // Change the real input without delivering another capture or resize callback.
  // The RAF's own validation is the first observer of this latest layout.
  f.changeColumnsBeforeScheduling(3);f.flushScheduledFrames();await flush();
  assert.ok(held.every(r=>r.signal.aborted));assert.equal(held.length,newerActive?8:4);
  f.flushScheduledFrames();await flush();const fresh=held.slice(newerActive?8:4);assert.equal(fresh.length,4);
  for(const r of fresh)r.resolve(Response.json(pageBody(r.section)));await flush();
  for(const key of ['completed','my','other','smoke'])assert.equal(f.h.sections()[key].visibleColumnCount,3);
  f.flushScheduledFrames();await flush();assert.equal(held.length,newerActive?12:8);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
 }finally{for(const r of held)r.resolve(Response.json(pageBody(r.section,'obsolete')));await Promise.allSettled([old,newer]);await flush();}
});

test('capture-only layout observation without a full job does not invent a full refresh',async t=>{
 const f=await fixture(t);f.setColumns(2);f.flushScheduledFrames();await flush();
 assert.equal(f.calls.length,0);assert.equal(f.h.active(),false);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});


test('two timed-out account Home reads retain explicit self-play through read retry without replaying creation',async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
  f.respond(()=>new Promise(()=>{}));
  const work=f.h.continue({hash:'#/',action:'create-self-play'});await flush();
  t.mock.timers.tick(5000);await flush();
  assert.ok(f.h.recovery());assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  t.mock.timers.tick(500);await flush();t.mock.timers.tick(5000);await work;
  assert.equal(f.calls.length,6);assert.equal(f.h.pending().running,false);
  assert.equal(f.h.pending().recoveryEpisode,true);assert.equal(f.h.recovery().error.code,'request_timeout');
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
  f.h.start('create-self-play');assert.equal(f.writes.length,0,'Start remains fenced while read recovery is unresolved');
  f.respond(({section})=>Response.json(pageBody(section)));
  await f.h.retry();
  assert.equal(f.h.recovery(),null);assert.equal(f.h.pending(),null);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0,'Explicit read retry cannot replay the old write intent');
  assert.match(f.h.startButton(),/data-action="create-self-play"/);assert.match(f.h.startButton(),/Start playing both sides/);
  assert.doesNotMatch(f.h.startButton(),/disabled/);
  f.h.start('create-self-play');await Promise.all(f.creations);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.selfPlayMode,true);
});

for(const authEnabled of [false,true])test(`completed ordinary partial recovery waits for strict first attempt and exhausted second auth=${authEnabled}`,async t=>{
 const f=await fixture(t,{authEnabled});t.mock.timers.enable({apis:['setTimeout']});
 const before=JSON.stringify(f.h.sections());
 f.respond(({section})=>section==='completed'?Response.json({error:'temporary_unavailable'},{status:503}):Response.json(pageBody(section)));
 const work=observe(f.h.sync());await flush();
 assert.equal(JSON.stringify(f.h.sections()),before,'first failure cannot publish any section');assert.equal(f.store.getHomeGameCard('my-new'),null);
 assert.equal(f.calls.length,3);t.mock.timers.tick(499);await flush();assert.equal(f.calls.length,3);
 t.mock.timers.tick(1);await work;
 assert.equal(f.calls.length,7,'two whole attempts plus one bounded healthy freshness reread');
 const state=f.h.sections();assert.deepEqual(state.my.gameIds,['my-new']);assert.equal(state.my.totalGames,7);
 assert.deepEqual(state.completed.gameIds,['completed-cached']);assert.equal(state.completed.totalGames,1);assert.equal(state.completed.error,true);
 assert(f.store.getHomeGameCard('my-new'));assert.equal(f.h.recovery(),null,'ordinary section recovery must not become a global creation failure');
 t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,7,'manual failed section cannot schedule another read');
});

test('completed partial policy never advances a retained account continuation',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});const before=JSON.stringify(f.h.sections());
 f.respond(({section})=>section==='completed'?Response.json({error:'temporary_unavailable'},{status:503}):Response.json(pageBody(section)));
 const work=observe(f.h.continue({hash:'#/',action:'create-self-play'}));await flush();t.mock.timers.tick(500);
 await work;assert.equal(f.h.recovery().error.code,'temporary_unavailable');assert.equal(f.calls.length,6);assert.equal(JSON.stringify(f.h.sections()),before);
 assert.equal(f.store.getHomeGameCard('my-new'),null);assert(f.h.pending());assert.equal(f.h.pending().running,false);assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});

test('completed partial policy rejects fatal503 codes after the original first retry',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});let second=false;const before=JSON.stringify(f.h.sections());
 f.respond(({section})=>section==='completed'?Response.json({error:second?'upgrade_required':'temporary_unavailable'},{status:503}):Response.json(pageBody(section)));
 const work=observe(f.h.sync());await flush();second=true;t.mock.timers.tick(500);
 await assert.rejects(work,{code:'upgrade_required'});assert.equal(f.calls.length,6);assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('my-new'),null);
});

test('completed second attempt cannot publish a healthy section before a held peer and owner retirement',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});let second=false;const held=deferred(),before=JSON.stringify(f.h.sections());
 f.respond(({section})=>section==='completed'?Response.json({error:'temporary_unavailable'},{status:503}):second&&section==='other'?held.promise:Response.json(pageBody(section)));
 const work=observe(f.h.sync());await flush();second=true;t.mock.timers.tick(500);await flush();
 assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('my-new'),null);
 f.change('account');await flush();await assert.rejects(work,{code:'session_changed'});
 held.resolve(Response.json(pageBody('other')));await flush();assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('my-new'),null);
});

test('completed partial batch discards every staged page of the failed section before healthy commit',async t=>{
 const f=await fixture(t),batch=f.store.createHomeRead({retainSectionFailure:f.h.retryable});
 f.respond(({section,page})=>section==='completed'&&page===1?Response.json({error:'temporary_unavailable'},{status:503}):Response.json(pageBody(section,`${section}-staged-${page}`,12,page)));
 await batch.readPage({section:'my',page:0});await batch.readPage({section:'completed',page:0});
 await assert.rejects(batch.readPage({section:'completed',page:1}),{code:'temporary_unavailable'});
 assert.equal(f.store.getHomeGameCard('my-staged-0'),null);assert.equal(f.store.getHomeGameCard('completed-staged-0'),null);
 batch.commit();assert(f.store.getHomeGameCard('my-staged-0'));assert.equal(f.store.getHomeGameCard('completed-staged-0'),null);
});

for(const visible of [false,true])test(`completed unknown membership evidence repairs prior ongoing count atomically visible=${visible}`,async t=>{
 const f=await fixture(t),held=deferred(),before=JSON.stringify(f.h.sections());let myReads=0;
 f.respond(({section})=>{
  if(section==='my'){
   myReads++;
   return Response.json({...pageBody('my','ongoing-stable',myReads===1?5:4),games:myReads===1&&visible?[{...card('unknown-x',1),eventSeq:1,gameplayRevision:1},card('ongoing-stable',1)]:[card('ongoing-stable',1)]});
  }
  if(section==='completed')return held.promise;
  return Response.json({...pageBody(section,undefined,0),games:[]});
 });
 const work=observe(f.h.sync());await flush();
 assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('unknown-x'),null);
 held.resolve(Response.json({...pageBody('completed','unknown-x',1),games:[{...card('unknown-x',2),eventSeq:2,gameplayRevision:2}]}));await work;
 assert.equal(myReads,2,'new off-page or previously staged membership evidence invalidates the prior count');
 assert.equal(f.h.sections().my.totalGames,4);assert.equal(f.h.sections().completed.totalGames,1);
 assert.deepEqual(f.h.sections().my.gameIds,['ongoing-stable']);assert.deepEqual(f.h.sections().completed.gameIds,['unknown-x']);
 assert.equal(f.store.getHomeGameCard('unknown-x').eventSeq,2);assert.equal(f.store.getHomeGameCard('unknown-x').moveCount,2);
 assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
});

test('completed late older evidence cannot overwrite a newer card learned inside the same private batch',async t=>{
 const f=await fixture(t),batch=f.store.createHomeRead();
 f.respond(({section})=>Response.json({...pageBody(section,'staged-x',1),games:[{...card('staged-x',section==='completed'?2:1),eventSeq:section==='completed'?2:1,gameplayRevision:section==='completed'?2:1}]}));
 await batch.readPage({section:'completed'});
 const older=await batch.readPage({section:'my'});
 assert.equal(older.homeListChanged,true,'counts from the older projection require bounded freshness repair');
 assert.equal(f.store.getHomeGameCard('staged-x'),null,'all evidence stays private before publication');
 batch.commit();assert.equal(f.store.getHomeGameCard('staged-x').eventSeq,2);assert.equal(f.store.getHomeGameCard('staged-x').moveCount,2);
});

test('completed continued membership churn refuses the whole real batch and preserves cache and focus without an automatic loop',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
 const before=JSON.stringify(f.h.sections()),cached=['my','completed','other'].map(key=>f.store.getHomeGameCard(`${key}-cached`));
 const focus={sectionKey:'completed',gameId:'completed-cached'};f.context.retainedFocus=focus;
 vm.runInContext('homeFocusToRestore=retainedFocus',f.context);
 let myReads=0;
 f.respond(({section})=>Response.json({...pageBody(section,`${section}-churn`,1),games:[{...card(`${section}-churn`,section==='my'?++myReads:1),eventSeq:section==='my'?myReads:1,gameplayRevision:section==='my'?myReads:1}]}));
 await assert.rejects(f.h.sync(),{code:'home_list_changed'});
 assert.equal(f.calls.length,5,'three initial sections and one bounded two-section freshness repair');
 assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.h.recovery().error.code,'home_list_changed');
 for(const [index,key] of ['my','completed','other'].entries()){
  assert.deepEqual(f.store.getHomeGameCard(`${key}-cached`),cached[index]);assert.equal(f.store.getHomeGameCard(`${key}-churn`),null);
 }
 assert.equal(vm.runInContext('homeFocusToRestore',f.context),focus);assert.equal(f.events.length,0);assert.equal(f.h.active(),false);
 t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,5,'manual global recovery cannot restart itself');
 assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
});


// A responsive callback can run while the original full Home read is in its
// existing 500ms retry delay, without changing any of that read's inputs.
function clearHomePages(f){
 const sections=f.h.sections();
 for(const section of Object.values(sections))Object.assign(section,{loaded:false,gameIds:[],serverPageGameIds:[],serverPageGameIdsByPage:{},totalGames:0,totalPages:0});
 f.h.seed(sections);
}
test('initial503 responsive stabilization waits the original Home read and preserves its partial recovery',async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);f.changeColumnsBeforeScheduling(2);
 t.mock.timers.enable({apis:['setTimeout']});
 f.respond(({section})=>section==='completed'?Response.json({error:'temporary_unavailable'},{status:503}):Response.json(pageBody(section,section+'-new',1)));
 const work=observe(f.h.sync());await flush();
 assert.equal(f.calls.filter(x=>x.section==='completed').length,1);assert.ok(f.h.recovery());
 f.h.scheduleResponsive();f.flushScheduledFrames();await flush();
 t.mock.timers.tick(500);await flush();
 await assert.doesNotReject(work,'Responsive stabilization must not retire the initial delayed Home job');
 assert.equal(f.h.sections().completed.error,true);assert.equal(f.h.sections().my.gameIds[0],'my-new');
 assert.equal(f.h.active(),false);assert.equal(f.h.readState().lastError,undefined);assert.equal(f.writes.length,0);
});

async function delayedPartialHome(t,{authEnabled=false,failEverySection=false}={}){
 const f=await fixture(t,{seed:false,authEnabled});clearHomePages(f);f.changeColumnsBeforeScheduling(2);
 t.mock.timers.enable({apis:['setTimeout']});let healthy=false;
 f.respond(({section})=>!healthy&&(failEverySection||section==='completed')?Response.json({error:'temporary_unavailable'},{status:503}):Response.json(pageBody(section,section+'-new',1)));
 return{f,allowSuccess:()=>{healthy=true;}};
}
function scheduleActualResponsive(f){f.h.scheduleResponsive();f.flushScheduledFrames();return f.responsiveWorks.at(-1);}
test('Home settlement partial success releases background wait without a third read and manual Retry remains explicit',async t=>{
 const{f,allowSuccess}=await delayedPartialHome(t);const work=observe(f.h.sync());await flush();const settled=f.h.settlement();
 scheduleActualResponsive(f);await flush();assert.equal(f.calls.filter(x=>x.section==='completed').length,1,'Background preserves original delay');assert.equal(f.h.pendingRefresh(),true);
 t.mock.timers.tick(500);await work;await flush();assert.equal(await settled,'fulfilled');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.h.sections().completed.error,true);
 const calls=f.calls.length;f.flushScheduledFrames();await flush();assert.equal(f.calls.length,calls,'Partial initial publication does not create a third full read');
 allowSuccess();await f.h.retrySection({getAttribute:()=> 'completed'});await flush();assert.equal(f.h.sections().completed.error,null);assert.equal(f.h.sections().completed.gameIds[0],'completed-new');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.h.readState().lastError,undefined);assert.equal(f.writes.length,0);
});
test('Home settlement healthy initial publication satisfies the waiting refresh without a redundant batch',async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);f.changeColumnsBeforeScheduling(2);const gate=deferred();
 f.respond(({section})=>gate.promise.then(()=>Response.json(pageBody(section,section+'-new',1))));const work=observe(f.h.sync());await flush();const settled=f.h.settlement();scheduleActualResponsive(f);await flush();assert.equal(f.calls.length,3);
 gate.resolve();await work;const ownReadCalls=f.calls.length;await flush();assert.equal(await settled,'fulfilled');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.calls.length,ownReadCalls,'No background batch after the initial legitimate bounded revision repair');assert.equal(f.h.readState().lastError,undefined);
});
test('Home settlement terminal initial failure releases background wait without another attempt or swallowed error',async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);f.changeColumnsBeforeScheduling(2);t.mock.timers.enable({apis:['setTimeout']});const gate=deferred();
 f.respond(({section})=>section==='completed'?gate.promise:Response.json(pageBody(section,section+'-new',1)));const work=observe(f.h.sync());await flush();const settled=f.h.settlement();scheduleActualResponsive(f);await flush();
 gate.resolve(Response.json({error:'invalid_credentials'},{status:401}));await assert.rejects(work,{code:'invalid_credentials'});await flush();assert.equal(await settled,'failed');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.h.active(),false);assert.equal(f.calls.length,3);
 t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,3);assert.equal(f.writes.length,0);
});
test('Home settlement exhausted original retry releases wait and grants no extra automatic cycle',async t=>{
 const{f}=await delayedPartialHome(t,{failEverySection:true});const work=observe(f.h.sync());await flush();const settled=f.h.settlement();scheduleActualResponsive(f);await flush();assert.equal(f.calls.length,3);
 const rejected=assert.rejects(work,/temporary_unavailable/);t.mock.timers.tick(500);await rejected;await flush();assert.equal(await settled,'failed');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.calls.length,6);assert.equal(f.h.active(),false);
 t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,6);assert.equal(f.writes.length,0);
});
for(const change of['account','transport','route'])test(`Home settlement waiting background refresh retains the true ${change} fence`,async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);f.changeColumnsBeforeScheduling(2);const held=[];
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});const work=observe(f.h.sync());await flush();const settled=f.h.settlement();const responsive=scheduleActualResponsive(f);await flush();assert.equal(f.h.pendingRefresh(),true);
 f.change(change);assert.equal(await settled,'retired');for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete',1)));
 await assert.rejects(work,{code:'session_changed'});await assert.rejects(responsive,{code:'session_changed'});await flush();assert.equal(f.h.pendingRefresh(),false);assert.equal(f.calls.length,3);assert.equal(f.store.getHomeGameCard('obsolete'),null);assert.equal(f.writes.length,0);assert.equal(f.h.readState().lastError,undefined);
});
test('Home settlement retired wait cannot displace a newer full read and must finish before replacement completion',async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);f.changeColumnsBeforeScheduling(2);const held=[];
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});const old=observe(f.h.sync());await flush();const settled=f.h.settlement();const responsive=scheduleActualResponsive(f);await flush();
 f.setColumns(3);const newer=observe(f.h.sync());await flush();assert.equal(await settled,'retired');const fresh=held.slice(3);assert.equal(fresh.length,3);assert.equal(f.h.active(),true);assert(fresh.every(x=>!x.signal.aborted));
 for(const request of held.slice(0,3))request.resolve(Response.json(pageBody(request.section,'obsolete',1)));await assert.rejects(old,{code:'session_changed'});await assert.rejects(responsive,{code:'session_changed'});await flush();assert.equal(f.h.active(),true);assert.equal(f.h.pendingRefresh(),false);
 for(const request of fresh)request.resolve(Response.json(pageBody(request.section,request.section+'-fresh',1)));await newer;await flush();assert.equal(f.h.sections().my.gameIds[0],'my-fresh');const ownReadCalls=f.calls.length;f.flushScheduledFrames();await flush();assert.equal(f.calls.length,ownReadCalls,'Only the replacement owns its bounded revision repair');assert.equal(f.h.pendingRefresh(),false);assert.equal(f.h.readState().lastError,undefined);
});
test('Home settlement background wait preserves failed account continuation until a deliberate retry without replay',async t=>{
 const{f,allowSuccess}=await delayedPartialHome(t,{authEnabled:true});const work=f.h.continue({hash:'#/',action:'create-self-play'});await flush();const settled=f.h.settlement();scheduleActualResponsive(f);await flush();
 t.mock.timers.tick(500);await work;await flush();assert.equal(await settled,'failed');assert.equal(f.h.pendingRefresh(),false);assert(f.h.pending());assert.equal(f.clicks(),0);assert.equal(f.writes.length,0);const calls=f.calls.length;t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,calls);
 allowSuccess();await f.h.retry();await flush();assert.equal(f.h.pending(),null);assert.equal(f.clicks(),0);assert.equal(f.writes.length,0);assert.equal(f.h.pendingRefresh(),false);
});


test('controlled responsive ownership retains the actual production foreign rejection',async t=>{
 const f=await fixture(t,{seed:false,authEnabled:false});clearHomePages(f);
 const held=[];f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
 f.changeColumnsBeforeScheduling(2);
 const responsive=scheduleActualResponsive(f);await flush();
 f.change('account');
 for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete',1)));
 await assert.rejects(responsive,{code:'session_changed'});
 assert.equal(f.writes.length,0);assert.equal(f.h.sections().my.gameIds.length,0);
});


test('an owned responsive continuation replacement retires the old attempt and replays its unchanged choice once',async t=>{
 const f=await fixture(t),held=[];
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
 const original=observe(f.h.continue({hash:'#/',action:'create-self-play'}));
 await flush();const old=f.h.pending();assert.equal(old.running,true);assert.equal(held.length,3);
 f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
 const replacement=f.h.pending();assert.notEqual(replacement,old);assert.equal(replacement.intent,old.intent);
 assert.equal(old.running,true,'old completion retains its own identity');
 f.flushScheduledFrames();await flush();assert.equal(held.length,6);
 for(const request of held.slice(3))request.resolve(Response.json(pageBody(request.section)));
 await original;await flush();
 assert.equal(f.clicks(),1);assert.equal(f.h.pending(),null);assert.equal(f.writes.length,0);
 for(const request of held.slice(0,3))request.resolve(Response.json(pageBody(request.section,'obsolete')));
 await flush();assert.equal(f.clicks(),1,'late old work cannot replay or poison the new owner');
});


test('an owned responsive handoff after a real failed Home attempt retains recovery and never replays the action',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
 f.respond(()=>Response.json({error:'temporary_unavailable'},{status:503}));
 const old=observe(f.h.continue({hash:'#/',action:'create-self-play'}));await flush();
 assert.ok(f.h.recovery(),'the actual Home reader observed the original failure');
 const first=f.h.pending();f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
 const replacement=f.h.pending();assert.notEqual(replacement,first);assert.equal(replacement.intent,first.intent);
 assert.equal(replacement.recoveryEpisode,true);
 f.respond(({section})=>Response.json(pageBody(section)));f.flushScheduledFrames();await old;await flush();
 assert.equal(f.h.pending(),null);assert.equal(f.clicks(),0);assert.equal(f.writes.length,0);
});


test('the continuation owns its render-before-read layout change without issuing an extra batch',async t=>{
 const f=await fixture(t);let changed=false,batches=0;
 const createBatch=f.context.transport.createHomeRead;
 f.context.transport.createHomeRead=(...args)=>{batches++;return createBatch(...args);};
 f.onRender(()=>{if(!changed){changed=true;f.changeColumnsBeforeScheduling(2);}});
 f.respond(({section})=>Response.json(pageBody(section)));
 await f.h.continue({hash:'#/',action:'create-self-play'});
 assert.equal(f.clicks(),1);assert.equal(f.h.pending(),null);assert.equal(batches,1);
 assert.deepEqual(f.calls.map(call=>call.section),['my','completed','other','my','completed'],'one owned transaction includes the existing bounded membership repair');
 assert.equal(f.writes.length,0);
});
for(const kind of ['page','visit','account','transport','route'])test(`an owned render cannot carry an old continuation across a foreign ${kind} choice`,async t=>{
 const f=await fixture(t);let changed=false;
 f.onRender(()=>{if(changed)return;changed=true;if(kind==='page')f.h.changePage('my',1);else if(kind==='visit')f.h.noteVisit({});else f.change(kind);});
 f.respond(({section})=>Response.json(pageBody(section)));
 await f.h.continue({hash:'#/',action:'create-self-play'});
 assert.equal(f.clicks(),0);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
});
test('a current full read can fulfill the replacement continuation without a third batch',async t=>{
 const f=await fixture(t),held=[];let batches=0;
 const createBatch=f.context.transport.createHomeRead;
 f.context.transport.createHomeRead=(...args)=>{batches++;return createBatch(...args);};
 f.respond(request=>{const wait=deferred();held.push({...request,...wait});return wait.promise;});
 const old=observe(f.h.continue({hash:'#/',action:'create-self-play'}));await flush();
 f.changeColumnsBeforeScheduling(2);f.h.scheduleResponsive();
 f.respond(({section})=>Response.json(pageBody(section)));
 await f.h.sync();await old;
 f.flushScheduledFrames();await flush();
 assert.equal(f.clicks(),1);assert.equal(f.h.pending(),null);assert.equal(batches,2,'only the retired transaction and its owned replacement');
 assert.deepEqual(f.calls.map(call=>call.section),['my','completed','other','my','completed','other','my','completed'],'replacement may perform its existing bounded page repair, never a third transaction');
 for(const request of held)request.resolve(Response.json(pageBody(request.section,'obsolete')));await flush();assert.equal(f.clicks(),1);
});
