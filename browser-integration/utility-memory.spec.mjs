import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/browser-integration/support/utility-memory.html');await page.waitForFunction(()=>window.fixtureReady);});
test('utility reopening restores nested disclosures, scroll and text selection after focus moves outside',async({page})=>{
 await page.locator('[data-key="position"] > summary').click();await page.locator('[data-key="raw"] > summary').click();
 const input=page.locator('textarea');await input.focus();await input.evaluate(el=>el.setSelectionRange(1,4,'backward'));
 await input.scrollIntoViewIfNeeded();const scroll=page.locator('.shell-flyout-scroll');const top=await scroll.evaluate(el=>el.scrollTop);
 await page.locator('#other').click();await page.evaluate(()=>{window.fixture.draw(false);window.fixture.draw(true);});
 await expect(input).toBeFocused();expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([1,4,'backward']);
 await expect(page.locator('[data-key="raw"]')).toHaveAttribute('open','');await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(top);
});
test('account, game and decision changes do not restore another scope’s focus or disclosures',async({page})=>{
 const input=page.locator('textarea');await input.focus();await input.evaluate(el=>el.setSelectionRange(1,4));
 await page.locator('#other').click();await page.evaluate(()=>{window.fixture.draw(false);window.fixture.decision('different');window.fixture.draw(true);});
 await expect(input).not.toBeFocused();
 await page.locator('[data-key="position"] > summary').click();await page.locator('[data-key="raw"] > summary').click();
 await input.focus();await page.locator('#other').click();
 await page.evaluate(()=>{window.fixture.draw(false);window.fixture.scope('account2:game2');window.fixture.draw(true);});
 await expect(input).not.toBeFocused();await expect(page.locator('[data-key="position"]')).not.toHaveAttribute('open','');
 await input.focus();await page.locator('#other').click();await page.evaluate(()=>{window.fixture.reset();window.fixture.draw(false);window.fixture.draw(true);});
 await expect(input).not.toBeFocused();
});
