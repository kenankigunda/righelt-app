import {test,expect} from '@playwright/test';
import {waitForAccountStartup} from './helpers.mjs';

const register = async page => {
 await page.goto('/');await waitForAccountStartup(page);
 const account=page.getByTestId('account-open');await expect(account).toBeVisible();await account.click();
 const dialog=page.getByTestId('account-dialog');await expect(dialog).toHaveAttribute('data-presentation','modal');
 await dialog.getByRole('button',{name:'Create account',exact:true}).click();
 await dialog.getByLabel('Username',{exact:true}).fill(`Rail_${Date.now().toString(36)}`);
 await dialog.getByLabel('Password',{exact:true}).fill('Quiet tactile account password 42');
 await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(dialog).not.toBeVisible();
 await expect(account).toHaveAttribute('data-authenticated','true');
};

test('Account stays beside sound and switches with shared utility rails without narrowing the page',async({page})=>{
 await page.setViewportSize({width:1100,height:800});await register(page);
 const account=page.getByTestId('account-open'),dialog=page.getByTestId('account-dialog'),main=page.locator('.shell-main-content');
 const before=await main.boundingBox();await account.click();await expect(dialog).toBeVisible();
 await expect.poll(()=>main.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(Math.round(before.width));
 await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode','wide');
 const sound=await page.locator('.sound-toggle').boundingBox(),button=await account.boundingBox();expect(sound.x+sound.width).toBeLessThanOrEqual(button.x);
 await page.getByRole('button',{name:'Scenarios',exact:true}).click();await expect(dialog).not.toBeVisible();
 const scenarios=page.locator('[data-flyout="scenarios"]');await expect(scenarios).toBeVisible();
 await expect.poll(()=>scenarios.evaluate(el=>getComputedStyle(el,'::before').clipPath)).not.toBe('none');
 await page.getByRole('button',{name:'Debug',exact:true}).click();
 await expect(scenarios).toHaveCount(0);await expect(page.locator('[data-flyout="debug"]')).toBeVisible();
 await expect(account).toBeInViewport({ratio:1});
 await account.click();await expect(scenarios).toHaveCount(0);await expect(dialog).toBeVisible();
 await page.getByRole('button',{name:'Debug',exact:true}).click();await expect(dialog).not.toBeVisible();
 await expect(page.locator('[data-flyout="debug"]')).toBeVisible();
 await page.getByRole('heading',{name:'Start something new',exact:true}).click();
 await expect(page.locator('[data-flyout]')).toHaveCount(0);
 await account.click();await page.locator('.sound-toggle').click();await expect(dialog).toBeVisible();
 await page.getByRole('heading',{name:'Start something new',exact:true}).click();await expect(dialog).not.toBeVisible();
 await page.screenshot({path:test.info().outputPath('utility-medium.png')});
});

test('signed-out Account remains visible on phone and opens sign-in',async({page})=>{
 await page.setViewportSize({width:375,height:667});await page.goto('/');await waitForAccountStartup(page);
 const account=page.getByTestId('account-open');await expect(account).toBeVisible();await expect(account).toHaveAttribute('data-authenticated','false');
 await account.click();await expect(page.getByTestId('account-dialog')).toHaveAttribute('data-presentation','modal');
 await expect(page.getByLabel('Username',{exact:true})).toBeVisible();
});

 test('wide stacked utilities collapse to one accessible rail when resized',async({page})=>{
  await page.setViewportSize({width:2200,height:1000});await page.goto('/');await waitForAccountStartup(page);
  await page.getByRole('button',{name:'Scenarios',exact:true}).click();
  await page.getByRole('button',{name:'Debug',exact:true}).click();
  await expect(page.locator('.shell-flyout.is-open')).toHaveCount(2);
  await page.setViewportSize({width:1100,height:800});
  await expect(page.locator('.shell-flyout.is-open')).toHaveCount(1);
  await expect(page.getByTestId('account-open')).toBeInViewport({ratio:1});
  await page.getByTestId('account-open').click();
  await expect(page.locator('.shell-flyout.is-open')).toHaveCount(0);
  await expect(page.getByTestId('account-dialog')).toBeVisible();
 });
