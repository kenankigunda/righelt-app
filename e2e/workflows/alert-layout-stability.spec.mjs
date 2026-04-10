import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  makeAnyLegalMove,
  openPendingHistoryBranchFromMove,
} from "../support/app.mjs";
import {
  assertMaxCumulativeLayoutShift,
  expectLocatorInZone,
  installUxMetricsCollector,
  readUxMetrics,
} from "../support/ux.mjs";

const getShellAnchors = async (page) =>
  page.evaluate(() => {
    const app = document.getElementById("app");
    const layoutMode = app?.dataset.shellLayoutMode;
    if (layoutMode === "narrow") {
      const trackWrap = document.querySelector(".game-shell-track-wrap");
      const activeTab = document.querySelector('[data-action="switch-game-panel"][aria-pressed="true"]');
      const activePanelKey = activeTab instanceof HTMLElement ? activeTab.dataset.panel : null;
      const activePanel = activePanelKey ? document.querySelector(`[data-mobile-panel="${activePanelKey}"]`) : null;
      if (!(trackWrap instanceof HTMLElement) || !(activePanel instanceof HTMLElement)) {
        return null;
      }
      const trackWrapRect = trackWrap.getBoundingClientRect();
      const activePanelRect = activePanel.getBoundingClientRect();
      return {
        layoutMode,
        shellTop: Math.round(trackWrapRect.top),
        activePanelTop: Math.round(activePanelRect.top),
      };
    }

    const board = document.querySelector('[data-shell-panel="board"]');
    const history = document.querySelector('[data-game-panel="history"]');
    if (!(board instanceof HTMLElement) || !(history instanceof HTMLElement)) {
      return null;
    }
    const boardRect = board.getBoundingClientRect();
    const historyRect = history.getBoundingClientRect();
    return {
      layoutMode: "wide",
      boardTop: Math.round(boardRect.top),
      historyTop: Math.round(historyRect.top),
    };
  });

const expectStableShellAnchors = (before, after, label) => {
  expect(after, `${label}: expected shell anchors to exist`).not.toBeNull();
  if (before.layoutMode === "narrow") {
    expect(after.layoutMode, `${label}: expected narrow shell layout`).toBe("narrow");
    expect(Math.abs(after.shellTop - before.shellTop), `${label}: shell top should stay stable`).toBeLessThanOrEqual(2);
    expect(Math.abs(after.activePanelTop - before.activePanelTop), `${label}: active panel top should stay stable`).toBeLessThanOrEqual(2);
    return;
  }
  expect(Math.abs(after.boardTop - before.boardTop), `${label}: board top should stay stable`).toBeLessThanOrEqual(2);
  expect(Math.abs(after.historyTop - before.historyTop), `${label}: history top should stay stable`).toBeLessThanOrEqual(2);
};

const runAlertLayoutCase = async ({ context, page, zone }) => {
  let failureCount = 0;
  let releaseBranchFailure = null;
  const allowBranchFailure = new Promise((resolve) => {
    releaseBranchFailure = resolve;
  });
  const branchRequestSeen = new Promise((resolve) => {
    context.route("**/api/shell/history/branch", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      resolve();
      await allowBranchFailure;
      failureCount += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: `forced alert layout stability ${failureCount}` }),
      });
    });
  });

  await createGameFromHome(page);
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await makeAnyLegalMove(page, "p1");
  const { popup, gameId } = await openPendingHistoryBranchFromMove(page, 0);
  await branchRequestSeen;

  await expect(popup.getByTestId("game-shell")).toBeVisible();
  await expect(popup.getByTestId("game-role")).toContainText("Player 1");
  await expect(popup.getByText("Latest: History branch pending sync")).toBeVisible();
  await expect(popup).toHaveURL(new RegExp(`#\\/game\\/${gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await installUxMetricsCollector(popup);
  const before = await getShellAnchors(popup);
  releaseBranchFailure?.();

  const failureBanner = popup.getByTestId("sync-failure-banner");
  await expect(failureBanner).toBeVisible();
  await expectLocatorInZone(popup, failureBanner, { zone, tolerancePx: 32 });
  const afterAppear = await getShellAnchors(popup);
  expectStableShellAnchors(before, afterAppear, "after alert appearance");

  await failureBanner.getByRole("button", { name: "Dismiss" }).click();
  await expect(failureBanner).toHaveCount(0);
  const afterDismiss = await getShellAnchors(popup);
  expectStableShellAnchors(before, afterDismiss, "after alert dismissal");

  const metrics = await readUxMetrics(popup);
  assertMaxCumulativeLayoutShift(metrics.layoutShiftEntries, 0.02);
};

test("alert layout stability keeps wide-view alerts in the header zone without shifting the shell", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await runAlertLayoutCase({ context, page, zone: "header-center" });
  } finally {
    await closeContextQuietly(context);
  }
});

test("alert layout stability keeps narrow-view alerts in the top overlay without shifting the shell", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await runAlertLayoutCase({ context, page, zone: "top-overlay" });
  } finally {
    await closeContextQuietly(context);
  }
});
