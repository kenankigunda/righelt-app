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
    if (shell?.getAttribute('data-game-id') === id && shell.querySelector('[data-computer-status] [data-control="retry"]')) {
      throw Error('Computer entered recovery before an accepted decision');
    }
    // One outstanding read, no swallowed failures. Existing test/context teardown
    // bounds this operation and destroys any pending browser timer or request.
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function waitForComputerDecision(page, id, profile, { guest = false, modelId } = {}) {
  if (typeof modelId !== 'string' || !modelId) throw Error('Expected computer model identity required');
  // Preparation and search use the existing test budget. Accepted server history,
  // not a short UI-transition deadline or a client-side result, completes the wait.
  return page.evaluate(readProjectedGame, {
    id, guest, expectedComputer: { modelId, profile }, wait: true,
  });
}
