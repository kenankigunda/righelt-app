import { test, expect } from "@playwright/test";

import { closeContextQuietly, createGameFromHome, createIsolatedPage } from "../support/app.mjs";

const getBoardCell = (page, coord) =>
  page.locator(`[data-testid="game-board"] .cell[data-row="${coord.row}"][data-col="${coord.col}"]`);

const cellHasClass = async (locator, className) =>
  locator.evaluate((element, token) => element.classList.contains(token), className);

const getPlayableSelectionPair = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      return null;
    }

    const gameId = decodeURIComponent(match[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const body = await response.json();
    const legalActions = Array.isArray(body?.game?.legalActions) ? body.game.legalActions : [];
    const actionsBySourceKey = new Map();

    for (const action of legalActions) {
      if (!action?.from || !action?.to) {
        continue;
      }
      const sourceKey = `${action.actorId ?? ""}:${action.from.row},${action.from.col}`;
      const entry = actionsBySourceKey.get(sourceKey) ?? {
        actorId: action.actorId ?? null,
        source: { ...action.from },
        targets: [],
      };
      if (!entry.targets.some((target) => target.row === action.to.row && target.col === action.to.col)) {
        entry.targets.push({ ...action.to });
      }
      actionsBySourceKey.set(sourceKey, entry);
    }

    return [...actionsBySourceKey.values()].find((entry) => entry.targets.length >= 2) ?? null;
  });

test("scenario flyout saves a selected source and destination after switching an already-loaded board into click mode", async ({
  browser,
}) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    let savedScenario = null;

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: savedScenario ? [savedScenario] : [],
        }),
      });
    });

    await page.route("**/scenarios/save", async (route) => {
      savedScenario = route.request().postDataJSON()?.scenario ?? null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            id: "S",
            title: "Saved Scenarios",
            scenarios: savedScenario ? [savedScenario] : [],
          },
        }),
      });
    });

    await createGameFromHome(page);
    const selectionPair = await getPlayableSelectionPair(page);
    expect(selectionPair).not.toBeNull();

    const sourceCell = getBoardCell(page, selectionPair.source);
    const targetCell = getBoardCell(page, selectionPair.targets[0]);

    await sourceCell.click();
    await targetCell.hover();
    await expect
      .poll(async () => cellHasClass(targetCell, "target"), {
        message: "Expected the live board to use hover target selection before the scenarios flyout opens",
      })
      .toBe(true);

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-save-field="title"]')).toBeVisible();
    await expect
      .poll(async () => cellHasClass(targetCell, "target"), {
        message: "Expected opening the flyout to clear the transient hover target selection",
      })
      .toBe(false);

    await targetCell.hover();
    await expect
      .poll(async () => cellHasClass(targetCell, "target"), {
        message: "Expected hovering a target while the scenarios flyout is open to stop short of selecting it",
      })
      .toBe(false);

    // The flyout clears only the hover target, preserving the selected source.
    // Clicking that source again would intentionally show supply lines instead.
    await expect(sourceCell).toHaveClass(/(?:^|\s)selected-piece(?:\s|$)/);
    await targetCell.click();
    await expect
      .poll(async () => cellHasClass(sourceCell, "source"), {
        message: "Expected the clicked source square to stay selected while authoring a scenario",
      })
      .toBe(true);
    await expect
      .poll(async () => cellHasClass(targetCell, "target"), {
        message: "Expected clicking the destination while the flyout is open to select it for scenario authoring",
      })
      .toBe(true);
    await expect(page.locator("#shell-board-preview-label")).toContainText("Activate this destination again to play");

    await page.locator('[data-scenario-save-field="title"]').fill(`Selection mode scenario ${Date.now()}`);
    await page.locator('[data-scenario-save-field="description"]').fill("Verifies flyout authoring captures a clicked source/destination.");
    await page.locator('[data-action="save-scenario"]').click();

    await expect
      .poll(() => savedScenario?.savedSelection ?? null, {
        message: "Expected saving the scenario to capture the selected source and destination squares",
      })
      .not.toBeNull();
    expect(savedScenario.savedSelection).toEqual({
      source: selectionPair.source,
      target: selectionPair.targets[0],
      actorSide: "P1",
      turnIndex: 0,
    });
  } finally {
    await closeContextQuietly(context);
  }
});

test("closing the scenarios flyout restores hover target selection on an already-loaded board", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await createGameFromHome(page);
    const selectionPair = await getPlayableSelectionPair(page);
    expect(selectionPair).not.toBeNull();

    const sourceCell = getBoardCell(page, selectionPair.source);
    const firstTargetCell = getBoardCell(page, selectionPair.targets[0]);
    const secondTargetCell = getBoardCell(page, selectionPair.targets[1]);

    await sourceCell.click();
    await firstTargetCell.hover();
    await expect
      .poll(async () => cellHasClass(firstTargetCell, "target"), {
        message: "Expected the live board to use hover target selection before the scenarios flyout opens",
      })
      .toBe(true);
    await expect(page.locator("#shell-board-preview-label")).toContainText("Click to");

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-save-field="title"]')).toBeVisible();
    await expect
      .poll(async () => cellHasClass(firstTargetCell, "target"), {
        message: "Expected opening the flyout to clear the transient hover target selection",
      })
      .toBe(false);

    await secondTargetCell.hover();
    await expect
      .poll(async () => cellHasClass(secondTargetCell, "target"), {
        message: "Expected hover target selection to stay disabled while the scenarios flyout is open",
      })
      .toBe(false);

    await expect(sourceCell).toHaveClass(/(?:^|\s)selected-piece(?:\s|$)/);
    await firstTargetCell.click();
    await expect(page.locator("#shell-board-preview-label")).toContainText("Activate this destination again to play");

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-save-field="title"]')).toHaveCount(0);

    await expect(sourceCell).toHaveClass(/(?:^|\s)selected-piece(?:\s|$)/);
    await secondTargetCell.hover();
    await expect
      .poll(async () => cellHasClass(secondTargetCell, "target"), {
        message: "Expected closing the flyout to restore hover target selection on the mounted board",
      })
      .toBe(true);
    await expect(page.locator("#shell-board-preview-label")).toContainText("Click to");
  } finally {
    await closeContextQuietly(context);
  }
});
