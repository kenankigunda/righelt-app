import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRouteHydration } from '../shell/route-hydration.js';
import { createIssueDiagnostics } from '../shell/issue-diagnostics.js';
import { parseRouteFromHash, buildHomeHash, buildHashForRoute, FLYOUT_KEYS } from '../shell/routes.js';
import { renderInvitationSurface } from '../shell/invitations.js';
import { invitationLoadFailureKind, renderInviteLoadRecovery } from '../shell/invite-load-recovery.js';

// An explicit immutable old-source copy supports failing-first qualification.
// CI always uses its actual candidate application source.
const source=readFileSync(process.env.RIGHELT_INVITE_RECOVERY_SOURCE || new URL('../shell/app.js',import.meta.url),'utf8');
const extract=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`Missing actual application boundary ${start}`);
  return source.slice(a,b);
};
const routeFunctions=extract(source.includes('const routeReadKey =')?'const routeReadKey =':'const captureRouteRead =','const retryAccountContinuation =');
const routeComparisons=extract('const getBaseRouteRenderKey =','let flyoutRenderOrder =');
const cachedRoute=extract('const canHydrateRouteFromLocalState =','const startRouteSync =');
const routeEvents=extract('window.addEventListener("hashchange"','window.addEventListener("load"');
const passiveDismiss=extract('let utilityCloseFlight = null;', 'appEl.addEventListener("click", async (event) => {');
const syncFunctions=extract('const startRouteSync =','const syncRouteDataPassive =');
const hasRetry=source.includes('  if (action === "retry-invite-load")');
if(!process.env.RIGHELT_INVITE_RECOVERY_SOURCE)assert.ok(hasRetry,'The candidate must expose the actual invitation retry action');
const retryAction=hasRetry?extract('  if (action === "retry-invite-load")','  if (action === "toggle-diagnostic"'):'';
const inviteView=extract('  } else if (currentRoute.name === "invite") {','  } else if (currentRoute.name === "tutorial") {').replace(/^  } else /,'');
const flush=()=>new Promise(setImmediate);
const failure=(code='request_timeout',status)=>Object.assign(new Error(code),{code,...(status?{status}:{})});

