import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as ort from 'onnxruntime-web';
import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {legalActionMap, selectMove, transition} from '../../packages/computer-player/src/index.ts';
import {COMPUTER_PROFILES} from '../../packages/shared-types/src/computer-play.ts';
import {certifyTurn, turnOwner, winStatus} from './tactical-certification.mjs';
import {canonical} from '../hosted-compute/policy.mjs';

export async function exportedPlayer(path) {
  const bytes = readFileSync(path);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(bytes, {executionProviders:['wasm'], graphOptimizationLevel:'all'});
  if (session.inputNames.join(',') !== 'state' || session.outputNames.join(',') !== 'policy,value') {
    throw Error('unexpected model input or outputs');
  }
  return {
    sha256:createHash('sha256').update(bytes).digest('hex'),
    close:()=>session.release(),
    async evaluate(input) {
      const outputs = await session.run({state:new ort.Tensor('float32', input, [1,46,10,10])});
      const policyLogits = outputs.policy.data, value = outputs.value.data[0];
      if (policyLogits.length !== 2801 || !policyLogits.every(Number.isFinite) || !Number.isFinite(value)) {
        throw Error('invalid model output');
      }
      return {policyLogits,value};
    },
  };
}

/** The tested player controls one seat. A genuine counterexample is sufficient
 * for a loss; a successful forced outcome must cover every opposing reply. */
export async function scoreTurn({item, player, profile, seed, forcing = false, adjudicate,
  limit = 512, milliseconds = 90000}) {
  const started = performance.now(), trace = [], decisions = [];
  const own = item.controller ?? item.state.sideToMove;
  const opponent = own === 'P1' ? 'P2' : 'P1';
  const deadline = started + milliseconds;
  const finish = item.finishTurn ?? item.state.turnIndex + 1;
  const config = COMPUTER_PROFILES[profile];
  if (!config || !Number.isInteger(seed)) throw Error('invalid tactical evaluation profile or seed');
  let explored = 0;
  const terminals = s => s.outcome.status === winStatus(own) ?
    (item.targetReason && !s.outcome.reason?.endsWith(item.targetReason) ? 'alternate-win' : 'win') :
    s.outcome.status === winStatus(opponent) ? 'loss' : 'draw';
  const combine = outcomes => {
    if (outcomes.includes('loss')) return 'loss';
    if (outcomes.includes('technical-incomplete')) return 'technical-incomplete';
    if (outcomes.every(v => v === 'win')) return 'win';
    if (outcomes.every(v => v === 'win' || v === 'alternate-win')) return 'alternate-win';
    if (outcomes.every(v => v === 'win' || v === 'protected')) return 'protected';
    if (outcomes.every(v => v === 'material-gain' || v === 'win')) return 'material-gain';
    return 'unknown';
  };
  async function walk(s, depth, opponentCounts = {}) {
    const hash = deterministicStateHash(s);
    if (s.outcome.status !== 'ongoing') {
      trace.push({hash, turn:s.turnIndex, outcome:s.outcome});
      return terminals(s);
    }
    if (performance.now() >= deadline || ++explored > limit || depth >= 64) return 'unknown';
    if (depth && s.turnIndex >= finish && !s.continuation) {
      if (item.material) {
        const count = s.pieces.filter(p => p.owner === item.material.owner).length;
        if (count <= item.material.maximumRemaining) {
          trace.push({hash, turn:s.turnIndex, materialRemaining:count});
          return 'material-gain';
        }
      }
      const endTurnIndex = s.turnIndex + (turnOwner(s) === opponent ? 1 : 2);
      const proof = await adjudicate({state:s, winner:opponent, endTurnIndex, item, deadline});
      trace.push({hash, turn:s.turnIndex, opponentForcedWin:proof.value ?? null,
        proofSha256:proof.sha256 ?? null, scopeEnd:endTurnIndex});
      return proof.value === true ? 'loss' : proof.value === false && item.defending ? 'protected' : 'unknown';
    }
    if (s.sideToMove !== own) {
      let replies = [...legalActionMap(s)];
      if (!replies.length) return 'technical-incomplete';
      const slot = opponentCounts[s.turnIndex] ?? 0;
      if (item.opponentScript) {
        const action = item.opponentScript[s.turnIndex]?.[slot];
        if (!action) return 'unknown';
        replies = replies.filter(([,a])=>canonical(a) === canonical(action));
        if (!replies.length) return 'unknown';
      } else if (item.conditionalReply && item.conditionalReply.turn === s.turnIndex && slot===0) {
        replies = replies.filter(([,a])=>canonical(a) === canonical(item.conditionalReply.action));
        if (!replies.length) return 'unknown';
      }
      const outcomes = [];
      for (const [index,a] of replies) {
        const next = transition(s,a);
        trace.push({hash, opposing:index, action:a, afterHash:deterministicStateHash(next)});
        const result = await walk(next, depth+1, {...opponentCounts,[s.turnIndex]:slot+1});
        outcomes.push(result);
        if (result === 'loss') return result;
        if (performance.now() >= deadline || explored > limit) return 'unknown';
      }
      return combine(outcomes);
    }
    const begin = performance.now();
    const result = await selectMove({state:s, seed:(seed+depth)>>>0, simulations:config.simulations,
      temperature:config.temperature, maxValueGap:config.maxValueGap, verifyForcingReplies:forcing,
      deadlineMs:Math.min(deadline,begin+30000)}, input=>player.evaluate(input));
    const elapsedMs = performance.now()-begin;
    if (result.status !== 'ready') {
      trace.push({hash, status:result.status, stopped:result.stopped, fallback:result.fallback ?? null});
      return 'technical-incomplete';
    }
    const next = transition(s,result.action);
    const afterHash = deterministicStateHash(next);
    if (afterHash !== deterministicStateHash(result.nextState)) throw Error('search and replay disagree');
    decisions.push({hash, afterHash, index:result.actionIndex, action:result.action, elapsedMs, nodes:result.nodes,
      simulations:result.simulations, reason:result.reason, fallback:result.fallback ?? null,
      stopped:result.stopped, seed:(seed+depth)>>>0});
    return walk(next, depth+1, opponentCounts);
  }
  const status = await walk(item.state,0);
  return {caseId:item.id,sourceFamily:item.sourceFamily,controller:own,profile,seed,forcing,model:player.sha256,
    root:deterministicStateHash(item.state),conditional:Boolean(item.conditionalReply || item.opponentScript),
    status,decisions,trace,explored,elapsedMs:performance.now()-started};
}

export async function localAdjudication({state, winner, endTurnIndex, item, deadline}, work=12000) {
  const hints = new Map(item.hints ?? []);
  const remaining = Math.floor(deadline-performance.now());
  if (remaining < 20) return {status:'unknown'};
  return certifyTurn({state,winner,endTurnIndex,hints,maxWork:work,milliseconds:Math.min(remaining,4500)});
}
