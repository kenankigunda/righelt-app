import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  makeAnyLegalMove,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("undo-last-move applies optimistically before the revert request response returns", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.route("**/api/shell/games/*/revert-request", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await page.waitForTimeout(1_500);
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    await createGameFromHome(page);
    await makeAnyLegalMove(page);

    const revertResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname.endsWith("/revert-request");
    });

    await expect(page.locator('[data-action="undo-last-move"]')).toBeVisible();
    await page.locator('[data-action="undo-last-move"]').click();

    await expect(page.getByText("Latest: Undo applied")).toBeVisible({ timeout: 700 });

    await revertResponsePromise;
    await expect(page.getByText(/Latest: (Undo applied|Player .* accepted the undo request)/)).toBeVisible();
    await expect(page.locator('[data-action="undo-last-move"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("undo-last-move keeps the optimistic revert request id aligned when approval is required", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const created = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, created.gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(owner.page);

    let releaseRevertResponse = null;
    const revertResponseBlocked = new Promise((resolve) => {
      releaseRevertResponse = resolve;
    });
    await owner.page.route("**/api/shell/games/*/revert-request", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await revertResponseBlocked;
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    const revertRequestPromise = owner.page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && url.pathname.endsWith("/revert-request");
    });

    await expect(owner.page.locator('[data-action="undo-last-move"]')).toBeVisible();
    await owner.page.locator('[data-action="undo-last-move"]').click();

    const rescindButton = owner.page.locator('[data-action="rescind-revert-request"]');
    await expect(rescindButton).toBeVisible({ timeout: 700 });
    await expect(owner.page.getByText("Latest: Undo request pending approval")).toBeVisible({ timeout: 700 });

    const revertRequest = await revertRequestPromise;
    const requestId = revertRequest.postDataJSON()?.requestId;
    expect(requestId).toMatch(/^revert-/);
    await expect.poll(async () => rescindButton.getAttribute("data-request-id")).toBe(requestId);

    releaseRevertResponse?.();

    await expect(owner.page.getByText("Latest: Undo request pending approval")).toBeVisible();
    await expect(rescindButton).toHaveAttribute("data-request-id", requestId);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});
