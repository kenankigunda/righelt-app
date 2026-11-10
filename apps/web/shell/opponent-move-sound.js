const moveKey = move => move.moveId ?? move.clientCommandId;

// Observe authoritative history only. Transport paths and repeated receipts
// cannot change a move's identity, and loading older history is not a new move.
export function createOpponentMoveTracker() {
  const games = new Map();
  return {
    update(game, { scope = '', sequence, baseline = false } = {}) {
      if (!game?.id) return { moves: [], finished: false };
      const key = `${scope}:${game.id}`, previous = games.get(key);
      if (previous && Number.isSafeInteger(sequence) && sequence < previous.sequence) return { moves: [], finished: false };
      const seen = previous?.seen ?? new Set(), moves = [...new Map((game.moves ?? []).filter(move => moveKey(move)).map(move => [moveKey(move), move])).values()];
      const lastKnown = moves.findLastIndex(move => seen.has(moveKey(move)));
      const advanced = !previous || !Number.isSafeInteger(game.gameplayRevision) || game.gameplayRevision > previous.revision;
      const fresh = moves.filter((move, index) => index > lastKnown && !seen.has(moveKey(move)) && !move.undone);
      for (const move of moves) seen.add(moveKey(move));
      const terminal = Boolean(game.board?.state?.outcome?.status && game.board.state.outcome.status !== 'ongoing');
      games.set(key, { seen, sequence: sequence ?? previous?.sequence ?? -1, revision: game.gameplayRevision, terminal });
      while (games.size > 32) games.delete(games.keys().next().value);
      return { moves: !previous || baseline || !advanced ? [] : fresh, finished: Boolean(previous && !previous.terminal && terminal && !baseline) };
    },
  };
}

export function isOpponentAction(game, move, identityId = null) {
  const roles = identityId ? ['Player 1', 'Player 2'].filter(role => game?.[role === 'Player 1' ? 'player1' : 'player2']?.identityId === identityId) : game?.myRoles ?? [game?.myRole];
  if (!roles.some(role => role === 'Player 1' || role === 'Player 2')) return false;
  const role = move?.actorSide === 'P1' ? 'Player 1' : move?.actorSide === 'P2' ? 'Player 2' : null;
  return Boolean(role && (move.computerProof && game.computer || !roles.includes(role)));
}
