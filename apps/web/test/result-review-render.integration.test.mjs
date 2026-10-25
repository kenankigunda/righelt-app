import {playerDisplayName} from '../shell/perspective-labels.js';
import {canReadAdditionalHistory} from '../shell/additional-history.js';
import {renderHistorySlots} from '../shell/panel-loading.js';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getGameResult } from "../shell/game-result.js";
import {historyActorLabel} from '../shell/perspective-labels.js';
import { participantName, participantDisplayName } from "../shell/public-profile.js";
import { createRenderGestureGate } from "../shell/render-gesture.js";
import { renderResultMark, createResultPresentation } from '../shell/result-presentation.js';
import { icon } from '../shell/ui.js';
import { createLiveTransportStore } from '../shell/live-transport.js';

const source = readFileSync(new URL("../shell/app.js", import.meta.url), "utf8");
const extract = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `render source boundaries: ${start}`);
  return source.slice(from, to);
};
// Exercise the actual shell decisions, not a second implementation of the guard.
const patchHelper = extract("const shouldPatchMountedFlyouts =", "const syncRenderedMarkupSnapshot =");
const patchDecision = extract("  const shouldPatchFlyoutsOnly =", "  const previousPanelHeights =");
const reviewAction = extract('  if (action === "analysis")', '  if (action === "rematch")');

function harness({ resultMounted = true, activeResult = null } = {}) {
  class Element {}
  let mountedPanel = "board";
  const appEl = new Element();
  appEl.querySelector = selector => selector === ".game-result" ? (resultMounted ? new Element() : null) : new Element();
  const context = {
    resultPresentation:createResultPresentation(),
    HTMLElement: Element, appEl, currentRoute: { name: "game", gameId: "g", panel: "board" },
    activeResultGameId: activeResult,
    lastRenderedRouteKey: "g|board|debug:false", lastRenderedBaseRouteKey: "g", lastRenderedTransitionPhaseKey: "idle",
    getGamePanel: () => context.currentRoute.panel,
    getMountedGameShellRoot: () => ({querySelector:()=>({getAttribute:()=>mountedPanel})}),
    getRouteTransitionPhaseKey: () => "idle", getMountedShellPageEl: () => new Element(),
    getBaseRouteRenderKey: () => context.currentRoute.gameId,
    getRouteRenderKey: () => `${context.currentRoute.gameId}|${context.currentRoute.panel}|debug:${Boolean(context.currentRoute.debug)}`,
  };
  runInNewContext(`${patchHelper}
    globalThis.decide = () => {
      const hadResultView = Boolean(appEl.querySelector(".game-result"));
      const routeKey = getRouteRenderKey(), baseRouteKey = getBaseRouteRenderKey();
      ${patchDecision}
      return shouldPatchFlyoutsOnly;
    };
    globalThis.review = () => { const action = "analysis", actionGameId = "g"; ${reviewAction} };
  `, context);
  const jobs = new Map(), decisions = [];
  let id = 0;
  const renderContent = () => {
    const patch = context.decide();
    decisions.push(patch);
    // A flyout-only patch keeps main content; a full render mounts the game.
    if (!patch && context.activeResultGameId === null) resultMounted = false;
    context.lastRenderedRouteKey = context.getRouteRenderKey();
    mountedPanel = context.currentRoute.panel;
  };
  const gate = createRenderGestureGate({ render: renderContent, schedule: fn => { jobs.set(++id, fn); return id; }, cancel: key => jobs.delete(key) });
  context.render = () => { if (!gate.defer({ includeBoard: true })) renderContent(); };
  context.buildGameHash = (_id, _move, state) => state.panel;
  context.getCurrentGameHashState = panel => ({ panel });
  context.navigateTo = panel => { context.currentRoute.panel = panel; context.render(); };
  return { context, gate, decisions, mountedResult: () => resultMounted,
    flush() { for (const fn of jobs.values()) fn(); jobs.clear(); } };
}

