import {waitForOpponentReady,waitForComputerDecision} from '../support/computer-projection.mjs';
import { readFileSync } from 'node:fs';
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';
import {test,expect} from "@playwright/test";
import {createGameFromHome,importScenarioGame,submitPlayableAction,switchGamePanel,waitForLegacyIdentity} from "../support/app.mjs";

const currentGame=(page,gameId)=>page.evaluate(async id=>{
 const identityId=localStorage.getItem("righelt.identity.id.v1");return (await (await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json()).game;
},gameId);
const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
const scenario={formatVersion:2,id:"6288b956-a647-4e40-9c89-e45c5ea4cf22",title:"Recovery continuation regression",description:"Disposable push retreat follow fixture",incorrect:false,initialState:{boardSize:10,sideToMove:"P1",turnIndex:0,continuation:null,outcome:{status:"ongoing"},pieces:[piece("C1","P1","commander",3,1),piece("C2","P2","commander",4,4),piece("A1","P1","unit",4,1),piece("D1","P2","unit",4,2)]},moves:[],expectedFinalStateHash:"hash-placeholder",expectedOutcome:"ongoing",savedSelection:null};
scenario.resultingState=structuredClone(scenario.initialState);

test("lost move response recovers through identical submission while reconciliation stays stalled", async ({page}, info) => {
 let dropInbound = false, first = true, release;
 const commands = [];
 const gate = new Promise(resolve => release = resolve);
 await page.routeWebSocket(/\/api\/shell\/games\//, socket => {
  const server = socket.connectToServer();
  server.onMessage(message => { if (!dropInbound) socket.send(message); });
 });
 const {gameId} = await createGameFromHome(page);
 await page.route(`**/api/shell/games/${gameId}/**`, async route => {
  if(isOperationRequest(route.request(),'reconcile')){await gate;await route.abort();return;}
  if(!isOperationRequest(route.request(),'apply')){await route.continue();return;}
  commands.push(route.request().postDataJSON());
  if (first) {
   first = false; dropInbound = true;
   await route.fetch();
   await route.abort();
  } else await route.continue();
 });
 try {
  const game = await currentGame(page, gameId);
  const action = game.legalActions.find(entry => entry.type === "move") ?? game.legalActions[0];
  await submitPlayableAction(page, action);
  await expect.poll(() => commands.length, {timeout:20000}).toBe(2);
  expect(commands[1]).toEqual(commands[0]);
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0, {timeout:10000});
  const recovered = await currentGame(page, gameId);
  expect(recovered.moves).toHaveLength(1);
  expect(recovered.moves[0].clientCommandId).toBe(commands[0].clientCommandId);
  await page.screenshot({path:info.outputPath("submission-recovered.png")});
  dropInbound = false;
  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible();
  expect((await currentGame(page, gameId)).moves).toHaveLength(1);
 } finally {
  dropInbound = false; release();
  await page.unrouteAll({behavior:"wait"});
 }
});

