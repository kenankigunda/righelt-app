import AxeBuilder from '@axe-core/playwright';
import {test,expect} from '@playwright/test';
import {AUTH_REQUEST_HEADER,AUTH_PROTOCOL_HEADER,AUTH_PROTOCOL_VERSION} from '../../packages/shared-types/src/auth-policy.js';
const password='Tutorial account password 428';
const name=()=>`Lesson_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`;
test.beforeEach(async()=>{expect((await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'})).status).toBe(200);});
async function friendLesson(page){await page.goto('/');await page.getByTestId('home-create-game').click();const story=page.getByRole('dialog',{name:'Friend',exact:true});await expect(story).toBeVisible();await story.getByRole('button',{name:'Start a friend game',exact:true}).click();await expect(page.locator('[data-tutorial-root]')).toBeVisible();}
async function createAccount(page,username){const form=page.getByTestId('account-dialog');await form.getByRole('button',{name:'Create account',exact:true}).click();await form.getByLabel('Username',{exact:true}).fill(username);await form.getByLabel('Password',{exact:true}).fill(password);await form.getByRole('button',{name:'Create account & continue',exact:true}).click();}
test('Friend introduction leads to Horus, skip leads to integrated creation, and creates one match',async({page})=>{
 let creates=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/shell/games'&&r.method()==='POST')creates++;});
 await page.setViewportSize({width:1366,height:900});await friendLesson(page);expect(creates).toBe(0);await expect(page.locator('.lesson-host-name')).toHaveText('Horus');
 await page.locator('[data-lesson-skip-all]').click();const form=page.getByTestId('account-dialog');await expect(form).toHaveAttribute('data-presentation','inline');await expect(page.locator('[data-account-host] img')).toBeVisible();expect(creates).toBe(0);
 expect((await new AxeBuilder({page}).include('[data-lesson-account]').analyze()).violations).toEqual([]);
 await page.screenshot({path:'test-results/tutorial-account-wide.png'});await createAccount(page,name());await expect(page).toHaveURL(/#\/game\//);await expect(page.getByTestId('game-role')).toContainText('Player 1');await expect.poll(()=>creates).toBe(1);
 const preference=await page.evaluate(async()=> (await (await fetch('/api/auth/session')).json()).account.preferences.tutorial);expect(preference).toBe('skipped');
});
test('returning signed-out device goes directly to integrated login and Back creates nothing',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 let creates=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/shell/games'&&r.method()==='POST')creates++;});
 await page.addInitScript(()=>localStorage.setItem('righelt.lesson.progress.v1',JSON.stringify({completed:[],result:'skipped'})));
 await friendLesson(page);await expect(page.getByTestId('account-dialog')).toHaveAttribute('data-presentation','inline');await expect(page.locator('.lesson-layout')).toBeHidden();
 expect((await new AxeBuilder({page}).include('[data-lesson-account]').analyze()).violations).toEqual([]);
 const formBox=await page.getByTestId('account-dialog').boundingBox();expect(formBox.height).toBeLessThan(600);await expect(page.locator('[data-account-host] img')).toBeInViewport();
 await page.screenshot({path:'test-results/tutorial-account-phone.png'});
 await page.getByTestId('account-dialog').getByRole('button',{name:'Create account',exact:true}).focus();await page.keyboard.press('Tab');await expect(page.locator('[data-lesson-account] [data-lesson-exit]')).toBeFocused();
 await page.locator('[data-lesson-account] [data-lesson-exit]').click();await expect(page).toHaveURL(/#\/$/);await expect(page.getByTestId('account-dialog')).not.toBeVisible();expect(creates).toBe(0);
 await page.locator('[data-action="account-open"]').click();await expect(page.getByTestId('account-dialog')).toHaveAttribute('data-presentation','modal');
});
test('signed-in new account receives lesson and preference-save failure can retry without creating',async({page,baseURL})=>{
 await page.request.post('/api/auth/register',{headers:{Origin:new URL(baseURL).origin,[AUTH_REQUEST_HEADER]:'1',[AUTH_PROTOCOL_HEADER]:String(AUTH_PROTOCOL_VERSION)},data:{username:name(),password}});
 await friendLesson(page);let failure=true;await page.route('**/api/account',async route=>{if(route.request().method()==='PATCH'&&failure){failure=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporarily_unavailable'})});}else await route.continue();});
 await page.locator('[data-lesson-skip-all]').click();await expect(page.locator('[data-lesson-account-retry]')).toBeVisible();await page.locator('[data-lesson-account-retry]').click();await expect(page).toHaveURL(/#\/game\//);
});
test('cross-tab sign-out retires a delayed lesson continuation',async({page,baseURL})=>{
 const registered=await page.request.post('/api/auth/register',{headers:{Origin:new URL(baseURL).origin,[AUTH_REQUEST_HEADER]:'1',[AUTH_PROTOCOL_HEADER]:String(AUTH_PROTOCOL_VERSION)},data:{username:name(),password}});expect(registered.ok()).toBe(true);
 const sibling=await page.context().newPage();let release,seen;const held=new Promise(r=>release=r),started=new Promise(r=>seen=r);let creates=0;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/shell/games'&&r.method()==='POST')creates++;});
 await page.route('**/api/account',async route=>{if(route.request().method()==='PATCH'){const response=await route.fetch();seen();await held;await route.fulfill({response});}else await route.continue();});
 try {
  await sibling.goto('/');await expect(sibling.getByRole('button',{name:'Account',exact:true})).toBeVisible();await friendLesson(page);await page.locator('[data-lesson-skip-all]').click();await started;
  await sibling.getByRole('button',{name:'Account',exact:true}).click();await sibling.getByTestId('account-dialog').getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/#\/$/);release();await expect(page.getByTestId('home-create-game')).toBeVisible();expect(creates).toBe(0);
 }finally{release();await page.unrouteAll({behavior:'wait'});await sibling.close();}
});
