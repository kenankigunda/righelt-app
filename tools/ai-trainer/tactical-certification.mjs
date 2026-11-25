import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {legalActionMap, transition} from '../../packages/computer-player/src/index.ts';
import {canonical} from '../hosted-compute/policy.mjs';
import {createEngineOperationBudget, EngineExpansionLimit} from './engine-operation-budget.mjs';
import {verifyTurnCertificate} from './turn-certificate.mjs';

const rank = {end_turn: 0, push: 1, rush: 2, retreat: 3, follow: 4, project: 5, pass: 6, move: 7};
const other = side => side === 'P1' ? 'P2' : 'P1';
export const turnOwner = state => state.continuation?.attackerOwner ?? state.continuation?.owner ?? state.sideToMove;
export const winStatus = side => side === 'P1' ? 'p1_win' : 'p2_win';

/** An unfinished subtree has no Boolean value. Only the independently replayed
 * proof graph is eligible to supply a preference or adjudicate an outcome. */
export async function certifyTurn({state, prelude = [], winner, endTurnIndex, hints = new Map(),
  depths = [2, 4, 8, 16, 32, 64], maxWork = 8000, milliseconds = 4500}) {
  const deadline = performance.now() + milliseconds;
  let work = 0;
  class Cutoff extends Error {}
  const check = () => { if (work >= maxWork || performance.now() >= deadline) throw new Cutoff(); };
  const {bounded} = createEngineOperationBudget('replay', 2048, check);
  const beforeHash = deterministicStateHash(state);
  const step = (s, a) => bounded(() => transition(s, a));
  const start = state;
  const children = new Map();
  function choices(s, hash) {
    let list = children.get(hash);
    if (!list) {
      const hint = hints.get(hash);
      list = [...bounded(() => legalActionMap(s))].map(([index, action]) => ({
        index, action, preferred: hint !== undefined && canonical(hint) === canonical(action),
      })).sort((a, b) => Number(b.preferred) - Number(a.preferred) || rank[a.action.type] - rank[b.action.type] || a.index - b.index);
      children.set(hash, list);
    }
    return list;
  }
  try {
    for (const action of prelude) {
      if (!choices(state, deterministicStateHash(state)).some(e => canonical(e.action) === canonical(action))) {
        throw new Error('illegal certificate prelude');
      }
      state = step(state, action);
    }
    const rootHash = deterministicStateHash(state);
    for (const depth of depths) {
      const solved = new Map();
      const visit = (s, remaining) => {
        check();
        work++;
        const hash = deterministicStateHash(s);
        const id = hash + '/' + remaining;
        if (solved.has(id)) return solved.get(id);
        const n = {id, hash, depth: remaining, turnIndex: s.turnIndex, controller: s.sideToMove, edges: []};
        if (s.turnIndex > endTurnIndex) return null;
        if (s.outcome.status !== 'ongoing') {
          Object.assign(n, {kind:'terminal', value:s.outcome.status === winStatus(winner), reason:s.outcome.reason ?? null});
        } else if (s.turnIndex === endTurnIndex && !s.continuation && s.sideToMove !== winner) {
          Object.assign(n, {kind:'turn-boundary', value:false});
        } else {
          if (remaining === 0) return null;
          const edges = choices(s, hash);
          if (!edges.length) return null;
          const takesTrue = s.sideToMove === winner;
          let complete = true;
          n.kind = 'choice';
          for (const edge of edges) {
            edge.next ??= step(s, edge.action);
            const proof = visit(edge.next, remaining - 1);
            if (!proof) { complete = false; continue; }
            const link = {action:edge.action, child:proof.id};
            if (proof.value === takesTrue) {
              n.value = takesTrue;
              n.edges = [link];
              break;
            }
            n.edges.push(link);
          }
          if (n.value === undefined) {
            if (!complete) { solved.set(id, null); return null; }
            n.value = !takesTrue;
          }
        }
        solved.set(id, n);
        return n;
      };
      const proof = visit(state, depth);
      if (!proof) continue;
      const reachable = new Map();
      function keep(node) {
        if (reachable.has(node.id)) return;
        reachable.set(node.id, node);
        for (const edge of node.edges) keep(solved.get(edge.child));
      }
      keep(proof);
      if (reachable.size > 10000) break;
      const certificate = {schema:1, rootState:state, rootStateHash:rootHash, winner, endTurnIndex,
        actionHorizon:depth, status:proof.value ? 'forced-win' : 'no-forced-win-in-scope',
        proofRoot:proof.id, nodes:[...reachable.values()],
        ...(prelude.length ? {beforeState:start, beforeHash, prelude} : {})};
      const verified = await verifyTurnCertificate(certificate, {maxNodes:10000, milliseconds:30000});
      if (verified.disposition !== 'complete') return {status:'unknown',work};
      return {status:'verified', value:proof.value, certificate, verified, work};
    }
  } catch (e) {
    if (!(e instanceof Cutoff || e instanceof EngineExpansionLimit)) throw e;
  }
  return {status:'unknown',work};
}

export function currentTurnScope(state, defending) {
  const winner = defending ? other(state.sideToMove) : state.sideToMove;
  return {winner, endTurnIndex:state.turnIndex + (turnOwner(state) === winner ? 1 : 2)};
}