test("guest play-both push retreat follow recovers with healthy HTTP and unavailable sockets",async({page,baseURL},info)=>{
 let socketsUnavailable=false,losePush=true;const commands=[], sockets=[],pushProofs=[];
 const actionFor=command=>(command.kind==='shared'?command.payload.values:command).payload?.action;
 let holdConfirmation=false,releaseConfirmation,confirmationRequested=false;
 const confirmationGate=new Promise(resolve=>releaseConfirmation=resolve);
 page.on("close",()=>releaseConfirmation());
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  if(socketsUnavailable){socket.close({code:1012,reason:"Test deployment transition"});return;}
  sockets.push(socket);const server=socket.connectToServer();server.onMessage(message=>{if(!socketsUnavailable)socket.send(message);});
 });
 const {gameId}=await importScenarioGame(page,scenario,baseURL);
 await switchGamePanel(page,"players");
 await page.getByRole("button",{name:"Play both sides",exact:true}).click();
 await switchGamePanel(page,"board");
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  const request=route.request();
  if(isOperationRequest(request,'reconcile')){
   const response=await route.fetch();
   if(holdConfirmation){confirmationRequested=true;await confirmationGate;}
   await route.fulfill({response});return;
  }
  if(!isOperationRequest(request,'apply')){await route.continue();return;}
  const envelope=request.postDataJSON(),values=operationValues(request);commands.push(envelope);
  if(values.payload?.action?.type!=='push'){await route.continue();return;}
  const first=losePush;
  if(first){holdConfirmation=true;socketsUnavailable=true;losePush=false;sockets.forEach(socket=>socket.close({code:1012,reason:"Test deployment transition"}));}
  const response=await route.fetch(),body=await response.json();
  const accepted=body.commandOutcomes?.find(outcome=>outcome.clientCommandId===envelope.clientCommandId&&outcome.fingerprint===envelope.fingerprint&&outcome.outcome==='accepted');
  expect(accepted,'The healthy HTTP server must retain the accepted original push receipt').toBeTruthy();
  const proof={envelope,accepted,receivedAt:Date.now(),deliveredAt:null,lost:first};pushProofs.push(proof);
  if(first){await route.abort();return;}
  // A same-ID retry is also a valid confirmation authority. Holding only
  // reconcile lets its accepted reply legitimately unblock the next action.
  if(holdConfirmation)await confirmationGate;
  await route.fulfill({response});proof.deliveredAt=Date.now();
 });
 let game=await currentGame(page,gameId);const push=game.legalActions.find(a=>a.type==="push");expect(push).toBeTruthy();
 try {

 await submitPlayableAction(page,push);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length,{timeout:10000}).toBe(1);

 await expect.poll(()=>confirmationRequested).toBe(true);
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
 game=await currentGame(page,gameId);expect(game.board.state.continuation.phase).toBe("retreat");

 const message=page.locator("#shell-board-preview-label");
 await expect(message).toContainText('Select a retreat');
 await expect(message).not.toContainText('Supply and command lines');
 await expect(message.locator('[data-board-preview-action],[data-board-message-action]')).toHaveCount(0);
 // The continuation intent stays visible while admission is disabled. Board
 // targets still cannot submit a retreat until the original receipt arrives.
 const retreat=game.legalActions.find(a=>a.type==="retreat");expect(retreat).toBeTruthy();
 const retreatTarget=page.locator(`[data-testid="game-board"] .cell[data-row="${retreat.to.row}"][data-col="${retreat.to.col}"]`);

 await expect.poll(()=>pushProofs.length,{timeout:10000}).toBeGreaterThanOrEqual(2);
 const original=pushProofs[0].envelope;
 for(const proof of pushProofs){expect(proof.envelope).toEqual(original);expect(proof.deliveredAt).toBeNull();}
 for(let attempt=0;attempt<2;attempt++){
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
  expect(pushProofs.every(proof=>proof.deliveredAt===null)).toBe(true);
  await retreatTarget.click();
 }
 expect(commands.filter(command=>actionFor(command)?.type==="retreat")).toHaveLength(0);

 holdConfirmation=false;releaseConfirmation();
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 await page.screenshot({path:info.outputPath("retreat-recovered.png")});
 // Admission is restored only by the definitive original receipt. Verify the
 // required defender's legal destination before confirming the actual retreat.
 await expect(message).toContainText("Select a retreat");
 await submitPlayableAction(page,retreat);
 await expect.poll(async()=> (await currentGame(page,gameId)).board.state.continuation?.phase).toBe("follow");
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 game=await currentGame(page,gameId);const follow=game.legalActions.find(a=>a.type==="follow");expect(follow).toBeTruthy();
 // The required continuation actor is already selected, even when a pushed
 // defender shares its square with the attacker and has no generic source class.
 await submitPlayableAction(page,follow);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length).toBe(3);
 game=await currentGame(page,gameId);expect(game.board.state.continuation).toBeNull();
 expect(game.moves.map(move=>move.action)).toEqual([push,retreat,follow]);
 expect(new Set(game.moves.map(m=>m.clientCommandId)).size).toBe(3);
 expect(new Set(commands.filter(c=>actionFor(c)?.type==="push").map(c=>c.clientCommandId)).size).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 } finally {
  holdConfirmation=false;releaseConfirmation();
  // Drain intercepted requests before the browser fixture closes.
  await page.unrouteAll({behavior:"wait"});
  await info.attach("held-push-confirmations",{body:JSON.stringify(pushProofs,null,2),contentType:"application/json"});
 }
});