function fixture({staleInvite=false}={}) {
  let generation=1,homeLoads=0,channels=0;
  const reads=[],loads=[],renders=[],events={},clicks=[];
  let layout="wide";
  const noop=()=>{};
  const owner={
    resolveInvite(token){return new Promise((resolve,reject)=>reads.push({owner,token,resolve,reject}));},
    async loadGame(gameId){loads.push(gameId);},
    getGameViewModel:gameId=>({id:gameId}),
  };
  const diagnostics=createIssueDiagnostics({schedule:()=>1,environment:()=>({})});
  const context=vm.createContext({
    account:{snapshot:()=>({generation})},transport:owner,currentRoute:parseRouteFromHash('#/invite/first'),
    window:{location:{hash:'#/invite/first'},addEventListener:(name,fn)=>events[name]=fn,history:{replaceState:(_state,_title,hash)=>{context.window.location.hash=hash;}}},parseRouteFromHash,buildHashForRoute,FLYOUT_KEYS,URLSearchParams,hydrateRoute:createRouteHydration(),
    appEl:{querySelectorAll:()=>[{classList:{add:noop}}],addEventListener:(_name,fn)=>clicks.push(fn)},
    joinFeedback:{clear:noop},clearAccountContinuation:noop,closeHeaderMenu:noop,gameSound:{leaveGame:noop,play:noop,cancelPreview:noop},
    inlineProfiles:{close:noop},resultPresentation:{clear:noop},rematchDialog:{close:noop},retireTutorialSave:noop,
    normalizeRouteFlyoutState:route=>layout==='narrow'?{...route,scenarios:false}:route,preparePanelTransition:noop,syncRouteTransitionForCurrentRoute:noop,
    syncFlyoutRenderOrder:noop,getGamePanel:route=>route.panel||'board',getRouteTransitionRenderKey:()=>'',
    getShellLayoutMode:()=>layout,saveDebugFlyoutOpen:noop,storage:{},scheduleGameShellStickyLayout:noop,scheduleResponsiveHomeSectionPageSizes:noop,
    prefersReducedMotion:()=>true,isPassivePageClick:()=>true,accountDialog:{isOpen:()=>false},delay:async()=>{},FLYOUT_MOTION_MS:1,

    getVisibleHomeSectionKeys:()=>[],getHomeSection:()=>{},getHomeSectionVisiblePageSize:()=>0,getHomeSectionColumnCount:()=>1,
    syncHomeSections:async()=>{homeLoads++;},syncLiveChannels:()=>{channels++;},
    invitationLoadFailureKind,issueDiagnostics:diagnostics,render:options=>renders.push(options),maybeRevealRouteTransition:()=>{},
    renderInviteLoadRecovery,renderInvitationSurface,buildHomeHash,getCurrentFlyoutState:()=>({}),
    renderGameViewSkeleton:()=>'<div data-background-board></div>',renderInvitePageSkeleton:()=>'<div data-initial-invite-loading></div>',
    getInviteContextForGame:game=>game?{game}:null,renderInviteLanding:invite=>`<section data-loaded-invitation="${invite.game.id}"></section>`,renderGame:()=>'<section data-generic-game-skeleton></section>',

  });
  const api=new vm.Script(`
    let inviteLoadState=null,resolvedInvite=${staleInvite?"{gameId:'stale-game'}":'null'},routeSyncRequestId=0,routeHydrated=false;
    let hostInvite=null,inviteVisit=0,activeResultGameId=null,pendingResultReviewFocus=null,routeTransition=null,restoreHomePending=false,flyoutRenderOrder=[];
    ${routeComparisons}
    ${cachedRoute}
    ${routeFunctions}
    ${syncFunctions}
    ${routeEvents}
    ${passiveDismiss}
    ({start:startRouteSync,
      retry:()=>{const action='retry-invite-load';${retryAction}},
      snapshot:()=>({inviteLoadState,resolvedInvite,routeHydrated,routeSyncRequestId}),
      view:()=>{let body;${inviteView}} return body;}});

  `).runInContext(context);
  const navigate=hash=>{context.window.location.hash=hash;context.currentRoute=parseRouteFromHash(hash);};
  const adopt=(mode='both')=>{
    if(mode!=='transport')generation++;
    if(mode==='generation')return context.transport;
    const next={...owner,resolveInvite(token){return new Promise((resolve,reject)=>reads.push({owner:next,token,resolve,reject}));}};
    context.transport=next;
    return next;
  };
  return {api,context,owner,reads,loads,renders,diagnostics,navigate,adopt,dispatch:hash=>{if(hash)context.window.location.hash=hash;events.hashchange();},passive:async()=>{clicks[0]({});await flush();},resize:()=>{layout='narrow';events.resize();},homeLoads:()=>homeLoads,channels:()=>channels};
}

