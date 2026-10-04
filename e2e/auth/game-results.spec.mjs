import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectRematchRadioGeometry } from "../support/rematch-layout.mjs";
const scenario = JSON.parse(readFileSync(new URL("../../apps/web/scenarios/catalog.json", import.meta.url))).scenarios.find(s => s.title === "Capture supply point to win by unsupplying the commander");
test.beforeEach(async () => { expect((await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988)+100}/reset-limits`, { method: "POST" })).ok).toBe(true); });
for (const controlledOrder of [false, true]) for (const opponent of ["self", "friend"]) test(`real ${opponent} terminal game has persistent result, review and swapped rematch${controlledOrder ? " with controlled review ordering" : ""}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let creationHeaders;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creationHeaders = request.headers(); });
  await page.goto("/");
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await page.locator(`button[data-opponent="${opponent}"]`).click();
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(`Result_${Date.now().toString(36)}`);
  await dialog.getByLabel("Password", { exact: true }).fill("A result account test password 482");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("I saved my recovery code").check();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  const gameId = await page.getByTestId("game-shell").getAttribute("data-game-id");
  const loaded = await page.evaluate(async ({ scenario, gameId, headers }) => {
    const response = await fetch("/api/shell/scenarios/import", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ scenario, targetGameId: gameId, protocolVersion: 2 }) });
    return { status: response.status, body: await response.json() };
  }, { scenario, gameId, headers: creationHeaders });
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
  await expect(page.getByTestId("game-result")).toBeVisible();
  await expect(page.getByTestId("game-result").getByRole("heading", { name: "Loss" })).toBeVisible();
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
  await page.getByRole("button", { name: "View result" }).click();
  for (let cycle = 0; cycle < 2; cycle++) {
    if (controlledOrder && cycle === 0) {
      expect(new URL(page.url()).hash).not.toContain("panel=history");
      // Explicit event-order control: keep the existing gesture gate held through
      // the trusted click, then deliver the changed hash before its render flush.
      await page.evaluate(() => {
        window.__reviewHashchangeOrder = null;
        window.addEventListener("click", event => {
          const control = event.target.closest?.('[data-action="analysis"]');
          if (control) control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        }, { capture: true, once: true });
        window.addEventListener("click", event => {
          if (!event.target.closest?.('[data-action="analysis"]')) return;
          window.__reviewHashchangeOrder = { trusted: event.isTrusted, hash: location.hash };
          window.dispatchEvent(new HashChangeEvent("hashchange"));
          // Release through the same public event path, without altering timers.
          window.dispatchEvent(new PointerEvent("pointerup"));
        }, { once: true });
      });
    }
    await page.getByRole("button", { name: "Review game" }).click();
    if (controlledOrder && cycle === 0) {
      const ordering = await page.evaluate(() => window.__reviewHashchangeOrder);
      expect(ordering.trusted).toBe(true);
      expect(ordering.hash).toContain("panel=history");
    }
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
    if (opponent === "self") expect(projected.body.game.selfPlayStartSide).toBe("p2");
    if (cycle === 0) {
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await expect(page).not.toHaveURL(/panel=history/);
    }
    await page.getByRole("button", { name: "View result" }).click();
    await expect(page.getByTestId("game-result").getByRole("heading", { name: "Loss" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Play again" }).click();
  const rematch = page.getByRole("dialog", { name: "Play again" });
  await expect(rematch.getByLabel("Opponent")).toHaveValue(opponent);
  await expect(rematch.getByRole("radio", { name: "Player 1 · Red" })).toBeChecked();
  for (const width of [375, 1100, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expectRematchRadioGeometry(rematch);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/shell/games");
  await rematch.getByRole("button", { name: "Start game" }).click();
  const fresh = (await (await created).json()).game;
  expect(fresh.selfPlayMode).toBe(opponent === "self");
  if (opponent === "friend") expect(fresh.player2).toBeNull();
  await expect(page.getByTestId("game-shell")).not.toHaveAttribute("data-game-id", gameId);
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "red");
});
