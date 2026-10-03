import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { layoutStyles } from "../support/layout-styles.mjs";
import { expectRematchRadioGeometry } from "../support/rematch-layout.mjs";

for (const width of [375, 1100, 1600]) {
  test(`rematch native radios fit and support keyboard selection at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${layoutStyles}</style><main><h1>Game</h1></main>`);
    const source = (await Promise.all(["modal.js", "game-result.js"].map(file =>
      readFile(new URL(`../../apps/web/shell/${file}`, import.meta.url), "utf8")))).join("\n");
    await page.addScriptTag({ type: "module", content: `${source}\nwindow.rematch = createRematchDialog({ createModal, onStart: async intent => { window.started = intent; } });` });
    await page.evaluate(() => window.rematch.open({ opponent: "friend", rematchSide: "p1" }));
    const dialog = page.getByRole("dialog", { name: "Play again", exact: true });
    await expectRematchRadioGeometry(dialog);
    const red = dialog.getByRole("radio", { name: "Player 1 · Red", exact: true });
    const blue = dialog.getByRole("radio", { name: "Player 2 · Blue", exact: true });
    await expect(red).toBeChecked();
    await red.focus();
    await page.keyboard.press("ArrowRight");
    await expect(blue).toBeChecked();
    await expect(blue).toBeFocused();
    await expect(red).not.toBeChecked();
    await dialog.screenshot({ path: info.outputPath("rematch-native-radios.png") });
    await dialog.getByRole("button", { name: "Start game", exact: true }).click();
    expect(await page.evaluate(() => window.started)).toEqual({ opponent: "friend", side: "p2" });
  });
}
