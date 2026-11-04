import { test, expect } from '@playwright/test';
import { importScenarioGame, switchGamePanel, closeContextQuietly } from '../support/app.mjs';
import { createRushBlockerScenario } from '../support/rush-blocker-scenario.mjs';
import { readProjectedGame } from '../support/computer-projection.mjs';
import { isOperationRequest } from '../support/shared-request.mjs';

const submitTouchRush = async (page, action) => {
  await switchGamePanel(page, 'board');
  const cell = point => page.locator(`[data-testid="game-board"] .cell[data-row="${point.row}"][data-col="${point.col}"]`);
  const source = cell(action.from), target = cell(action.to);
  if (!await source.evaluate(node => node.classList.contains('source'))) await source.tap();
  await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);
  await expect(page.locator('#shell-board-preview-label')).not.toHaveAttribute('aria-busy', 'true');
  await expect(target.locator('.move-ghost')).toBeVisible();
  // A sole legal destination may already be selected. One native confirmation
  // tap is performed only after the visible target and rule checks are ready.
  if (!await target.evaluate(node => node.classList.contains('target'))) await target.tap();
  await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/, { timeout: 2000 });
  await expect.poll(() => target.evaluate(node => {
    const message = document.getElementById('shell-board-preview-label');
    return Boolean(node.isConnected && message?.isConnected && message.getAttribute('aria-busy') !== 'true'
      && node.classList.contains('target') && !node.classList.contains('unselectable'));
  }), { timeout: 2000, message: 'Complete move checks must settle before the native confirmation tap' }).toBe(true);
  await target.tap();
};

