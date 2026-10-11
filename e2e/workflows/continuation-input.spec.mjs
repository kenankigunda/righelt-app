import { test, expect } from "@playwright/test";
import { importScenarioGame } from "../support/app.mjs";

const piece = (id, owner, kind, row, col) => ({ id, owner, kind, position: { row, col }, supplied: true, commanded: true });
const scenario = (id, title, pieces, continuation = null) => {
  const state = { boardSize: 10, sideToMove: "P1", turnIndex: 0, continuation, outcome: { status: "ongoing" }, pieces };
  return { formatVersion: 2, id, title, description: title, incorrect: false, initialState: state, resultingState: structuredClone(state), moves: [], expectedFinalStateHash: "hash-placeholder", expectedOutcome: "ongoing" };
};
const rush = scenario("76ae5bd9-09a3-4d72-a455-77f420641913", "Rapid rush continuation input", [
  piece("A", "P1", "unit", 4, 3), piece("B", "P1", "unit", 5, 5), piece("D", "P1", "unit", 6, 5),
  piece("C1", "P1", "commander", 4, 5), piece("C2", "P2", "commander", 7, 1),
  piece("E0", "P2", "unit", 0, 4), piece("E1", "P2", "unit", 9, 4), piece("E2", "P2", "unit", 4, 2), piece("E3", "P2", "unit", 6, 3),
], { type: "rush", owner: "P1", rushedPieceIds: ["A"], rushChainPieceIds: ["A"], chainLength: 1 });
const push = scenario("bc94b216-e964-4232-8faf-3f80f43671af", "Push retreat and follow input", [
  piece("C1", "P1", "commander", 0, 9), piece("U1-1", "P1", "unit", 7, 9), piece("U1-2", "P1", "unit", 8, 9), piece("U1-3", "P1", "unit", 7, 8),
  piece("C2", "P2", "commander", 9, 0), piece("U2-2", "P2", "unit", 9, 9),
]);
const cell = (page, row, col) => page.locator(`[data-testid="game-board"] .cell[data-row="${row}"][data-col="${col}"]`);

async function submit(page, move, count, hover) {
  const claimBoth = page.locator('[data-action="play-as-both-players"]');
  if (await claimBoth.count()) await expect(claimBoth).toBeEnabled();
  await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
  const source = cell(page, move.from.row, move.from.col);
  if (!await source.evaluate(el => el.classList.contains("source"))) await source.click();
  await expect(source).toHaveClass(/source/);
  const target = cell(page, move.to.row, move.to.col);
  if (!hover && !await target.evaluate(el => el.classList.contains("target"))) await target.click();
  const request = page.waitForRequest(req => req.method() === "POST" && /\/api\/shell\/games\/[^/]+\/apply$/.test(new URL(req.url()).pathname));
  // Keyboard activation gives a native click without a mouseover repairing selection.
  await target.focus();
  await target.press("Enter");
  expect((await request).postDataJSON().payload.action).toEqual(move);
  await expect(page.getByTestId("history-move-item")).toHaveCount(count);
  await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
}

for (const hover of [true, false]) {
  test(`rush chain continues through current actor coordinates with ${hover ? "hover" : "click"} selection`, async ({ page, baseURL }) => {
    await page.addInitScript(hover => {
      const native = window.matchMedia.bind(window);
      window.matchMedia = query => { const result = native(query); if (query === "(any-hover: hover)") Object.defineProperty(result, "matches", { value: hover }); return result; };
    }, hover);
    await importScenarioGame(page, rush, baseURL);
    await expect(page.locator("html")).toHaveAttribute("data-hover-capability", hover ? "hover" : "none");
    await submit(page, { type: "rush", actorId: "B", from: { row: 5, col: 5 }, to: { row: 5, col: 4 } }, 1, hover);
    await submit(page, { type: "rush", actorId: "D", from: { row: 6, col: 5 }, to: { row: 6, col: 4 } }, 2, hover);
  });
}

test("push switches control for retreat and restores the follow selection without hovering", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => { const result = native(query); if (query === "(any-hover: hover)") Object.defineProperty(result, "matches", { value: true }); return result; };
  });
  await importScenarioGame(page, push, baseURL);
  await page.locator('[data-action="play-as-both-players"]').click();
  await expect(page.getByTestId("game-role")).toContainText("both");
  await expect(page.locator("html")).toHaveAttribute("data-hover-capability", "hover");
  await submit(page, { type: "push", actorId: "U1-2", from: { row: 8, col: 9 }, to: { row: 9, col: 9 } }, 1, true);
  await submit(page, { type: "retreat", actorId: "U2-2", from: { row: 9, col: 9 }, to: { row: 9, col: 8 } }, 2, true);
  await submit(page, { type: "follow", actorId: "U1-1", from: { row: 7, col: 9 }, to: { row: 8, col: 9 } }, 3, true);
});
