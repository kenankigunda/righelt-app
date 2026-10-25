import {canReadAdditionalHistory} from '../shell/additional-history.js';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getGameResult } from "../shell/game-result.js";
import { participantName, participantDisplayName } from "../shell/public-profile.js";
import { createRenderGestureGate } from "../shell/render-gesture.js";
import { renderResultMark, createResultPresentation } from '../shell/result-presentation.js';
import { icon } from '../shell/ui.js';

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
  const appEl = new Element();
  appEl.querySelector = selector => selector === ".game-result" ? (resultMounted ? new Element() : null) : new Element();
  const context = {
    resultPresentation:createResultPresentation(),
    HTMLElement: Element, appEl, currentRoute: { name: "game", gameId: "g", panel: "board" },
    activeResultGameId: activeResult,
    lastRenderedRouteKey: "g|board", lastRenderedBaseRouteKey: "g", lastRenderedTransitionPhaseKey: "idle",
    getRouteTransitionPhaseKey: () => "idle", getMountedShellPageEl: () => new Element(),
    getBaseRouteRenderKey: () => context.currentRoute.gameId,
    getRouteRenderKey: () => `${context.currentRoute.gameId}|${context.currentRoute.panel}`,
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

test("ordinary game panel/flyout changes retain patching; an active result never patches game content", () => {
  const game = harness({ resultMounted: false });
  game.context.currentRoute.panel = "history";
  assert.equal(game.context.decide(), true);
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
  const context = {canReadAdditionalHistory,account:{snapshot:()=>({enabled:false})},renderResultMark,resultPresentation:createResultPresentation(),additionalHistory:{snapshot:()=>({metadata:true,available:false,loaded:false,items:[]})}, getGameResult, transport:{getIdentityId:()=>"me",getAuthoritativeGame:()=>confirmed},escapeHtml:value=>String(value),formatDisplayGameId:value=>value,icon,renderTurnHistory:()=>"",participantName,participantDisplayName,render:()=>{},activeResultGameId:null};
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
  const context = {canReadAdditionalHistory,account:{snapshot:()=>({enabled:false})},renderResultMark,isPlayerRole:role=>['Player 1','Player 2'].includes(role),escapeHtml:String,participantName,participantDisplayName,getGameResult,transport:{getIdentityId:()=> 'me',getAuthoritativeGame:()=>game},additionalHistory:{snapshot:()=>({metadata:true,available:false,loaded:false,items:[]})},formatDisplayGameId:String,icon:()=>'',renderTurnHistory:()=>''};
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
  assert.match(context.result(game), /Owner vs Babs/);
  const history = context.history(game);
  assert.match(history, />Owner</); assert.match(history, />Babs</);
});

test("retained historical turns keep an exit even after undo removes the live turn", () => {
  const context = {escapeHtml:String,getControlSeatForTurn:(_state,seat)=>seat,
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
  const context={game,renderResultMark,getGameResult,transport:{getIdentityId:()=>identity,getAuthoritativeGame:()=>game},escapeHtml:String,formatDisplayGameId:String,icon,participantName,participantDisplayName};
  runInNewContext(`${extract('const renderResult =','const renderGame =')};globalThis.output=renderResult(game);`,context);
  assert.match(context.output,new RegExp(`data-result-tone="victory" data-winner="${winner}"`));
  assert.match(context.output,/>You won<\/h1>/);assert.match(context.output,/Your opponent’s commander was destroyed/);
  const actions=[...context.output.matchAll(/<button([^>]*)data-action="(analysis|rematch)"[^>]*>/g)];
  assert.equal(actions.length,2);for(const action of actions)assert.doesNotMatch(action[1],/secondary/);
  assert.equal(getGameResult(game,identity).rematchSide,winner==='p1'?'p2':'p1');
 }
});