test("terminal result review replaces main content when hashchange precedes gesture flush", () => {
  const h = harness({ activeResult: "g" });
  h.gate.begin(); h.gate.end();
  h.context.review(); // actual analysis handler; hashchange is delivered before timer flush
  assert.equal(h.context.currentRoute.panel, "history");
  assert.deepEqual(h.decisions, [], "gesture still retains the clicked control");
  assert.equal(h.mountedResult(), true);
  h.flush();
  assert.deepEqual(h.decisions, [false], "review must render the game, not patch only flyouts");
  assert.equal(h.mountedResult(), false);
  h.gate.destroy();
});

test("only true flyout changes retain flyout-only patching; panel changes refresh game content", () => {
  const flyout = harness({ resultMounted: false });
  flyout.context.currentRoute.debug = true;
  assert.equal(flyout.context.decide(), true);
  const game = harness({ resultMounted: false });
  game.context.currentRoute.panel = "history";
  assert.equal(game.context.decide(), false);
  const result = harness({ activeResult: "g" });
  result.context.currentRoute.panel = "history";
  assert.equal(result.context.decide(), false);
});

// An acknowledged undo can reopen a completed game while its result is visible.
test("authoritative terminal rollback clears result state so the board can remount", () => {
  const reconcile = extract("    if (activeResultGameId === currentRoute.gameId && confirmed?.board", "    if(resultTransitions.observe");
  for (const status of ["ongoing", "p1_win", "draw"]) {
    const context = {activeResultGameId:"g", currentRoute:{gameId:"g"}, confirmed:{board:{state:{outcome:{status}}}}, transport:{getIdentityId:()=>"me"},getGameResult:game=>game.board.state.outcome.status === "ongoing" ? null : {title:"Finished"}};
    runInNewContext(reconcile, context);
    assert.equal(context.activeResultGameId,status === "ongoing" ? null : "g");
  }
});

test("optimistic terminal state cannot expose a result or open it before confirmation", () => {
  const optimistic = {id:"g",board:{state:{outcome:{status:"p1_win"}}},player1:{identityId:"me"}};
  let confirmed = {...optimistic,board:{state:{outcome:{status:"ongoing"}}}};
  const context = {canReadAdditionalHistory,account:{snapshot:()=>({enabled:false})},renderHistorySlots,renderResultMark,playerDisplayName,resultPresentation:createResultPresentation(),additionalHistory:{snapshot:()=>({metadata:true,available:false,loaded:false,items:[]})}, getGameResult, transport:{getIdentityId:()=>"me",getAuthoritativeGame:()=>confirmed},escapeHtml:value=>String(value),formatDisplayGameId:value=>value,icon,renderTurnHistory:()=>"",participantName,participantDisplayName,render:()=>{},activeResultGameId:null};
  runInNewContext(`${extract("const renderResult =", "const renderGame =")}
    ${extract("const renderAdditionalHistory =", "const renderHistoryPanel =")}
    ${extract("const renderHistoryPanel =", "const renderBoardPanel =")}
    globalThis.result = renderResult;globalThis.history = renderHistoryPanel;
    globalThis.openResult = () => {const action="view-result", actionGameId="g";${extract('  if (action === "view-result")','  if (action === "analysis")')}};`,context);
  assert.equal(context.result(optimistic),"");
  assert.doesNotMatch(context.history(optimistic),/data-action="view-result"/);
  context.openResult();assert.equal(context.activeResultGameId,null);
  confirmed=optimistic;
  assert.match(context.result(optimistic),/>You won</);
  assert.match(context.result(optimistic),/<a[^>]+href="#\/">[\s\S]*?<svg[^>]+aria-hidden="true"[^>]+focusable="false"[\s\S]*?<\/svg>Home<\/a>/);
  assert.match(context.history(optimistic),/data-action="view-result"/);
  context.openResult();assert.equal(context.activeResultGameId,"g");
});

