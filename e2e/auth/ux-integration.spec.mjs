import {test,expect} from '@playwright/test';
import {waitForAccountStartup} from './helpers.mjs';

test('self-play resumes after account creation and uses the shared account and profile controls',async({page},info)=>{
 expect((await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'})).status).toBe(200);
 await page.goto('/');await waitForAccountStartup(page);
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const dialog=page.getByTestId('account-dialog');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Create account',exact:true}).click();
 await dialog.getByLabel('Username',{exact:true}).fill(`Ux_${Date.now().toString(36)}`);
 await dialog.getByLabel('Password',{exact:true}).fill('A tactile account password 482');
 await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#\/game\//);
 await expect(page.getByRole('button',{name:'Close invite',exact:true})).toHaveCount(0);
 const account=page.getByTestId('account-open');await expect(account.locator('svg')).toBeVisible();
 await account.focus();await account.click();await expect(dialog.getByLabel('Display name',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('account-wide.png')});
 await dialog.getByRole('button',{name:'Change password',exact:true}).click();await expect(dialog.getByLabel('New password',{exact:true})).toHaveAttribute('type','text');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByTestId('participant-player-1').getByRole('button').click();
 const profile=page.getByTestId('public-profile');await expect(profile).toContainText('Joined');
 await page.screenshot({path:info.outputPath('profile-wide.png')});
 await page.keyboard.press('Escape');await expect(profile).not.toBeVisible();
});