test('a mobile rush survives a false offline hint and page restoration without duplicated moves', async ({ browser, browserName, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: browserName !== 'firefox' });
  const page = await context.newPage();
  const sockets = [], commands = [], pageErrors = [];
  let diagnosticAttempts = 0, diagnosticFailures = 0;
  let diagnosticAccepted = 0, diagnosticFaultActive = false;
  // Only the diagnostic upload is unavailable. Real gameplay, reconciliation,
  // presence and WebSocket traffic are never intercepted by this fault.
  await page.route('**/api/diagnostics/recovery', async route => {
    if (!diagnosticFaultActive) { await route.continue(); return; }
    diagnosticAttempts++;
    await route.abort('failed');
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/diagnostics/recovery' && response.status() === 202) diagnosticAccepted++;
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/diagnostics/recovery') diagnosticFailures++;
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('websocket', socket => {
    if (!/\/api\/shell\/games\/[^/]+\/ws\?/.test(socket.url())) return;
    const observed = { url: socket.url(), closed: false, heartbeats: 0, frames: 0 };
    sockets.push(observed);
    socket.on('close', () => { observed.closed = true; });
    socket.on('framereceived', ({ payload }) => {
      observed.frames++;
      try { if (JSON.parse(String(payload)).type === 'heartbeat_ack') observed.heartbeats++; }
      catch { /* The application retains responsibility for invalid frames. */ }
    });
  });
  page.on('request', request => {
    if (!isOperationRequest(request, 'apply')) return;
    const envelope = request.postDataJSON();
    commands.push({ clientCommandId: envelope.clientCommandId, action: envelope.payload?.action });
  });

  try {
    // Touch selection is a deliberate fixture input, independent of the host's
    // desktop pointer. This is browser emulation, not physical-phone proof.
    await page.addInitScript(() => {
      const native = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const result = native(query);
        if (query === '(any-hover: hover)') Object.defineProperty(result, 'matches', { value: false });
        return result;
      };
    });
    const { before, firstRush, reconnect, scenario } = createRushBlockerScenario();
    const initial = { ...scenario, id: '6f2ccad9-3aef-482c-9855-d1760094a932',
      title: 'Sync hardening rush continuation', initialState: before, resultingState: structuredClone(before) };
    const { gameId } = await importScenarioGame(page, initial, baseURL);
    await expect(page.locator('html')).toHaveAttribute('data-hover-capability', 'none');
    await expect(page.locator('[data-action="play-as-both-players"]')).toBeEnabled();
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    await expect.poll(() => sockets.some(socket => socket.url.includes(`/games/${gameId}/ws?`))).toBe(true);
    const original = sockets.find(socket => socket.url.includes(`/games/${gameId}/ws?`));
    expect(original, 'the real game must establish its initial WebSocket').toBeTruthy();
    await expect.poll(() => original.heartbeats).toBeGreaterThan(0);
    await expect.poll(() => diagnosticAccepted, { message: 'A real browser upload must pass through the local Pages proxy and be accepted by the API' }).toBeGreaterThan(0);
    const baseline = await page.evaluate(readProjectedGame, { id: gameId, guest: true });

    await submitTouchRush(page, firstRush);
    await expect.poll(async () => (await page.evaluate(readProjectedGame, { id: gameId, guest: true })).gameplayRevision)
      .toBe(baseline.gameplayRevision + 1);
    await expect(page.getByTestId('history-move-item')).toHaveCount(1);
    const heartbeatBeforeFault = original.heartbeats;
    diagnosticFaultActive = true;
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    // A subsequent real heartbeat on this exact socket positively proves it
    // survived the hint. An immediate no-close check could miss delayed close.
    await expect.poll(() => original.heartbeats).toBeGreaterThan(heartbeatBeforeFault);
    expect(original.closed).toBe(false);
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    expect(commands).toHaveLength(1);

    const socketCount = sockets.length;
    const diagnosticAttemptsBeforeRestoration = diagnosticAttempts;
    const diagnosticFailuresBeforeRestoration = diagnosticFailures;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect.poll(() => sockets.length).toBeGreaterThan(socketCount);
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    await expect(page.locator('[data-action="play-as-both-players"]')).toBeEnabled();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    const ready = await page.evaluate(readProjectedGame, { id: gameId, guest: true });
    expect(ready.gameplayRevision).toBe(baseline.gameplayRevision + 1);
    expect(ready.legalActions).toContainEqual(reconnect);
    expect(commands).toHaveLength(1);
    await expect.poll(() => diagnosticAttempts).toBeGreaterThan(diagnosticAttemptsBeforeRestoration);
    await expect.poll(() => diagnosticFailures).toBeGreaterThan(diagnosticFailuresBeforeRestoration);

    // The next native rush must succeed after an actual diagnostic upload has
    // failed, rather than merely while the diagnostic callback is configured.
    await submitTouchRush(page, reconnect);
    await expect.poll(async () => (await page.evaluate(readProjectedGame, { id: gameId, guest: true })).gameplayRevision)
      .toBe(baseline.gameplayRevision + 2);
    await expect(page.getByTestId('history-move-item')).toHaveCount(2);
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    const final = await page.evaluate(readProjectedGame, { id: gameId, guest: true });
    expect(final.moves.map(move => move.action)).toEqual([firstRush, reconnect]);
    expect(new Set(final.moves.map(move => move.clientCommandId)).size).toBe(2);
    expect(commands.map(command => command.action)).toEqual([firstRush, reconnect]);
    expect(new Set(commands.map(command => command.clientCommandId)).size).toBe(2);
    expect(pageErrors).toEqual([]);
    const evidence = { browserName, viewport: { width: 390, height: 844 }, touch: true,
      mobileEmulation: browserName !== 'firefox', fault: 'navigator-only offline hint, synthetic pagehide/pageshow',
      actualNetworkOffline: false, initialRevision: baseline.gameplayRevision, finalRevision: final.gameplayRevision,
      acceptedMoves: final.moves.length, submittedCommands: commands.length,
      originalSocketReceivedLaterHeartbeat: original.heartbeats > heartbeatBeforeFault,
      originalSocketClosedAfterPagehide: original.closed, replacementSockets: sockets.length - socketCount,
      diagnosticAccepted, diagnosticAttempts, diagnosticFailures,
      pageErrors };
    await info.attach('sync-hardening-rush-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('mobile-rush-after-recovery.png') });
  } finally {
    await closeContextQuietly(context);
  }
});
