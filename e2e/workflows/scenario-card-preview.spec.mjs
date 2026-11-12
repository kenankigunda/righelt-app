import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

import { createInitialState, listLegalActions, resolveToStability } from "../../apps/web/generated/packages/game-engine/src/index.js";
import { closeContextQuietly, createIsolatedPage } from "../support/app.mjs";

const buildScenarioCatalog = () => {
  const snapshot = resolveToStability(createInitialState(), { artifactMode: "full" });
  const projectAction = listLegalActions(snapshot).find((action) => action.type === "project");
  if (!projectAction) {
    throw new Error("Expected a project action in the initial state for scenario preview coverage");
  }

  const makeScenario = (id, title, savedSelection) => ({
    formatVersion: 2,
    id,
    title,
    description: title,
    incorrect: false,
    initialState: snapshot,
    moves: [],
    resultingState: snapshot,
    expectedFinalStateHash: "hash-placeholder",
    expectedOutcome: "ongoing",
    savedSelection: {
      source: { ...savedSelection.source },
      target: savedSelection.target ? { ...savedSelection.target } : null,
      actorSide: snapshot.sideToMove,
      turnIndex: snapshot.turnIndex,
    },
  });

  return {
    historyScenario: makeScenario(
      "aa2cd610-f0b4-4dd6-ae95-b0804737fda0",
      "Another test save from history",
      { source: projectAction.from, target: projectAction.to },
    ),
    sourceOnlyScenario: makeScenario(
      "2de4c8e8-bc63-4111-b529-2d71a56a2a83",
      "Source-only project preview",
      { source: projectAction.from, target: null },
    ),
    projectAction,
  };
};

const cellLocator = (previewRoot, coord) =>
  previewRoot.locator(`.cell[data-row="${coord.row}"][data-col="${coord.col}"]`);

const locatorHasClass = async (locator, className) =>
  locator.evaluate((element, token) => element.classList.contains(token), className);

const locatorHasDescendant = async (locator, selector) =>
  locator.evaluate((element, token) => Boolean(element.querySelector(token)), selector);

test("scenario flyout selected card renders history-style recorded action previews", async ({ browser }, info) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { historyScenario, sourceOnlyScenario, projectAction } = buildScenarioCatalog();

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: [historyScenario, sourceOnlyScenario],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Scenarios" }).click();

    const flyout = page.locator('[data-flyout="scenarios"]');
    const scenarioCard = flyout.locator(".mini-board-card-scenario");
    const previewRoot = flyout.locator(`[data-preview-id="scenario:${historyScenario.id}"]`);
    const sourceCell = cellLocator(previewRoot, projectAction.from);

    await expect(previewRoot).toBeVisible();
    await expect(scenarioCard.locator(".mini-board-preview-status")).toContainText("Blue to play");
    await expect.poll(() => locatorHasClass(sourceCell, "selected-piece")).toBe(false);
    await expect
      .poll(() => locatorHasDescendant(cellLocator(previewRoot, projectAction.to), ".preview-created"))
      .toBe(true);
    await expect.poll(() => flyout.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return !element.getAnimations().some(animation => animation.playState === "running" || animation.playState === "pending")
        && getComputedStyle(element).opacity === "1" && rect.left >= -1 && rect.right <= innerWidth + 1;
    })).toBe(true);
    await expect(previewRoot.locator(".cell")).toHaveCount(100);
    const paint = await scenarioCard.evaluate(card => {
      const preview = card.querySelector(".mini-board-preview-surface"), outer = getComputedStyle(card), inner = getComputedStyle(preview);
      return { card: { image: outer.backgroundImage, color: outer.backgroundColor, border: outer.borderTopColor, radius: outer.borderRadius, shadow: outer.boxShadow }, preview: { image: inner.backgroundImage, color: inner.backgroundColor, filter: inner.backdropFilter }, rect: preview.getBoundingClientRect().toJSON() };
    });
    const paintPath = info.outputPath("scenario-miniature-native-paint.json");await writeFile(paintPath,JSON.stringify(paint,null,2),{mode:0o600});await info.attach("Scenario miniature native paint",{path:paintPath,contentType:"application/json"});
    expect(paint.card).toEqual({ image: "none", color: "rgba(0, 0, 0, 0)", border: "rgba(0, 0, 0, 0)", radius: "0px", shadow: "none" });
    expect(paint.preview.image).toContain("url(");expect(paint.preview.filter).toBe("none");
    const white = paint.preview.color.match(/[\d.]+/g).slice(0,3).map(Number);
    expect(Math.min(...white)).toBeGreaterThanOrEqual(250);expect(Math.max(...white)-Math.min(...white)).toBeLessThanOrEqual(2);
    const imagePath = info.outputPath("scenario-recorded-preview.png");
    await page.screenshot({ path: imagePath, fullPage: true });
    await info.attach("Scenario recorded preview", { path: imagePath, contentType: "image/png" });
    await page.emulateMedia({forcedColors:"active"});
    await expect.poll(() => previewRoot.evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none");
    const fallbackPath=info.outputPath("scenario-miniature-forced-colors.png");await page.screenshot({path:fallbackPath});await info.attach("Scenario miniature forced colors",{path:fallbackPath,contentType:"image/png"});
  } finally {
    await closeContextQuietly(context);
  }
});

test("scenario flyout selected card keeps source-only selections in interactive preview mode", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { historyScenario, sourceOnlyScenario, projectAction } = buildScenarioCatalog();

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: [historyScenario, sourceOnlyScenario],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Scenarios" }).click();
    await page.locator("#scenario-select").selectOption(sourceOnlyScenario.id);

    const flyout = page.locator('[data-flyout="scenarios"]');
    const scenarioCard = flyout.locator(".mini-board-card-scenario");
    const previewRoot = flyout.locator(`[data-preview-id="scenario:${sourceOnlyScenario.id}"]`);
    const sourceCell = cellLocator(previewRoot, projectAction.from);

    await expect(previewRoot).toBeVisible();
    await expect(scenarioCard.locator(".mini-board-preview-status")).toContainText("Red to play");
    await expect.poll(() => locatorHasClass(sourceCell, "selected-piece")).toBe(true);
    await expect
      .poll(() => locatorHasDescendant(previewRoot, ".recorded-action-source-piece"))
      .toBe(false);
  } finally {
    await closeContextQuietly(context);
  }
});
