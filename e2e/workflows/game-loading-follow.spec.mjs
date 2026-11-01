import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { importScenarioGame, switchGamePanel } from '../support/app.mjs';
import { readProjectedGame } from '../support/computer-projection.mjs';
import { ownedContexts } from '../support/owned-contexts.mjs';
import { applyAction, resolveToStability } from '../../apps/web/generated/packages/game-engine/src/index.js';
import { CURRENT_COMPUTER_MODEL } from '../../packages/shared-types/src/computer-play.ts';
import { STORAGE_GENERATION_HEADER } from '../../packages/shared-types/src/storage-policy.js';
import { ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION } from '../../packages/shared-types/src/sync-protocol.js';

const { state, action } = JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/game-loading-follow.json', import.meta.url)));
const scenario = { formatVersion: 2, id: '85241980-65fc-4b88-b978-c42726181042', title: 'Retained seven-push follow',
  initialState: state, resultingState: resolveToStability(applyAction(state, action).state, { artifactMode: 'full' }),
  moves: [{ turnIndex: state.turnIndex, turnMoveIndex: 0, actorSide: state.sideToMove, action, notation: 'FOLLOW' }] };

const guestRequest = (page, route, body) => page.evaluate(async ({ route, body, storageHeader, actionHeader, actionVersion }) => {
  const bootstrap = await fetch('/api/shell/bootstrap');
  if (!bootstrap.ok) throw Error(`Bootstrap failed: ${bootstrap.status}`);
  const generation = bootstrap.headers.get(storageHeader), identityId = localStorage.getItem('righelt.identity.id.v1');
  if (!identityId) throw Error('Native guest identity missing');
  const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json',
    [actionHeader]: String(actionVersion), ...(generation ? { [storageHeader]: generation } : {}) },
    body: JSON.stringify({ ...body, identityId, protocolVersion: 2 }) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw Error(`Local fixture request failed: ${response.status} ${JSON.stringify(result)}`);
  return result;
}, { route, body, storageHeader: STORAGE_GENERATION_HEADER, actionHeader: ACTION_CONTRACT_HEADER, actionVersion: ACTION_CONTRACT_VERSION });

const projected = (page, id) => page.evaluate(readProjectedGame, { id, guest: true });
const acceptedReceipt = async (page, command) => {
  let result;
  await expect.poll(async () => {
    result = await guestRequest(page, `/api/shell/games/${command.gameId}/reconcile`, { knownSnapshotEventSeq: 0, commands: [command] });
    expect(result.gameId).toBe(command.gameId);
    expect(result.game.id).toBe(command.gameId);
    expect(result.commandOutcomes).toHaveLength(1);
    expect(result.commandOutcomes[0]).toMatchObject({ gameId: command.gameId, identityId: command.identityId,
      clientCommandId: command.clientCommandId, fingerprint: command.fingerprint });
    const outcome = result.commandOutcomes[0];
    if (outcome.outcome === 'rejected') throw Error(`Native command rejected: ${outcome.reason}`);
    if (!['accepted', 'unknown'].includes(outcome.outcome)) throw Error('Malformed native command outcome');
    if (outcome.outcome === 'unknown' && !['not_recorded', 'dependency_pending'].includes(outcome.reason)) throw Error(`Native command cannot recover: ${outcome.reason}`);
    return outcome.outcome;
  }, { timeout: 30000, message: 'The exact native command must have a durable accepted receipt' }).toBe('accepted');
  return result;
};
const resumeHere = async (page, gameId) => {
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', gameId);
  await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode', 'narrow');
  await switchGamePanel(page, 'players');
  await page.getByRole('button', { name: 'Horus, Red, Paused', exact: true }).click();
  await page.locator('[data-game-panel="join"] [data-player-side="p1"]').getByRole('button', { name: 'Resume here', exact: true }).click();
};
const journalEntry = (page, command) => page.evaluate(envelope => new Promise((resolve, reject) => {
  const open = indexedDB.open('righelt.online-commands.v2'); open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, read = db.transaction('commands').objectStore('commands').get([envelope.identityId, envelope.gameId, envelope.clientCommandId]);
    read.onerror = () => { db.close(); reject(read.error); };
    read.onsuccess = () => { db.close(); resolve(read.result ?? null); };
  };
}), command);

test.describe('retained Horus follow', () => {
  // Keep the actual page, identity, game and receipt across both journeys. Each
  // native decision gets the existing test budget; failures skip its dependent.
  test.describe.configure({ mode: 'serial' });
  let owned, page, game, command, originalReceipt, paused;
  test.beforeAll(async ({ browser }, info) => {
    owned = ownedContexts(browser);
    const use = info.project.use;
    const context = await owned.create({ ...use.contextOptions, baseURL: use.baseURL,
      viewport: { width: 390, height: 900 }, deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile, hasTouch: use.hasTouch, userAgent: use.userAgent });
    page = await context.newPage();
  });
  test.afterAll(async () => { await owned?.close(); });
  const nextCommand = minimumGeneration => page.waitForRequest(request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== `/api/shell/games/${game.id}/apply`) return false;
    return request.postDataJSON()?.payload?.computer?.generation > minimumGeneration;
  }, { timeout: 30000 });

