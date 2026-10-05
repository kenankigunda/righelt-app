import { test, expect } from "@playwright/test";

import { closeContextQuietly, createGameFromHome, createIsolatedPage, openDirectGameLink } from "../support/app.mjs";

test("copy invite waits for pending game creation and then copies the committed invite token", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.addInitScript(() => {
      window.__copiedTexts = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText(text) {
            window.__copiedTexts.push(text);
            return Promise.resolve();
          },
        },
      });
    });

    let releaseCreate = null;
    const createReleased = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    await page.route("**/api/shell/games", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await createReleased;
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();

    const createResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === "/api/shell/games";
    });

    await page.getByTestId("home-create-game").click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("copy-invite")).toBeVisible();

    await page.getByTestId("copy-invite").click();

    await expect(page.getByTestId("copy-invite")).toHaveText("Preparing link…");
    await expect(page.getByTestId("copy-invite")).toHaveAttribute("data-pending", "true");
    await expect.poll(async () => page.evaluate(() => window.__copiedTexts.length)).toBe(0);

    releaseCreate?.();

    const createResponse = await createResponsePromise;
    const createBody = await createResponse.json();
    const expectedInviteToken = createBody?.game?.inviteToken;

    await expect(page.getByTestId("copy-invite")).toHaveText("Invite someone to play as blue");
    await expect(page.getByText("Link copied")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__copiedTexts[0] ?? null)).toContain(
      `#/invite/${expectedInviteToken}`,
    );
  } finally {
    await closeContextQuietly(context);
  }
});

test("joining through a delayed direct-link flow only pulses the clicked join button", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const created = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, created.gameHash);

    let releaseJoin = null;
    const joinReleased = new Promise((resolve) => {
      releaseJoin = resolve;
    });
    await guest.page.route("**/api/shell/games/*/join", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await joinReleased;
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    const inviteViewerButton = guest.page.getByTestId("invite-join-viewer");
    const invitePlayerButton = guest.page.getByTestId("invite-join-player");
    const panelViewerButton = guest.page.getByTestId("join-viewer");
    const panelPlayerButton = guest.page.getByTestId("join-player");
    const viewerButton = ((await inviteViewerButton.count()) > 0 ? inviteViewerButton : panelViewerButton).first();
    const otherButton = ((await invitePlayerButton.count()) > 0 ? invitePlayerButton : panelPlayerButton).first();

    await expect(viewerButton).toBeVisible();
    await expect(otherButton).toBeVisible();

    await viewerButton.click();

    await expect(viewerButton).toHaveAttribute("data-pending", "true");
    await expect(viewerButton).toHaveText("Joining...");
    await expect(otherButton).toBeEnabled();

    releaseJoin?.();

    await expect(guest.page.getByTestId("game-role")).toContainText("Viewer");
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});

test("scenario update only pulses the clicked scenario button while the local write is pending", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    await page.getByRole("button", { name: "Scenarios" }).click();
    const updateButton = page.locator('[data-action="update-scenario"]').first();
    const saveButton = page.locator('[data-action="save-scenario"]').first();
    await expect(updateButton).toBeVisible();
    await expect(saveButton).toBeVisible();

    let releaseUpdate = null;
    const updateReleased = new Promise((resolve) => {
      releaseUpdate = resolve;
    });
    await page.route("**/scenarios/update", async (route) => {
      await updateReleased;
      await route.fallback();
    });

    await updateButton.click();

    await expect(updateButton).toHaveAttribute("data-pending", "true");
    await expect(updateButton).toHaveAttribute("aria-busy", "true");
    await expect(updateButton).toHaveText("Update to match current board");
    await expect(saveButton).not.toHaveAttribute("data-pending", "true");

    releaseUpdate?.();
  } finally {
    await closeContextQuietly(context);
  }
});
