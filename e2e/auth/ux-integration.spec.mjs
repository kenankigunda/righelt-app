import {test,expect} from '@playwright/test';
import {waitForAccountStartup} from './helpers.mjs';

test('self-play resumes after account creation and uses the shared account and profile controls',async({page,browser},info)=>{
 expect((await fetch(`http://127.0.0.1:${Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988)+100}/reset-limits`,{method:'POST'})).status).toBe(200);
 await page.goto('/');await waitForAccountStartup(page);
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 await page.locator('[data-lesson-skip-all]').click();
 const dialog=page.getByTestId('account-dialog');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Create account',exact:true}).click();
 await dialog.getByLabel('Username',{exact:true}).fill(`Ux_${Date.now().toString(36)}`);
 await dialog.getByLabel('Password',{exact:true}).fill('A tactile account password 482');
 await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#\/game\//);
 await expect(page.getByRole('button',{name:'Close invite',exact:true})).toHaveCount(0);
 const account=page.getByTestId('account-open');await expect(account.locator('svg')).toBeVisible();
 await account.focus();await account.click();await expect(dialog.getByLabel('Display name',{exact:true})).toBeVisible();await expect(dialog).toHaveAttribute('data-presentation','flyout');expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(false);await expect(dialog.getByRole('button',{name:'Retry',exact:true})).not.toBeVisible();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 expect(await page.evaluate(()=>{const rail=document.querySelector('[data-testid="account-dialog"]').getBoundingClientRect();const main=document.querySelector('.shell-main-content').getBoundingClientRect();return main.right<=rail.left && document.documentElement.scrollWidth<=innerWidth+1;})).toBe(true);
 await page.screenshot({path:info.outputPath('account-wide.png')});
 await page.setViewportSize({width:375,height:812});
 await expect.poll(()=>dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
 await expect.poll(()=>dialog.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(375);
 await expect.poll(()=>dialog.evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(812);
 await page.screenshot({path:info.outputPath('account-phone.png')});
 await page.setViewportSize({width:1440,height:1000});
 await expect.poll(()=>dialog.evaluate(el=>el.matches(':modal'))).toBe(false);
 await dialog.getByRole('button',{name:'Change password',exact:true}).click();await expect(dialog.getByLabel('New password',{exact:true})).toHaveAttribute('type','text');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByTestId('participant-player-1').getByRole('button').click();
 const profile=page.getByTestId('public-profile');await expect(profile).toContainText('Joined');
 await expect(page.getByTestId('participant-player-1').getByRole('button')).toHaveAttribute('aria-expanded','true');
 expect(await page.getByTestId('participant-player-1').locator('.player-name').evaluate(el=>el.getBoundingClientRect().bottom<=el.parentElement.querySelector('.player-username').getBoundingClientRect().top)).toBe(true);
 await profile.evaluate(async el=>{await Promise.all(el.parentElement.getAnimations().map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:info.outputPath('profile-wide.png')});
 const blue=page.getByTestId('participant-player-2').getByRole('button');await blue.click();
 await expect(page.getByTestId('participant-player-1').getByRole('button')).toHaveAttribute('aria-expanded','false');
 await expect(blue).toHaveAttribute('aria-expanded','true');await blue.focus();
 const watcher=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
 try {
 const guest=await watcher.newPage();await guest.goto(new URL('/',page.url()).href);
 await guest.getByRole('button',{name:'Play both sides',exact:true}).click();
 await guest.locator('[data-lesson-skip-all]').click();
 const entry=guest.getByTestId('account-dialog');await entry.getByRole('button',{name:'Create account',exact:true}).click();
 await entry.getByLabel('Username',{exact:true}).fill(`Viewer_${Date.now().toString(36)}`);await entry.getByLabel('Password',{exact:true}).fill('Another account password 482');
 await entry.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(entry).not.toBeVisible();
 await guest.goto(page.url());await guest.getByTestId('join-viewer').click();await expect(page.getByTestId('participant-viewer')).toBeVisible();await expect(blue).toBeFocused();await expect(blue).toHaveAttribute('aria-expanded','true');}finally{await watcher.close();}
 await blue.click();await expect(profile).toHaveCount(0);
});
