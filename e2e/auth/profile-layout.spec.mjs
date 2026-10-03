import { profileLayoutDisplayName, profileLayoutUsername } from "../support/profile-layout.mjs";
import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { participantButton } from "../../apps/web/shell/public-profile.js";

const css = (await Promise.all(["../../apps/web/styles.css", "../../apps/web/shell/shell.css"].map(file => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
for (const width of [220, 270, 320]) {
  test(`long public names fit ${width}px participant panels and remain readable`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const person = { profile: { displayName: profileLayoutDisplayName, username: profileLayoutUsername } };
    await page.setContent(`<style>${css}</style><section class="panel" style="width:${width}px"><h2>Participants</h2><ul class="participant-list"><li>Player 1: ${participantButton(person)} <span>Connected</span></li></ul></section>`);
    const bounds = await page.locator(".participant-profile").evaluate(button => {
      const panel = button.closest(".panel").getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const text = [...button.querySelectorAll("bdi")].flatMap(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        return [...range.getClientRects()].map(r => ({ left: r.left, right: r.right }));
      });
      return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right, text, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
    });
    assert.ok(bounds.left >= bounds.panelLeft && bounds.right <= bounds.panelRight, `${width}px button stays in its panel`);
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, `${width}px button has no hidden horizontal overflow`);
    for (const fragment of bounds.text) assert.ok(fragment.left >= bounds.left - 1 && fragment.right <= bounds.right + 1, `${width}px every name fragment stays in its button`);
    await page.locator(".participant-profile").focus();
    assert.equal(await page.locator(".participant-profile").evaluate(button => button === document.activeElement), true);
  });
}
