import {test,expect} from '@playwright/test';
for(const width of [320,390,1440])test(`computer card reports local activity and offers deliberate recovery at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/browser-integration/support/computer-recovery.html');
 const card=page.getByRole('button',{name:'Horus, Blue, Active in another tab',exact:true});
 await card.focus();await page.keyboard.press('Enter');await expect(card).toBeFocused();await expect(card).toHaveAttribute('aria-expanded','true');
 const resume=page.getByRole('button',{name:'Resume here',exact:true});await expect(resume).toBeEnabled();
 await page.evaluate(()=>window.fixtureRefresh());await expect(card).toBeFocused();await expect(resume).toBeEnabled();
 await resume.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Horus, Blue, Resuming',exact:true})).toBeFocused();await expect(resume).toBeDisabled();
 await expect(page.getByRole('button',{name:'Horus, Blue, Resuming',exact:true})).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Complete resume',exact:true}).click();await expect(resume).toHaveCount(0);await expect(page.getByRole('button',{name:'Horus, Blue, Active here',exact:true})).toHaveAttribute('aria-expanded','true');
 for(const state of ['Paused','Manual']){await page.getByRole('button',{name:state,exact:true}).click();await expect(page.getByRole('button',{name:'Resume here',exact:true})).toBeEnabled();}
 await page.getByRole('button',{name:'Viewer',exact:true}).click();await expect(page.getByRole('button',{name:'Resume here',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Finished',exact:true}).click();await expect(page.getByRole('button',{name:'Resume here',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Horus, Blue, Game finished',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'No control',exact:true}).click();await expect(page.locator('#notice')).toBeEmpty();
 await page.getByRole('button',{name:'Advance 29 seconds',exact:true}).click();await expect(page.locator('#notice')).toBeEmpty();
 await page.getByRole('button',{name:'Advance one second',exact:true}).click();await expect(page.locator('#notice')).toContainText('Horus hasn’t resumed');
 await expect(page.locator('#notice').getByRole('button',{name:'Resume here',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 expect(await page.locator('.participant-computer .player-name').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.locator('#notice').evaluate(async root=>{await Promise.all(root.getAnimations({subtree:true}).filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
 await page.screenshot({path:info.outputPath(`computer-recovery-${width}.png`),fullPage:true});
});
