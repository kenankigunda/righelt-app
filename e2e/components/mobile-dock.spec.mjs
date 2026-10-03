import { test, expect } from "@playwright/test";
import { layoutStyles } from "../support/layout-styles.mjs";
import { expectMobileDockClear } from "../support/mobile-dock.mjs";
for (const [width, height, fontSize, safeArea] of [[390,844,16,0], [375,540,16,0], [390,844,24,24]]) {
  test(`mobile docks stay separate after scrolling ${width}x${height} font${fontSize}`, async ({ page }, info) => {
    await page.setViewportSize({width, height});
    await page.setContent(`<style>${layoutStyles}</style><style>:root{font-size:${fontSize}px;--shell-mobile-safe-area-bottom:${safeArea}px}</style>
      <main id="app" class="app-root" data-shell-route="game" data-shell-layout-mode="narrow" data-shell-game-panel="board">
        <header style="height:120px">Righelt</header><div class="shell-main-content"><section class="game-shell-frame">
          <div class="game-shell-track-wrap"><section class="game-shell-track"><div class="game-shell-mobile-panel" data-mobile-panel="board"><div style="height:700px">Board</div></div></section></div>
          <nav class="shell-mobile-tabbar"><button class="secondary shell-mobile-tab">Players</button><button class="secondary shell-mobile-tab">Board</button><button class="secondary shell-mobile-tab">History</button></nav>
          <section class="game-help" data-expanded="true"><div class="game-help-controls"><button class="secondary">Explain</button><button class="secondary" data-disclosure>Collapse</button></div><p class="game-help-copy">Select a piece to inspect its supply, command and available actions.</p></section>
        </section></div></main>`);
    expect(await page.locator(".shell-mobile-tabbar").evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))).toBeCloseTo(fontSize * 0.75 + safeArea, 1);
    await page.locator(".shell-mobile-tabbar").evaluate(nav => nav.addEventListener("click", event => { nav.dataset.clicked = event.target.textContent; }));
    for (const expanded of ["true", "false"]) {
      await page.locator(".game-help").evaluate((el, value) => el.dataset.expanded = value, expanded);
      await page.locator("[data-disclosure]").evaluate((el, value) => el.textContent = value === "true" ? "Collapse" : "Expand", expanded);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await expectMobileDockClear(page);
      for (const name of ["Players", "History", "Board"]) {
        await page.getByRole("button", {name, exact:true}).click();
        await expect(page.locator(".shell-mobile-tabbar")).toHaveAttribute("data-clicked", name);
      }
    }
    await page.screenshot({path:info.outputPath("mobile-dock.png")});
    await page.setViewportSize({width:1200,height:900});
    await page.locator("#app").evaluate(el => el.dataset.shellLayoutMode = "wide");
    await expect(page.locator(".shell-mobile-tabbar")).toBeHidden();
    expect(await page.locator(".game-help").evaluate(el => getComputedStyle(el).position)).not.toBe("fixed");
  });
}
