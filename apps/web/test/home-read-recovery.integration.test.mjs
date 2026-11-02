import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createCommandJournal} from '../shell/command-journal.js';
import {createRouteHydration} from '../shell/route-hydration.js';
import {parseRouteFromHash,buildHashForRoute,buildGameHash,FLYOUT_KEYS} from '../shell/routes.js';
import {createInitialState,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
import {classifyWebTestFile} from './test-layers.mjs';

// Execute the actual app routines with controlled browser boundaries, following
// game-render-hydration.integration.test.mjs. No duplicate recovery algorithm.
const source = readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const part = (start,end) => {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing app source boundary: ${start}`);
  return source.slice(a,b);
};
const script = new vm.Script([
  'let accountContinuation=null,accountContinuationError=false,accountContinuationIncidentId=null;',
  part('let homeReadJob = null;','const hydrateRoute ='),
  'let routeHydrated=false,routeSyncRequestId=0,inviteLoadState=null,resolvedInvite=null;',
  part('const createHomeSectionState =','const getPersistedDebugFlyoutOpen ='),
  part('const getVisibleHomeSectionKeys =','const resetRouteWsStatus ='),
  part('const loadHomeSectionServerPage =','const scheduleResponsiveHomeSectionPageSizes ='),
  part('const routeReadKey =','const syncScenarioCatalog ='),
  part('const navigateTo =','let previousLayoutMode ='),
  part('const renderHomeStartButton =','const renderHomeGameSection ='),
  `const explicitStart=(action,actionEl={})=>{${part('  if (action === "create-game" || action === \'create-self-play\') {','  if (action === "launch-history-branch"')}};`,
  `globalThis.home={sync:()=>syncRouteDataAndLiveChannels(),capture:captureRouteRead,noteVisit:observeHomeReadVisit,navigate:navigateTo,
    transitions:()=>({pending:homeReadTransitions.length,trusted:homeReadTransitionsTrusted,visit:homeReadVisit}),
    continue:completeAccountContinuation,retry:retryAccountContinuation,clear:clearAccountContinuation,
    start:explicitStart,startButton:renderHomeStartButton,
    sections:()=>structuredClone(homeSections),
    seed:sections=>{homeSections=structuredClone(sections);},
    changePage:(key,page)=>{setHomeSection(key,{...getHomeSection(key),page});captureRouteRead();},
    recovery:()=>homeReadRecovery,pending:()=>accountContinuation,
    active:()=>Boolean(homeReadJob)};`,
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
const pageBody=(section,id=`${section}-new`,count=7,page=0)=>({ok:true,section,page,pageSize:6,totalGames:count,totalPages:Math.ceil(count/6),games:[card(id,42)]});
const section=(title,id)=>({title,page:0,totalPages:1,totalGames:1,gameIds:[id],serverPage:0,serverTotalPages:1,serverPageGameIds:[id],serverPageGameIdsByPage:{0:[id]},visiblePageSize:1,visibleColumnCount:1,slideDirection:'none',animationToken:3});

async function fixture(t,{journalAdapter,seed=true}={}) {
  const calls=[],writes=[],events=[],creations=[];
  const auth={enabled:true,session:{authenticated:true,account:{id:'reader'},contextId:'a'.repeat(64)}};
  const journal=createCommandJournal({indexedDB:new IDBFactory(),databaseName:'home-read-fixture'});
  const durable=journalAdapter?journalAdapter(journal):journal;
  let responder=async({section})=>Response.json(pageBody(section,`${section}-cached`,1));
  const game=snapshot();
  const store=createLiveTransportStore({storage:memory(),auth,commandJournal:durable,shouldDeferCommandSend:()=>true,
    fetcher:async(url,init={})=>{
      if(init.method==='POST'){writes.push({url,body:JSON.parse(init.body)});return Response.json({ok:true,protocolVersion:2,eventSeq:1,game});}
      const parsed=new URL(url,'http://fixture');
      if(parsed.pathname==='/api/shell/games'){
        const request={section:parsed.searchParams.get('section'),page:Number(parsed.searchParams.get('page')),signal:init.signal};
        calls.push(request);return responder(request);
      }
      return Response.json({ok:true,protocolVersion:2,eventSeq:1,game});
    }});
  store.subscribe(event=>events.push(event));
  t.after(async()=>{store.retire();await journal.close();});
  if(seed)for(const key of ['my','other'])await store.loadGamesPage({section:key,pageSize:6});
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
  const browser={location,scrollTo(){},addEventListener:(name,handler)=>listeners.set(name,handler)};
  let generation=1,pageSize=1,columnCount=1,clicks=0,renders=0,refreshes=0;
  const context=vm.createContext({structuredClone,URL,URLSearchParams,SYNC_TIMING,createRouteHydration,
    hydrateRoute:createRouteHydration(),window:browser,currentRoute:parseRouteFromHash('#/'),transport,
    account:{snapshot:()=>({generation}),canPlay:()=>true},
    parseRouteFromHash,buildHashForRoute,FLYOUT_KEYS,HOME_SECTION_SERVER_PAGE_SIZE:6,HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT:1,
    getHomeSectionVisiblePageSize:()=>pageSize,getHomeSectionColumnCount:()=>columnCount,
    setTimeout:(...args)=>setTimeout(...args),clearTimeout:(...args)=>clearTimeout(...args),
    render:()=>{renders++;},syncLiveChannels:()=>{},gameSound:{play(){},leaveGame(){},cancelPreview(){}},
    issueDiagnostics:{capture:()=> 'fixture-incident',resolve(){}},
    storyDialog:{refresh:()=>{refreshes++;},open(){},close(){}},
    appEl:{querySelector:()=>({click:()=>{clicks++;}})},CSS:{escape:value=>value},
    getGameResult:()=>null,rematchDialog:{open(){},close(){}},startGameEntryRouteTransition(){},
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
  script.runInContext(context);
  const h=context.home;
  h.seed({my:section('My games','my-cached'),other:section('Other games','other-cached'),smoke:section('Deploy smoke player','smoke-cached')});
  return{h,store,journal,auth,calls,writes,events,creations,context,hashEvents,
    onHashWrite:probe=>{hashWriteProbe=probe;},
    deliver:event=>listeners.get('hashchange')(event),
    deliverNext:()=>{const event=hashEvents.shift();assert.ok(event,'queued hashchange');listeners.get('hashchange')(event);return event;},
    browserNavigate:hash=>{browser.location.hash=hash;},
    respond:fn=>{responder=fn;},clicks:()=>clicks,renders:()=>renders,refreshes:()=>refreshes,
    change(kind){if(kind==='account')generation++;if(kind==='route'){browser.location.hash='#/game/created';context.currentRoute={name:'game',gameId:'created'};}
      if(kind==='transport')context.transport={...transport};if(kind==='inputs')pageSize=2;h.capture();},
    setColumns:value=>{columnCount=value;h.capture();},
    setPageSize:value=>{pageSize=value;h.capture();},
  };
}

test('Home recovery is registered as integration coverage',()=>{
  assert.equal(classifyWebTestFile('home-read-recovery.integration.test.mjs'),'integration');
});

test('a changed section/card remains private while the other section is held, then both publish together',async t=>{
  const f=await fixture(t),held=deferred();
  const before=JSON.stringify(f.h.sections()),old=f.store.getHomeGameCard('my-cached');
  f.respond(({section})=>section==='my'?Response.json(pageBody('my')):held.promise);
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
  f.respond(({section})=>retry?Response.json(pageBody(section)):section==='my'?Response.json(pageBody('my')):failure.promise);
  const work=observe(f.h.sync());await flush();failure.resolve(Response.json({error:'temporarily_unavailable'},{status:503}));await flush();
  const episode=f.h.recovery();assert.ok(episode);assert.equal(JSON.stringify(f.h.sections()),before);
  assert.equal(f.store.getHomeGameCard('my-new'),null);assert.equal(f.calls.length,2);
  t.mock.timers.tick(499);await flush();assert.equal(f.calls.length,2);
  retry=true;t.mock.timers.tick(1);await work;
  assert.equal(f.calls.length,4);assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
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
  assert.equal(f.calls.length,4);assert.equal(f.h.recovery(),episode);assert.equal(episode.error.code,'request_timeout');
  assert.equal(JSON.stringify(f.h.sections()),before);assert.ok(f.store.getHomeGameCard('my-cached'));
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,4);assert.equal(f.h.active(),false);
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
  assert.equal(f.calls.length,2);assert.equal(JSON.stringify(f.h.sections()),before);
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
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,2);
  assert.equal(JSON.stringify(f.h.sections()),before);assert.ok(f.h.recovery().error);assert.equal(f.writes.length,0);
});

test('network rejection gets exactly one retry with a fresh abort controller',async t=>{
  const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});let retry=false;
  f.respond(({section})=>{if(!retry)throw new TypeError('Failed to fetch');return Response.json(pageBody(section));});
  const work=observe(f.h.sync());await flush();assert.equal(f.calls.length,2);
  const first=f.calls.map(call=>call.signal);assert.ok(first.every(signal=>signal.aborted));
  retry=true;t.mock.timers.tick(500);await work;assert.equal(f.calls.length,4);
  assert.ok(f.calls.slice(2).every(call=>!first.includes(call.signal)));assert.equal(f.writes.length,0);
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
  const work=observe(f.h.sync());await flush();assert.equal(f.calls.length,4);
  assert.equal(JSON.stringify(f.h.sections()),before);assert.equal(f.store.getHomeGameCard('my-6'),null);
  held.resolve(Response.json({...pageBody('other',undefined,9,1),games:[6,7,8].map(n=>card(`other-${n}`))}));await work;
  for(const key of ['my','other']){
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
  assert.ok(f.store.getHomeGameCard('my-new'));assert.equal(f.calls.length,2);
  t.mock.timers.tick(50000);await flush();assert.equal(f.calls.length,2);assert.equal(f.h.recovery(),null);assert.equal(f.writes.length,0);
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
  for(const key of ['my','other'])assert.equal(f.store.getHomeGameCard(`${key}-${label}`),null);
  assert.equal(f.writes.length,0);assert.equal(f.clicks(),0);
};

test('actual navigateTo away/back retires before mutation and old completion before event delivery cannot publish',async t=>{
  const f=await fixture(t),pending=holdHomePages(f),before=JSON.stringify(f.h.sections());
  const old=observe(f.h.sync());await flush();assert.equal(pending.length,2);
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
  assert.ok(f.h.active());assert.ok(freshPages.every(request=>!request.signal.aborted));assert.equal(f.calls.length,4);
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshPages,'fresh');await fresh;await flush();
  for(const key of ['my','other']){
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
  const freshPages=holdHomePages(f),fresh=observe(f.h.sync());await flush();const freshOwned=freshPages.slice();assert.equal(freshOwned.length,2);
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
  assert.equal(f.h.transitions().visit,visit);assert.equal(f.h.transitions().pending,0);assert.equal(f.calls.length,2);
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
  releaseHomePages(oldPages,'obsolete');releaseHomePages(freshPages.slice(0,2),'obsolete');await flush();
  assertNoOldPublication(f,before);assert.ok(freshPages.slice(0,2).every(request=>request.signal.aborted));
});
