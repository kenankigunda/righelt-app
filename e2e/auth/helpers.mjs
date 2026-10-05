import { expect } from "@playwright/test";

// A username edit retires secrets; fill the password only after this exact
// lookup has settled, including when the creation form was opened explicitly.
export async function enterUsername(page, username) {
  const dialog = page.getByTestId("account-dialog");
  await dialog.getByLabel("Username", { exact: true }).fill(username);
  await expect(dialog.locator("form")).toHaveAttribute("data-lookup-state", /^(available|taken)$/);
}
