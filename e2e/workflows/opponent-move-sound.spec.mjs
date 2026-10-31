import { test, expect } from '@playwright/test';
import { createGameFromHome, openDirectGameLink, requestPlayerJoin, acceptPendingRequest, submitPlayableAction, selectPlayableAction, switchGamePanel, closeContextQuietly } from '../support/app.mjs';
import { readProjectedGame } from '../support/computer-projection.mjs';

const instrument = () => {
  window.opponentAudioNotes = [];
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    const result = Reflect.apply(start, this, args);
    window.opponentAudioNotes.push({ frequency: this.frequency.value, state: this.context.state, focused: document.hasFocus(), hidden: document.hidden });
    return result;
  };
};
const projected = (page, id) => page.evaluate(readProjectedGame, { id, guest: true });
const displayedPieces = page => page.locator('#shell-board .cell').evaluateAll(cells => cells.flatMap(cell => [...cell.querySelectorAll('.piece-token:not(.move-ghost):not(.removal-piece):not(.history-destruction-piece)')].map(piece => ({id:piece.dataset.pieceId,row:Number(cell.dataset.row),col:Number(cell.dataset.col)}))).sort((a,b) => a.id.localeCompare(b.id)));
const moveNotes = page => page.evaluate(() => window.opponentAudioNotes.filter(note => note.frequency === 460));

for (const delivery of ['WebSocket', 'HTTP fallback']) test(`unseen opponent updates share one notification batch during history inspection through ${delivery}`, async ({ browser, baseURL }, info) => {
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const opponentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ownerContext.addInitScript(instrument);
  if (delivery === 'HTTP fallback') await ownerContext.addInitScript(() => { window.WebSocket = undefined; });
  const owner = await ownerContext.newPage(), opponent = await opponentContext.newPage();
  try {
    const { gameId, gameHash } = await createGameFromHome(owner);
    await openDirectGameLink(opponent, baseURL, gameHash);
    await requestPlayerJoin(opponent); await acceptPendingRequest(owner);
    await expect(opponent.getByTestId('game-role')).toContainText('Player 2');
    await switchGamePanel(owner, 'board');
    const initial = await projected(owner, gameId);
    await submitPlayableAction(owner, initial.legalActions.find(action => action.type === 'move' && action.from && action.to));
    await expect.poll(async () => (await projected(opponent, gameId)).moves.length).toBe(1);
    await switchGamePanel(opponent, 'board');
    const next = await projected(opponent, gameId);
    const destination = await selectPlayableAction(opponent, next.legalActions.find(action => action.type === 'move' && action.from && action.to));
    await owner.bringToFront();
    const moveId = (await projected(owner, gameId)).moves[0].moveId;
    const row = owner.locator(`[data-testid="history-move-item"][data-move-id="${moveId}"]`);
    await row.locator('.history-item-info').click();
    await expect(row).toHaveClass(/is-selected/);
    const inspected = await displayedPieces(owner);
    expect(inspected.length).toBeGreaterThan(0);
    await expect.poll(() => owner.evaluate(() => document.hasFocus() && !document.hidden)).toBe(true);
    await owner.evaluate(() => { window.opponentAudioNotes = []; });
    // Confirm the other player's real prepared board action without stealing
    // focus from the person inspecting history in the receiving tab.
    await destination.evaluate(element => element.click());
    await expect.poll(async () => (await projected(owner, gameId)).moves.length, { timeout: 15000 }).toBe(2);
    await expect.poll(async () => (await moveNotes(owner)).length).toBe(1);
    expect((await moveNotes(owner))[0]).toMatchObject({ state: 'running', focused: true, hidden: false });
    await expect(row).toHaveClass(/is-selected/);
    expect(await displayedPieces(owner)).toEqual(inspected);
    await owner.waitForTimeout(delivery === 'HTTP fallback' ? 5500 : 300);
    expect(await moveNotes(owner)).toHaveLength(1);
    await info.attach('authoritative-opponent-sound', { contentType: 'application/json', body: JSON.stringify({ delivery, notes: await moveNotes(owner), revision: (await projected(owner, gameId)).gameplayRevision }, null, 2) });
  } finally { await closeContextQuietly(ownerContext); await closeContextQuietly(opponentContext); }
});
