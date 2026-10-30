const createReplayPreview = ({rootEl, createAdapter, preview}) => {
  const doc = rootEl.ownerDocument;
  const wrap = doc.createElement('div'); wrap.className = 'board-wrap computer-replay-wrap';
  const board = doc.createElement('div'); board.className = 'board';
  const lines = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.classList.add('overlay-lines');
  wrap.append(board, lines); rootEl.appendChild(wrap);
  const adapter = createAdapter();
  const update = ({snapshot, overlay}) => adapter.render({snapshot, overlay, selection: {selectedPieceId: null, source: null, target: null}, legalActions: [], selectedPieceMoves: [], selectedPieceMovePreviews: [], removalEffects: [], interactionMode: 'static'});
  try { adapter.mount({boardEl: board, overlayLinesEl: lines, interactionMode: 'static', onCellClick: () => {}}); update(preview); } catch (error) {adapter.unmount(); wrap.remove(); throw error;}
  return {update, destroy() {adapter.unmount(); wrap.remove();}};
};

export const COMPUTER_REPLAY_TIMING = Object.freeze({motion: 520, pause: 360});

/** Frames come from acknowledged active-lineage decisions, never engine simulation. */
export function buildComputerTurnReplay(options) {
  if (!(options.moves ?? []).some(move => !move.undone && move.turnIndex === options.completedTurnIndex && move.computerProof)) return null;
  return buildTurnReplay(options);
}

export function buildTurnReplay({moves, completedTurnIndex, gameId, revision, lineageHead, finalSnapshot = null}) {
  if (!Number.isInteger(completedTurnIndex)) return null;
  const turn = (moves ?? []).filter(move => !move.undone && move.turnIndex === completedTurnIndex && move.action?.type !== 'end_turn');
  if (!turn.length) return null;
  if (turn.some((move, index) => !move.moveId || !move.selectionSnapshot || !move.snapshot || move.turnMoveIndex !== index)) return null;
  const frames = turn.map(move => ({decisionId: move.moveId, action: move.action, before: move.selectionSnapshot, after: move.snapshot, destroyedPieces: move.destroyedPieces ?? []}));
  if (finalSnapshot && JSON.stringify(finalSnapshot) !== JSON.stringify(frames.at(-1).after)) {
    frames.push({decisionId: `turn-${completedTurnIndex}-finalization`, action: {type: 'end_turn'}, before: frames.at(-1).after, after: finalSnapshot, destroyedPieces: []});
  }
  return structuredClone({gameId, revision, lineageHead, turnIndex: completedTurnIndex, frames});
}