for(const reduced of [false,true])test(`routine reconnect stays quiet four seconds and preserves board${reduced?" with reduced motion":""}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
 await page.clock.install();
 let hold=false,release,held;const gate=new Promise(r=>release=r);const waiting=new Promise(r=>held=r);
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{const server=socket.connectToServer();server.onMessage(message=>{if(!hold)socket.send(message);});});
 const {gameId}=await createGameFromHome(page);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'reconcile')){await route.continue();return;}
  const response=await route.fetch();if(hold){held();await gate;}await route.fulfill({response});
 });
 try {
 await switchGamePanel(page,"board");
 const boardTab=page.getByRole("button",{name:"Board",exact:true});
 if(await boardTab.isVisible()) await expect(boardTab).toHaveAttribute("aria-pressed","true");
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 const board=page.getByTestId("game-board");
 // The measured board must be on its settled panel before timers are frozen.
 await expect.poll(()=>board.evaluate(el=>{
  for(let node=el;node;node=node.parentElement)
   if(node.getAnimations().some(animation=>
    (animation.playState==='running'||animation.pending)&&
    Number.isFinite(animation.effect?.getComputedTiming().endTime)))return false;
  const rect=el.getBoundingClientRect();
  return rect.width>0&&rect.left>=0&&rect.right<=innerWidth;
 })).toBe(true);
 // Freeze Date during the pause handshake so browser/runner delay cannot
 // put its target in the past. Do not fast-forward existing recovery timers.
 const frozenAt=await page.evaluate(()=>Date.now());
 await page.clock.setFixedTime(frozenAt);
 await page.clock.pauseAt(frozenAt);
 await page.clock.setSystemTime(frozenAt);
 const before=await board.boundingBox();const contents=await board.innerHTML();
 hold=true;await page.evaluate(()=>{dispatchEvent(new Event("pagehide"));dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));});
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
 await waiting;
 await expect(page.locator('.reconnect-background')).toBeHidden();
 await page.clock.runFor(199);await expect(page.locator('.board-wrap')).toHaveAttribute('data-loading-phase','quiet');
 await page.clock.runFor(2);await expect(page.locator('.board-wrap')).toHaveAttribute('data-loading-phase','visible');
 await expect(page.locator('.reconnect-background')).toBeHidden();
 // Phase publication schedules the Edge via MutationObserver then rAF. Give
 // that rendering turn its clock time rather than waiting on a frozen clock.
 await page.clock.runFor(16);
 await expect(page.locator('.loading-edge-p1')).toBeVisible();
 await page.evaluate(()=>{window.heldRecoveryEdge=document.querySelector('.loading-edge-p1');});
 await page.clock.runFor(3782);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await page.clock.runFor(2);
 await expect(page.getByTestId("sync-recovery-banner")).toBeVisible();
 await expect(page.getByTestId("sync-recovery-banner")).toHaveText("Reconnecting");
 expect(await board.boundingBox()).toEqual(before);expect(await board.innerHTML()).toBe(contents);
 await expect(page.getByRole('button',{name:'Reload game',exact:true})).toHaveCount(0);
 expect(await page.locator('.loading-edge-p1').evaluate(el=>el===window.heldRecoveryEdge)).toBe(true);
 if(reduced)expect(await page.locator('.loading-edge-p1').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 // Deadline assertions are complete. CSS transitions use the browser's
 // animation clock, so resume it before measuring the unchanged stone face.
 await page.clock.resume();
 await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
 await page.screenshot({path:info.outputPath(reduced?"reconnect-static.png":"reconnect-sweep.png")});
 hold=false;release();await page.clock.resume();await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 } finally {
  hold=false;release();await page.clock.resume();
  await page.unrouteAll({behavior:"wait"});
 }
});

test('branch chooser waits for this page recovery before creating exactly one original-position popup',async({page},info)=>{
 let hold=false,release,seen;
 const gate=new Promise(resolve=>release=resolve),held=new Promise(resolve=>seen=resolve);
 const popups=[],branches=[];
 page.on('popup',popup=>popups.push(popup));
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  const server=socket.connectToServer();server.onMessage(message=>{if(!hold)socket.send(message);});
 });
 const {gameId}=await createGameFromHome(page);
 let applied;
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'apply')){await route.continue();return;}
  const response=await route.fetch();applied=await response.json();await route.fulfill({response});
 });
 const {makeAnyLegalMove}=await import('../support/app.mjs');
 await makeAnyLegalMove(page);
 // The live socket may acknowledge first and cancel the browser HTTP fetch.
 // Capture its actual server response at the route boundary before cancellation.
 await expect.poll(()=>Boolean(applied?.game)).toBe(true);
 const original=applied.game;
 const row=page.getByTestId('history-move-item').first();
 await row.click();await row.locator('[data-action="launch-history-branch"]').click();
 const chooser=page.getByRole('dialog',{name:'Create a new game here',exact:true});
 const start=chooser.getByRole('button',{name:'Start game',exact:true});
 await expect(start).toBeEnabled();
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'reconcile')){await route.fallback();return;}
  const response=await route.fetch();if(hold){seen();await gate;}await route.fulfill({response});
 });
 await page.context().route('**/api/shell/history/branch',async route=>{branches.push(route.request().postDataJSON());await route.continue();});
 try{
  hold=true;await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await held;
  await expect(start).toBeDisabled();await expect(chooser.getByRole('status')).toHaveText('Updating this game');
  expect(branches).toHaveLength(0);expect(popups).toHaveLength(0);
  await page.screenshot({path:info.outputPath('branch-updating-source.png')});
  hold=false;release();
  // This UI transition is driven by the page's own transport subscription.
  // An independent HTTP projection cannot prove that this tab has recovered.
  await expect(start).toBeEnabled();await expect(chooser.getByRole('status')).toHaveText('');
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/history/branch');
  const popupPromise=page.waitForEvent('popup');await start.click();
  const popup=await popupPromise,response=await responsePromise;
  expect(response.status()).toBe(200);const branched=(await response.json()).game;
  await expect(popup.getByTestId('game-shell')).toHaveAttribute('data-game-id',branched.id);
  expect(branched.board.state).toEqual(original.moves[0].selectionSnapshot);
  expect(branched.moves).toHaveLength(0);expect(branches).toHaveLength(1);expect(popups).toHaveLength(1);
  await expect(page.getByTestId('history-move-item')).toHaveCount(original.moves.length);
  await popup.close();
 }finally{hold=false;release();await page.context().unrouteAll({behavior:'wait'});await page.unrouteAll({behavior:'wait'});}
});


test.describe('mobile rules workers', () => {
 test.use({hasTouch:true});

test('mobile production rush ends once and reloads the same tab with complete legal actions', async ({page,baseURL},info) => {
  await page.setViewportSize({width:390,height:844});
  const state=JSON.parse(readFileSync('packages/game-engine/test/fixtures/mobile-end-turn-rush.json','utf8'));
  const fixture={formatVersion:2,id:'50d3b5ac-5741-45f4-9559-cdcd677cadc1',title:'Mobile End Turn regression',description:'Reduced production rules position',incorrect:false,
    initialState:state,resultingState:state,moves:[],expectedFinalStateHash:'hash-placeholder',expectedOutcome:'ongoing',savedSelection:null};
  const {gameId}=await importScenarioGame(page,fixture,baseURL);
  await switchGamePanel(page,'players');
  const both=page.getByRole('button',{name:'Play both sides',exact:true});
  if(await both.isVisible())await both.click();
  await switchGamePanel(page,'board');
  await expect.poll(async()=>(await currentGame(page,gameId)).canEndTurn).toBe(true);
  const before=await currentGame(page,gameId);
  const submitted=[];
  page.on('request',request=>{if(isOperationRequest(request,'end-turn'))submitted.push(request.postDataJSON());});
  await page.locator('[data-board-preview-action="end-turn"]').click();
  await expect.poll(async()=>(await currentGame(page,gameId)).board.state.continuation).toBeNull();
  const ended=await currentGame(page,gameId);
  expect(ended.board.state.turnIndex).toBe(before.board.state.turnIndex+1);
  expect(ended.legalActions).toHaveLength(46);
  expect(new Set(submitted.map(command=>command.clientCommandId)).size).toBe(1);
  await page.reload();
  await expect(page.getByTestId('game-board')).toBeVisible();
  const reloaded=await currentGame(page,gameId);
  expect(reloaded.gameplayRevision).toBe(ended.gameplayRevision);
  expect(reloaded.board.state).toEqual(ended.board.state);
  expect(reloaded.legalActions).toEqual(ended.legalActions);
  await page.screenshot({path:info.outputPath('mobile-end-turn-reloaded.png')});
});

test('slow rules worker leaves mobile navigation responsive and stops when leaving the game', async ({page,baseURL}) => {
  await page.setViewportSize({width:390,height:844});
  // Hold actual worker execution at its module boundary, without blocking UI JS.
  let release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/board/rules-worker.js',async route=>{await gate;await route.continue().catch(()=>{});});
  try {
    await createGameFromHome(page);
    await page.evaluate(()=>{
      window.rulesWorkers=[];
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker {
        constructor(url,options){super(url,options);if(String(url).includes('rules-worker'))window.rulesWorkers.push(this);}
        terminate(){this.wasTerminated=true;super.terminate();}
      };
    });
    await page.locator('[data-testid="game-board"] .cell[data-row="3"][data-col="6"]').click();
    await expect.poll(()=>page.evaluate(()=>window.rulesWorkers.length)).toBeGreaterThan(0);
    await switchGamePanel(page,'players');
    await expect(page.getByTestId('game-shell')).toBeVisible();
    // Production mounts through bindElements/loadSnapshot, not initialize().
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect.poll(()=>page.evaluate(()=>window.rulesWorkers.every(worker=>worker.wasTerminated))).toBe(true);
    await page.getByRole('link',{name:'Righelt',exact:true}).click();
    await expect(page.getByTestId('home-create-game')).toBeVisible();
    expect(await page.evaluate(()=>window.rulesWorkers.every(worker=>worker.wasTerminated))).toBe(true);
  } finally {release();await page.unrouteAll({behavior:'wait'});}
});


test('Horus finishes a real turn and releases its worker before self-play and reload', async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    window.ownedGameWorkers=[];
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options){super(url,options);window.ownedGameWorkers.push(this);}
      terminate(){this.wasTerminated=true;super.terminate();}
    };
  });
  await page.goto('/');await waitForLegacyIdentity(page);
  await page.locator('[data-action="opponent-story"][data-opponent="horus"]').click();
  await waitForOpponentReady(page);
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Play Horus',exact:true}).click();
  const initial=(await (await created).json()).game;
  await expect(page.getByTestId('game-board')).toBeVisible();
  await submitPlayableAction(page,initial.legalActions.find(action=>action.type==='move'));
  await waitForComputerDecision(page,initial.id,'horus',{guest:true,modelId:initial.computer.modelId});
  await expect.poll(async()=>(await currentGame(page,initial.id)).computerTurn,{timeout:30000}).toBeNull();
  await page.getByRole('link',{name:'Righelt',exact:true}).click();
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.ownedGameWorkers.every(worker=>worker.wasTerminated))).toBe(true);
  const selfCreated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await page.locator('[data-action="create-self-play"]').click();
  const self=(await (await selfCreated).json()).game;
  await expect(page.getByTestId('game-board')).toBeVisible();
  await submitPlayableAction(page,self.legalActions.find(action=>action.type==='move'));
  await expect.poll(async()=>(await currentGame(page,self.id)).moves.length).toBe(1);
  const saved=await currentGame(page,self.id);
  await page.reload();await expect(page.getByTestId('game-board')).toBeVisible();
  const reloaded=await currentGame(page,self.id);
  expect(reloaded.gameplayRevision).toBe(saved.gameplayRevision);expect(reloaded.board.state).toEqual(saved.board.state);
  await page.screenshot({path:info.outputPath('horus-to-self-play-reloaded.png')});
});
});
