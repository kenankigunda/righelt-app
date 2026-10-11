import { expect } from "@playwright/test";

export async function enterUsername(page, username) {
  await page.getByTestId("account-dialog").getByLabel("Username", { exact: true }).fill(username);
}

export async function waitForAccountStartup(page) {
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  // Read one DOM state. Separate locator calls can straddle the transition
  // from Connecting to retry and falsely observe both indicators as absent.
  await expect.poll(() => page.evaluate(() => ({
    header: Boolean(document.querySelector('.shell-header')),
    retry: Boolean(document.querySelector('[data-action="retry-account-startup"]')),
    connecting: [...document.querySelectorAll('[role="status"]')].some(node => /^Connecting…$/.test(node.textContent.trim())),
  }))).toEqual({ header: true, retry: false, connecting: false });
}

// Resume from the existing board without creating a replacement game. On the
// public home page the real Start new game action supplies the account gate.
export async function openPlaySignIn(page) {
  const inviteClose=page.getByRole("button",{name:"Close invite",exact:true});
  if(await inviteClose.isVisible())await inviteClose.click();
  const board = page.locator("#shell-board button").first();
  if (new URL(page.url()).hash.startsWith("#/game/") || await board.isVisible()) {
    await expect(board).toBeVisible();
    await board.click();
  }
  else {
    await waitForAccountStartup(page);
    await page.locator('[data-action="account-open"]').click();
  }
  await expect(page.getByTestId("account-dialog")).toBeVisible();
}

export async function signOutAndOpenSignIn(page) {
  await page.getByTestId("account-dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("righelt.account.logout-pending.v1"))).toBeNull();
  await openPlaySignIn(page);
}

// Home authentication resumes the chosen Friend introduction, never silently
// creates a match. Tests must explicitly choose whether to play or dismiss it.
export async function continueFriendIntroduction(page, {play = true} = {}) {
  const story=page.getByRole('dialog',{name:'Friend',exact:true});
  if(!await story.isVisible())await page.getByTestId('home-create-game').click();
  await expect(story).toBeVisible();
  if (!play) {await story.getByRole('button',{name:'Close opponent story',exact:true}).click();return;}
  await story.getByRole('button',{name:'Start a friend game',exact:true}).click();
  await expect(page).toHaveURL(/#\/(tutorial(?:$|\/)|game\/)/);
  // A saved result briefly passes through the tutorial route while its account
  // acknowledgment completes. Only skip when an actual lesson is displayed.
  const skip=page.locator('[data-lesson-skip-all]');
  await expect.poll(async()=>new URL(page.url()).hash.startsWith('#/game/')||await skip.isVisible()).toBe(true);
  if(await skip.isVisible())await skip.click();
  await expect(page).toHaveURL(/#\/game\//);
  await expect(page.getByTestId('game-role')).toContainText('Player 1');
  await page.getByRole('button',{name:'Close invite',exact:true}).click();
}
