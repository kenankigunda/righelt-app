import {test,expect} from '@playwright/test';

test('completed History Play again wraps safely and preserves native keyboard cancellation',async({page})=>{
 for(const width of [320,390]){
  await page.setViewportSize({width,height:760});
  await page.goto('/browser-integration/support/history-play-again.html');
  await page.waitForFunction(()=>window.fixtureReady);
  const action=page.getByRole('button',{name:'Play again',exact:true}),summary=page.getByTestId('history-result-summary');
  await expect(action).toBeVisible();await expect(summary).toBeVisible();
  const geometry=await page.evaluate(()=>{const action=document.querySelector('[data-action="rematch"]').getBoundingClientRect(),summary=document.querySelector('[data-testid="history-result-summary"]').getBoundingClientRect();return {action:{left:action.left,right:action.right,top:action.top,bottom:action.bottom},summary:{left:summary.left,right:summary.right,top:summary.top,bottom:summary.bottom},scrollWidth:document.documentElement.scrollWidth};});
  expect(geometry.scrollWidth).toBeLessThanOrEqual(width);expect(geometry.action.left).toBeGreaterThanOrEqual(geometry.summary.left);expect(geometry.action.top).toBeGreaterThanOrEqual(geometry.summary.top);
 }
 await page.setViewportSize({width:320,height:760});
 const action=page.getByRole('button',{name:'Play again',exact:true});await action.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Play again',exact:true});await expect(dialog).toBeVisible();expect(await page.evaluate(()=>window.historyPlayAgainFixture.starts)).toBe(0);
 await page.evaluate(()=>window.historyPlayAgainFixture.render());await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'Play again',exact:true})).toBeFocused();expect(await page.evaluate(()=>window.historyPlayAgainFixture.starts)).toBe(0);
 await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'Play again',exact:true})).toBeFocused();expect(await page.evaluate(()=>window.historyPlayAgainFixture.starts)).toBe(0);
});
