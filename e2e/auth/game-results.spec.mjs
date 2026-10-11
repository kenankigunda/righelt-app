import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectRematchRadioGeometry } from "../support/rematch-layout.mjs";
const scenario = JSON.parse(readFileSync(new URL("../../apps/web/scenarios/catalog.json", import.meta.url))).scenarios.find(s => s.title === "Capture supply point to win by unsupplying the commander");
test.beforeEach(async () => { expect((await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988)+100}/reset-limits`, { method: "POST" })).ok).toBe(true); });
for (const opponent of ["self", "friend"]) test(`real ${opponent} terminal game has persistent result, review and swapped rematch`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let creationHeaders;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creationHeaders = request.headers(); });
  await page.goto("/");
  await page.getByTestId("home-create-game").waitFor();
  await (opponent === "self" ? page.getByRole("button", {name:"Play both sides", exact:true}) : page.getByTestId("home-create-game")).click();
  if(opponent==='friend')await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
  await page.locator('[data-lesson-skip-all]').click();
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(`Result_${Date.now().toString(36)}`);
  await dialog.getByLabel("Password", { exact: true }).fill("A result account test password 482");
  await dialog.getByRole("button", { name: "Create account & continue", exact: true }).click();
  if (opponent === "friend") await page.getByRole("button",{name:"Close invite",exact:true}).click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  // The invitation preview is also visible while its dismissal animates.
  // Wait for the live shell before choosing the scenario import target.
  await expect(page.getByTestId("game-shell")).toHaveAttribute("data-game-id", /^game-/);
  const gameId = await page.getByTestId("game-shell").getAttribute("data-game-id");
  const loaded = await page.evaluate(async ({ scenario, gameId, headers }) => {
    const response = await fetch("/api/shell/scenarios/import", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ scenario, targetGameId: gameId, protocolVersion: 2 }) });
    return { status: response.status, body: await response.json() };
  }, { scenario, gameId, headers: creationHeaders });
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
  expect(loaded.body.game.id).toBe(gameId);
  await expect(page.getByTestId("game-result")).toBeVisible();
  await expect(page.getByTestId("game-result").getByRole("heading", { name: "Win" })).toBeVisible();
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
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "View result" }).click();
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole("button", { name: "Review game" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-game-panel="history"] h2')).toBeFocused();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("game-result")).toHaveCount(0);
    // Read the real authenticated HTTP projection, not the optimistic creation
    // object or a warm socket snapshot. Repeating catches persistence regressions.
    const projected = await page.evaluate(async gameId => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}`, {
        headers: { "X-Righelt-Auth-Version": "1", "X-Righelt-Session": session.contextId },
      });
      return { status: response.status, body: await response.json() };
    }, gameId);
    expect(projected.status).toBe(200);
    if (opponent === "self") expect(projected.body.game.selfPlayStartSide).toBe("p1");
    if (cycle === 0) {
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await expect(page).not.toHaveURL(/panel=history/);
      await page.getByRole("button", { name: "History", exact: true }).click();
    }
    await page.getByRole("button", { name: "View result" }).click();
    await expect(page.getByTestId("game-result").getByRole("heading", { name: "Win" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Play again" }).click();
  const rematch = page.getByRole("dialog", { name: "Play again" });
  await expect(rematch.getByLabel("Opponent")).toHaveValue(opponent);
  await expect(rematch.getByRole("radio", { name: "Player 2 · Blue" })).toBeChecked();
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
