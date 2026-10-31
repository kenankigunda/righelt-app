import { deterministicStateHash } from '../generated/packages/game-engine/src/hash.js';
import { canonicalCommandJson } from '../generated/packages/shared-types/src/sync-protocol.js';

export function mandatoryFollowAction(game) {
  const state = game?.board?.state;
  if (state?.outcome?.status !== 'ongoing' || state.continuation?.type !== 'push' || state.continuation.phase !== 'follow') return null;
  const actions = game.legalActions ?? [];
  const action = actions.length === 1 ? actions[0] : null;
  return action?.type === 'follow' && action.actorId && action.from && action.to ? structuredClone(action) : null;
}

const sameScope = (token, context) => token && context.visible && context.eligible && token.owner === context.owner && token.scope === context.scope && token.gameId === context.game?.id;
const keyFor = game => `${game.id}:${game.gameplayRevision}:${deterministicStateHash(game.board.state)}`;
const defaultLock = (key, work) => globalThis.navigator?.locks
  ? navigator.locks.request(`righelt:mandatory-follow:${key}`, { ifAvailable: true }, lock => lock ? work() : null)
  : work();

// A single admission owner. Once a handle exists its durable journal, rather
// than this controller, owns every delivery retry and uncertain receipt.
export function createForcedFollow({ getContext, hold = async () => {}, animate = async () => {}, clearVisual = () => {}, sound = () => {}, onChange = () => {}, onError = () => {}, withLock = defaultLock }) {
  let active = null, generation = 0, destroyed = false;
  const admitted = new Set();
  const cancel = () => { generation++; active?.cancelWait(); active = null; clearVisual(); onChange(); };
  const current = token => !destroyed && token === active && token.generation === generation && sameScope(token, getContext());
  const candidate = context => context.visible && context.eligible && context.canAct && !context.view?.sharedMutationsBlocked && !(context.view?.pendingCommandCount > 0) && !context.view?.inHistoryMode && !context.game?.computerTurn
    ? mandatoryFollowAction(context.game) : null;
  const api = {
    snapshot: () => ({ working: Boolean(active), gameId: active?.gameId ?? null }),
    ownsEnqueue(change, view) {
      if (!active?.admitting || change.gameId !== active.gameId) return false;
      const move = view?.pendingMoves?.find(move => move.clientCommandId === change.clientCommandId);
      return Boolean(move && canonicalCommandJson(move.action) === canonicalCommandJson(active.action));
    },
    cancel,
    async tick() {
      if (destroyed) return;
      const context = getContext();
      if (active) {
        if (!sameScope(active, context) || active.animatingRevision != null && context.game.gameplayRevision !== active.animatingRevision) cancel();
        return;
      }
      const action = candidate(context);
      if (!action) return;
      const key = keyFor(context.game), admissionKey = `${context.scope}:${key}`;
      if (admitted.has(admissionKey)) return;
      let cancelWait;
      const cancellation = new Promise(resolve => { cancelWait = resolve; });
      const token = active = { owner: context.owner, scope: context.scope, gameId: context.game.id, generation, action, admitting: false, cancellation, cancelWait };
      onChange();
      try {
        await withLock(`${context.owner.getIdentityId()}:${key}`, async () => {
          if (!current(token)) return;
          await hold(structuredClone(context.game.board.state));
          if (!current(token)) return;
          // This hydrates restored journals too. A refreshed tab cannot create
          // another command while an earlier automatic follow remains unknown.
          await context.owner.reconcileGame(context.game.id);
          if (!current(token)) return;
          const refreshed = getContext(), next = candidate(refreshed);
          if (!next || keyFor(refreshed.game) !== key || canonicalCommandJson(next) !== canonicalCommandJson(action)) return;
          token.admitting = true;
          const handle = await context.owner.applyGameAction({ gameId: token.gameId, state: structuredClone(refreshed.game.board.state), action });
          token.admitting = false;
          if (!handle?.committed) throw new Error(handle?.validation?.code ?? 'follow_not_admitted');
          admitted.add(admissionKey);
          // Releasing visual/lock ownership never cancels the durable command.
          await Promise.race([handle.committed, token.cancellation]);
          if (!current(token)) return;
          const acknowledged = getContext().game;
          const move = acknowledged.moves?.findLast(move => !move.undone && move.clientCommandId === handle.id);
          const head = acknowledged.moves?.findLast(move => !move.undone);
          if (!move?.selectionSnapshot || !move.snapshot || move.moveId !== head?.moveId || canonicalCommandJson(move.action) !== canonicalCommandJson(action)) return;
          token.animatingRevision = acknowledged.gameplayRevision;
          sound();
          await animate(structuredClone(move));
        });
      } catch (error) { if (current(token)) onError(error); }
      finally {
        if (token === active) { active = null; clearVisual(); onChange(); }
      }
      // No retry loop: a newly acknowledged mandatory continuation is a new
      // state. Existing pending commands continue under their journal owner.
      const nextContext = getContext();
      if (!destroyed && generation === token.generation && candidate(nextContext) && keyFor(nextContext.game) !== key) void api.tick();
    },
    destroy() { destroyed = true; cancel(); },
  };
  return api;
}
