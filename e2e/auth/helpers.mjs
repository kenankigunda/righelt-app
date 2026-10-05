import { expect } from "@playwright/test";

// Sign-in never looks up names; registration availability is advisory. Helpers
// type normally without adding an availability gate that the user does not have.
export async function enterUsername(page, username) {
  await page.getByTestId("account-dialog").getByLabel("Username", { exact: true }).fill(username);
}

export async function signOutAndOpenSignIn(page) {
  await page.getByTestId("account-dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("righelt.account.logout-pending.v1"))).toBeNull();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
