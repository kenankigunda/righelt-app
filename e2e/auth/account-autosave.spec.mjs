import {test,expect} from '@playwright/test';
import {continueFriendIntroduction,openPlaySignIn} from './helpers.mjs';
async function register(page,username){await page.goto('/');await openPlaySignIn(page);const d=page.getByTestId('account-dialog');await d.getByRole('button',{name:'Create account',exact:true}).click();await d.getByLabel('Username',{exact:true}).fill(username);await d.getByLabel('Password',{exact:true}).fill('Autosave testing password 42');await d.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(d).not.toBeVisible();await continueFriendIntroduction(page);await expect(page.getByTestId('game-role')).toContainText('Player 1');}
test.beforeEach(async()=>{await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'});});
test('display name autosaves inline, retries failures and preserves preferences',async({page},testInfo)=>{
 await register(page,`Auto_${Date.now().toString(36)}`,{gate:true});
 await page.getByRole('button',{name:'Account',exact:true}).click();
 const d=page.getByTestId('account-dialog'),field=d.getByLabel('Display name',{exact:true}), status=d.locator('[data-autosave-status]');
 await expect(d.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
 const before=await page.evaluate(async()=> (await (await fetch('/api/auth/session')).json()));
 const patches=[];let offline=true;
 await page.route('**/api/account',async route=>{if(route.request().method()!=='PATCH')return route.continue();patches.push(route.request().postDataJSON());if(offline)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'temporarily_unavailable'})});return route.continue();});
 await field.fill('Étoile 🌟');await expect(status).toHaveText('Not saved');await expect(field).toHaveValue('Étoile 🌟');
 await expect(field).toBeFocused();
 await d.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(d).not.toBeVisible();expect(patches).toHaveLength(1);
 await page.getByRole('button',{name:'Account',exact:true}).click();await field.fill('Étoile 🌟');await expect(status).toHaveText('Not saved');
 offline=false;await d.getByRole('button',{name:'Retry',exact:true}).click();await expect(status).toHaveText('Saved');
 expect(patches).toEqual([{displayName:'Étoile 🌟'},{displayName:'Étoile 🌟'},{displayName:'Étoile 🌟'}]);
 const after=await page.evaluate(async()=> (await (await fetch('/api/auth/session')).json()));
 expect(before.account.preferences).toBeDefined();expect(after.account.preferences).toEqual(before.account.preferences);
 await field.fill('Latest name');await d.getByRole('button',{name:'Change password',exact:true}).click();await expect(d.getByRole('heading',{name:'Change password',exact:true})).toBeVisible();await d.getByRole('button',{name:'Back',exact:true}).click();await expect(field).toHaveValue('Latest name');
 await field.fill('Captured name');await expect(status).toHaveText('Saved');await page.screenshot({path:testInfo.outputPath('account-autosaved.png'),animations:'disabled'});
 await d.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Account',exact:true}).click();await expect(field).toHaveValue('Captured name');
});

test('reverted names settle before closing and invalid edits can be discarded',async({page})=>{
 const username=`Revert_${Date.now().toString(36)}`;
 await register(page,username);await page.getByRole('button',{name:'Account',exact:true}).click();
 const d=page.getByTestId('account-dialog'),field=d.getByLabel('Display name',{exact:true});
 let release;const held=new Promise(resolve=>{release=resolve;});let started=false;
 await page.route('**/api/account',async route=>{if(route.request().method()==='PATCH'&&!started){started=true;await held;}await route.continue();});
 try {await field.fill('Temporary');await expect.poll(()=>started).toBe(true);await field.fill(username);await d.getByRole('button',{name:'Close',exact:true}).click();await expect(d).toBeVisible();release();await expect(d).not.toBeVisible();}finally{release();await page.unrouteAll({behavior:'wait'});}
 await page.getByRole('button',{name:'Account',exact:true}).click();await expect(field).toHaveValue(username);
 await field.fill('x'.repeat(33));await page.keyboard.press('Escape');await expect(d).toBeVisible();await expect(d.locator('[data-autosave-status]')).toHaveText('Not saved');await d.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(d).not.toBeVisible();
});
