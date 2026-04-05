import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("participant badges show disconnect and reconnect transitions for the joined player", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);

    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");
    await expect(owner.page.getByTestId("participant-player-2")).toContainText("Connected");

    const guestGameUrl = guest.page.url();
    await guest.page.goto("about:blank");
    await expect
      .poll(async () => owner.page.getByTestId("participant-player-2").textContent())
      .toContain("Disconnected");

    await guest.page.goto(guestGameUrl);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");
    await expect
      .poll(async () => owner.page.getByTestId("participant-player-2").textContent())
      .toContain("Connected");
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});
