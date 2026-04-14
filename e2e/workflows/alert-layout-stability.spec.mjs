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

const readAlertStackState = async (page) =>
  page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-alert-stack-card]"));
    const items = cards.map((card) => ({
      stackIndex: Number(card.getAttribute("data-stack-index") ?? "-1"),
      active: card.classList.contains("is-active"),
      text: card.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));
    const activeItem = items.find((item) => item.active) ?? null;
    return {
      count: items.length,
      activeText: activeItem?.text ?? "",
      stackSignature: items.map((item) => `${item.stackIndex}:${item.text}`).join("|"),
    };
  });

const cycleAlertStack = async (page) => {
  const activeCard = page.locator(".shell-game-alert-stack-card.is-active").first();
  await expect(activeCard).toBeVisible();
  await activeCard.click({ position: { x: 18, y: 18 } });
};

const bringFailureBannerToFront = async (page) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const activeText = (await readAlertStackState(page)).activeText;
    if (activeText.includes("Sync failed")) {
      return;
    }
    await cycleAlertStack(page);
  }
  throw new Error("Expected to rotate the sync failure banner to the front of the alert stack");
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
  const popupViewport = page.viewportSize();
  if (popupViewport) {
    await popup.setViewportSize(popupViewport);
  }
  await branchRequestSeen;

  await expect(popup.getByTestId("game-shell")).toBeVisible();
  await expect(popup.getByTestId("game-role")).toContainText("Player 1");
  const pendingSyncNotice = popup.getByText("Latest: History branch pending sync");
  await expect(pendingSyncNotice).toBeVisible();
  await expect(popup).toHaveURL(new RegExp(`#\\/game\\/${gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await installUxMetricsCollector(popup);
  const before = await getShellAnchors(popup);
  releaseBranchFailure?.();

  const failureBanner = popup.getByTestId("sync-failure-banner");
  await expect(failureBanner).toBeVisible();
  await expect(pendingSyncNotice).toHaveCount(0);
  await expectLocatorInZone(popup, failureBanner, { zone, tolerancePx: 32 });
  const afterAppear = await getShellAnchors(popup);
  expectStableShellAnchors(before, afterAppear, "after alert appearance");

  const beforeRotate = await readAlertStackState(popup);
  await expect
    .poll(async () => (await readAlertStackState(popup)).count, {
      message: "Expected at least one alert to remain visible in the top overlay",
    })
    .toBeGreaterThanOrEqual(1);
  if (beforeRotate.count > 1) {
    await cycleAlertStack(popup);
    await expect
      .poll(async () => (await readAlertStackState(popup)).activeText, {
        message: "Expected clicking the active notification to rotate the stack order",
      })
      .not.toBe(beforeRotate.activeText);
    const afterRotate = await getShellAnchors(popup);
    expectStableShellAnchors(before, afterRotate, "after alert rotation");
    const afterRotateStack = await readAlertStackState(popup);
    expect(afterRotateStack.stackSignature).not.toBe(beforeRotate.stackSignature);
  }

  await bringFailureBannerToFront(popup);

  await popup.locator('.shell-game-alert-stack-card.is-active [data-action="dismiss-failed-operation"]').click();
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
    await runAlertLayoutCase({
      context,
      page,
      zone: { unit: "percent", left: 0.02, top: 0, width: 0.96, height: 0.18 },
    });
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
