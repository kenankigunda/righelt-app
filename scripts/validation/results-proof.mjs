import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { proof } from './proof.mjs';

export function selectTerminalScenario(catalog) {
  const scenario = catalog.scenarios?.find(item => item.title === 'Capture supply point to win by unsupplying the commander');
  assert.ok(scenario, 'Candidate lacks the catalog-backed terminal result fixture');
  return scenario;
}
export function assertFriendRematch(game, previousId, accountId) {
  assert.ok(game?.id && game.id !== previousId, 'Rematch must create a different game');
  assert.equal(game.ownershipMode, 'account_v1');
  assert.equal(game.selfPlayMode, false);
  assert.equal(game.player1?.identityId, accountId, 'Swapped side must belong to the signed-in account');
  assert.equal(game.player2, null, 'A friend rematch must leave the peer seat empty');
  assert.equal(game.board?.state?.outcome?.status, 'ongoing');
}
async function request(page, route, body) {
  return page.evaluate(async ({ route, body }) => {
    const session = await (await fetch('/api/auth/session')).json();
    const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Righelt-Auth': '1', 'X-Righelt-Auth-Version': '1', 'X-Righelt-Session': session.contextId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), accountId: session.account?.id };
  }, { route, body });
}
async function settled(page) {
  const transition = page.locator('.shell-route-transition-layer');
  if (await transition.count()) await expect(transition).toHaveAttribute('data-active', 'false');
}
// Uses real creation/import handlers and the candidate's own catalog. The
// terminal outcome is delivered through the live channel, never DOM injection.
export async function proveResultsRematch({ page, info, root }) {
  const scenario = selectTerminalScenario(JSON.parse(await readFile(path.join(root, 'apps/web/scenarios/catalog.json'), 'utf8')));
  const created = await request(page, '/api/shell/games', { selfPlayMode: false, creatorSide: 'p2' });
  assert.equal(created.status, 200);
  const id = created.body.game.id;
  await page.goto(`/#/game/${encodeURIComponent(id)}`);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', id);
  await expect(page.getByTestId('game-role')).toContainText('Player 2');
  await settled(page);
  const imported = await request(page, '/api/shell/scenarios/import', { scenario, targetGameId: id, protocolVersion: 2 });
  assert.equal(imported.status, 200);
  const result = page.getByTestId('game-result');
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading', { name: 'Loss', exact: true })).toBeVisible();
  await proof(page, info, 'friend-game-result', result);
  await page.reload();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', id);
  await expect(page.getByRole('button', { name: 'View result', exact: true })).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: 'View result', exact: true }).click();
  await page.getByRole('button', { name: 'Review game', exact: true }).click();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: 'View result', exact: true }).click();
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  const rematch = page.getByRole('dialog', { name: 'Play again', exact: true });
  await expect(rematch.getByLabel('Opponent', { exact: true })).toHaveValue('friend');
  await expect(rematch.getByRole('radio', { name: 'Player 1 · Red', exact: true })).toBeChecked();
  await proof(page, info, 'friend-rematch-choice', rematch);
  let requests = 0;
  const observesCreate = event => { if (event.method() === 'POST' && new URL(event.url()).pathname === '/api/shell/games') requests++; };
  page.on('request', observesCreate);
  try {
    const response = page.waitForResponse(event => event.request().method() === 'POST' && new URL(event.url()).pathname === '/api/shell/games');
    await rematch.getByRole('button', { name: 'Start game', exact: true }).click();
    const received = await response; assert.equal(received.status(), 200);
    const fresh = (await received.json()).game;
    assertFriendRematch(fresh, id, created.accountId);
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', fresh.id);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
    await expect(page.locator('#app')).toHaveAttribute('data-action-affiliation', 'red');
    await expect(rematch).not.toBeVisible(); await settled(page);
    assert.equal(requests, 1, 'One rematch confirmation must issue exactly one creation');
    const confirmed = await request(page, `/api/shell/games/${encodeURIComponent(fresh.id)}`);
    assert.equal(confirmed.status, 200); assertFriendRematch(confirmed.body.game, id, created.accountId);
    await proof(page, info, 'friend-rematch-created', page.getByTestId('game-board'));
  } finally { page.off('request', observesCreate); }
}
