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

test("a pending home list cannot delay or replace the chosen game after account acknowledgment", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await page.getByTestId("home-create-game").click();
  await finishRegistration(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let held = 0;
  const creates = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates.push(request.postDataJSON());
  });
  await page.route(/\/api\/shell\/games\?.*section=other/, async route => {
    const response = await route.fetch();
    held++;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await acknowledge(page);
    await expect.poll(() => held).toBeGreaterThan(0);
    await expect(page.getByTestId("game-role")).toContainText("Player 2");
    const gameUrl = page.url();
    expect(creates).toHaveLength(1);
    expect(creates[0].creatorSide).toBe("p2");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(page).toHaveURL(gameUrl);
    await expect(page.getByTestId("game-role")).toContainText("Player 2");
    expect(creates).toHaveLength(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
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

for (const width of [320, 375, 1100, 1600]) test(`personal home fits ${width}px and keeps keyboard side choice visible`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const red = page.getByRole("radio", { name: "Player 1 · Red" });
  await red.focus();
  await page.keyboard.press("ArrowRight");
  const blue = page.getByRole("radio", { name: "Player 2 · Blue" });
  await expect(blue).toBeChecked();
  await expect(blue).toBeFocused();
  expect(await blue.evaluate(element => getComputedStyle(element).appearance)).not.toBe("none");
  await expect.poll(() => page.evaluate((wide) => {
    const babs = document.querySelector('[data-opponent="babs"]')?.getBoundingClientRect();
    const horus = document.querySelector('[data-opponent="horus"]')?.getBoundingClientRect();
    return Boolean(babs && horus && (wide ? horus.y === babs.y : horus.y > babs.y));
  }, width >= 1200)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect(page.locator('[data-opponent="babs"]')).toHaveCSS("background-color", "rgb(36, 94, 155)");
  await testInfo.attach(`personal-home-${width}`, { body: await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true }), contentType: "image/png" });
});

test("blue self-play keeps its selected affiliation after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  await page.locator('[data-opponent="self"]').click();
  await finishRegistration(page); await acknowledge(page);
  await expect(page.locator("#shell-board")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
  await page.reload();
  await expect(page.locator("#shell-board")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-action-affiliation", "blue");
});

test("Explain activation survives an account response arriving during its press", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("home-create-game").click();
  await finishRegistration(page); await acknowledge(page);
  const explain = page.getByRole("button", { name: "Explain", exact: true });
  await expect(explain).toBeVisible();
  let release, intercepted;
  const held = new Promise(resolve => { intercepted = resolve; });
  await page.route("**/api/auth/session", async route => {
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; intercepted(); });
    await route.fulfill({ response });
  }, { times: 1 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await held;
  await explain.scrollIntoViewIfNeeded();
  const box = await explain.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  release();
  await page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
  await page.mouse.up();
  await expect(explain).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/api/auth/session")).json()).account.preferences.view)).toBe("explanatory");
});

test("an initial session wait preserves the side chosen when play was requested", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("account-open")).toBeVisible();
  let release, arrived;
  const held = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/auth/session", async route => {
    const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.reload(); await held;
    await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
    await page.getByTestId("home-create-game").click();
    await page.getByRole("radio", { name: "Player 1 · Red" }).check();
    release();
    await finishRegistration(page); await acknowledge(page);
    await expect(page.getByTestId("game-role")).toContainText("Player 2");
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});
