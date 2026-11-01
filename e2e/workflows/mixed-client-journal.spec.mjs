import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { legacyClientFixture } from '../../apps/web/test/support/legacy-client.mjs';
import { createGameFromHome, makeAnyLegalMove, switchGamePanel } from '../support/app.mjs';

import {readProjectedGame} from '../support/computer-projection.mjs';

const journalRecords = page => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('righelt.online-commands.v2');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction('commands'), read = tx.objectStore('commands').getAll();
    read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
    tx.oncomplete = () => db.close();
  };
}));

for (const fault of ['uncommitted', 'delayed-cleanup']) test(`actual150 browser preserves158 shared journal through ${fault}`, async ({ page, context }, info) => {
  test.setTimeout(75000);
  const fixture = await legacyClientFixture(); let old;
  try {
    await page.addInitScript(() => {
      // Isolate HTTP receipt recovery from live confirmations.
      window.WebSocket = undefined;
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        const request = remove.apply(this, args);
        if (this.name === 'commands' && sessionStorage.getItem('mixed.hold-cleanup') === 'true') {
          request.addEventListener('success', () => this.transaction.abort());
        }
        return request;
      };
    });
    const { gameId, gameHash } = await createGameFromHome(page);
    await page.locator('[data-action="play-as-both-players"]').click();
    await makeAnyLegalMove(page, 'p1');
    await expect.poll(async () => (await journalRecords(page)).length).toBe(0);
    old = await context.newPage();
    await old.route(/\.m?js(?:\?.*)?$/, async route => {
      const pathname = new URL(route.request().url()).pathname;
      expect(fixture.assetPaths.has(pathname), `Historical browser must load its own module: ${pathname}`).toBe(true);
      const body = await readFile(join(fixture.web, pathname));
      return route.fulfill({ status: 200, contentType: 'application/javascript', body });
    });
    const oldSends = []; old.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/')) oldSends.push(request.postDataJSON());
    });
    await old.goto(page.url()); await expect(old.getByTestId('game-board')).toBeVisible();
    expect(await old.evaluate(async () => {
      const { isSyncCommand } = await import('/generated/packages/shared-types/src/sync-protocol.js');
      return isSyncCommand({ protocolVersion: 2, kind: 'shared', gameId: 'g', identityId: 'i',
        clientCommandId: 'v2:probe', fingerprint: 'a'.repeat(64), payload: {}, expectedState: {}, expectedGameplayRevision: 0 });
    })).toBe(false);
    let allow = false, envelope, successfulSetupReconciles = 0; const sends = [], setupReconcileRequests = new Set();
    page.on('response', response => {
      if (!envelope && setupReconcileRequests.has(response.request()) && response.ok()) successfulSetupReconciles++;
    });
    await page.route(`**/api/shell/games/${gameId}/reconcile`, route => {
      if (!envelope) setupReconcileRequests.add(route.request());
      // Hold receipt recovery only after the shared command exists. An HTTP
      // catch-up during old-client preparation must still restore authority.
      return allow || !envelope ? route.continue() : route.abort();
    });
    await page.route(`**/api/shell/games/${gameId}/shared`, route => {
      const command = route.request().postDataJSON(); envelope ??= command; sends.push(command);
      return fault === 'uncommitted' && !allow ? route.abort() : route.continue();
    });
    if (fault === 'delayed-cleanup') await page.evaluate(() => sessionStorage.setItem('mixed.hold-cleanup', 'true'));
    // This fixture has exactly one accepted move: undo before that immutable
    // boundary must restore the original board, independent of history ordering.
    // Exercise actual runtime catch-up after the faults are installed, before
    // admitting Undo. This boundary must also work when preparation is late.
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => successfulSetupReconciles).toBeGreaterThan(0);
    const preparedGame = await page.evaluate(readProjectedGame,{id:gameId,guest:true});
    expect(preparedGame.gameplayRevision).toBe(1);
    expect(preparedGame.myRoles).toEqual(['Player 1', 'Player 2']);
    expect(preparedGame.canUndoLastMove).toBe(true);
    expect(await journalRecords(page)).toEqual([]);
    const activeMoves=preparedGame.moves.filter(move=>!move.undone);
    expect(activeMoves).toHaveLength(1);expect(activeMoves[0].moveId).toBeTruthy();
    await switchGamePanel(page,'history');
    const undoRow=page.locator(`[data-testid="history-move-item"][data-move-id="${activeMoves[0].moveId}"]`);
    await undoRow.locator('.history-item-info').click();
    const undo = undoRow.getByRole('button',{name:'Undo before this move',exact:true});
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect.poll(() => envelope?.kind).toBe('shared');
    expect(envelope.payload.values.targetMoveId).toBe(activeMoves[0].moveId);
    if (fault === 'delayed-cleanup') await expect(page.getByTestId('sync-recovery-banner')).toContainText(/saving|save/i);
    const original = await journalRecords(page); expect(original).toHaveLength(1);
    expect(original[0]).toEqual(envelope);
    // Real same-origin storage notification reaches the already-open150 tab.
    await old.evaluate(async id => {
      const identityId = localStorage.getItem('righelt.identity.id.v1');
      const { game } = await (await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json();
      localStorage.setItem('righelt.pendingLocalGames', JSON.stringify({ [id]: game }));
    }, gameId);
    await page.evaluate(() => localStorage.removeItem('righelt.pendingLocalGames'));
    await expect(old.getByTestId('game-board')).toBeVisible();
    expect(await journalRecords(old)).toEqual(original);
    await old.reload(); await expect(old.getByTestId('game-board')).toBeVisible();
    await expect(old.getByTestId('sync-recovery-banner')).toContainText(/saving|save/i);
    expect(await journalRecords(old)).toEqual(original);
    expect(oldSends.some(body => body?.kind === 'shared' || body?.commands?.some(command => command.kind === 'shared'))).toBe(false);
    await page.evaluate(() => sessionStorage.removeItem('mixed.hold-cleanup'));
    allow = true; await page.reload();
    await expect.poll(async () => (await journalRecords(page)).length, { timeout: 25000 }).toBe(0);
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    const proof = await page.evaluate(async ({ gameId, envelope }) => {
      const response = await fetch(`/api/shell/games/${gameId}/reconcile`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 2, identityId: envelope.identityId, knownSnapshotEventSeq: 0, commands: [envelope] }) });
      return response.json();
    }, { gameId, envelope });
    expect(proof.commandOutcomes[0]).toMatchObject({ outcome: 'accepted', clientCommandId: envelope.clientCommandId, fingerprint: envelope.fingerprint });
    expect(proof.game.gameplayRevision).toBe(2);
    for (const sent of sends) expect(sent).toEqual(envelope);
    if (fault === 'delayed-cleanup') expect(sends).toHaveLength(1);
    await info.attach('mixed-client-proof', { contentType: 'application/json', body: JSON.stringify({ legacyRevision: fixture.revision,
      legacyTransportHash: fixture.transportHash, fault, clientCommandId: envelope.clientCommandId, fingerprint: envelope.fingerprint,
      outcome: proof.commandOutcomes[0], successfulSetupReconciles, oldTabSharedSends: 0, sharedAttempts: sends.length, gameHash }) });
  } finally { await old?.close(); await fixture.close(); }
});
