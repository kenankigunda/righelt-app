import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function makeAnyLegalMove(page) {
  const read = () => page.evaluate(async () => {
    const gameId = decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
    const session = await (await fetch("/api/auth/session")).json();
    return (await (await fetch(`/api/shell/games/${gameId}`, { headers: { "X-Righelt-Auth-Version": "1", "X-Righelt-Session": session.contextId } })).json()).game;
  });
  const before = await read(); const action = before.legalActions.find(action => action.from && action.to);
  const cell = position => page.locator(`#shell-board .cell[data-row="${position.row}"][data-col="${position.col}"]`);
  await cell(action.from).click(); await cell(action.to).click(); await cell(action.to).click();
  await expect.poll(async () => (await read()).moves.length).toBeGreaterThan(before.moves.length);
}
async function register(page) {
  await page.goto("/"); await page.getByTestId("account-open").click();
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(`Polish_${Date.now().toString(36)}`);
  await dialog.getByLabel("Password", { exact: true }).fill("A final polish account password 482");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("I saved my recovery code").check();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeEach(async () => { expect((await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988)+100}/reset-limits`, { method: "POST" })).ok).toBe(true); });
test("blue account dialogs retain accessible controls at narrow, landscape and enlarged layouts", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 320, height: 720 }); await page.goto("/");
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check(); await page.getByTestId("home-create-game").click();
  const dialog = page.getByTestId("account-dialog");
  await expect(dialog).toHaveAttribute("data-action-affiliation", "blue");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 253, 246)");
  expect((await new AxeBuilder({ page }).include('[data-testid="account-dialog"]').analyze()).violations).toEqual([]);
  for (const viewport of [{ width: 320, height: 720 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 640, height: 800 });
  await page.addStyleTag({ content: '.account-dialog { zoom: 2; width: calc(100vw / 2); height: calc(100dvh / 2); max-height: calc(100dvh / 2); }' });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("account-enlarged.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
test("device sound is muted initially, confirms once, and reload stays silent", async ({ page }) => {
  await page.addInitScript(() => {
    window.__tones = 0;
    window.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; } createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() { window.__tones++; }, stop() {} }; } };
  });
  await register(page); await page.getByRole("button", { name: "Self-play", exact: true }).click(); await expect(page.getByTestId("game-shell")).toBeVisible();
  await makeAnyLegalMove(page); expect(await page.evaluate(() => window.__tones)).toBe(0);
  await page.getByTestId("account-open").click();
  const toggle = page.getByRole("button", { name: "Sound on this device: Off", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false"); await toggle.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await makeAnyLegalMove(page); await expect.poll(() => page.evaluate(() => window.__tones)).toBe(1);
  await page.reload(); await expect(page.getByTestId("game-shell")).toBeVisible(); expect(await page.evaluate(() => window.__tones)).toBe(0);
  await page.getByTestId("account-open").click(); await expect(page.getByRole("button", { name: "Sound on this device: On", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByTestId("account-open").click();
  await page.getByRole("button", { name: "Sound on this device: On", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sound on this device: Off", exact: true })).toHaveAttribute("aria-pressed", "false");
});
test("resume loading reserves Start position without blocking it", async ({ page }, testInfo) => {
  await register(page); await page.getByRole("button", { name: "Self-play", exact: true }).click(); await expect(page.getByTestId("game-shell")).toBeVisible();
  let release, arrived; const held = new Promise(resolve => { release = resolve; }); const requested = new Promise(resolve => { arrived = resolve; });
  await page.route("**/api/shell/games?**unfinished=1*", async route => { const response = await route.fetch(); arrived(); await held; await route.fulfill({ response }); });
  await page.getByRole("link", { name: "Righelt", exact: true }).click(); await requested;
  const start = page.getByTestId("home-create-game"); await expect(start).toBeEnabled();
  const before = await start.boundingBox(); release();
  await expect(page.locator('[data-zone="home-resume"]')).toHaveAttribute("aria-busy", "false");
  const after = await start.boundingBox(); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  for (const viewport of [{ width: 375, height: 812 }, { width: 1100, height: 800 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
    await page.screenshot({ path: testInfo.outputPath(`personal-home-${viewport.width}.png`), fullPage: true });
  }
});

test("dismissed rule help survives reload and respects the hydrated manual preference", async ({ page }) => {
  await register(page); await page.getByTestId("home-create-game").click(); await expect(page.getByTestId("game-shell")).toBeVisible();
  const source = await page.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    const id = decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
    const game = (await (await fetch(`/api/shell/games/${id}`, { headers: { "X-Righelt-Auth-Version": "1", "X-Righelt-Session": session.contextId } })).json()).game;
    return game.legalActions.find(action => action.from && action.to).from;
  });
  const triggerRule = async () => {
    await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
    await page.locator(`#shell-board .cell[data-row="${source.row}"][data-col="${source.col}"]`).click();
    await page.locator('#shell-board .cell[data-row="4"][data-col="9"]').click();
  };
  await triggerRule();
  await expect(page.locator('[data-zone="game-help"]')).toHaveAttribute("data-expanded", "true");
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await page.reload(); await expect(page.getByTestId("game-shell")).toBeVisible(); await triggerRule();
  await expect(page.locator('[data-zone="game-help"]')).toHaveAttribute("data-expanded", "false");
  await page.getByTestId("account-open").click(); await page.getByLabel("View preference").selectOption("explanatory");
  await page.getByRole("button", { name: "Save account settings", exact: true }).click();
  await expect(page.getByTestId("account-dialog").getByText("Account settings saved.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/api/auth/session")).json()).account.preferences.view)).toBe("explanatory");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload(); await expect(page.getByRole("button", { name: "Explain", exact: true })).toHaveAttribute("aria-pressed", "true");
});
