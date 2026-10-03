// JSON-lines protocol. Parent owns inference, resource allocation and hard process termination.
import { createInterface } from 'node:readline';
import { searchRecovery } from './search-recovery.mjs';
import { createHash } from 'node:crypto';
import { createInitialState, deterministicStateHash, normalizeState, resolveToStability } from '../../packages/game-engine/src/index.ts';
import { encodeState, legalActionMap, transition, selectMove, seededRandom, experimentConfig } from '../../packages/computer-player/src/index.ts';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const read = async () => {
  const next = await input.next();
  if (next.done) throw new Error('Parent disconnected');
  return JSON.parse(next.value);
};
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const searchOptions = profile => ({ simulations: profile?.simulations, temperature: profile?.temperature,
  maxValueGap: profile?.maxValueGap, maxNodes: experimentConfig.search.maxNodes });

// IDs are canonicalized by owner/location for repetition detection only. Original
// states and IDs are preserved for exact replay. Administrative counters and UI
// artifacts must not hide repetitions, including optional false flag spellings.
export function ruleFingerprint(state) {
  const s = structuredClone(state);
  delete s.artifacts;
  const ids = new Map(s.pieces.map(p => [p.id, `${p.owner}:${p.kind}:${p.position.row},${p.position.col}`]));
  for (const p of s.pieces) {
    p.id = ids.get(p.id); delete p.displaySupplied; delete p.displayCommanded;
    p.pushed = !!p.pushed; p.shifted = !!p.shifted;
  }
  s.pieces.sort((a, b) => a.id.localeCompare(b.id));
  if (s.continuation) {
    const c = s.continuation;
    for (const key of ['followGroupPieceIds', 'rushedPieceIds', 'rushChainPieceIds']) {
      if (c[key]) c[key] = c[key].filter(id => ids.has(id)).map(id => ids.get(id)).sort();
    }
    if (c.pushedPieceId) c.pushedPieceId = ids.get(c.pushedPieceId) ?? c.pushedPieceId;
    if (c.frozenPieceStatesById) c.frozenPieceStatesById = Object.fromEntries(
      Object.entries(c.frozenPieceStatesById).filter(([id]) => ids.has(id))
        .map(([id, value]) => [ids.get(id), value]).sort(([a], [b]) => a.localeCompare(b)),
    );
    delete c.chainLength;
  }
  // normalizeState fills display fields, so remove them after normalization.
  const normalized = normalizeState(s);
  delete normalized.turnIndex;
  for (const piece of normalized.pieces) { delete piece.displaySupplied; delete piece.displayCommanded; }
  return createHash('sha256').update(JSON.stringify(canonical(normalized))).digest('hex');
}

