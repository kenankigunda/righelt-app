import { test, expect } from "@playwright/test";
const dialog = page => page.getByTestId("account-dialog");
async function finishRegistration(page) {
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(`Home_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`);
  await dialog(page).getByLabel("Password", { exact: true }).fill("A personal home test password 482");
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Save your recovery code" })).toBeVisible();
}
async function acknowledge(page) {
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}
async function home(page) {
  await page.getByRole("link", { name: "Righelt", exact: true }).click();
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await expect(page.locator('.shell-route-transition-layer')).toHaveAttribute("data-active", "false");
}
test.beforeEach(async () => {
  const response = await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988) + 100}/reset-limits`, { method: "POST" });
  expect(response.ok).toBe(true);
});

test("blue Friend intent survives registration and no game starts before recovery acknowledgment", async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let creates = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates++; });
  await page.goto("/");
  await expect(page.locator('[data-zone="home-resume"]')).toHaveCount(0);
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
  await page.getByTestId("home-create-game").click();
  await finishRegistration(page);
  expect(creates).toBe(0);
  await acknowledge(page);
  await expect(page.getByTestId("game-role")).toContainText("Player 2");
  expect(creates).toBe(1);
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => (await (await fetch("/api/auth/session")).json()).account.preferences.view)).toBe("explanatory");
  await page.reload();
  await expect(page.getByRole("button", { name: "Explain", exact: true })).toHaveAttribute("aria-pressed", "true");
  const guest = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    await guest.goto(page.url());
    await guest.locator("#shell-board .cell").first().focus();
    await guest.keyboard.press("Enter");
    await expect(dialog(guest)).toBeVisible();
  } finally { await guest.close(); }

});

test("cancelling account gate keeps choice, and unavailable computer never creates a substitute match", async ({ page }) => {
  let creates = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates++; });
  await page.goto("/");
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await page.locator('[data-opponent="babs"]').click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole("radio", { name: "Player 2 · Blue" })).toBeChecked();
  expect(creates).toBe(0);
  await page.locator('[data-opponent="babs"]').click();
  await finishRegistration(page);
  await acknowledge(page);
  await expect(page.locator(".home-start-status")).toContainText("Computer play is being prepared");
  await page.locator('[data-opponent="babs"]').focus();
  await page.keyboard.press("Space");
  await expect(page.locator('[data-opponent="babs"]')).toBeFocused();
  expect(creates).toBe(0);
  await expect(page.getByTestId("home-create-game")).toBeVisible();
});

test("resume puts your older turn before a newer waiting game and retries a failed load", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("home-create-game").click();
  await finishRegistration(page); await acknowledge(page);
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  const firstId = page.url().match(/game\/([^?]+)/)[1];
  await home(page);
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await page.getByTestId("home-create-game").click();
  await expect(page.getByTestId("game-role")).toContainText("Player 2");
  await page.route("**/api/shell/games?**unfinished=1*", route => route.abort());
  await home(page);
  await expect(page.locator('[data-zone="home-resume"]')).toContainText("could not be loaded");
  await page.unroute("**/api/shell/games?**unfinished=1*");
  await page.locator('[data-action="retry-resume"]').click();
  const resume = page.locator('[data-zone="home-resume"]');
  await expect(resume.locator('.mini-board-card-link-surface').first()).toHaveAttribute("data-game-id", firstId);
  await expect(resume.locator('.resume-turn').first()).toHaveText("Your turn");
  expect((await resume.boundingBox()).y).toBeLessThan((await page.locator('[data-zone="home-start"]').boundingBox()).y);
  await testInfo.attach("personal-home", { body: await page.screenshot({ path: testInfo.outputPath("personal-home.png"), fullPage: true }), contentType: "image/png" });
});

for (const width of [375, 1100, 1600]) test(`personal home fits ${width}px and keeps keyboard side choice visible`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const red = page.getByRole("radio", { name: "Player 1 · Red" });
  await red.focus();
  await page.keyboard.press("ArrowRight");
  const blue = page.getByRole("radio", { name: "Player 2 · Blue" });
  await expect(blue).toBeChecked();
  await expect(blue).toBeFocused();
  expect(await blue.evaluate(element => getComputedStyle(element).appearance)).not.toBe("none");
  const babs = await page.locator('[data-opponent="babs"]').boundingBox();
  const horus = await page.locator('[data-opponent="horus"]').boundingBox();
  if (width >= 1200) expect(horus.y).toBe(babs.y);
  else expect(horus.y).toBeGreaterThan(babs.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await testInfo.attach(`personal-home-${width}`, { body: await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true }), contentType: "image/png" });
});
