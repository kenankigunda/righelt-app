import {AUTH_CONTROL_ORIGIN} from "./fixture.mjs";
import {test,expect} from '@playwright/test';
import {waitForAccountStartup} from './helpers.mjs';

async function createSelfPlayAccount(page) {
 await page.setViewportSize({width:1920,height:1100});
 expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).status).toBe(200);
 await page.goto('/');await waitForAccountStartup(page);
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const dialog=page.getByTestId('account-dialog');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Create account',exact:true}).click();
 await dialog.getByLabel('Username',{exact:true}).fill(`Ux_${Date.now().toString(36)}`);
 await dialog.getByLabel('Password',{exact:true}).fill('A tactile account password 482');
 await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#\/game\//);
 await expect(page.getByRole('button',{name:'Close invite',exact:true})).toHaveCount(0);
 return dialog;
}

test('self-play resumes after account creation and uses responsive account controls',async({page},info)=>{
 const dialog=await createSelfPlayAccount(page);
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
});

test('self-play profile controls preserve focus and expansion across viewer presence',async({page,browser},info)=>{
 await createSelfPlayAccount(page);
 await page.setViewportSize({width:1440,height:1000});
 await page.getByTestId('participant-player-1').getByRole('button').click();
 const profile=page.getByTestId('public-profile');await expect(profile).toContainText('Joined');
 await expect(page.getByTestId('participant-player-1').getByRole('button')).toHaveAttribute('aria-expanded','true');
 // Presence updates may replace profile nodes between locator resolution and
 // evaluation. Inspect the current mounted geometry and motion atomically.
 await expect.poll(()=>page.evaluate(()=>{
  const row=document.querySelector('[data-testid="participant-player-1"]');
  const name=row?.querySelector('.player-name'),username=row?.querySelector('.player-username');
  const profile=row?.querySelector('[data-testid="public-profile"]');
  if(!name?.isConnected||!username?.isConnected||!profile?.parentElement)return false;
  if(profile.parentElement.getAnimations().some(a=>(a.playState==='running'||a.pending)&&Number.isFinite(a.effect?.getComputedTiming().endTime)))return false;
  const nameRect=name.getBoundingClientRect(),usernameRect=username.getBoundingClientRect();
  return nameRect.height>0&&usernameRect.height>0&&nameRect.bottom<=usernameRect.top;
 })).toBe(true);
 await page.screenshot({path:info.outputPath('profile-wide.png')});
 const blue=page.getByTestId('participant-player-2').getByRole('button');await blue.click();
 await expect(page.getByTestId('participant-player-1').getByRole('button')).toHaveAttribute('aria-expanded','false');
 await expect(blue).toHaveAttribute('aria-expanded','true');await blue.focus();
 const watcher=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
 try {
 const guest=await watcher.newPage();await guest.goto(new URL('/',page.url()).href);
 await guest.getByRole('button',{name:'Play both sides',exact:true}).click();
 const entry=guest.getByTestId('account-dialog');await entry.getByRole('button',{name:'Create account',exact:true}).click();
 await entry.getByLabel('Username',{exact:true}).fill(`Viewer_${Date.now().toString(36)}`);await entry.getByLabel('Password',{exact:true}).fill('Another account password 482');
 await entry.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(entry).not.toBeVisible();
 await guest.goto(page.url());await guest.getByTestId('join-viewer').click();await expect(page.getByTestId('participant-viewer')).toBeVisible();await expect(blue).toBeFocused();await expect(blue).toHaveAttribute('aria-expanded','true');}finally{await watcher.close();}
 await blue.click();await expect(profile).toHaveCount(0);
});
