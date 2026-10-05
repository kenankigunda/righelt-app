import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`account creation remains accessible without acknowledgment at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByTestId('account-dialog');
    await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(dialog.getByLabel('Username', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Password', { exact: true })).toBeFocused();
    await expect(dialog.getByLabel('Display name (optional)', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Back to sign in', exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog).toContainText('If you forget it and are signed out everywhere');
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await dialog.screenshot({ path: info.outputPath('account-entry.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  });
}

test('desktop dialog resizes smoothly, retargets rapid changes and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__accountSizeAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.dataset.testid === 'account-dialog' && Array.isArray(frames) && frames.some(frame => 'height' in frame)) {
        // Pause only after the real animation is created, so its geometry and
        // cancellation can be inspected without racing a short 180ms effect.
        animation.pause();
        window.__accountSizeAnimations.push(animation);
      }
      return animation;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByTestId('account-dialog');
  await expect(dialog.getByLabel('Username', { exact: true })).toBeFocused();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initial = (await dialog.boundingBox()).height;
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__accountSizeAnimations.length)).toBe(1);
  const first = await page.evaluate(() => {
    const animation = window.__accountSizeAnimations[0];
    const frames = animation.effect.getKeyframes();
    animation.currentTime = 90;
    return { from: parseFloat(frames[0].height), to: parseFloat(frames.at(-1).height), duration: animation.effect.getTiming().duration };
  });
  expect(first.from).toBeCloseTo(initial, 0);
  expect(first.to).toBeGreaterThan(first.from);
  expect(first.duration).toBeGreaterThan(0);
  const intermediate = (await dialog.boundingBox()).height;
  expect(intermediate).toBeGreaterThan(first.from);
  expect(intermediate).toBeLessThan(first.to);
  // A rapid reversal targets the currently rendered size, not the old endpoint.
  await dialog.getByRole('button', { name: 'Back to sign in', exact: true }).evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__accountSizeAnimations.length)).toBe(2);
  const retargeted = await page.evaluate(() => ({
    oldState: window.__accountSizeAnimations[0].playState,
    from: parseFloat(window.__accountSizeAnimations[1].effect.getKeyframes()[0].height),
  }));
  expect(retargeted.oldState).toBe('idle');
  expect(retargeted.from).toBeCloseTo(intermediate, 0);
  await page.evaluate(async () => {
    const animation = window.__accountSizeAnimations.at(-1);
    animation.play(); await animation.finished;
  });
  await expect.poll(async () => (await dialog.boundingBox()).height).toBeCloseTo(initial, 0);
  expect(await dialog.evaluate(node => node.style.height)).toBe('');

  await dialog.getByLabel('Username', { exact: true }).fill('MotionPlayer');
  await dialog.getByLabel('Password', { exact: true }).focus();
  await expect(dialog.locator('[data-existing-hint]')).toBeVisible({ timeout: 7000 });
  await expect.poll(() => page.evaluate(() => window.__accountSizeAnimations.length)).toBe(3);
  const hintTarget = await page.evaluate(() => parseFloat(window.__accountSizeAnimations.at(-1).effect.getKeyframes().at(-1).height));
  // Changing the OS preference during an effect must cancel it immediately.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.__accountSizeAnimations.at(-1).playState)).toBe('idle');
  expect((await dialog.boundingBox()).height).toBeCloseTo(hintTarget, 0);
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.__accountSizeAnimations.length)).toBe(3);
  expect(await dialog.evaluate(node => node.getAnimations().length)).toBe(0);
  expect(await dialog.evaluate(node => node.style.height)).toBe('');
});

test('CSS zoom keeps animation endpoints in layout units without a visual height jump', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__zoomSizeAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.dataset.testid === 'account-dialog' && Array.isArray(frames) && frames.some(frame => 'height' in frame)) {
        animation.pause(); animation.currentTime = 0;
        window.__zoomSizeAnimations.push(animation);
      }
      return animation;
    };
  });
  await page.goto('/');
  await page.addStyleTag({ content: '.account-dialog { zoom: 2; }' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByTestId('account-dialog');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await dialog.evaluate(node => ({ visual: node.getBoundingClientRect().height, layout: parseFloat(getComputedStyle(node).height) }));
  expect(before.visual).toBeCloseTo(before.layout * 2, 0);
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__zoomSizeAnimations.length)).toBe(1);
  const animated = await dialog.evaluate(node => ({
    visual: node.getBoundingClientRect().height,
    from: parseFloat(window.__zoomSizeAnimations[0].effect.getKeyframes()[0].height),
    to: parseFloat(window.__zoomSizeAnimations[0].effect.getKeyframes().at(-1).height),
  }));
  expect(animated.from).toBeCloseTo(before.layout, 0);
  expect(animated.visual).toBeCloseTo(before.visual, 0);
  await page.evaluate(async () => {
    const animation = window.__zoomSizeAnimations[0];
    animation.play(); await animation.finished;
  });
  const settled = await dialog.evaluate(node => ({ visual: node.getBoundingClientRect().height, layout: parseFloat(getComputedStyle(node).height), inline: node.style.height }));
  expect(settled.layout).toBeCloseTo(animated.to, 0);
  expect(settled.visual).toBeCloseTo(animated.to * 2, 0);
  expect(settled.inline).toBe('');
});
