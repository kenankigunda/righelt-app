import assert from 'node:assert/strict';
import {assertOpponentChoice,selectGamePanel} from './browser-navigation.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import {candidateCapabilities} from './capabilities.mjs';
import {assertResultHeading} from './result-heading.mjs';
import { proof } from './proof.mjs';
import { STORAGE_GENERATION_HEADER } from '../../packages/shared-types/src/storage-policy.js';
import {closeHostInvitation} from '../../e2e/support/app.mjs';

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
export async function request(page, route, body, authProtocol) {
  return page.evaluate(async ({ route, body, authProtocol, generationHeader }) => {
    const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!sessionResponse.ok) throw new Error(`Session read failed: ${sessionResponse.status}`);
    const session = await sessionResponse.json();
    const generation = sessionResponse.headers.get(generationHeader);
    const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Righelt-Auth': '1', 'X-Righelt-Auth-Version': String(authProtocol), 'X-Righelt-Session': session.contextId, ...(generation ? { [generationHeader]: generation } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), accountId: session.account?.id };
  }, { route, body, authProtocol, generationHeader: STORAGE_GENERATION_HEADER });
}
async function settled(page) {
  const transition = page.locator('.shell-route-transition-layer');
  if (await transition.count()) await expect(transition).toHaveAttribute('data-active', 'false');
}
// Uses real creation/import handlers and the candidate's own catalog. The
// terminal outcome is delivered through the live channel, never DOM injection.
export async function proveResultsRematch({ page, info, root }) {
  const capabilities = await candidateCapabilities(root);
  const authProtocol = capabilities.simplifiedAccounts ? 2 : 1;
  const scenario = selectTerminalScenario(JSON.parse(await readFile(path.join(root, 'apps/web/scenarios/catalog.json'), 'utf8')));
  const created = await request(page, '/api/shell/games', { selfPlayMode: false, creatorSide: 'p2' }, authProtocol);
  assert.equal(created.status, 200);
  const id = created.body.game.id;
  await page.goto(`/#/game/${encodeURIComponent(id)}`);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', id);
  await expect(page.getByTestId('game-role')).toContainText('Player 2');
  await settled(page);
  const imported = await request(page, '/api/shell/scenarios/import', { scenario, targetGameId: id, protocolVersion: 2 }, authProtocol);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.game.board.state.outcome.status, 'p1_win');
  const result = page.getByTestId('game-result');
  await expect(result).toBeVisible();
  await assertResultHeading(result, {contract: capabilities.resultHeadingContract, outcome: imported.body.game.board.state.outcome.status, viewerSide: 'p2'});
  await proof(page, info, 'friend-game-result', result);
  await page.reload();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', id);
  await selectGamePanel(page,'history');
  await expect(page.getByRole('button', { name: 'View result', exact: true })).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: 'View result', exact: true }).click();
  await page.getByRole('button', { name: 'Review game', exact: true }).click();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: 'View result', exact: true }).click();
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  const rematch = page.getByRole('dialog', { name: 'Play again', exact: true });
  await assertOpponentChoice(rematch,'friend');
  await expect(rematch.getByRole('radio', { name: 'Player 1 · Red', exact: true })).toBeChecked();
  await expect(rematch.getByRole('group',{name:'Your side',exact:true}).getByRole('radio')).toHaveCount(2);
  // Measure controls after deliberate source-scale entry, not an intermediate frame.
  // Do not suppress animation or wait for unrelated perpetual decorative motion.
  await rematch.evaluate(async element=>{
    await Promise.all(element.getAnimations().filter(animation=>
      animation.effect?.getKeyframes().some(frame=>typeof frame.transform==='string'&&frame.transform.includes('scale('))
    ).map(animation=>animation.finished.catch(()=>{})));
  });
  for(const side of await rematch.getByRole('radio').all()){
    const box=await side.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(16);expect(box.width).toBeLessThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(16);expect(box.height).toBeLessThanOrEqual(24);
  }
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
    await closeHostInvitation(page);
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', fresh.id);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
    await expect(page.locator('#app')).toHaveAttribute('data-action-affiliation', 'red');
    await expect(rematch).not.toBeVisible(); await settled(page);
    assert.equal(requests, 1, 'One rematch confirmation must issue exactly one creation');
    const confirmed = await request(page, `/api/shell/games/${encodeURIComponent(fresh.id)}`, undefined, authProtocol);
    assert.equal(confirmed.status, 200); assertFriendRematch(confirmed.body.game, id, created.accountId);
    await page.getByTestId('game-board').scrollIntoViewIfNeeded();
    await proof(page, info, 'friend-rematch-created', page.getByTestId('game-board'));
  } finally { page.off('request', observesCreate); }
}
