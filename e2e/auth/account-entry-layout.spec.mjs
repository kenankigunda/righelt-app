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
    await page.keyboard.press('Tab');
    // Safari's default keyboard navigation may skip native buttons. In both
    // modes the next editable field must be the optional display name.
    const visibility = dialog.getByRole('button', { name: 'Hide password', exact: true });
    if (await visibility.evaluate(node => node === document.activeElement)) await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Display name (optional)', { exact: true })).toBeFocused();
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
