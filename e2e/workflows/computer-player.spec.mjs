import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage, getHistoryMoveCount } from "../support/app.mjs";

const NARROW_VIEWPORT = { width: 850, height: 1100 };

const installInlineComputerPlayerHook = async (page, { failFirstTurn = false } = {}) => {
  await page.addInitScript(({ failFirstTurn }) => {
    try {
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    } catch {}

    const failedTurnKeys = new Set();
    globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = async (request) => {
      const requestKey = `${request?.personaId ?? "unknown"}:${request?.seed ?? "seedless"}`;
      if (failFirstTurn && !failedTurnKeys.has(requestKey)) {
        failedTurnKeys.add(requestKey);
        const error = new Error("Injected computer-player failure.");
        error.code = "injected_computer_player_failure";
        throw error;
      }

      const legalActions = Array.isArray(request?.legalActions) ? request.legalActions : [];
      const action = legalActions.find((candidate) => candidate?.type !== "pass") ?? legalActions[0] ?? { type: "pass" };

      return {
        action,
        diagnostics: {
          selectedAction: {
            key: action?.type === "pass" ? "pass" : "playwright-first-legal",
          },
          exploredNodes: 120,
          legalActionCount: 4,
        },
      };
    };
  }, { failFirstTurn });
};

const openComputerGameFromHome = async (page, { seat = "Player 2", opponentBotId = "babs" } = {}) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await page.getByTestId("home-create-game").click();
  await expect(page.getByTestId("start-game-picker")).toBeVisible();
  await page.getByTestId("start-mode-computer").getByRole("button", { name: "Play a computer" }).click();
  await expect(page.getByTestId("computer-opponent-picker")).toBeVisible();
  await page.getByTestId("computer-seat-choice").getByRole("button", { name: seat }).click();
  await page.getByTestId(`computer-opponent-${opponentBotId}`).getByRole("button", { name: "Start game" }).click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
};

test("computer-player games use the staged picker, narrow full-page flyout, and retain viewer sharing", async ({ browser }) => {
  const owner = await createIsolatedPage(browser);
  const viewer = await createIsolatedPage(browser);

  try {
    await installInlineComputerPlayerHook(owner.page);
    await owner.page.setViewportSize(NARROW_VIEWPORT);
    await owner.page.goto("/");
    await expect(owner.page.getByTestId("home-create-game")).toBeVisible();
    await owner.page.getByTestId("home-create-game").click();
    await expect(owner.page.getByTestId("start-game-picker")).toBeVisible();

    const flyoutBox = await owner.page.locator('[data-flyout="start"]').boundingBox();
    expect(flyoutBox).not.toBeNull();
    expect(flyoutBox.height).toBeGreaterThanOrEqual(NARROW_VIEWPORT.height - 4);
    expect(flyoutBox.width).toBeGreaterThanOrEqual(NARROW_VIEWPORT.width - 4);
    expect(flyoutBox.x).toBeLessThanOrEqual(1);
    expect(flyoutBox.y).toBeLessThanOrEqual(1);

    await owner.page.getByTestId("start-mode-computer").getByRole("button", { name: "Play a computer" }).click();
    await expect(owner.page.getByTestId("computer-opponent-picker")).toBeVisible();
    await owner.page.getByTestId("computer-seat-choice").getByRole("button", { name: "Player 2" }).click();
    await owner.page.getByTestId("computer-opponent-tau").getByRole("button", { name: "Start game" }).click();
    await expect(owner.page.getByTestId("game-shell")).toBeVisible();

    await expect(owner.page.getByTestId("game-role")).toContainText("Player 2");
    await expect(owner.page.getByTestId("computer-player-thinking")).toBeVisible();
    await owner.page.waitForTimeout(300);
    expect(await getHistoryMoveCount(owner.page)).toBe(0);
    await expect(owner.page.getByTestId("active-turn-label")).toContainText("Player 2");
    await expect(owner.page.getByTestId("computer-player-thinking")).toHaveCount(0);

    const copyInviteButton = owner.page.getByTestId("copy-invite");
    await expect(copyInviteButton).toBeVisible();
    const inviteLink = await copyInviteButton.getAttribute("data-link");
    expect(inviteLink).toBeTruthy();

    await viewer.page.goto(inviteLink);
    await expect(viewer.page.getByTestId("invite-join-viewer")).toBeVisible();
    await viewer.page.getByTestId("invite-join-viewer").click();
    await expect(viewer.page.getByTestId("game-role")).toContainText("Viewer");
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(viewer.context);
  }
});

test("computer-player failures stay recoverable and retry inline", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await installInlineComputerPlayerHook(page, { failFirstTurn: true });
    await openComputerGameFromHome(page, { seat: "Player 2", opponentBotId: "babs" });

    await expect(page.getByTestId("computer-player-thinking")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await getHistoryMoveCount(page)).toBe(0);
    const failureBanner = page.getByTestId("computer-player-failure");
    await expect(failureBanner).toContainText("could not move");
    await expect(page.getByTestId("computer-player-thinking")).toHaveCount(0);
    expect(await getHistoryMoveCount(page)).toBe(0);

    await failureBanner.getByRole("button", { name: "Retry move" }).click();
    await expect(failureBanner).toHaveCount(0);
    await expect(page.getByTestId("computer-player-thinking")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await getHistoryMoveCount(page)).toBe(0);
    await expect(page.getByTestId("active-turn-label")).toContainText("Player 2");
    await expect(page.getByTestId("computer-player-thinking")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
