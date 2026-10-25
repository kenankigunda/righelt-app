import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove } from '../support/app.mjs';

test('phone instructions keep the board stationary during source and hover selection', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = native(query);
      if (query === '(any-hover: hover)') Object.defineProperty(result, 'matches', {value:true});
      return result;
    };
  });
  const {gameId} = await createGameFromHome(page);
  const boardTab = page.getByRole('button', {name:'Board',exact:true});
  if (await boardTab.isVisible()) await boardTab.click();
  const action = await page.evaluate(async id => {
    const identityId = localStorage.getItem('righelt.identity.id.v1');
    const {game} = await (await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json();
    return game.legalActions.find(action => action.from && action.to);
  }, gameId);
  const cell = position => page.locator(`[data-testid="game-board"] .cell[data-row="${position.row}"][data-col="${position.col}"]`);
  const geometry = () => page.getByTestId('game-board').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return {x:bounds.x+scrollX,y:bounds.y+scrollY,width:bounds.width,height:bounds.height};
  });
  await page.mouse.move(0,0);
  const before = await geometry();
  await cell(action.from).click();
  await expect(page.locator('#shell-board-preview-label')).toContainText('Select a move');
  expect(await geometry()).toEqual(before);
  await cell(action.to).hover();
  await expect(cell(action.to)).toHaveClass(/\btarget\b/);
  expect(await geometry()).toEqual(before);
  await cell(action.to).click();
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
});

for (const supportsHover of [true, false]) test(`browser move submission follows ${supportsHover ? 'hover' : 'click'} destination selection`, async ({ page }) => {
  await page.addInitScript(supportsHover => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = native(query);
      if (query === '(any-hover: hover)') Object.defineProperty(result, 'matches', { value: supportsHover });
      return result;
    };
  }, supportsHover);
  await createGameFromHome(page);
  await expect(page.locator('html')).toHaveAttribute('data-hover-capability', supportsHover ? 'hover' : 'none');
  let applied;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/apply')) applied = request; });
  await makeAnyLegalMove(page);
  await expect.poll(() => Boolean(applied)).toBe(true);
  expect(applied.postDataJSON().protocolVersion).toBe(2);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
});
