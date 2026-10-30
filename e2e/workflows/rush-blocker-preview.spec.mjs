import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage, importScenarioGame, submitPlayableAction } from "../support/app.mjs";

import {createRushBlockerScenario,assertRushBlockerState} from '../support/rush-blocker-scenario.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';

test("rush blocker preview chip matches the highlighted square", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    // The engine resolves eligibility and captures its own frozen turn state.
    // Importing hand-written true flags cannot establish a legal continuation.
    const {scenario,reconnect,state}=createRushBlockerScenario();
    const {gameId}=await importScenarioGame(page, scenario, baseURL);
    const imported=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
    expect(imported.canRecordMove).toBe(true);expect(imported.canEndTurn).toBe(false);
    expect(imported.legalActions.some(action=>action.type==='rush')).toBe(true);
    expect(imported.legalActions.some(action=>action.type==='end_turn')).toBe(false);
    expect(imported.legalActions).toContainEqual(reconnect);
    expect(imported.board.state.continuation.frozenPieceStatesById).toEqual(state.continuation.frozenPieceStatesById);
    assertRushBlockerState(imported.board.state);

    const previewLabel = page.locator("#shell-board-preview-label");
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
    await expect(previewLabel).toContainText("Rush to reconnect piece at");
    const blockerChip = previewLabel.locator(".board-preview-coordinate-chip-rush-blocker");
    await expect(blockerChip).toHaveText("4, 3");

    const blockerCell = page.locator('[data-testid="game-board"] .cell[data-row="4"][data-col="3"]');
    await expect
      .poll(async () => blockerCell.evaluate((cell) => cell.classList.contains("rush-blocker")), {
        message: "Expected the named rush blocker square to carry the dedicated rush-blocker highlight",
      })
      .toBe(true);
    await expect(previewLabel.locator('[data-board-preview-action="end-turn"]')).toHaveCount(0);
    await submitPlayableAction(page,reconnect);
    await expect.poll(async()=>{
      const next=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
      return {canEndTurn:next.canEndTurn,endTurnLegal:next.legalActions.some(action=>action.type==='end_turn')};
    }).toEqual({canEndTurn:true,endTurnLegal:true});
    await expect(previewLabel.locator('.board-preview-coordinate-chip-rush-blocker')).toHaveCount(0);

  } finally {
    await closeContextQuietly(context);
  }
});
