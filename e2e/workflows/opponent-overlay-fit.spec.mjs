import { waitForOverlayEntry } from "../support/overlay-motion.mjs";
import {test,expect} from '@playwright/test';

for (const viewport of [{width:1366,height:768},{width:1024,height:640},{width:390,height:844},{width:375,height:667}]) {
 test(`opponent introductions expose their play action at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/');
  for (const opponent of ['babs','tau','horus','friend']) {
   const trigger=opponent==='friend'?page.getByTestId('home-create-game'):page.locator(`[data-opponent="${opponent}"]`);
   await trigger.click();
   const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
   await expect(dialog.locator('[data-story-image]').first()).toHaveJSProperty('complete',true);
   await waitForOverlayEntry(dialog);
   // Inspect the initial presentation. Scrolling to the CTA would hide this regression.
   await expect(dialog.locator('[data-story-play]')).toBeInViewport({ratio:1});
   await expect(dialog.locator('.modal-content')).toHaveJSProperty('scrollTop',0);
   expect(await dialog.locator('.modal-content').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
   await page.screenshot({path:test.info().outputPath(`${opponent}-${viewport.width}.png`)});
   await page.keyboard.press('Escape');
  }
 });
}
