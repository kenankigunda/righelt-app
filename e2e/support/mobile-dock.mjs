import { expect } from "@playwright/test";

export async function expectMobileDockClear(page) {
  const nav = page.locator(".shell-mobile-tabbar");
  const help = page.locator(".game-help");
  const box = await nav.boundingBox();
  expect(box).not.toBeNull();
  if (await help.isVisible()) {
    const helpBox = await help.boundingBox();
    expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(box.y + 1);
  }
  const tabs = nav.locator("button");
  await expect(tabs).toHaveCount(3);
  for (const tab of await tabs.all()) {
    expect(await tab.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight &&
        el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
  }
}
