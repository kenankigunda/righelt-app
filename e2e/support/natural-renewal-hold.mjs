import {buildLocalApiWsHost,isLocalDevHost} from '../../apps/web/local-dev-ports.js';

// Test preparation only. Observe existing traffic; never send or alter it.
export function createNaturalRenewalLeaseObserver(page, {minimumRemainingMs, maximumRemainingMs, clock = Date.now}) {
  if (!(Number.isFinite(minimumRemainingMs) && minimumRemainingMs > 0 && maximumRemainingMs > minimumRemainingMs)) throw Error('Explicit original timing contracts required');
  let scope = null, latest = null, selected = null, retired = false, incomplete = false;
  const sockets = new Map(), candidates = [];
  const read = (game, eventSeq = null, socket = null) => {
    if (!scope || game?.id !== scope.gameId) return;
    const control = game.computer, lease = control?.lease;
    if (control?.ownerId !== scope.identityId || !Number.isSafeInteger(control.generation) || !lease
      || typeof lease.deviceId !== 'string' || typeof lease.authContextId !== 'string' || !Number.isFinite(lease.expiresAt)) { latest = null; return; }
    if (!Number.isSafeInteger(game.gameplayRevision)) { latest = null; return; }
    if (latest && (control.generation < latest.generation || control.generation === latest.generation
      && (lease.expiresAt < latest.lease.expiresAt || game.gameplayRevision < latest.gameplayRevision
        || eventSeq !== null && latest.eventSeq !== null && eventSeq < latest.eventSeq))) return;
    latest = {gameId:game.id, identityId:control.ownerId, generation:control.generation,
      gameplayRevision:game.gameplayRevision, lease:structuredClone(lease), eventSeq, socket};
  };
  const onSocket = socket => {
    let url;
    try { url = new URL(socket.url()); } catch { return; }
    const location = new URL(page.url());
    const host = location.protocol !== 'https:' && isLocalDevHost(location.hostname) ? buildLocalApiWsHost(location.port) : location.host;
    if (url.protocol !== (location.protocol === 'https:' ? 'wss:' : 'ws:') || url.host !== host) return;
    const match = /^\/api\/shell\/games\/([^/]+)\/ws$/.exec(url.pathname);
    if (!match) return;
    const gameId = decodeURIComponent(match[1]), identityId = url.searchParams.get('identityId');
    if (sockets.size >= 16) { incomplete = true; return; }
    const record = {gameId, identityId, last:null};
    const frame = ({payload}) => {
      if (retired) return;
      let value;
      try { value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')); }
      catch { if (scope?.gameId === gameId && scope.identityId === identityId) incomplete = true; return; }
      if (!value?.game || value.game.id !== gameId || !Number.isSafeInteger(value.eventSeq)) return;
      record.last = value;
      if (scope?.gameId === gameId && scope.identityId === identityId) read(value.game, value.eventSeq, socket);
    };
    const close = () => { if (latest?.socket === socket) latest = null; socket.off('framereceived', frame); socket.off('close', close); sockets.delete(socket); };
    // Keep the same record object so pre-bind frames remain available.
    sockets.set(socket, record); record.frame = frame; record.close = close;
    socket.on('framereceived', frame); socket.on('close', close);
  };
  const navigate = frame => { if (scope && frame === page.mainFrame()) { retired = true; latest = null; } };
  const dispose = () => {
    retired = true; page.off('websocket', onSocket); page.off('framenavigated', navigate); page.off('close', closePage);
    for (const [socket, record] of sockets) { socket.off('framereceived', record.frame); socket.off('close', record.close); }
    sockets.clear(); latest = null;
  };
  const closePage = () => dispose();
  page.on('websocket', onSocket); page.on('framenavigated', navigate); page.on('close', closePage);
  return {
    bind(game) {
      if (scope) throw Error('One original game scope only');
      if (!game?.id || !game.computer?.ownerId) throw Error('Original authoritative game required');
      scope = {gameId:game.id, identityId:game.computer.ownerId, origin:new URL(page.url()).origin,
        sharedPath:`/api/shell/games/${encodeURIComponent(game.id)}/shared`};
      read(game); // Reuse the original projected() read; no additional HTTP/evaluation.
      for (const [socket, record] of sockets) if (record.gameId === scope.gameId && record.identityId === scope.identityId && record.last) read(record.last.game, record.last.eventSeq, socket);
    },
    eligible(request, command) {
      let ownsPage = false;
      try {
        const url = new URL(request.url());
        ownsPage = request.frame() === page.mainFrame() && request.method() === 'POST'
          && url.origin === scope?.origin && url.pathname === scope.sharedPath && url.search === '' && url.hash === '';
      } catch {}
      const values = command?.payload?.values, now = clock(), proof = latest;
      const remainingMs = proof ? proof.lease.expiresAt - now : null;
      const eligible = Boolean(!selected && !retired && !incomplete && ownsPage && scope && proof
        && command.gameId === scope.gameId && command.identityId === scope.identityId
        && command.kind === 'shared' && command.payload?.operation === 'computer-control' && values?.action === 'renew'
        && values.identityId === scope.identityId && values.generation === proof.generation
        && values.deviceId === proof.lease.deviceId && (command.authContextId ?? '') === proof.lease.authContextId
        && command.expectedGameplayRevision === proof.gameplayRevision
        && Number.isFinite(now) && remainingMs >= minimumRemainingMs && remainingMs <= maximumRemainingMs);
      if (candidates.length >= 64) { incomplete = true; return false; }
      candidates.push({clientCommandId:command?.clientCommandId, fingerprint:command?.fingerprint,
        generation:values?.generation, observedGeneration:proof?.generation, remainingMs, eligible,
        eventSeq:proof?.eventSeq, source:proof?.socket ? 'same-page-server-frame' : 'original-projection'});
      if (eligible) selected = {clientCommandId:command.clientCommandId, fingerprint:command.fingerprint, expiresAt:proof.lease.expiresAt, remainingAtCaptureMs:remainingMs};
      return eligible;
    },
    remainingAtRelease(command) {
      if (!selected || selected.clientCommandId !== command?.clientCommandId || selected.fingerprint !== command?.fingerprint) throw Error('Exact selected renewal required');
      return selected.expiresAt - clock();
    },
    snapshot() { return {minimumRemainingMs, maximumRemainingMs, retired, incomplete, selected:structuredClone(selected), candidates:structuredClone(candidates)}; },
    dispose,
  };
}
