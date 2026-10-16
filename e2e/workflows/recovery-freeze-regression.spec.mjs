import {test,expect} from "@playwright/test";
import {createGameFromHome,importScenarioGame,submitPlayableAction} from "../support/app.mjs";

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
 await page.route(`**/api/shell/games/${gameId}/reconcile`, async route => {
  await gate;
  await route.abort();
 });
 await page.route(`**/api/shell/games/${gameId}/apply`, async route => {
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
 let socketsUnavailable=false,losePush=true;const commands=[], sockets=[];
 let holdConfirmation=false,releaseConfirmation,confirmationRequested=false;
 const confirmationGate=new Promise(resolve=>releaseConfirmation=resolve);
 page.on("close",()=>releaseConfirmation());
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  if(socketsUnavailable){socket.close({code:1012,reason:"Test deployment transition"});return;}
  sockets.push(socket);const server=socket.connectToServer();server.onMessage(message=>{if(!socketsUnavailable)socket.send(message);});
 });
 const {gameId}=await importScenarioGame(page,scenario,baseURL);
 const players=page.getByRole("button",{name:"Players",exact:true});if(await players.isVisible())await players.click();
 await page.getByRole("button",{name:"Play as both players",exact:true}).click();
 const boardTab=page.getByRole("button",{name:"Board",exact:true});if(await boardTab.isVisible())await boardTab.click();
 await page.route(`**/api/shell/games/${gameId}/reconcile`,async route=>{
  const response=await route.fetch();
  if(holdConfirmation){confirmationRequested=true;await confirmationGate;}
  await route.fulfill({response});
 });
 await page.route(`**/api/shell/games/${gameId}/apply`,async route=>{
  const envelope=route.request().postDataJSON();commands.push(envelope);
  if(envelope.payload?.action?.type==="push"&&losePush){holdConfirmation=true;socketsUnavailable=true;losePush=false;sockets.forEach(socket=>socket.close({code:1012,reason:"Test deployment transition"}));await route.fetch();await route.abort();return;}
  await route.continue();
 });
 let game=await currentGame(page,gameId);const push=game.legalActions.find(a=>a.type==="push");expect(push).toBeTruthy();
 try {

 await submitPlayableAction(page,push);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length,{timeout:10000}).toBe(1);

 await expect.poll(()=>confirmationRequested).toBe(true);
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
 game=await currentGame(page,gameId);expect(game.board.state.continuation.phase).toBe("retreat");

 await expect(page.locator("#shell-board-preview-label")).toContainText("Choose where to retreat");
 // The tentative retreat stays visible, but no command is allowed while the
 // accepted push's response is still unknown. The quiet banner is not readiness.
 const retreat=game.legalActions.find(a=>a.type==="retreat");expect(retreat).toBeTruthy();
 const retreatTarget=page.locator(`[data-testid="game-board"] .cell[data-row="${retreat.to.row}"][data-col="${retreat.to.col}"]`);

 await retreatTarget.click();await retreatTarget.click();
 expect(commands.filter(c=>c.payload?.action?.type==="retreat")).toHaveLength(0);

 holdConfirmation=false;releaseConfirmation();
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 await page.screenshot({path:info.outputPath("retreat-recovered.png")});

 await submitPlayableAction(page,retreat);
 await expect.poll(async()=> (await currentGame(page,gameId)).board.state.continuation?.phase).toBe("follow");
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 game=await currentGame(page,gameId);const follow=game.legalActions.find(a=>a.type==="follow");expect(follow).toBeTruthy();
 await expect(page.locator(`[data-testid="game-board"] .cell[data-row="${follow.from.row}"][data-col="${follow.from.col}"]`)).toHaveClass(/(?:^|\s)source(?:\s|$)/);
 await submitPlayableAction(page,follow);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length).toBe(3);
 game=await currentGame(page,gameId);expect(game.board.state.continuation).toBeNull();
 expect(new Set(game.moves.map(m=>m.clientCommandId)).size).toBe(3);
 expect(new Set(commands.filter(c=>c.payload?.action?.type==="push").map(c=>c.clientCommandId)).size).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 } finally {
  holdConfirmation=false;releaseConfirmation();
  // Drain intercepted requests before the browser fixture closes.
  await page.unrouteAll({behavior:"wait"});
 }
});

for(const reduced of [false,true])test(`routine reconnect stays quiet four seconds and preserves board${reduced?" with reduced motion":""}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
 await page.clock.install();
 let hold=false,release,held;const gate=new Promise(r=>release=r);const waiting=new Promise(r=>held=r);
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{const server=socket.connectToServer();server.onMessage(message=>{if(!hold)socket.send(message);});});
 const {gameId}=await createGameFromHome(page);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await page.route(`**/api/shell/games/${gameId}/reconcile`,async route=>{const response=await route.fetch();if(hold){held();await gate;}await route.fulfill({response});});
 try {
 const boardTab=page.getByRole("button",{name:"Board",exact:true});
 if(await boardTab.isVisible()){
  await boardTab.click();
  await expect(boardTab).toHaveAttribute("aria-pressed","true");
 }
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
 await page.clock.runFor(199);await expect(page.locator('.reconnect-background')).toBeHidden();
 await page.clock.runFor(2);await expect(page.locator('.reconnect-background')).toBeVisible();
 await page.clock.runFor(3798);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await page.clock.runFor(2);
 await expect(page.getByTestId("sync-recovery-banner")).toBeVisible();
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Reconnecting. We’ll be right back!");
 expect(await board.boundingBox()).toEqual(before);expect(await board.innerHTML()).toBe(contents);
 if(reduced)expect(await page.locator(".reconnect-background").evaluate(el=>getComputedStyle(el,"::before").animationName)).toBe("none");
 // Deadline assertions are complete. CSS transitions use the browser's
 // animation clock, so resume it before measuring the settled fade.
 await page.clock.resume();
 await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(.2);
 await page.screenshot({path:info.outputPath(reduced?"reconnect-static.png":"reconnect-sweep.png")});
 hold=false;release();await page.clock.resume();await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 } finally {
  hold=false;release();await page.clock.resume();
  await page.unrouteAll({behavior:"wait"});
 }
});
