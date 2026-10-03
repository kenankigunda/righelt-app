import { test, expect } from "@playwright/test";
const stories = {
  babs: "Babs discovered Righelt during a rainstorm and has been demanding rematches ever since. She plays on instinct, celebrates early, and considers every defeat valuable research. Her research collection is impressive.",
  tau: "Tau spent years tending the village gardens, where he learned that everything depends on a good supply line. He brought that lesson to the board. He calls it patience. Babs calls it taking forever.",
  horus: "Horus learned to play in a watchtower, studying matches in the courtyard below. He eventually came down to explain what everyone was doing wrong. Unfortunately, he was usually right.",
};
async function register(page) {
  await page.goto("/"); await page.getByTestId("account-open").click();
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Username", { exact: true }).fill(`Story_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`);
  await dialog.getByLabel("Password", { exact: true }).fill("A story account test password 482");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("I saved my recovery code").check();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeEach(async () => { expect((await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988)+100}/reset-limits`, { method: "POST" })).ok).toBe(true); });

test("all approved stories and nine scenes remain usable without a trained runtime", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 }); await register(page);
  let creates = 0;
  const artRequests = [];
  page.on("request", request => { if (request.url().includes("/assets/opponents/")) artRequests.push(request.url()); });
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates++; });
  await page.getByRole("radio", { name: "Player 2 · Blue" }).check();
  for (const [id, story] of Object.entries(stories)) {
    const trigger = page.locator(`button[data-opponent="${id}"]`);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`^${id}`, "i") });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-story-retry]")).toBeHidden();
    await expect(page.locator(".story-presentation-board")).toHaveAttribute("inert", "");
    expect(artRequests.filter(url => url.includes(`/${id}-`))).toHaveLength(1);
    await expect(dialog.locator(".opponent-story-copy")).toHaveText(story);
    await expect(dialog.locator("[data-story-play]")).toBeDisabled();
    await expect(dialog.locator("[data-story-readiness]")).toContainText("Computer play is being prepared");
    for (let index = 0; index < 3; index++) {
      await dialog.getByRole("button", { name: `Show image ${index + 1} of 3` }).click();
      await expect(dialog.locator("[data-story-image]").nth(index)).toHaveAttribute("data-active", "true");
      await expect.poll(() => dialog.locator("[data-story-image]").nth(index).evaluate(image => image.complete && image.naturalWidth === 960)).toBe(true);
    }
    await expect(dialog.getByRole("button", { name: "Resume images" })).toBeVisible();
    await page.mouse.click(1, 1); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close opponent story" }).focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${id}-375.png`), fullPage: false });
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  expect(creates).toBe(0);
  expect(await page.evaluate(async () => (await (await fetch("/api/auth/session")).json()).account.preferences.introducedOpponents)).toBe(0);
});

test("reduced-motion stories stay manual and art failure preserves the full story and exits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await register(page);
  await page.route("**/babs-2-rematch.webp", route => route.abort());
  await page.locator('button[data-opponent="babs"]').click();
  const dialog = page.getByRole("dialog", { name: "Babs · Easy" });
  await expect(dialog.locator("[data-story-pause]")).toBeHidden();
  await dialog.getByRole("button", { name: "Show image 2 of 3" }).click();
  await expect(dialog.locator(".opponent-story-copy")).toHaveText(stories.babs);
  await expect(dialog.locator("[data-story-play]")).toBeDisabled();
  await dialog.getByRole("button", { name: "Close opponent story" }).click();
  await page.locator('button[data-opponent="babs"]').click();
  await expect(dialog.getByRole("button", { name: "Show image 1 of 3" })).toHaveAttribute("aria-pressed", "true");
});