class BudgetExpired extends Error {}
async function main() {
  const job = await read();
  const budgetMs = job.budgetMs ?? 600_000;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 600_000) throw new Error('Invalid job bound');
  const deadline = performance.now() + budgetMs;
  const check = () => { if (performance.now() >= deadline) throw new BudgetExpired(); };
  if (job.command === 'search') {
    let requestId=0;
    const result=await selectMove({state:job.state,seed:job.seed,...searchOptions(job.profile),deadlineMs:deadline},async encoded=>{
      const id=++requestId;send({type:'evaluate',id,input:Array.from(encoded)});
      const reply=await read();if(reply.type!=='evaluation'||reply.id!==id)throw new Error('Inference response mismatch');return reply;
    });
    send({type:'searched',result});return;
  }
  if (job.command === 'replay') {
    let state = job.game.rootState ?? job.game.initialState;
    for (const action of job.game.warmupActions ?? []) { check(); state = transition(state, action); }
    if (deterministicStateHash(state) !== deterministicStateHash(job.game.initialState)) throw new Error('Replay warmup mismatch');
    const repetitions = new Map([[ruleFingerprint(state), 1]]);
    for (const record of job.game.decisions) {
      check();
      if (deterministicStateHash(state) !== record.beforeHash) throw new Error('Replay before-state mismatch');
      if (state.sideToMove !== record.controller) throw new Error('Replay controller mismatch');
      if (record.encoded && JSON.stringify(Array.from(encodeState(state))) !== JSON.stringify(record.encoded)) throw new Error('Replay encoding mismatch');
      if (record.legal && JSON.stringify([...legalActionMap(state).keys()]) !== JSON.stringify(record.legal)) throw new Error('Replay legal mask mismatch');
      state = transition(state, record.action);
      if (deterministicStateHash(state) !== record.afterHash) throw new Error('Replay after-state mismatch');
      const key = ruleFingerprint(state);
      repetitions.set(key, (repetitions.get(key) ?? 0) + 1);
    }
    if (deterministicStateHash(state) !== job.game.finalHash) throw new Error('Replay final hash mismatch');
    if (state.outcome.status !== job.game.outcome.status) throw new Error('Replay outcome mismatch');
    if (state.outcome.status === 'ongoing') {
      const reason = job.game.decisions.length >= experimentConfig.training.maxDecisions ? 'decision-cap'
        : repetitions.get(ruleFingerprint(state)) >= experimentConfig.training.repetitionLimit ? 'repetition' : null;
      if (job.game.termination !== 'truncated' || !reason || job.game.truncationReason !== reason) throw new Error('Unjustified truncation');
    } else if (job.game.termination !== 'terminal') throw new Error('Terminal game mislabeled');
    send({ type: 'replayed', hash: deterministicStateHash(state), outcome: state.outcome }); return;
  }
  if (job.command === 'validate-opening') {
    let current=createInitialState();
    for (const action of job.actions??[]) {check();current=transition(current,action);}
    if(deterministicStateHash(current)!==deterministicStateHash(job.state))throw new Error('Opening trajectory mismatch');
    if(current.outcome.status!=='ongoing')throw new Error('Opening is terminal');
    send({type:'opening-verified',fingerprint:ruleFingerprint(current),initial:ruleFingerprint(current)===ruleFingerprint(createInitialState())});return;
  }
  if (job.command === 'generate-opening') {
    const random=seededRandom(job.seed),actions=[];
    let current=createInitialState();
    const steps=12+Math.floor(random()*29);
    for(let i=0;i<steps && current.outcome.status==='ongoing';i++) {
      check();const legal=[...legalActionMap(current).values()];check();
      if(!legal.length)break;
      const action=legal[Math.floor(random()*legal.length)];
      current=transition(current,action);actions.push(action);
    }
    check();send({type:'opening-generated',state:current,actions,fingerprint:ruleFingerprint(current),
      initial:ruleFingerprint(current)===ruleFingerprint(createInitialState())});return;
  }
  if (job.command === 'fingerprint') { send({ type: 'fingerprint', fingerprint: ruleFingerprint(job.state) }); return; }
  const arena=job.command==='arena';
  if (arena && ['P1', 'P2'].some(seat => !job.profiles?.[seat] || !job.modelVersions?.[seat] || !job.profileVersions?.[seat])) {
    throw new Error('Arena model and profile identities are required for both seats');
  }
  if (!['generate', 'prepare', 'arena'].includes(job.command) || !Number.isSafeInteger(job.seed) ||
      (arena ? !['validation','final'].includes(job.partition) : job.partition !== 'train') ||
      !['normal', 'simple', 'continuation'].includes(job.kind)) throw new Error('Invalid training job');
  let state = resolveToStability(normalizeState(job.initialState ?? createInitialState()));
  encodeState(state);
  if (state.outcome.status !== 'ongoing') throw new Error('Curriculum root is terminal');
  const rootState = structuredClone(state), warmupActions = [];
  if (job.kind === 'continuation') {
    const random = seededRandom(job.seed);
    for (let step = 0; !state.continuation && step < 48; step++) {
      check();
      const legal = [...legalActionMap(state).values()];
      const forcing = legal.filter(action => action.type === 'push' || action.type === 'rush');
      const choices = forcing.length ? forcing : legal;
      if (!choices.length) break;
      const action = choices[Math.floor(random() * choices.length)];
      warmupActions.push(action); state = transition(state, action);
      if (state.outcome.status !== 'ongoing') break;
    }
    if (!state.continuation || state.outcome.status !== 'ongoing') {
      send({ type: 'unavailable-start', id: job.id, reason: 'no-continuation', warmupActions }); return;
    }
  }
  const initialState = structuredClone(state), decisions = [], repetitions = new Map();
  if (job.command === 'prepare') {
    send({ type: 'prepared', rootState, warmupActions, initialState }); return;
  }
  let requestId = 0, termination = 'terminal', truncationReason = null;
  try {
    for (let n = 0; state.outcome.status === 'ongoing'; n++) {
      check();
      const key = ruleFingerprint(state), count = (repetitions.get(key) ?? 0) + 1;
      repetitions.set(key, count);
      if (n >= experimentConfig.training.maxDecisions || count >= experimentConfig.training.repetitionLimit) {
        termination = 'truncated'; truncationReason = n >= experimentConfig.training.maxDecisions ? 'decision-cap' : 'repetition'; break;
      }
      const seed = (job.seed + n) >>> 0;
      const decisionController=state.sideToMove;
      const profile=arena ? job.profiles[decisionController] : {simulations:experimentConfig.search.selfPlaySimulations,temperature:1,maxValueGap:.1};
      const result = await selectMove({ state, seed, ...searchOptions(profile), deadlineMs: deadline }, async encoded => {
        const id = ++requestId;
        send({ type: 'evaluate', id, modelSeat:decisionController, input: Array.from(encoded) });
        const reply = await read();
        if (reply.type !== 'evaluation' || reply.id !== id) throw new Error('Inference response mismatch');
        return reply;
      });
      const unfinished=searchRecovery(result,{schema:1,id:job.id,familyId:job.familyId,partition:job.partition,
        initialState,decisions,finalHash:deterministicStateHash(state),outcome:state.outcome});
      if(unfinished){send(unfinished);return;}
      const beforeHash = deterministicStateHash(state), controller = state.sideToMove;
      const encoded = Array.from(encodeState(state)), legal = [...legalActionMap(state).keys()];
      state = transition(state, result.action);
      decisions.push({ id: `${job.id}:${n}`, controller, action: result.action, beforeHash,
        afterHash: deterministicStateHash(state), seed, policy: result.policy, legal, encoded,
        ...(arena ? { modelVersion: job.modelVersions[controller], profileVersion: job.profileVersions[controller] } : {}),
        search: { nodes: result.nodes, simulations: result.simulations, stopped: result.stopped, reason: result.reason } });
    }
  } catch (error) {
    if (!(error instanceof BudgetExpired)) throw error;
    send({ type: 'unfinished', id: job.id, reason: 'budget', decisions: decisions.length }); return;
  }
  send({ type: 'game', game: { schema: 1, id: job.id, familyId: job.familyId, partition: job.partition, kind: job.kind,
    seed: job.seed, modelVersion: job.modelVersion, rootState, warmupActions, initialState, decisions,
    ...(arena ? { modelVersions: job.modelVersions, profileVersions: job.profileVersions } : {}),
    termination, truncationReason, outcome: state.outcome, finalHash: deterministicStateHash(state) } });
}
main().catch(error => {
  send({ type: error instanceof BudgetExpired ? 'unfinished' : 'error', message: error.message });
  if (!(error instanceof BudgetExpired)) process.exitCode = 1;
})
  .finally(() => process.stdin.destroy());
