import {COMPUTER_TIMING} from '../../apps/web/generated/packages/shared-types/src/computer-play.js';

// Cold verified WASM preparation may exceed an ordinary UI assertion timeout.
// Use the existing workflow budget, require visible progress, and fail terminal
// preparation errors immediately. This never retries preparation or gameplay.
export async function waitForOpponentReady(page, {timeoutMs = 45_000} = {}) {
  const receipt = await page.evaluate(async ({timeoutMs, detailAfterMs}) => {
    const started = performance.now();
    let lastMessage = '', detailed = false, byteSamples = 0, lastBytes = null;
    while (performance.now() - started < timeoutMs) {
      const dialog = document.querySelector('dialog[open].opponent-story-modal');
      if (!dialog) throw Error('Opponent preparation dialog closed before readiness');
      const play = dialog.querySelector('[data-story-play]');
      const status = dialog.querySelector('[data-story-readiness]');
      lastMessage = status?.textContent ?? '';
      const retry = dialog.querySelector('[data-story-retry]');
      if ((retry && !retry.hidden) || /could not prepare|unsupported|not supported|unavailable/i.test(lastMessage)) {
        throw Error(`Opponent preparation failed: ${lastMessage}`);
      }
      const bytes = /([\d,]+) of ([\d,]+) bytes/.exec(lastMessage);
      if (bytes) {
        const received = Number(bytes[1].replaceAll(',', '')), total = Number(bytes[2].replaceAll(',', ''));
        if (!(received >= 0 && received <= total && total > 0)) throw Error('Invalid preparation byte progress');
        if (lastBytes?.total === total && received < lastBytes.received) throw Error('Preparation byte progress moved backwards');
        if (!lastBytes || lastBytes.received !== received || lastBytes.total !== total) byteSamples++;
        lastBytes = {received, total};
      }
      if (/\b\d+s\b/.test(lastMessage) && (bytes || /Getting ready to play/.test(lastMessage))) detailed = true;
      if (play && !play.disabled) {
        const elapsedMs = performance.now() - started;
        if (elapsedMs >= detailAfterMs + 1000 && !detailed) throw Error('Slow opponent preparation did not expose detailed progress');
        return {elapsedMs:Math.round(elapsedMs), detailed, byteSamples, lastBytes};
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Opponent preparation exceeded its bounded workflow allowance: ${lastMessage}`);
  }, {timeoutMs, detailAfterMs:COMPUTER_TIMING.detailAfterMs});
  console.info('Verified opponent preparation', JSON.stringify(receipt));
  return receipt;
}

// Serialized into the browser, so this function has no module-scope dependencies.
export async function readProjectedGame({ id, expectedComputer, wait = false, guest = false }) {
  for (;;) {
    let headers = {};
    let query = '';
    if (guest) {
      const identityId = window.localStorage.getItem('righelt.identity.id.v1');
      if (!identityId) throw Error('Guest identity missing');
      query = `?identityId=${encodeURIComponent(identityId)}`;
    } else {
      const sessionResponse = await fetch('/api/auth/session');
      if (!sessionResponse.ok) throw Error(`Session failed: ${sessionResponse.status}`);
      const session = await sessionResponse.json();
      if (typeof session.contextId !== 'string' || !session.contextId) throw Error('Session context missing');
      headers = { 'X-Righelt-Auth-Version': '2', 'X-Righelt-Session': session.contextId };
    }
    const response = await fetch(`/api/shell/games/${id}${query}`, { headers });
    if (!response.ok) throw Error(`Projection failed: ${response.status}`);
    const { game } = await response.json();
    if (game?.id !== id || !Array.isArray(game.moves)) throw Error('Projection missing the requested game history');
    if (!expectedComputer || game.moves.some(move =>
      move.computerProof?.modelId === expectedComputer.modelId && move.computerProof?.profile === expectedComputer.profile)) return game;
    if (!wait) return false;
    const shell = document.querySelector('[data-testid="game-shell"]');
    if (shell?.getAttribute('data-game-id') === id && document.querySelector('[data-computer-status] [data-control="retry"]')) {
      throw Error('Computer entered recovery before an accepted decision');
    }
    // One outstanding read, no swallowed failures. Existing test/context teardown
    // bounds this operation and destroys any pending browser timer or request.
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function waitForComputerDecision(page, id, profile, { guest = false } = {}) {
  // Preparation and search use the existing test budget. Accepted server history,
  // not a short UI-transition deadline or a client-side result, completes the wait.
  return page.evaluate(readProjectedGame, {
    id, guest, expectedComputer: { modelId: 'initial-1554', profile }, wait: true,
  });
}