test('a failed invitation route offers one fresh manual retry and adopts only its successful result',async()=>{
  const f=fixture();f.api.start();await flush();
  assert.equal(f.reads.length,1);
  f.reads[0].reject(failure());await flush();
  assert.match(f.api.view(),/data-testid="invite-load-recovery"/,'a failed invitation read must expose recovery instead of the generic game skeleton');
  let state=f.api.snapshot();assert.equal(state.routeHydrated,true);assert.equal(state.inviteLoadState.status,'error');assert.equal(state.inviteLoadState.kind,'retry');
  assert.equal(state.resolvedInvite,null);assert.match(f.api.view(),/data-testid="invite-load-recovery"/);assert.doesNotMatch(f.api.view(),/data-generic-game-skeleton/);assert.equal(f.diagnostics.list()[0].initial.code,'request_timeout');
  assert.equal(f.diagnostics.list()[0].initial.operation,'invitation_lookup');
  f.api.retry();f.api.retry();await flush();
  state=f.api.snapshot();assert.equal(f.reads.length,2,'rapid Retry clicks share one actual hydration read');assert.equal(state.inviteLoadState.status,'loading');assert.equal(state.inviteLoadState.retrying,true);
  assert.match(f.api.view(),/disabled aria-busy="true"/);
  f.reads[1].resolve({gameId:'current',inviteToken:'first',inviteFromRole:'Player 1'});await flush();
  state=f.api.snapshot();assert.equal(state.inviteLoadState,null);assert.equal(state.resolvedInvite.gameId,'current');assert.equal(state.routeHydrated,true);assert.deepEqual(f.loads,['current']);
  assert.match(f.api.view(),/data-loaded-invitation="current"/);assert.doesNotMatch(f.api.view(),/invite-load-recovery/);
  assert.ok(f.diagnostics.list()[0].resolvedAt);assert.equal(f.reads.length,2,'there is no automatic retry loop');
});

test('confirmed missing or expired invitations expose Home without issuing another lookup',async()=>{
  for(const status of [404,410]){
    const f=fixture();f.api.start();await flush();f.reads[0].reject(failure(`HTTP_${status}`,status));await flush();
    const state=f.api.snapshot();assert.equal(state.inviteLoadState.kind,status===404?'unavailable':'expired');assert.equal(state.resolvedInvite,null);
    f.api.retry();await flush();assert.equal(f.reads.length,1);assert.deepEqual(f.loads,[]);
    const html=renderInviteLoadRecovery({kind:state.inviteLoadState.kind});assert.doesNotMatch(html,/retry-invite-load/);assert.match(html,/Home<\/a>/);
  }
});

test('Home remains a safe exit and a late failed lookup cannot restore the recovery surface',async()=>{
  const f=fixture();f.api.start();await flush();f.navigate('#/');f.api.start();await flush();
  assert.equal(f.homeLoads(),1);f.reads[0].reject(failure());await flush();
  assert.equal(f.api.snapshot().inviteLoadState,null);assert.equal(f.api.snapshot().resolvedInvite,null);assert.equal(f.diagnostics.list().length,0);
});

