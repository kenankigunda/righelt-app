import {test,expect} from '@playwright/test';
import {continueFriendIntroduction,openPlaySignIn} from './helpers.mjs';
import {AUTH_REQUEST_HEADER,AUTH_PROTOCOL_HEADER,AUTH_PROTOCOL_VERSION,SESSION_CONTEXT_HEADER} from '../../packages/shared-types/src/auth-policy.js';
async function register(page,username){await page.goto('/');await openPlaySignIn(page);const d=page.getByTestId('account-dialog');await d.getByRole('button',{name:'Create account',exact:true}).click();await d.getByLabel('Username',{exact:true}).fill(username);await d.getByLabel('Password',{exact:true}).fill('Autosave testing password 42');await d.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(d).not.toBeVisible();await continueFriendIntroduction(page);await expect(page.getByTestId('game-role')).toContainText('Player 1');}
async function prepareAutosaveAccount(page,baseURL,username){
 // Prepare this test's prerequisites through the browser context's real cookie jar.
 // The adjacent test retains UI registration, and all autosave interactions stay in the UI.
 const origin=new URL(baseURL).origin;
 const headers={Origin:origin,[AUTH_REQUEST_HEADER]:'1',[AUTH_PROTOCOL_HEADER]:String(AUTH_PROTOCOL_VERSION)};
 const registration=await page.request.post(`${origin}/api/auth/register`,{headers,data:{username,password:'Autosave testing password 42'}});
 expect(registration.status()).toBe(200);
 const session=await registration.json();
 expect(session.account.id).toBeTruthy();expect(session.account.username).toBe(username);expect(session.contextId).toBeTruthy();
 const creation=await page.request.post(`${origin}/api/shell/games`,{headers:{...headers,[SESSION_CONTEXT_HEADER]:session.contextId},data:{selfPlayMode:false,creatorSide:'p1'}});
 expect(creation.status()).toBe(200);
 const {game}=await creation.json();
 expect(game.id).toBeTruthy();expect(game.ownershipMode).toBe('account_v1');expect(game.selfPlayMode).toBe(false);
 expect(game.myRoles).toEqual(['Player 1']);expect(game.player1.identityId).toBe(session.account.id);expect(game.player2).toBeNull();
 await page.goto(`${origin}/#/game/${encodeURIComponent(game.id)}`);
 await expect(page.getByTestId('game-board')).toBeVisible();await expect(page.getByTestId('game-role')).toContainText('Player 1');
 const browserSession=await page.evaluate(async()=>{const response=await fetch('/api/auth/session');return {status:response.status,body:await response.json()};});
 expect(browserSession.status).toBe(200);expect(browserSession.body.account.id).toBe(session.account.id);
 expect(browserSession.body.account.username).toBe(username);expect(browserSession.body.contextId).toBe(session.contextId);
}
test.beforeEach(async()=>{await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'});});
test('display name autosaves inline, retries failures and preserves preferences',async({page,baseURL},testInfo)=>{
 await prepareAutosaveAccount(page,baseURL,`Auto_${Date.now().toString(36)}`);
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
