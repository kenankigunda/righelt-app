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
  const admissionKeyFor = context => `${context.scope}:${keyFor(context.game)}`;
  const observeAdmittedFollow = context => {
    const action=mandatoryFollowAction(context.game);
    if(action && context.view?.pendingMoves?.some(move=>move.clientCommandId && move.action && canonicalCommandJson(move.action)===canonicalCommandJson(action))) {
      // A restored durable intent already has an admission owner, even if its
      // eventual receipt rejects. This controller must not create another one.
      admitted.add(admissionKeyFor(context));
    }
  };
  const waitUntilReady = async token => {
    while(current(token)) {
      const next=getContext(), action=mandatoryFollowAction(next.game);
      observeAdmittedFollow(next);
      if(next.hasHumanAuthority===false || keyFor(next.game)!==token.positionKey || !action
        || canonicalCommandJson(action)!==canonicalCommandJson(token.action) || admitted.has(token.admissionKey)) return null;
      if(candidate(next))return next;
      // A temporary protocol fence does not discard the automatic intent or
      // repeat its hold/reconciliation. Transport updates wake this one waiter.
      token.waiting=true;
      await Promise.race([new Promise(resolve=>{token.wake=resolve;}),token.cancellation]);
      token.waiting=false;token.wake=null;
    }
    return null;
  };
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
      observeAdmittedFollow(context);
      if (active) {
        const preAdmission=!active.admitting && !active.admitted;
        if (!sameScope(active, context) || active.animatingRevision != null && context.game.gameplayRevision !== active.animatingRevision
          || preAdmission && (context.hasHumanAuthority===false || keyFor(context.game)!==active.positionKey)) cancel();
        else active.wake?.();
        return;
      }
      const action = candidate(context);
      if (!action) return;
      const key = keyFor(context.game), admissionKey = `${context.scope}:${key}`;
      if (admitted.has(admissionKey)) return;
      let cancelWait;
      const cancellation = new Promise(resolve => { cancelWait = resolve; });
      const token = active = { owner: context.owner, scope: context.scope, gameId: context.game.id, generation, action, positionKey:key, admissionKey, admitting: false, admitted:false, cancellation, cancelWait };
      onChange();
      try {
        await withLock(`${context.owner.getIdentityId()}:${key}`, async () => {
          if (!current(token)) return;
          await hold(structuredClone(context.game.board.state));
          if (!current(token)) return;
          // This hydrates restored journals too. A refreshed tab cannot create
          // another command while an earlier automatic follow remains unknown.
          try { await context.owner.reconcileGame(context.game.id); }
          catch(error) {
            if(!current(token))return;
            // Recovery remains owned by the transport. An unfenced failure
            // still surfaces normally; a fenced one keeps this intent pending.
            if(candidate(getContext()))throw error;
          }
          let handle;
          while(current(token)) {
            const refreshed=await waitUntilReady(token);
            if(!refreshed)return;
            token.admitting=true;
            try {
              handle=await context.owner.applyGameAction({gameId:token.gameId,state:structuredClone(refreshed.game.board.state),action});
              break;
            } catch(error) {
              // This code is emitted before durable admission. Never replay an
              // uncertain persistence failure or an already returned handle.
              if(error.code!=='sync_recovering' || !current(token) || candidate(getContext()))throw error;
            } finally { token.admitting=false; }
          }
          if(!current(token))return;
          if (!handle?.committed) throw new Error(handle?.validation?.code ?? 'follow_not_admitted');
          token.admitted=true;admitted.add(admissionKey);
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