test('the exact follow saves once and pauses with its durable receipt', async ({ baseURL }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { gameId: sourceId } = await importScenarioGame(page, scenario, baseURL, { open: false });
  const source = await projected(page, sourceId);
  ({ game } = await guestRequest(page, '/api/shell/history/branch', { sourceGameId: sourceId,
    sourceDecisionId: source.moves.at(-1).moveId, creatorSide: 'p2',
    // Watch mode permits a later native decision regardless of which side the
    // resumed continuation leaves active. The retained model itself is unchanged.
    computer: { p1: 'horus', p2: 'horus' }, computerModelId: CURRENT_COMPUTER_MODEL.id }));
  expect(game.legalActions).toEqual([action]);
  expect(game.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  const acquired = await guestRequest(page, `/api/shell/games/${game.id}/computer-control`, { action: 'acquire', deviceId: 'follow-fixture', generation: game.computer.generation });
  await guestRequest(page, `/api/shell/games/${game.id}/computer-control`, { action: 'pause', deviceId: 'follow-fixture', generation: acquired.game.computer.generation });
  await page.goto(`/?retained-follow=1#/game/${game.id}`);
  const firstRequest = nextCommand(-1);
  await resumeHere(page, game.id);
  command = (await firstRequest).postDataJSON();
  const saved = await acceptedReceipt(page, command);
  expect(command.payload.action).toEqual(action);
  expect(command.payload.computer.modelId).toBe(game.computer.modelId);
  expect(command.payload.computer.profile).toBe('horus');
  expect(saved.commandOutcomes).toHaveLength(1);
  originalReceipt = saved.commandOutcomes[0];
  expect(originalReceipt).toMatchObject({ gameId: game.id, identityId: command.identityId, clientCommandId: command.clientCommandId,
    fingerprint: command.fingerprint, outcome: 'accepted', gameplayRevision: command.expectedGameplayRevision + 1 });
  expect(saved.game.moves.filter(move => move.clientCommandId === command.clientCommandId)).toHaveLength(1);
  // Pause through the real owned handler after acknowledgement, never altering
  // the command, proof, generation or receipt that admitted the saved follow.
  const current = await projected(page, game.id);
  paused = (await guestRequest(page, `/api/shell/games/${game.id}/computer-control`, {
    action: 'pause', deviceId: current.computer.lease.deviceId, generation: current.computer.generation })).game;
  expect(paused.computer.paused).toBe(true);
  const path = info.outputPath('retained-follow-accepted.json');
  await writeFile(path, JSON.stringify({ modelId: game.computer.modelId, command, originalReceipt,
    pausedRevision: paused.gameplayRevision }, null, 2));
  await info.attach('retained-follow-accepted', { path, contentType: 'application/json' });
});

test('the same saved follow survives reload and resumes a distinct native Horus move', async ({}, info) => {
  await page.reload();
  const reloaded = await projected(page, game.id);
  expect(reloaded.moves.filter(move => move.clientCommandId === command.clientCommandId)).toHaveLength(1);
  expect(reloaded.computer.modelId).toBe(game.computer.modelId);
  expect(reloaded.computer.paused).toBe(true);
  expect(reloaded.computer.generation).toBe(paused.computer.generation);
  const beforeResume = await guestRequest(page, `/api/shell/games/${game.id}/reconcile`, { knownSnapshotEventSeq: 0, commands: [command] });
  expect(beforeResume.commandOutcomes).toEqual([originalReceipt]);
  await expect.poll(() => journalEntry(page, command)).toBeNull();
  const resumedRequest = nextCommand(paused.computer.generation);
  await resumeHere(page, game.id);
  const laterCommand = (await resumedRequest).postDataJSON(), later = await acceptedReceipt(page, laterCommand);
  expect(laterCommand.clientCommandId).not.toBe(command.clientCommandId);
  expect(laterCommand.payload.computer.modelId).toBe(game.computer.modelId);
  expect(later.commandOutcomes[0]).toMatchObject({ gameId: game.id, identityId: laterCommand.identityId,
    clientCommandId: laterCommand.clientCommandId, fingerprint: laterCommand.fingerprint, outcome: 'accepted',
    gameplayRevision: laterCommand.expectedGameplayRevision + 1 });
  expect(later.game.moves.filter(move => move.clientCommandId === laterCommand.clientCommandId)).toHaveLength(1);
  expect(later.game.gameplayRevision).toBeGreaterThan(paused.gameplayRevision);
  const reconciled = await guestRequest(page, `/api/shell/games/${game.id}/reconcile`, { knownSnapshotEventSeq: 0, commands: [command] });
  expect(reconciled.commandOutcomes).toEqual([originalReceipt]);
  expect(reconciled.game.moves.filter(move => move.clientCommandId === command.clientCommandId)).toHaveLength(1);
  await expect.poll(() => journalEntry(page, command)).toBeNull();
  const path = info.outputPath('retained-follow-save-reload.json');
  await writeFile(path, JSON.stringify({ modelId: game.computer.modelId, command, originalReceipt, pausedRevision: paused.gameplayRevision,
    reloadedRevision: reloaded.gameplayRevision, laterCommand, laterReceipt: later.commandOutcomes[0] }, null, 2));
  await info.attach('retained-follow-save-reload', { path, contentType: 'application/json' });
  await switchGamePanel(page, 'board');
  await page.screenshot({ path: info.outputPath('retained-follow-resumed.png') });
});
});
