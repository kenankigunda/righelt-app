import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const contracts = JSON.parse(
  readFileSync(new URL("./support/lookup.json", import.meta.url), "utf8"),
);
import AxeBuilder from "@axe-core/playwright";
for (const width of [390, 1440]) {
  test(`account focus, geometry and accessibility at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForFunction(() => window.fixtureReady);
    await page.getByRole("button", { name: "Open account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="account-dialog"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("account-dialog.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open account" }),
    ).toBeFocused();
  });
}
test("obsolete lookup completion cannot update a dismissed form", async ({
  page,
}) => {
  let release, complete;
  const held = new Promise((resolve) => (release = resolve)),
    completed = new Promise((resolve) => (complete = resolve));
  await page.route("**/lookup?**", async (route) => {
    await held;
    await route.fulfill({ json: contracts.taken }).catch(() => {});
    complete();
  });
  try {
    await page.goto("/");
    await page.waitForFunction(() => window.fixtureReady);
    await page.evaluate(() => {
      window.accountFixture.ignoreLookupAbort();
      window.accountFixture.open("register");
    });
    await page.locator('[name="username"]').fill("controlled_user");
    await page.waitForRequest("**/lookup?**");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.accountFixture.open("register"));
    release();
    await completed;
    await page.waitForFunction(() => window.accountFixture.lookupSettled() > 0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator('[name="username"]')).toHaveValue("");
    await expect(page.getByRole("dialog").locator("form")).toHaveAttribute(
      "data-lookup-state",
      "idle",
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("reduced motion prevents content-size animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(() => {
    window.heightAnimations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, ...args) {
      if (
        this.matches?.('[data-testid="account-dialog"]') &&
        frames.some((frame) => "height" in frame)
      )
        window.heightAnimations++;
      return animate.call(this, frames, ...args);
    };
    window.accountFixture.open("login");
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => window.accountFixture.open("register"));
  await expect(page.getByRole("dialog").locator("form")).toHaveAttribute(
    "data-entry-mode",
    "create",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await page.evaluate(() => window.heightAnimations)).toBe(0);
});
