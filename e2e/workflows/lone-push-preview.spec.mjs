import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createIsolatedPage,
  expectHistoryMoveCountToIncrease,
  getHistoryMoveCount,
  importScenarioGame,
} from "../support/app.mjs";

const LONE_PUSH_PREVIEW_SCENARIO = {
  formatVersion: 2,
  id: "8d7d9f9f-3b89-4a0a-b9a4-a2eb3f1f7a8d",
  title: "Lone push preview E2E fixture",
  description: "A corner push where the selected piece has exactly one legal target, which is a push.",
  incorrect: false,
  initialState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 7, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
      { id: "U1-3", owner: "P1", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 9, col: 8 }, supplied: true, commanded: true },
      { id: "U2-2", owner: "P2", kind: "unit", position: { row: 9, col: 9 }, supplied: true, commanded: true },
    ],
  },
  moves: [],
  resultingState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 7, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
      { id: "U1-3", owner: "P1", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 9, col: 8 }, supplied: true, commanded: true },
      { id: "U2-2", owner: "P2", kind: "unit", position: { row: 9, col: 9 }, supplied: true, commanded: true },
    ],
  },
  expectedFinalStateHash: "hash-placeholder",
  expectedOutcome: "ongoing",
};

const getBoardCell = (page, coord) =>
  page.locator(`[data-testid="game-board"] .cell[data-row="${coord.row}"][data-col="${coord.col}"]`);

const cellHasClass = async (locator, className) =>
  locator.evaluate((element, token) => element.classList.contains(token), className);

test("lone auto-selected push targets render the nudge preview and submit the push action", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, LONE_PUSH_PREVIEW_SCENARIO, baseURL);

    const source = { row: 8, col: 9 };
    const target = { row: 9, col: 9 };
    const sourceCell = getBoardCell(page, source);
    const targetCell = getBoardCell(page, target);
    const previewLabel = page.locator("#shell-board-preview-label");
    const startingHistoryCount = await getHistoryMoveCount(page);

    await sourceCell.click();

    await expect
      .poll(async () => cellHasClass(targetCell, "target"), {
        message: "Expected the lone legal push target to auto-select as soon as its source is clicked",
      })
      .toBe(true);
    await expect(previewLabel).toContainText("push piece onto");
    await expect(targetCell.locator('[data-push-preview-stack="1"] .stacked-underlay.stacked-pushed')).toHaveCount(1);

    const applyRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && /\/api\/shell\/games\/[^/]+\/apply$/.test(url.pathname);
    });

    await targetCell.click();

    const applyRequest = await applyRequestPromise;
    expect(applyRequest.postDataJSON()?.payload?.action).toEqual({
      type: "push",
      actorId: "U1-2",
      from: source,
      to: target,
    });
    await expectHistoryMoveCountToIncrease(page, startingHistoryCount);
  } finally {
    await closeContextQuietly(context);
  }
});


test("a pushed commander stays below the attacking unit while its window masks board paths", async ({browser,baseURL})=>{
 const {context,page}=await createIsolatedPage(browser);
 try {
  const scenario=structuredClone(LONE_PUSH_PREVIEW_SCENARIO);
  for(const state of [scenario.initialState,scenario.resultingState]) {
   state.pieces.find(p=>p.id==='C2').position={row:9,col:9};
   state.pieces.find(p=>p.id==='U2-2').position={row:9,col:0};
  }
  await importScenarioGame(page,scenario,baseURL);
  await getBoardCell(page,{row:8,col:9}).click();
  const stack=getBoardCell(page,{row:9,col:9}).locator('[data-push-preview-stack="1"]');
  await expect(stack.locator('.commander.stacked-underlay')).toBeVisible();
  const order=await stack.evaluate(el=>({stack:Number(getComputedStyle(el).zIndex),under:Number(getComputedStyle(el.querySelector('.stacked-underlay')).zIndex),top:Number(getComputedStyle(el.querySelector('.stacked-top')).zIndex),opacity:getComputedStyle(el.querySelector('.commander')).opacity}));
  expect(order.stack).toBeGreaterThanOrEqual(2);expect(order.under).toBeLessThan(order.top);expect(order.opacity).toBe('1');
 } finally {await closeContextQuietly(context);}
});
