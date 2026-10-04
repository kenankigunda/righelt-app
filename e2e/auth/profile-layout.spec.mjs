import { profileLayoutDisplayName, profileLayoutUsername, sampleParticipantGeometry } from "../support/profile-layout.mjs";
import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { layoutStyles } from "../support/layout-styles.mjs";
import { participantButton } from "../../apps/web/shell/public-profile.js";

for (const width of [220, 270, 320]) {
  test(`long public names fit ${width}px participant panels and remain readable`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const person = { profile: { displayName: profileLayoutDisplayName, username: profileLayoutUsername } };
    await page.setContent(`<style>${layoutStyles}</style><section class="panel" style="width:${width}px"><h2>Participants</h2><ul class="participant-list"><li>Player 1: ${participantButton(person)} <span>Connected</span></li></ul></section>`);
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

test("participant geometry samples replacement nodes and exposes real overflow", async ({ page }) => {
  await page.setContent('<section data-game-panel="participants" style="width:220px"><div data-testid="participant-player-1"><button style="width:100px">Original</button></div></section>');
  const staleHandle = await page.locator('[data-testid="participant-player-1"] button').elementHandle();
  const original = await page.evaluate(sampleParticipantGeometry);
  assert.ok(original);
  await page.evaluate(() => {
    const old = document.querySelector('[data-testid="participant-player-1"] button');
    window.detachedParticipant = old;
    old.replaceWith(Object.assign(document.createElement('button'), { textContent: 'Replacement' }));
    const next = document.querySelector('[data-testid="participant-player-1"] button');
    next.style.width = '180px';
  });
  assert.equal(await page.evaluate(() => window.detachedParticipant.isConnected), false);
  assert.equal(await staleHandle.boundingBox(), null, 'a retained handle loses geometry on replacement');
  await staleHandle.dispose();
  const replaced = await page.evaluate(sampleParticipantGeometry);
  assert.ok(replaced);
  assert.equal(replaced.width, 180);
  assert.ok(replaced.x >= replaced.panelX);
  assert.ok(replaced.x + replaced.width <= replaced.panelX + replaced.panelWidth);
  assert.ok(replaced.scrollWidth <= replaced.clientWidth + 1);
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="participant-player-1"] button');
    button.style.width = '400px';
    button.style.whiteSpace = 'nowrap';
    button.textContent = 'Overflow'.repeat(100);
  });
  const overflow = await page.evaluate(sampleParticipantGeometry);
  assert.ok(overflow, 'overflow is sampled, not retried as missing geometry');
  assert.ok(overflow.x + overflow.width > overflow.panelX + overflow.panelWidth);
  assert.ok(overflow.scrollWidth > overflow.clientWidth + 1);
  await page.locator('[data-game-panel="participants"]').evaluate(panel => { panel.hidden = true; });
  assert.equal(await page.evaluate(sampleParticipantGeometry), null);
});
