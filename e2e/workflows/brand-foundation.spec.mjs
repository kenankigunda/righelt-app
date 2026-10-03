import { test, expect } from "@playwright/test";
import { createGameFromHome, makeAnyLegalMove } from "../support/app.mjs";
import { runScopedAxeScan } from "../support/ux.mjs";

test("home logo changes together while primary actions stay affiliated; game supply stays owned", async ({ page }, testInfo) => {
  await page.goto("/");
  const logo = page.getByRole("img", { name: "Righelt", exact: true });
  await expect(logo).toBeVisible();
  await expect(page.getByRole("link", { name: "Righelt", exact: true })).toBeVisible();
  const play = page.getByTestId("home-create-game");
  await expect(play).toHaveCSS("background-color", "rgb(180, 47, 54)");
  const redButton = await play.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.clock.install();
  await page.clock.fastForward(9500);
  await expect(logo).toHaveAttribute("data-player", "blue");
  expect(await play.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(redButton);
  await testInfo.attach("blue-wordmark", { body: await logo.screenshot({ path: testInfo.outputPath("wordmark.png") }), contentType: "image/png" });
  await page.clock.resume();
  await createGameFromHome(page);
  const redSupply = page.locator('[data-testid="game-shell"] .supply-point-p1');
  const blueSupply = page.locator('[data-testid="game-shell"] .supply-point-p2');
  await expect(redSupply).toHaveAttribute("aria-label", "Player 1 supply point");
  await expect(blueSupply).toHaveAttribute("aria-label", "Player 2 supply point");
  const fill = (locator) => locator.evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  const before = [await fill(redSupply), await fill(blueSupply)];
  expect(before[0]).not.toBe(before[1]);
  await makeAnyLegalMove(page, "p1");
  expect([await fill(redSupply), await fill(blueSupply)]).toEqual(before);
  await expect(logo).toHaveAttribute("data-player", "red");
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "red");
});

test("Player 2 actions remain blue during Player 1's turn and home returns to red", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  const gameId = await page.evaluate(async () => {
    const post = async (path, data) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
      return response.json();
    };
    const created = await post("/api/shell/games", { identityId: `foundation-${crypto.randomUUID()}` });
    await post(`/api/shell/games/${created.game.id}/join`, {
      identityId: localStorage.getItem("righelt.identity.id.v1"), mode: "player", inviteFromRole: "Player 1",
    });
    return created.game.id;
  });
  await page.goto(`/#/game/${gameId}`);
  await expect(page.getByTestId("game-role")).toContainText("Player 2");
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
  await expect(page.getByTestId("copy-invite")).toHaveCSS("background-color", "rgb(36, 94, 155)");
  await page.getByRole("link", { name: "Righelt", exact: true }).click();
  await expect(page.getByTestId("home-create-game")).toHaveCSS("background-color", "rgb(180, 47, 54)");
});

for (const viewport of [{ width: 375, height: 812 }, { width: 1100, height: 800 }, { width: 1600, height: 1000 }]) {
  test(`foundation at ${viewport.width}px is readable, keyboard reachable and reduced-motion still`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const logo = page.getByRole("img", { name: "Righelt", exact: true });
    await expect(logo).toBeVisible();
    await page.getByRole("link", { name: "Righelt", exact: true }).focus();
    expect(await page.getByRole("link", { name: "Righelt", exact: true }).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.clock.install();
    await page.clock.fastForward(20000);
    await expect(logo).toHaveAttribute("data-player", "red");
    await expect(logo).toHaveAttribute("data-cell", "0");
    const bounds = await logo.boundingBox();
    expect(bounds.width).toBeGreaterThan(160);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    const result = await runScopedAxeScan({ page, include: [".shell-header"], testInfo });
    expect(result.violations).toEqual([]);
    await testInfo.attach(`foundation-${viewport.width}`, { body: await page.screenshot({ path: testInfo.outputPath("foundation.png") }), contentType: "image/png" });
    await testInfo.attach(`wordmark-${viewport.width}`, { body: await logo.screenshot({ path: testInfo.outputPath("wordmark.png") }), contentType: "image/png" });
  });
}
