import { expect } from "@playwright/test";

export async function enterUsername(page, username) {
  await page.getByTestId("account-dialog").getByLabel("Username", { exact: true }).fill(username);
}

export async function waitForAccountStartup(page) {
  await expect(page.getByRole("button", { name: "Start new game", exact: true })).toBeVisible();
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
  const board = page.locator("#shell-board button").first();
  if (new URL(page.url()).hash.startsWith("#/game/") || await board.isVisible()) {
    await expect(board).toBeVisible();
    await board.click();
  }
  else {
    await waitForAccountStartup(page);
    await page.getByRole("button", { name: "Start new game", exact: true }).click();
  }
  await expect(page.getByTestId("account-dialog")).toBeVisible();
}

export async function signOutAndOpenSignIn(page) {
  await page.getByTestId("account-dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("righelt.account.logout-pending.v1"))).toBeNull();
  await openPlaySignIn(page);
}
