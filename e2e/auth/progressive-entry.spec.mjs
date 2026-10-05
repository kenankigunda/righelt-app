import { test, expect } from "@playwright/test";
import { enterUsername, openPlaySignIn, waitForAccountStartup } from "./helpers.mjs";
import { AUTH_REQUEST_HEADER, AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION } from "../../packages/shared-types/src/auth-policy.js";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `Entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const password = "Account browser password 428";

test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
});
async function open(page) {
  await page.goto("/");
  await openPlaySignIn(page);
  await expect(dialog(page).getByRole("heading", { name: "Log in to start playing" })).toBeVisible();
}
async function create(page) {
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
}
async function existingAccount(request, baseURL) {
  const username = uniqueName();
  const response = await request.post("/api/auth/register", {
    headers: { Origin: new URL(baseURL).origin, [AUTH_REQUEST_HEADER]: "1", [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION) },
    data: { username, password },
  });
  expect(response.status()).toBe(200);
  return username;
}

test("sign-in immediately shows both fields and never looks up a username", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  let lookups = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/username") lookups++; });
  await open(page);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeVisible();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(dialog(page).getByTestId("password-requirements")).toHaveCount(0);
  await expect(dialog(page).locator(".account-help")).toBeHidden();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).not.toBeVisible();
  expect(lookups).toBe(0);
});

test("explicit creation retains a taken username without changing forms or disabling submit", async ({ page, request, baseURL }) => {
  const taken = await existingAccount(request, baseURL);
  await open(page);
  await create(page);
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await enterUsername(page, taken);
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "taken");
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await dialog(page).getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(taken);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
});

test("creation keeps password through username edits, clears it on form switch, and defaults the display name to username", async ({ page }) => {
  await open(page);
  await create(page);
  const username = uniqueName();
  await enterUsername(page, username);
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveCount(0);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  const changed = uniqueName();
  await enterUsername(page, changed);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
  await dialog(page).getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(changed);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  const destination = page.url();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(changed);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  expect(page.url()).toBe(destination);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(dialog(page).getByLabel("Display name", { exact: true })).toHaveValue(changed);
});

test("creation checklist starts neutral and validates an eight-character password locally", async ({ page }) => {
  await open(page);
  await create(page);
  const checklist = dialog(page).getByTestId("password-requirements");
  for (const name of ["length", "differentFromUsername", "notCommon"])
    await expect(checklist.locator(`[data-requirement="${name}"]`)).toHaveAttribute("data-state", "neutral");
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill("password");
  const common = checklist.locator('[data-requirement="notCommon"]');
  await expect(common).toHaveAttribute("data-state", "unmet");
  await expect(common).toContainText("not met");
  const unmetColor = await common.evaluate(node => getComputedStyle(node).color);
  const [unmetR, unmetG] = unmetColor.match(/[\d.]+/g).map(Number);
  expect(unmetR).toBeGreaterThan(unmetG);
  await dialog(page).getByLabel("Password", { exact: true }).fill("Ax7!pQ2z");
  await expect(checklist.locator('[data-state="met"]')).toHaveCount(3);
  await expect(common).toContainText("met");
  const metColor = await common.evaluate(node => getComputedStyle(node).color);
  const [metR, metG] = metColor.match(/[\d.]+/g).map(Number);
  expect(metG).toBeGreaterThan(metR);
  expect(metColor).not.toBe(unmetColor);
  await dialog(page).getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  const gameUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  expect(page.url()).toBe(gameUrl);
});

test("obsolete availability results cannot overwrite a newer name or switch into sign-in", async ({ page }) => {
  let release, arrived;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  const first = uniqueName(), second = uniqueName();
  await page.route("**/api/auth/username", async route => {
    if (route.request().postDataJSON().username === first) {
      arrived(); await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: true }) }).catch(() => {});
    } else await route.continue();
  });
  try {
    await open(page);
    await create(page);
    await enterUsername(page, first);
    await started;
    await enterUsername(page, second);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
    await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
    await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
    await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("failed availability is unknown and permits authoritative registration", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/auth/username", async route => {
    calls++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
  });
  await open(page);
  await create(page);
  const username = uniqueName();
  await enterUsername(page, username);
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "error");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(username);
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(calls).toBe(1);
});

test("forgotten-password help points to a signed-in device and offers a fresh account", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  await open(page);
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill("An incorrect password 943");
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).not.toHaveText("");
  await expect(dialog(page).locator("[data-existing-hint]")).toBeVisible();
  const errorLayout = await dialog(page).evaluate(node => {
    const status = node.querySelector('[data-account-status]');
    const hint = node.querySelector('[data-existing-hint]');
    const secret = node.querySelector('[name="password"]');
    return {
      state: status.dataset.state, color: getComputedStyle(status).color,
      top: status.getBoundingClientRect().top, bottom: status.getBoundingClientRect().bottom,
      passwordBottom: secret.getBoundingClientRect().bottom, hintTop: hint.getBoundingClientRect().top,
      hintFont: getComputedStyle(hint).fontSize, forgotFont: getComputedStyle(node.querySelector('summary')).fontSize,
    };
  });
  expect(errorLayout.state).toBe("error");
  expect(errorLayout.top).toBeGreaterThanOrEqual(errorLayout.passwordBottom);
  expect(errorLayout.bottom).toBeLessThanOrEqual(errorLayout.hintTop);
  const [red, green] = errorLayout.color.match(/[\d.]+/g).map(Number);
  expect(red).toBeGreaterThan(green);
  expect(errorLayout.hintFont).toBe(errorLayout.forgotFont);
  const helpGap = await dialog(page).evaluate(node => node.querySelector('summary').getBoundingClientRect().top - node.querySelector('[data-existing-hint]').getBoundingClientRect().bottom);
  expect(helpGap).toBeGreaterThanOrEqual(0);
  expect(helpGap).toBeLessThanOrEqual(6);
  await dialog(page).locator("summary").filter({ hasText: "Forgot password?" }).click();
  await expect(dialog(page)).toContainText("Change password");
  await expect(dialog(page)).toContainText(/signed.in/);
  await dialog(page).getByRole("button", { name: "Choose another username", exact: true }).click();
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
});

test("a lost registration response inspects the session without creating twice", async ({ page }) => {
  let creates = 0;
  await page.route("**/api/auth/register", async route => {
    creates++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await open(page);
  await create(page);
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  expect(creates).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});

test("registration collision stays in creation and never retries as login", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  let registrations = 0, logins = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/register") registrations++;
    if (path === "/api/auth/login") logins++;
  });
  await page.route("**/api/auth/username", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: false }),
  }));
  await open(page);
  await create(page);
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
  expect(registrations).toBe(1);
  expect(logins).toBe(0);
});

test("an unavailable common-password list is disclosed without blocking authoritative creation", async ({ page }) => {
  await page.route("**/generated/packages/shared-types/data/common-passwords.json", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }),
  }));
  await open(page);
  await create(page);
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  const common = dialog(page).getByTestId("password-requirements").locator('[data-requirement="notCommon"]');
  await expect(common).toHaveAttribute("data-state", "unavailable");
  await expect(common).toContainText(/unavailable/i);
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});


test("sign-in creation hint waits five seconds after username blur without routing or looking up names", async ({ page }) => {
  let lookups = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/username") lookups++; });
  await open(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const hint = dialog(page).locator("[data-existing-hint]");
  const username = dialog(page).getByLabel("Username", { exact: true });
  const secret = dialog(page).getByLabel("Password", { exact: true });
  await expect(hint).toBeHidden();
  await username.fill("NewPlayer");
  await secret.focus();
  await page.clock.fastForward(4999);
  await expect(hint).toBeHidden();
  await page.clock.fastForward(1);
  await expect(hint).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Log in to start playing" })).toBeVisible();
  expect(lookups).toBe(0);
  await page.clock.resume();
  await dialog(page).getByRole("link", { name: "Create a new account.", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
});

test("password input, username edits and refocus cancel the delayed sign-in hint", async ({ page }) => {
  await open(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const hint = dialog(page).locator("[data-existing-hint]");
  const username = dialog(page).getByLabel("Username", { exact: true });
  const secret = dialog(page).getByLabel("Password", { exact: true });
  await username.fill("NewPlayer");
  await secret.focus();
  await page.clock.fastForward(4000);
  await secret.fill("x");
  await secret.fill("");
  await page.clock.fastForward(6000);
  await expect(hint).toBeHidden();
  await username.focus();
  await secret.focus();
  await page.clock.fastForward(4000);
  await username.focus();
  await page.clock.fastForward(6000);
  await expect(hint).toBeHidden();
  await secret.focus();
  await page.clock.fastForward(4000);
  await username.fill("DifferentPlayer");
  await page.clock.fastForward(6000);
  await expect(hint).toBeHidden();
  await username.fill("   ");
  await secret.focus();
  await page.clock.fastForward(6000);
  await expect(hint).toBeHidden();
  await page.clock.resume();
});

test("leaving sign-in or closing the dialog cancels its pending hint", async ({ page }) => {
  await open(page);
  await page.clock.install();
  const username = dialog(page).getByLabel("Username", { exact: true });
  const secret = dialog(page).getByLabel("Password", { exact: true });
  await username.fill("NewPlayer");
  await secret.focus();
  await create(page);
  await page.clock.fastForward(6000);
  await dialog(page).getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(dialog(page).locator("[data-existing-hint]")).toBeHidden();
  await secret.focus();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await page.clock.fastForward(6000);
  await openPlaySignIn(page);
  await expect(username).toHaveValue("");
  await expect(dialog(page).locator("[data-existing-hint]")).toBeHidden();
});

test("switching forms focuses password for a preserved username and username when empty", async ({ page }) => {
  await open(page);
  const username = dialog(page).getByLabel("Username", { exact: true });
  const secret = dialog(page).getByLabel("Password", { exact: true });
  await username.fill("FocusPlayer");
  await secret.fill(password);
  await create(page);
  await expect(username).toHaveValue("FocusPlayer");
  await expect(secret).toHaveValue("");
  await expect(secret).toBeFocused();
  await secret.fill(password);
  await dialog(page).getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(username).toHaveValue("FocusPlayer");
  await expect(secret).toHaveValue("");
  await expect(secret).toBeFocused();
  await username.fill("   ");
  await create(page);
  await expect(username).toBeFocused();
  await dialog(page).getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(username).toBeFocused();
});

test("public landing has no sign-in shortcut and keyboard play opens a cancellable account gate", async ({ page }) => {
  let creates = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates++;
  });
  await page.goto("/");
  await waitForAccountStartup(page);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account", exact: true })).toHaveCount(0);
  const original = page.url();
  const play = page.getByRole("button", { name: "Start new game", exact: true });
  await play.focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("heading", { name: "Log in to start playing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(play).toBeFocused();
  expect(page.url()).toBe(original);
  expect(creates).toBe(0);
});

test("username availability uses matching status colors and an accessible reduced-motion loading state", async ({ page }) => {
  let release, reached;
  const held = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { reached = resolve; });
  const first = uniqueName(), taken = uniqueName();
  await page.route("**/api/auth/username", async route => {
    const isTaken = route.request().postDataJSON().username === taken;
    if (!isTaken) { reached(); await held; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: isTaken }) });
  });
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page);
    await create(page);
    await enterUsername(page, first);
    await pending;
    const status = dialog(page).locator("[data-username-status]");
    await expect(status).toHaveAttribute("data-state", "pending");
    await expect(status).toContainText(/Checking/i);
    await expect(status).toHaveCSS("animation-name", "account-loading-swipe");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(status).toHaveCSS("animation-name", "none");
    await expect(status).toContainText(/Checking/i);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    const length = dialog(page).locator('[data-requirement="length"]');
    await expect(length).toHaveAttribute("data-state", "met");
    release();
    await expect(status).toHaveAttribute("data-state", "available");
    await expect(status).toHaveText(/^✓/);
    expect(await status.evaluate(node => getComputedStyle(node).color)).toBe(await length.evaluate(node => getComputedStyle(node).color));
    await enterUsername(page, taken);
    await expect(status).toHaveAttribute("data-state", "taken");
    await expect(status).toHaveText(/^✕/);
    await dialog(page).getByLabel("Password", { exact: true }).fill(taken);
    const different = dialog(page).locator('[data-requirement="differentFromUsername"]');
    await expect(different).toHaveAttribute("data-state", "unmet");
    expect(await status.evaluate(node => getComputedStyle(node).color)).toBe(await different.evaluate(node => getComputedStyle(node).color));
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("revealed username feedback reserves its row while valid edits debounce and incomplete edits stay quiet", async ({ page }) => {
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/auth/username", async route => {
    calls++;
    if (calls === 2) await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: false }) }).catch(() => {});
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await create(page);
    await enterUsername(page, uniqueName());
    const status = dialog(page).locator("[data-username-status]");
    const secret = dialog(page).getByLabel("Password", { exact: true });
    await expect(status).toHaveAttribute("data-state", "available");
    const rowHeight = (await status.boundingBox()).height;
    const passwordY = (await secret.boundingBox()).y;
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await enterUsername(page, uniqueName());
    await expect(status).toHaveAttribute("data-state", "pending");
    expect(calls).toBe(1);
    expect((await secret.boundingBox()).y).toBeCloseTo(passwordY, 0);
    await page.clock.fastForward(499);
    expect(calls).toBe(1);
    await page.clock.fastForward(1);
    await expect.poll(() => calls).toBe(2);
    await enterUsername(page, "");
    await expect(status).toHaveAttribute("data-state", "idle");
    await expect(status).toHaveText("");
    expect((await status.boundingBox()).height).toBeCloseTo(rowHeight, 0);
    expect((await secret.boundingBox()).y).toBeCloseTo(passwordY, 0);
    await enterUsername(page, "a");
    await page.clock.fastForward(1000);
    await expect(status).toHaveText("");
    expect(calls).toBe(2);
    expect((await secret.boundingBox()).y).toBeCloseTo(passwordY, 0);
    await page.clock.resume();
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("wrapped unavailable username feedback keeps its height while editing or clearing", async ({ page }) => {
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/auth/username", async route => {
    if (++calls === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
    else {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: false }) }).catch(() => {});
    }
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await create(page);
    await enterUsername(page, uniqueName());
    const status = dialog(page).locator("[data-username-status]");
    const secret = dialog(page).getByLabel("Password", { exact: true });
    await expect(status).toHaveAttribute("data-state", "error");
    const errorHeight = (await status.boundingBox()).height;
    expect(await status.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return range.getClientRects().length; })).toBeGreaterThan(1);
    const beforeY = (await secret.boundingBox()).y;
    await enterUsername(page, uniqueName());
    await expect(status).toHaveAttribute("data-state", "pending");
    expect((await status.boundingBox()).height).toBeCloseTo(errorHeight, 0);
    expect((await secret.boundingBox()).y).toBeCloseTo(beforeY, 0);
    await expect.poll(() => calls).toBe(2);
    await enterUsername(page, "");
    await expect(status).toHaveText("");
    expect((await status.boundingBox()).height).toBeCloseTo(errorHeight, 0);
    expect((await secret.boundingBox()).y).toBeCloseTo(beforeY, 0);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});
