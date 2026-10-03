import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { layoutStyles } from '../support/layout-styles.mjs';

// Component integration: use the shipped dialog and CSS, with account transport
// stubbed so every browser/viewport checks the same recovery acknowledgment UI.
for (const width of [390, 768, 1440]) {
  test(`recovery checkbox preserves native geometry and keyboard behavior at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addStyleTag({ content: layoutStyles });
    const source = await readFile('apps/web/shell/account-dialog.js', 'utf8');
    await page.addScriptTag({ type: 'module', content: `${source}\nwindow.createAccountDialog = createAccountDialog;` });
    await page.evaluate(() => {
      const controller = {
        snapshot: () => ({ session: {}, busy: false }),
        act: async () => ({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR-STVW-XY01-2345-6789', recoveryVersion: 1 }),
      };
      window.createAccountDialog({ controller }).open('register');
    });
    const dialog = page.getByTestId('account-dialog');
    await dialog.getByLabel('Username', { exact: true }).fill('Checkbox_test');
    await dialog.getByLabel('Password', { exact: true }).fill('Synthetic password for layout');
    await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
    const checkbox = dialog.getByRole('checkbox', { name: 'I saved my recovery code' });
    await expect(checkbox).toBeVisible();
    const geometry = await checkbox.evaluate(input => {
      const rect = input.getBoundingClientRect();
      const label = input.closest('label').getBoundingClientRect();
      const style = getComputedStyle(input);
      return { width: rect.width, height: rect.height, labelWidth: label.width, appearance: style.appearance };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(16);
    expect(geometry.width).toBeLessThanOrEqual(24);
    expect(geometry.height).toBeGreaterThanOrEqual(16);
    expect(geometry.height).toBeLessThanOrEqual(24);
    expect(geometry.labelWidth - geometry.width).toBeGreaterThan(150);
    expect(geometry.appearance).toBe('auto');
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await dialog.locator('.account-check').click();
    await expect(checkbox).toBeChecked();
    await dialog.screenshot({ path: info.outputPath('recovery-checkbox.png') });
  });
}
