import {switchGamePanel} from '../support/app.mjs';
import {AUTH_CONTROL_ORIGIN} from "./fixture.mjs";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectRematchRadioGeometry } from "../support/rematch-layout.mjs";
import { AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION, SESSION_CONTEXT_HEADER } from '../../packages/shared-types/src/auth-policy.js';
const scenario = JSON.parse(readFileSync(new URL("../../apps/web/scenarios/catalog.json", import.meta.url))).scenarios.find(s => s.title === "Capture supply point to win by unsupplying the commander");
test.beforeEach(async () => { expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`, { method: "POST" })).ok).toBe(true); });
for (const opponent of ["self", "friend"]) test(`real ${opponent} terminal game has persistent result, review and swapped rematch`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const creation = page.waitForResponse(response => response.ok() && response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/shell/games');
  await page.getByTestId("home-create-game").waitFor();
  await (opponent === "self" ? page.getByRole("button", {name:"Play both sides", exact:true}) : page.getByTestId("home-create-game")).click();
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(`Result_${Date.now().toString(36)}`);
  await dialog.getByLabel("Password", { exact: true }).fill("A result account test password 482");
  await dialog.getByRole("button", { name: "Create account & continue", exact: true }).click();
  if (opponent === "friend") await page.getByRole("button",{name:"Start a friend game",exact:true}).click();
  if (opponent === "friend") await page.getByRole("button",{name:"Close invite",exact:true}).click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  // The optimistic invitation shell can precede the authenticated create request.
  // Its accepted response supplies both the real target and its protocol headers.
  const acceptedCreation = await creation, gameId = (await acceptedCreation.json()).game.id;
  const creationHeaders = Object.fromEntries(Object.entries(acceptedCreation.request().headers()).filter(([name]) => name.startsWith('x-righelt-')));
  await expect(page.getByTestId("game-shell")).toHaveAttribute("data-game-id", gameId);
  const loaded = await page.evaluate(async ({ scenario, gameId, headers }) => {
    const response = await fetch("/api/shell/scenarios/import", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ scenario, targetGameId: gameId, protocolVersion: 2 }) });
    return { status: response.status, body: await response.json() };
  }, { scenario, gameId, headers: creationHeaders });
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
  expect(loaded.body.game.id).toBe(gameId);
  await expect(page.getByTestId("game-result")).toBeVisible();
  await expect(page.getByTestId("game-result").getByRole("heading", { name: "You won" })).toBeVisible();
  await expect(page.getByTestId("game-result")).toHaveAttribute('data-result-tone','victory');
  const review = page.getByRole("button", { name: "Review game" });
  await review.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const reconnected = page.waitForEvent("websocket");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const socket = await reconnected;
  await socket.waitForEvent("framereceived");
  await expect(review).toBeFocused();
  for (const viewport of [{ width: 375, height: 812 }, { width: 1100, height: 800 }, { width: 1600, height: 1000 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{}))); });
    await page.screenshot({ path: testInfo.outputPath(`result-${viewport.width}.png`) });
  }
  // Landscape starts above the actions; verify the real scroll can reveal each
  // control rather than treating a heading-only screenshot as complete proof.
  const result = page.getByTestId("game-result");
  for (const action of [review, result.getByRole("button", { name: "Play again", exact: true }), result.getByRole("link", { name: "Home", exact: true })]) {
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(await action.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("result-812-actions-reachable.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  const home = page.getByTestId("game-result").getByRole("link", { name: "Home", exact: true });
  await home.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const reconnectedAgain = page.waitForEvent("websocket");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await (await reconnectedAgain).waitForEvent("framereceived");
  await expect(home).toBeFocused();
  await page.reload();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.getByTestId("game-result")).toHaveCount(0);
  await switchGamePanel(page,'history');
  await page.getByRole("button", { name: "View result" }).click();
  expect(await page.getByTestId('game-result').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole("button", { name: "Review game" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-game-panel="history"] h2')).toBeFocused();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("game-result")).toHaveCount(0);
    // Selecting a saved after-state must keep the History board/mini preview,
    // never open a result overlay or replay a celebration.
    // Click the move text. A selected row contains an Undo action, so its
    // geometric center is not a reliable target for selecting that same move.
    const lastMove=page.locator('[data-testid="history-move-item"] .history-move-line').last();
    await lastMove.click();
    await expect(page.getByTestId('game-result')).toHaveCount(0);
    // Read the real authenticated HTTP projection, not the optimistic creation
    // object or a warm socket snapshot. Repeating catches persistence regressions.
    const projected = await page.evaluate(async ({ gameId, protocolHeader, protocolVersion, contextHeader }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}`, {
        headers: { [protocolHeader]: String(protocolVersion), [contextHeader]: session.contextId },
      });
      return { status: response.status, body: await response.json() };
    }, { gameId, protocolHeader: AUTH_PROTOCOL_HEADER, protocolVersion: AUTH_PROTOCOL_VERSION, contextHeader: SESSION_CONTEXT_HEADER });
    expect(projected.status).toBe(200);
    if (opponent === "self") expect(projected.body.game.selfPlayStartSide).toBe("p1");
    if (cycle === 0) {
      await switchGamePanel(page,'board');
      await expect(page).not.toHaveURL(/panel=history/);
      await switchGamePanel(page,'history');
    }
    await page.getByRole("button", { name: "View result" }).click();
    await expect(page.getByTestId("game-result").getByRole("heading", { name: "You won" })).toBeVisible();
    expect(await page.getByTestId('game-result').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
  }
  await page.getByRole("button", { name: "Play again" }).click();
  const rematch = page.getByRole("dialog", { name: "Play again" });
  await expect(rematch.getByRole("group",{name:"Opponent",exact:true}).locator(`input[value="${opponent}"]`)).toBeChecked();
  await expect(rematch.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
  for (const width of [375, 1100, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expectRematchRadioGeometry(rematch);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({path:testInfo.outputPath("rematch-phone.png")});
  const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/shell/games");
  await rematch.getByRole("button", { name: "Start game" }).click();
  const fresh = (await (await created).json()).game;
  expect(fresh.selfPlayMode).toBe(opponent === "self");
  if (opponent === "friend") expect(fresh.player1).toBeNull();
  if (opponent === "friend") await page.getByRole("button",{name:"Close invite",exact:true}).click();
  await expect(page.getByTestId("game-shell")).not.toHaveAttribute("data-game-id", gameId);
  await expect(page).not.toHaveURL(new RegExp(gameId));
  await page.reload();
  await expect(page.getByTestId("game-shell")).toHaveAttribute("data-game-id", fresh.id);
  if (opponent === "friend") await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
  else expect(fresh.selfPlayStartSide).toBe("p2");
});

test('a retained legacy commander destruction explains the actual cause without rewriting its stored reason',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 let headers;
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/shell/games')headers=request.headers();});
 await page.goto('/');await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const account=page.getByTestId('account-dialog');await account.getByRole('button',{name:'Create account',exact:true}).click();
 await account.getByLabel('Username',{exact:true}).fill(`Legacy_${Date.now().toString(36)}`);await account.getByLabel('Password',{exact:true}).fill('A retained result password 482');
 await account.getByRole('button',{name:'Create account & continue',exact:true}).click();
 await expect(page.getByTestId('game-shell')).toBeVisible();const gameId=await page.getByTestId('game-shell').getAttribute('data-game-id');
 const terminal=structuredClone(scenario.resultingState);terminal.pieces=terminal.pieces.filter(piece=>piece.id!=='C2');terminal.outcome={status:'p1_win',reason:'p2_commander_unsupplied'};
 const imported=await page.evaluate(async({gameId,scenario,terminal,headers})=>{
  const response=await fetch('/api/shell/scenarios/import',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({targetGameId:gameId,protocolVersion:2,scenario:{...scenario,initialState:terminal,resultingState:terminal,moves:[],expectedOutcome:'p1_win'}})});
  return{status:response.status,body:await response.json()};
 },{gameId,scenario,terminal,headers});
 expect(imported.status,JSON.stringify(imported.body)).toBe(200);expect(imported.body.game.board.state.outcome.reason).toBe('p2_commander_unsupplied');expect(imported.body.game.moves).toHaveLength(0);
 const result=page.getByTestId('game-result');await expect(result.getByRole('heading',{name:'You won as Red',exact:true})).toBeVisible();await expect(result).toContainText('Your Blue commander was destroyed.');await expect(result).not.toContainText('lost its supply');
 await page.reload();await expect(page.getByTestId('game-shell')).toBeVisible();await expect(result).toHaveCount(0);
 await page.goto(`/#/game/${gameId}?panel=history`);await page.getByRole('button',{name:'View result',exact:true}).click();
 await expect(result.getByRole('heading',{name:'You won as Red',exact:true})).toBeVisible();expect(await result.locator('[data-result-mark]').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
 const retained=await page.evaluate(async({gameId,headers})=>(await(await fetch(`/api/shell/games/${gameId}`,{headers})).json()).game,{gameId,headers});
 expect(retained.board.state.outcome.reason).toBe('p2_commander_unsupplied');expect(retained.moves).toHaveLength(0);
 await page.screenshot({path:info.outputPath('legacy-commander-result.png')});
});
