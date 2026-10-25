import assert from 'node:assert/strict';
import {assertOpponentChoice,selectGamePanel} from './browser-navigation.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { proof } from './proof.mjs';
import {candidateCapabilities} from './capabilities.mjs';
import {assertResultHeading} from './result-heading.mjs';
import { request as accountRequest, selectTerminalScenario } from './results-proof.mjs';

export async function request(page, route, body) {
  const response = await accountRequest(page, route, body === undefined ? undefined : { ...body, protocolVersion: 2 }, 2);
  if (response.status < 200 || response.status >= 300) throw Error(`Computer proof request failed: ${response.status} ${route}`);
  return response.body;
}
const gameAt = async (page, id) => (await request(page, `/api/shell/games/${encodeURIComponent(id)}`)).game;
const creation = page => page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST');
async function readyStory(page) {
  await page.getByRole('link', { name: 'Righelt', exact: true }).click();
  await page.locator('button[data-opponent="babs"]').click();
  const story = page.getByRole('dialog', { name: 'Babs', exact: true });
  await expect(story.locator('[data-story-readiness]')).toContainText('Ready to play');
  await expect(story.locator('[data-story-play]')).toBeEnabled();
  return story;
}

// This is a real local-stack journey. The model, worker, accepted command,
// archive and result must agree. No enabled failure selects a legacy contract.
export async function proveComputerPlay({ page, info, root, submitPlayableAction }) {
  const capabilities = await candidateCapabilities(root);
  let creates = 0;
  const observe = request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/shell/games') creates++; };
  page.on('request', observe);
  try {
    const story = await readyStory(page);
    await proof(page, info, 'computer-ready-story', story);
    await page.keyboard.press('Escape');
    await expect(story).not.toBeVisible(); assert.equal(creates, 0, 'Preparation and dismissal must not create a game');
    await readyStory(page);
    const createdResponse = creation(page);
    await story.getByRole('button', { name: 'Play Babs', exact: true }).click();
    const response = await createdResponse; assert.equal(response.status(), 200);
    const initial = (await response.json()).game;
    assert.equal(creates, 1); assert.equal(initial.computer.modelId, 'initial-1554');
    assert.deepEqual(initial.computer.seats, { p1: null, p2: 'babs' });
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', initial.id);
    await submitPlayableAction(initial.legalActions.find(action => action.from && action.to));
    if ((await gameAt(page, initial.id)).canEndTurn) await page.locator('[data-action="end-turn"], [data-board-preview-action="end-turn"]').filter({visible:true}).click();
    await expect.poll(async () => (await gameAt(page, initial.id)).moves.some(move => move.computerProof?.modelId === 'initial-1554'), { message: 'A real model decision must be accepted' }).toBe(true);
    const accepted = await gameAt(page, initial.id), decision = accepted.moves.find(move => move.computerProof);
    const evidence = await request(page, `/api/shell/games/${initial.id}/decision-attempt`, { attemptId: decision.computerProof.attemptId, kind: 'computer' });
    assert.equal(evidence.attempt.result.status, 'ready');
    assert.deepEqual(evidence.attempt.result.action, decision.action);
    const archive = await request(page, `/api/shell/games/${initial.id}/decision-history`, {});
    assert.ok(archive.items.some(item => item.id === decision.moveId), 'Accepted model decision must be durable');
    await proof(page, info, 'computer-accepted-play', page.getByTestId('game-board'));
    await selectGamePanel(page,'history');
    await page.locator('[data-action="undo-last-move"]').click();
    await expect.poll(async () => (await gameAt(page, initial.id)).moves.filter(move => !move.undone).length).toBe(0);
    assert.deepEqual((await gameAt(page, initial.id)).board.state, initial.board.state);
    const retained = await request(page, `/api/shell/games/${initial.id}/decision-history`, {});
    assert.ok(retained.items.some(item => item.id === decision.moveId), 'Undo must retain accepted evidence');
    await selectGamePanel(page,'board');
    await page.getByTestId('game-board').scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
    });
    await proof(page, info, 'computer-undo', page.getByTestId('game-board'));

    // Seed a catalog-backed finished manual game, then let the server branch
    // before its final decision. A real computer must choose and commit the win.
    const scenario = selectTerminalScenario(JSON.parse(await readFile(path.join(root, 'apps/web/scenarios/catalog.json'), 'utf8')));
    const source = (await request(page, '/api/shell/scenarios/import', { scenario, protocolVersion: 2 })).game;
    const finalDecision = source.moves.at(-1);
    assert.ok(finalDecision?.moveId);
    const branched = (await request(page, '/api/shell/history/branch', { sourceGameId: source.id, sourceDecisionId: finalDecision.moveId, creatorSide: 'p2', computer: { p1: 'babs', p2: null } })).game;
    assert.equal(branched.board.state.outcome.status, 'ongoing');
    assert.deepEqual(branched.board.state, finalDecision.selectionSnapshot);
    await page.goto(`/#/game/${encodeURIComponent(branched.id)}`);
    await expect.poll(async () => (await gameAt(page, branched.id)).board.state.outcome.status).toBe('p1_win');
    const finished = await gameAt(page, branched.id);
    assert.equal(finished.moves.at(-1).computerProof?.modelId, 'initial-1554');
    const result = page.getByTestId('game-result');
    // This page owns the worker and observes an ongoing-to-terminal transition.
    // Await delivery of that transition instead of branching on a transient frame.
    await expect(result).toBeVisible();
    await assertResultHeading(result, {contract: capabilities.resultHeadingContract, outcome: finished.board.state.outcome.status, viewerSide: 'p2'});
    await proof(page, info, 'computer-game-result', result);
    await result.getByRole('button', { name: 'Play again', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Play again', exact: true });
    await assertOpponentChoice(chooser,'babs');
    await expect(chooser.getByRole('radio', { name: 'Player 1 · Red', exact: true })).toBeChecked();
    await expect(chooser.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
    await expect(chooser.locator('[role=status]')).toContainText('Ready to play');
    await proof(page, info, 'computer-rematch-choice', chooser);
    const rematchResponse = creation(page);
    await chooser.getByRole('button', { name: 'Start game', exact: true }).click();
    const freshResponse = await rematchResponse; assert.equal(freshResponse.status(), 200);
    const fresh = (await freshResponse.json()).game;
    assert.notEqual(fresh.id, branched.id); assert.equal(fresh.computer.modelId, 'initial-1554');
    assert.deepEqual(fresh.computer.seats, { p1: null, p2: 'babs' });
    assert.equal(fresh.board.state.outcome.status, 'ongoing');
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', fresh.id);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
    await proof(page, info, 'computer-rematch-created', page.getByTestId('game-board'));
  } finally { page.off('request', observe); }
}