/** Isolated visual playback. This module deliberately has no transport/search dependency. */
export function createComputerReplay({rootEl, createAdapter, onChange = () => {}, onFinish = () => {}, reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, createPreview = createReplayPreview, timing = COMPUTER_REPLAY_TIMING, holdFinal = false, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const doc = rootEl.ownerDocument;
  let replay = null, layer = null, preview = null, index = -1, generation = 0, timer = null, settleWait = null;
  let animations = [], removedTokens = [];
  const snapshot = () => ({playing: Boolean(replay), step: index + 1, total: replay?.frames.length ?? 0, manual: Boolean(replay && reducedMotion()), gameId: replay?.gameId ?? null, action: index >= 0 && replay?.frames[index] ? structuredClone(replay.frames[index].action) : null});
  const notify = () => onChange(snapshot());
  const wait = duration => new Promise(resolve => { settleWait = resolve; timer = setTimer(() => {timer = null; settleWait = null; resolve(true);}, duration); });
  const clearMotion = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
    for (const token of removedTokens) token.remove();
    removedTokens = [];
  };
  const stop = (reason = 'stopped') => {
    if (!replay) return;
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null; settleWait?.(false); settleWait = null;
    clearMotion();
    preview?.destroy(); preview = null;
    layer?.remove(); layer = null;
    replay = null; index = -1;
    notify(); onFinish({reason});
  };
  const findToken = piece => Array.from(layer.querySelectorAll?.(".piece-token[data-piece-id]") ?? []).find(token => token.getAttribute("data-piece-id") === piece.id && !token.classList.contains("ghost"));
  const render = (state, key, frame = null) => preview.update({snapshot: state, previewKey: key, overlay: {mode: 'none'}});
  const showFrame = () => {
    if (!replay || index < 0) return;
    clearMotion();
    const frame = replay.frames[index];
    // Capture source geometry while before-state tokens are still mounted.
    const sources = new Map((frame.before.pieces ?? []).map(piece => [piece.id, {piece, token: findToken(piece), rect: findToken(piece)?.getBoundingClientRect?.()}]));
    render(frame.after, `${generation}:${index}:after`);
    const manual = reducedMotion();
    for (const piece of frame.after.pieces ?? []) {
      const source = sources.get(piece.id), token = findToken(piece);
      if (!token) continue;
      const rect = token.getBoundingClientRect?.();
      const moved = source && (source.piece.position.row !== piece.position.row || source.piece.position.col !== piece.position.col);
      if (moved || !source) token.classList.add('computer-replay-changed-piece');
      if (!manual && token.animate && rect && (!source || source.rect && moved)) {
        const baseTransform = doc.defaultView?.getComputedStyle?.(token).transform ?? token.style?.transform ?? 'none';
        const frames = source ? [{transform: `translate(${source.rect.left - rect.left}px, ${source.rect.top - rect.top}px)${baseTransform === 'none' ? '' : ` ${baseTransform}`}`}, {transform: baseTransform}] : [{opacity: 0}, {opacity: 1}];
        const animation = token.animate(frames, {duration: timing.motion, easing: 'cubic-bezier(.2,.75,.25,1)'});
        animation.finished.catch(() => {}); animations.push(animation);
      }
    }
    if (!manual) {
      const afterIds = new Set((frame.after.pieces ?? []).map(piece => piece.id));
      const layerRect = layer.getBoundingClientRect?.();
      for (const [id, source] of sources) {
        if (afterIds.has(id) || !source.rect || !layerRect || !source.token?.cloneNode) continue;
        const ghost = source.token.cloneNode(true);
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {position: 'absolute', left: `${source.rect.left - layerRect.left}px`, top: `${source.rect.top - layerRect.top}px`, width: `${source.rect.width}px`, height: `${source.rect.height}px`, transform: 'none', pointerEvents: 'none'});
        layer.appendChild(ghost); removedTokens.push(ghost);
        if (ghost.animate) { const animation = ghost.animate([{opacity: 1}, {opacity: 0}], {duration: timing.motion, fill: 'forwards'}); animation.finished.catch(() => {}); animations.push(animation); }
      }
    }
    notify();
  };
  const next = () => {
    if (!replay || !reducedMotion()) return false;
    if (index + 1 >= replay.frames.length) { stop('completed'); return true; }
    index++; showFrame(); return true;
  };
  const play = async payload => {
    stop('replaced');
    if (!payload?.frames?.length || payload.frames.some(frame => !frame.before || !frame.after)) return false;
    replay = structuredClone(payload); generation++; const current = generation;
    try {
    layer = doc.createElement('div');
    layer.className = 'computer-replay'; layer.setAttribute('aria-hidden', 'true');
    // The root is the board wrapper. An opaque, geometry-matched layer prevents live position flashes.
    Object.assign(layer.style, {position: 'absolute', inset: '0', zIndex: '3', pointerEvents: 'auto', background: 'var(--surface, #eee5d3)'});
    layer.addEventListener('click', event => {event.preventDefault(); event.stopPropagation();});
    rootEl.appendChild(layer);
    preview = createPreview({rootEl: layer, createAdapter, sizeVariant: 'replay', preview: {snapshot: replay.frames[0].before, overlay: {mode: 'none'}, previewKey: `${generation}:before`}});
    notify();
    if (reducedMotion()) { next(); return true; }
    if (!await wait(timing.pause) || generation !== current) return false;
    for (index = 0; replay && generation === current && index < replay.frames.length; index++) {
      if (index) render(replay.frames[index].before, `${generation}:${index}:before`);
      showFrame();
      if (!await wait(timing.motion + timing.pause) || generation !== current) return false;
    }
    if (replay && generation === current) {
      if (holdFinal) { index = replay.frames.length - 1; notify(); }
      else stop('completed');
    }
    return true;
    } catch (error) { if (generation === current) stop('error'); throw error; }
  };
  const reconcile = ({gameId, revision, lineageHead}) => {
    if (replay && (gameId !== replay.gameId || revision !== replay.revision || lineageHead !== replay.lineageHead)) stop('live-change');
  };
  const visibility = () => { if (doc.hidden) stop('backgrounded'); };
  const pagehide = () => stop('navigation');
  doc.addEventListener?.('visibilitychange', visibility);
  doc.defaultView?.addEventListener?.('pagehide', pagehide);
  return {play, stop, next, snapshot, reconcile, destroy() {stop('destroyed'); doc.removeEventListener?.('visibilitychange', visibility); doc.defaultView?.removeEventListener?.('pagehide', pagehide);}};
}