test('old successful and failed lookups cannot follow another token or game',async()=>{
  for(const next of ['#/invite/second','#/game/current'])for(const outcome of ['resolve','reject']){
    const f=fixture();f.api.start();await flush();f.navigate(next);f.api.start();await flush();
    if(outcome==='resolve')f.reads[0].resolve({gameId:'old-game'});else f.reads[0].reject(failure());
    await flush();assert.notEqual(f.api.snapshot().resolvedInvite?.gameId,'old-game');assert.equal(f.diagnostics.list().length,0);
    if(next.includes('/invite/')){f.reads[1].resolve({gameId:'new-game'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'new-game');}
    else assert.equal(f.api.snapshot().resolvedInvite,null);
    assert.equal(f.loads.includes('old-game'),false);
  }
});

test('returning to token A cannot revive its superseded read after an intervening token B',async()=>{
  const f=fixture();f.api.start();await flush();f.navigate('#/invite/second');f.api.start();await flush();f.navigate('#/invite/first');f.api.start();await flush();
  assert.equal(f.reads.length,3);f.reads[0].resolve({gameId:'old-A'});f.reads[1].reject(failure());await flush();
  assert.equal(f.api.snapshot().resolvedInvite,null);assert.equal(f.api.snapshot().inviteLoadState.status,'loading');assert.equal(f.loads.length,0);assert.equal(f.diagnostics.list().length,0);
  f.reads[2].resolve({gameId:'fresh-A'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'fresh-A');assert.deepEqual(f.loads,['fresh-A']);
});

test('an account generation or transport replacement fences late completion on the same URL',async()=>{
  for(const mode of ['generation','transport'])for(const outcome of ['resolve','reject']){
    const f=fixture();f.api.start();await flush();const next=f.adopt(mode);f.api.start();await flush();
    assert.equal(f.reads.length,2);assert.equal(f.reads[1].owner,next);
    if(outcome==='resolve')f.reads[0].resolve({gameId:'retired'});else f.reads[0].reject(failure());await flush();
    assert.equal(f.api.snapshot().resolvedInvite,null);assert.equal(f.diagnostics.list().length,0);
    f.reads[1].resolve({gameId:'owned-by-current'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'owned-by-current');
  }
});

test('a confirmed protocol upgrade retains its validated invitation route for existing recovery UI',async()=>{
  const f=fixture();f.owner.loadGame=async()=>{throw failure('upgrade_required');};f.api.start();await flush();f.reads[0].resolve({gameId:'upgrade-game'});await flush();
  assert.equal(f.api.snapshot().resolvedInvite.gameId,'upgrade-game');assert.equal(f.api.snapshot().inviteLoadState,null);assert.equal(f.api.snapshot().routeHydrated,true);
});

test('semantic navigation through a cached game retires the old invitation flight',async()=>{
  const f=fixture();f.api.start();await flush();f.dispatch('#/game/cached');await flush();
  assert.equal(f.reads.length,1);assert.equal(f.api.snapshot().routeHydrated,true);
  f.dispatch('#/invite/first');await flush();assert.equal(f.reads.length,2);
  f.reads[0].resolve({gameId:'old-A'});await flush();assert.equal(f.api.snapshot().resolvedInvite,null);assert.equal(f.loads.includes('old-A'),false);
  f.reads[1].resolve({gameId:'fresh-A'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'fresh-A');
});

test('Debug and utility hashchange, passive dismissal and resize preserve a settled error without another lookup',async()=>{
  for(const action of ['passive','resize']){
    const f=fixture();f.api.start();await flush();f.reads[0].reject(failure());await flush();
    f.dispatch('#/invite/first?scenarios=1&debug=1');await flush();
    assert.match(f.api.view(),/invite-load-recovery/);assert.equal(f.reads.length,1);
    if(action==='passive')await f.passive();else f.resize();
    assert.equal(f.context.window.location.hash,'#/invite/first');assert.match(f.api.view(),/invite-load-recovery/);assert.equal(f.reads.length,1);
    f.api.retry();f.api.retry();await flush();assert.equal(f.reads.length,2);
    f.reads[1].resolve({gameId:'recovered'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'recovered');
  }
});

test('utility-only navigation preserves one pending invitation GET through real dispatch and passive replaceState',async()=>{
  const f=fixture();f.api.start();await flush();f.dispatch('#/invite/first?scenarios=1');await flush();
  await f.passive();assert.equal(f.reads.length,1);
  f.reads[0].resolve({gameId:'same-invitation'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'same-invitation');assert.deepEqual(f.loads,['same-invitation']);
});

test('a fresh route read clears stale invitation metadata before loading',async()=>{
  const f=fixture({staleInvite:true});f.api.start();await flush();assert.equal(f.api.snapshot().resolvedInvite,null);
  f.reads[0].reject(failure());await flush();assert.equal(f.api.snapshot().resolvedInvite,null);
});


test('changing invitation role or another non-utility input starts a fresh fenced read',async()=>{
  for(const query of ['as=viewer&scenarios=1','revision=2&scenarios=1']){
    const f=fixture();f.api.start();await flush();f.dispatch(`#/invite/first?${query}`);if(f.context.window.location.hash!==`#/invite/first?${query}`)f.dispatch();await flush();assert.equal(f.reads.length,2);
    f.reads[0].resolve({gameId:'old-input'});await flush();assert.equal(f.api.snapshot().resolvedInvite,null);assert.equal(f.loads.includes('old-input'),false);
    f.reads[1].resolve({gameId:'new-input'});await flush();assert.equal(f.api.snapshot().resolvedInvite.gameId,'new-input');
  }
});