test("computer seats have distinct human, watch, history and result labels despite shared authority", () => {
  const person = {identityId:'me', profile:{username:'owner', displayName:'Owner'}};
  const game = {id:'g', player1:person, player2:{...person, computerProfile:'babs'}, selfPlayMode:true, computer:{seats:{p1:null,p2:'babs'},manual:false}, board:{state:{outcome:{status:'p1_win'}}}, moves:[]};
  const context = {canReadAdditionalHistory,account:{snapshot:()=>({enabled:false})},renderHistorySlots,renderResultMark,playerDisplayName,isPlayerRole:role=>['Player 1','Player 2'].includes(role),escapeHtml:String,participantName,participantDisplayName,getGameResult,transport:{getIdentityId:()=> 'me',getAuthoritativeGame:()=>game},additionalHistory:{snapshot:()=>({metadata:true,available:false,loaded:false,items:[]})},formatDisplayGameId:String,icon:()=>'',renderTurnHistory:()=>`<li data-testid="history-move-item">${historyActorLabel(game,{actorSide:'P2'},{identityId:'me'})} · Move 1: Pass</li>`};
  runInNewContext(`${extract('const playerToneClassForSeat =','const renderConnectionStatusIcon =')}
    ${extract('const renderResult =','const renderGame =')}
    ${extract('const renderAdditionalHistory =','const renderHistoryPanel =')}
    ${extract('const renderHistoryPanel =','const renderBoardPanel =')}
    globalThis.role = renderRoleLabel; globalThis.result = renderResult; globalThis.history = renderHistoryPanel;`, context);
  assert.match(context.role('Player 1', game), />Player 1</);
  assert.match(context.role('Player 1', {...game,player1:{...person,computerProfile:'tau'},player2:person}), />Player 2</);
  assert.match(context.role('Player 1', {...game,player1:{...person,computerProfile:'tau'}}), /watching computers/);
  assert.match(context.role('Viewer', game), />Viewer</);
  assert.match(context.role('Player 1', {...game,player2:person}), /both players/);
  assert.match(context.result(game), /<bdi dir="auto">Owner<\/bdi> vs <bdi dir="auto">Babs<\/bdi>/);
  const history = context.history(game);
  assert.match(history, /history-move-item">Babs · Move 1/);
  assert.doesNotMatch(history, /history-player-names|history-player-name|>Owner<|Computer/);
});

test("retained historical turns keep an exit even after undo removes the live turn", () => {
  const context = {icon,escapeHtml:String,getControlSeatForTurn:(_state,seat)=>seat,
    playerToneClassForSide:()=>"",playerToneClassForSeat:()=>"",formatClientDateTime:String,expandedUndoneGroups:new Set()};
  runInNewContext(`${extract("const renderTurnHistory =", "const renderHeader =")}\n globalThis.history = renderTurnHistory;`, context);
  for (const turns of [[], [{index:0,playerSeat:"Player 1",moveIndexes:[]}]]) {
    const game={id:"retained",currentTurn:{index:2,playerSeat:"Player 1"},turns,moves:[],inHistoryMode:true,historyIndex:1};
    assert.match(context.history(game), /data-testid="history-return-live"/);
    assert.doesNotMatch(context.history({...game,inHistoryMode:false}), /data-testid="history-return-live"/);
  }
});

test('actual result renderer affiliates victory with the authoritative winning side',()=>{
 for(const [winner,identity]of[['p1','red'],['p2','blue']]){
  const game={id:'g',player1:{identityId:'red'},player2:{identityId:'blue'},currentTurn:{playerSeat:winner==='p1'?'Player 2':'Player 1'},board:{state:{sideToMove:winner==='p1'?'P2':'P1',pieces:[{id:winner==='p1'?'C1':'C2',supplied:true}],outcome:{status:`${winner}_win`,reason:winner==='p1'?'p2_commander_destroyed':'p1_commander_destroyed'}}}};
  const context={game,renderResultMark,getGameResult,playerDisplayName,transport:{getIdentityId:()=>identity,getAuthoritativeGame:()=>game},escapeHtml:String,formatDisplayGameId:String,icon,participantName,participantDisplayName};
  runInNewContext(`${extract('const renderResult =','const renderGame =')};globalThis.output=renderResult(game);`,context);
  assert.match(context.output,new RegExp(`data-result-tone="victory" data-winner="${winner}"`));
  assert.match(context.output,/>You won<\/h1>/);assert.match(context.output,/Your opponent’s commander was destroyed/);
  const actions=[...context.output.matchAll(/<button([^>]*)data-action="(analysis|rematch)"[^>]*>/g)];
  assert.equal(actions.length,2);for(const action of actions)assert.doesNotMatch(action[1],/secondary/);
  assert.equal(getGameResult(game,identity).rematchSide,winner==='p1'?'p2':'p1');
 }
});

function historyRouteHarness(t) {
  class Element { constructor() { this.innerHTML=''; } }
  const history=new Element(),shell=new Element(),main=new Element(),tab=new Element();
  let mountedPanel='history',historyPatches=0,flyoutPatches=0;
  tab.getAttribute=()=>mountedPanel;
  shell.getAttribute=()=> 'g';
  shell.querySelector=selector=>selector==='[data-game-panel="history"]'?history:selector.includes('aria-pressed="true"')?tab:null;
  const appEl=new Element();appEl.querySelector=()=>main;
  const snapshot=index=>({pieces:[],sideToMove:'P1',turnIndex:index});
  const transport=createLiveTransportStore({storage:{getItem:()=> 'actor',setItem(){}},fetcher:()=>{throw Error('History is cached; no request is needed');}});
  transport.applyLiveGameUpdate({game:{id:'g',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:1,
    board:{state:snapshot(2)},currentSnapshot:snapshot(2),turns:[{index:2,playerSeat:'Player 1',moveIndexes:[]}],
    moves:[0,1].map(index=>({index,moveId:`m${index}`,snapshot:snapshot(index),selectionSnapshot:snapshot(index),notation:'MOVE',at:'2026-01-01'}))}});
  transport.selectHistoryMove({gameId:'g',moveIndex:0});
  const noop=()=>{};
  const context={HTMLElement:Element,appEl,transport,currentRoute:{name:'game',gameId:'g',panel:'history'},
    lastRenderedRouteKey:'g|history|debug:false',lastRenderedBaseRouteKey:'g',lastRenderedTransitionPhaseKey:'idle',
    activeResultGameId:null,mountedBoardGameId:null,FLYOUT_KEYS:[],
    getGamePanel:route=>(route??context.currentRoute).panel,
    getRouteRenderKey:()=>`g|${context.currentRoute.panel}|debug:${Boolean(context.currentRoute.debug)}`,
    getBaseRouteRenderKey:()=> 'g',getRouteTransitionPhaseKey:()=> 'idle',
    getMountedGameShellRoot:()=>shell,getMountedShellPageEl:()=>main,shouldUseIncrementalGameShell:()=>true,
    window:{location:{origin:'https://local.test',pathname:'/'},scrollY:0,requestAnimationFrame:noop},
    document:{getElementById:()=>null,querySelector:()=>main},
    getCurrentFlyoutState:()=>({}),buildInviteHash:()=>'',
    escapeHtml:String,formatClientDateTime:String,toStableKey:JSON.stringify,
    getControlSeatForTurn:(_state,seat)=>seat,playerToneClassForSide:()=>'',playerToneClassForSeat:()=>'',
    getShellLayoutMode:()=> 'narrow',getShellLayoutModeForRoute:()=> 'narrow',
    expandedUndoneGroups:new Set(),getDecisionDebugState:()=>({items:[],cursor:null}),getGameResult:()=>null,
    renderMiniBoardPreviewRoot:()=>'<div class="mini-board-preview"></div>',
    patchToolHtml:(element,html)=>{element.innerHTML=html;historyPatches++;},
    syncMountedGameShellPanelUi:()=>{mountedPanel=context.currentRoute.panel;},
    updateMountedHeader:noop,updateMountedFlyouts:()=>{flyoutPatches++;},syncFlyoutAwareLinks:noop,syncCopyInviteLinks:noop,
    updateHeaderFields:noop,reconcileMiniBoardPreviews:noop,animateHomeSectionTransitions:noop,syncScenarioAuthoringControls:noop,
    scheduleGameShellStickyLayout:noop,syncShellLayoutMode:noop,applySharedMutationGates:noop,mountBoardForGame:noop,
    syncRenderedMarkupSnapshot:()=>{context.lastRenderedRouteKey=context.getRouteRenderKey();},
    viewingIntent:{saveScroll:noop,cancelUndo:noop,scrollTop:()=>0},replayRequests:{cancel:noop},replayController:null,mobileNavigation:null,
  };
  runInNewContext(`
    ${patchHelper}
    ${extract('const preparePanelTransition =','const getCurrentFlyoutState =')}
    ${extract('const renderTurnHistory =','const renderHeader =')}
    ${extract('const renderHistoryPanel =','const renderBoardPanel =')}
    ${extract('const updateMountedGameShell =','const doesMountedFlyoutStateMatchRoute =')}
    globalThis.paintHistory = () => updateMountedGameShell({game:transport.getGameViewModel('g'),includeBoard:false});
    globalThis.prepare = preparePanelTransition;
    globalThis.paint = () => {
      const hadResultView=false,routeKey=getRouteRenderKey(),baseRouteKey=getBaseRouteRenderKey();
      const animatePanels=false,includeBoard=false,restoreScenarioDraftFocus=null;
      ${extract('  const shouldPatchFlyoutsOnly =','  let body = "";')}
      throw Error('The existing game must update incrementally, without replacing its shell');
    };
  `,context);
  const jobs=new Map();let id=0;
  const gate=createRenderGestureGate({render:()=>context.paint(),schedule:fn=>{jobs.set(++id,fn);return id;},cancel:key=>jobs.delete(key)});
  const render=()=>{if(!gate.defer({includeBoard:false}))context.paint();};
  const unsubscribe=transport.subscribe(render);context.paintHistory();
  t.after(()=>{unsubscribe();gate.destroy();transport.retire();});
  return {transport,history,gate,context,
    previews:()=>(history.innerHTML.match(/data-testid="history-inline-preview"/g)||[]).length,
    patches:()=>({history:historyPatches,flyout:flyoutPatches}),
    transition(panel) {const next={...context.currentRoute,panel};context.prepare(context.currentRoute,next);context.currentRoute=next;render();},
    flush(){for(const fn of jobs.values())fn();jobs.clear();},render};
}

test('coalesced live-return and Board hashchange clear retained History markup before it is reopened',t=>{
  const h=historyRouteHarness(t);
  assert.equal(h.transport.getGameViewModel('g').inHistoryMode,true);assert.equal(h.previews(),1);
  h.gate.begin();h.gate.end();
  h.transition('board');
  assert.equal(h.transport.getGameViewModel('g').inHistoryMode,false,'Return-to-live clears the actual transport cursor synchronously');
  assert.equal(h.previews(),1,'The gesture still retains the old markup until its release task');
  h.flush();
  assert.equal(h.previews(),0,'The panel change must refresh hidden History, not only its tab/inert state');
  assert.doesNotMatch(h.history.innerHTML,/class="[^"]*\bis-selected\b/);
  assert.equal(h.context.lastRenderedRouteKey,h.context.getRouteRenderKey(),'The incremental render records the panel it actually rendered');
  h.transition('history');
  assert.equal(h.transport.getGameViewModel('g').inHistoryMode,false);assert.equal(h.previews(),0);
  assert.doesNotMatch(h.history.innerHTML,/class="[^"]*\bis-selected\b/);
});

test('Players and History retain personal selection while genuine flyout changes keep their narrow patch path',t=>{
  const h=historyRouteHarness(t);
  h.transition('players');h.transition('history');
  assert.equal(h.transport.getGameViewModel('g').inHistoryMode,true);assert.equal(h.transport.getGameViewModel('g').historyIndex,0);
  assert.equal(h.previews(),1);
  const before=h.patches();h.context.currentRoute.debug=true;h.render();
  assert.equal(h.patches().history,before.history,'Opening a flyout must not repatch the history panel');
  assert.equal(h.patches().flyout,before.flyout+1);assert.equal(h.previews(),1);
});
