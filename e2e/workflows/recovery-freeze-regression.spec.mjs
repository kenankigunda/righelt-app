import {test,expect} from "@playwright/test";
import {createGameFromHome,importScenarioGame,submitPlayableAction} from "../support/app.mjs";

const currentGame=(page,gameId)=>page.evaluate(async id=>{
 const identityId=localStorage.getItem("righelt.identity.id.v1");return (await (await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json()).game;
},gameId);
const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
const scenario={formatVersion:2,id:"6288b956-a647-4e40-9c89-e45c5ea4cf22",title:"Recovery continuation regression",description:"Disposable push retreat follow fixture",incorrect:false,initialState:{boardSize:10,sideToMove:"P1",turnIndex:0,continuation:null,outcome:{status:"ongoing"},pieces:[piece("C1","P1","commander",3,1),piece("C2","P2","commander",4,4),piece("A1","P1","unit",4,1),piece("D1","P2","unit",4,2)]},moves:[],expectedFinalStateHash:"hash-placeholder",expectedOutcome:"ongoing",savedSelection:null};
scenario.resultingState=structuredClone(scenario.initialState);

test("guest play-both push retreat follow recovers with healthy HTTP and unavailable sockets",async({page,baseURL},info)=>{
 let socketsUnavailable=false,losePush=true;const commands=[], sockets=[];
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  if(socketsUnavailable){socket.close({code:1012,reason:"Test deployment transition"});return;}
  sockets.push(socket);const server=socket.connectToServer();server.onMessage(message=>{if(!socketsUnavailable)socket.send(message);});
 });
 const {gameId}=await importScenarioGame(page,scenario,baseURL);
 const players=page.getByRole("button",{name:"Players",exact:true});if(await players.isVisible())await players.click();
 await page.getByRole("button",{name:"Play as both players",exact:true}).click();
 const boardTab=page.getByRole("button",{name:"Board",exact:true});if(await boardTab.isVisible())await boardTab.click();
 await page.route(`**/api/shell/games/${gameId}/apply`,async route=>{
  const envelope=route.request().postDataJSON();commands.push(envelope);
  if(envelope.payload?.action?.type==="push"&&losePush){socketsUnavailable=true;losePush=false;sockets.forEach(socket=>socket.close({code:1012,reason:"Test deployment transition"}));await route.fetch();await route.abort();return;}
  await route.continue();
 });
 let game=await currentGame(page,gameId);const push=game.legalActions.find(a=>a.type==="push");expect(push).toBeTruthy();
 await submitPlayableAction(page,push);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length,{timeout:10000}).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0,{timeout:10000});
 game=await currentGame(page,gameId);expect(game.board.state.continuation.phase).toBe("retreat");
 await expect(page.locator("#shell-board-preview-label")).toContainText("Choose where to retreat");
 await page.screenshot({path:info.outputPath("retreat-recovered.png")});
 const retreat=game.legalActions.find(a=>a.type==="retreat");expect(retreat).toBeTruthy();await submitPlayableAction(page,retreat);
 await expect.poll(async()=> (await currentGame(page,gameId)).board.state.continuation?.phase).toBe("follow");
 game=await currentGame(page,gameId);const follow=game.legalActions.find(a=>a.type==="follow");expect(follow).toBeTruthy();await submitPlayableAction(page,follow);
 await expect.poll(async()=> (await currentGame(page,gameId)).moves.length).toBe(3);
 game=await currentGame(page,gameId);expect(game.board.state.continuation).toBeNull();
 expect(new Set(game.moves.map(m=>m.clientCommandId)).size).toBe(3);
 expect(new Set(commands.filter(c=>c.payload?.action?.type==="push").map(c=>c.clientCommandId)).size).toBe(1);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
});

for(const reduced of [false,true])test(`routine reconnect stays quiet four seconds and preserves board${reduced?" with reduced motion":""}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
 let hold=false,release;const gate=new Promise(r=>release=r);
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{const server=socket.connectToServer();server.onMessage(message=>{if(!hold)socket.send(message);});});
 const {gameId}=await createGameFromHome(page);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await page.route(`**/api/shell/games/${gameId}/reconcile`,async route=>{const response=await route.fetch();if(hold)await gate;await route.fulfill({response});});
 const board=page.getByTestId("game-board");const before=await board.boundingBox();const contents=await board.innerHTML();
 hold=true;await page.evaluate(()=>{dispatchEvent(new Event("pagehide"));dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));});
 await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
 await expect(page.locator('.board-wrap > .loading-pieces')).toBeVisible();
 await page.waitForTimeout(3200);await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Reconnecting. We’ll be right back!",{timeout:1500});
 expect(await board.boundingBox()).toEqual(before);expect(await board.innerHTML()).toBe(contents);
 if(reduced)expect(await page.locator(".reconnect-background").evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
 await page.screenshot({path:info.outputPath(reduced?"reconnect-static.png":"reconnect-sweep.png")});
 hold=false;release();await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:10000});
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
});
