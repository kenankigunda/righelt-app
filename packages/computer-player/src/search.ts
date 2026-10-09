import { withEngineComputationGuard, MAX_ENGINE_OPERATION_EXPANSIONS, DecisionRuleCache, withDecisionRuleCache, type DecisionCacheStats, withEngineComputationObserver, type EngineComputationObserver } from "../../game-engine/src/index";
import type { Action, GameState } from "../../shared-types/src/engine";
import { encodeState, experimentConfig as config, legalActionMap, scanLegalActions } from "./representation";
import { terminalValue, transition } from "./transition";
import { proveTactical, TacticalInterrupted, type TacticalStatus } from "./tactics";
import { applyRootExploration, explorationEvidence, verifyTrainingRecipe, type RootExplorationEvidence, type RootExplorationRequest } from "./exploration";
export type { TacticalStatus } from "./tactics";
export const SEARCH_POLICY_VERSION = "model-fallback-v2";

export type Evaluation = { policyLogits: ArrayLike<number>; value: number };
export type Evaluator = (input: Float32Array, context: {
  state: GameState; legalActions: Map<number, Action>; signal?: AbortSignal;
}) => Promise<Evaluation>;
export type SearchRequest = {
  state: GameState; seed: number; simulations?: number; temperature?: number;
  maxValueGap?: number; maxNodes?: number; deadlineMs?: number; signal?: AbortSignal; decisionCache?: boolean; observeEngine?: EngineComputationObserver;
  /** Training self-play/development screen only. Browser and evaluation omit it. */
  rootExploration?: RootExplorationRequest;
};
export type ActionReport = {
  executable: boolean | null; index: number; visits: number; prior: number; policyLogit: number; value: number | null;
  immediate: "win" | "eligible" | "losing" | "incomplete";
  tactical: TacticalStatus;
};
type EngineBudget = { perOperationLimit: number; peakExpansions: number; totalExpansions: number; limitReached: boolean };
export type ModelFallback = {
  schemaVersion: 1 | 2; reason: "search-incomplete" | "safety-incomplete" | "legality-incomplete";
  selectionBasis: "model-policy"; selectedActionSafety: "win" | "eligible" | "losing" | "incomplete";
  valueSource: "root-model"; checkedEligibleCount: number; uncheckedCount: number; provenLosingCount: number;
};
export type LegalityEvidence = { complete: boolean; checked: number; unknown: number; indices: number[] };
export type SearchResult = ({
  status: "ready"; nextState: GameState; legality: LegalityEvidence; action: Action; actionIndex: number; value: number;
  policy: { index: number; probability: number }[]; policyMask: boolean; fallback: ModelFallback | null;
  actions: ActionReport[]; seed: number; nodes: number; simulations: number;
  elapsedMs: number; engineBudget: EngineBudget; stopped: "complete" | "deadline" | "node-limit";
  reason: "immediate-win" | "forced-win" | "search" | "unavoidable-loss" | "model-fallback";
} | {
  status: "recovery"; reason: "terminal" | "no-legal-actions" | "incomplete-safety" | "no-completed-search";
  actions: ActionReport[]; nodes: number; simulations: number; elapsedMs: number; engineBudget: EngineBudget;
  stopped: "complete" | "deadline" | "node-limit";
}) & { decisionCache?: DecisionCacheStats; rootExploration?: RootExplorationEvidence };

type Edge = { index: number; action: Action; prior: number; policyLogit: number; visits: number; sum: number; child?: Node; resolved?: GameState; transitionLimited?: boolean };
type Node = { state: GameState; edges?: Edge[]; enumerationLimited?: boolean; value?: number; visits: number; sum: number };
class SoftStop extends Error {}
// Exhausting one authoritative operation does not spend another candidate's
// allowance. Memoize interruption, never a legal/safety answer.
class EngineLimit extends Error {}
function abort() { const error = new Error("Search cancelled"); error.name = "AbortError"; return error; }
function mover(state: GameState) { return state.sideToMove === "P1" ? 1 : -1; }

/** Reproducible PRNG; no ambient randomness participates in play or training. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** The host must terminate the worker for blocked inference or synchronous engine work.
 * This core checks cooperative cancellation between bounded operations, not during them. */
export async function selectMove(request: SearchRequest, evaluator: Evaluator): Promise<SearchResult> {
  const started = performance.now();
  const exploration = explorationEvidence(request.rootExploration, request.seed);
  if (exploration) await verifyTrainingRecipe(exploration.recipe);
  const ruleCache = request.decisionCache ? new DecisionRuleCache() : undefined;
  const rules = <T>(operation: () => T): T => {
    const cached = () => withDecisionRuleCache(ruleCache, operation);
    return request.observeEngine ? withEngineComputationObserver(request.observeEngine, cached) : cached();
  };
  const cacheEvidence = () => ({ ...(ruleCache ? { decisionCache: { ...ruleCache.stats } } : {}),
    ...(exploration ? { rootExploration: exploration } : {}) });
  const random = seededRandom(request.seed);
  const simulations = request.simulations ?? config.search.selfPlaySimulations;
  const maxNodes = request.maxNodes ?? config.search.maxNodes;
  const temperature = request.temperature ?? 0;
  const valueGap = request.maxValueGap ?? 0;
  if ((request.decisionCache !== undefined && typeof request.decisionCache !== "boolean") || !Number.isSafeInteger(request.seed) || !Number.isSafeInteger(simulations) || simulations < 1 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > config.search.maxNodes ||
      !Number.isFinite(temperature) || temperature < 0 || !Number.isFinite(valueGap) || valueGap < 0 ||
      (request.deadlineMs !== undefined && !Number.isFinite(request.deadlineMs))) throw new Error("Invalid search limits");
  // Actual PUCT/tree nodes retain the approved 2,048 ceiling. Internal rule
  // enumeration has its own finite per-call allocation bound and same deadline.
  let nodes = 1;
  const engineBudget: EngineBudget = { perOperationLimit: MAX_ENGINE_OPERATION_EXPANSIONS,
    peakExpansions: 0, totalExpansions: 0, limitReached: false };
  let completed = 0;
  let stopped: "complete" | "deadline" | "node-limit" = "complete";
  const root: Node = { state: request.state, visits: 0, sum: 0 };
  const safety = new Map<number, ActionReport["immediate"]>();
  const proofs = new Map<number, TacticalStatus>();
  const reserveMs = request.deadlineMs === undefined ? 0 : Math.min(500, Math.max(0, (request.deadlineMs - started) / 5));
  const legality: LegalityEvidence = { complete: true, checked: 0, unknown: 0, indices: [] };
  const check = (final = false) => {
    if (request.signal?.aborted) throw abort();
    if (request.deadlineMs !== undefined && performance.now() >= request.deadlineMs - (final ? 0 : reserveMs)) {
      stopped = "deadline"; throw new SoftStop();
    }
  };
  const engine = <T>(operation: () => T, final = false): T => {
    let expansions = 0;
    return rules(() => withEngineComputationGuard(expansion => {
      check(final);
      if (expansion) {
        if (expansions >= engineBudget.perOperationLimit) {
          engineBudget.limitReached = true; stopped = "node-limit"; throw new EngineLimit();
        }
        expansions++; engineBudget.totalExpansions++;
        engineBudget.peakExpansions = Math.max(engineBudget.peakExpansions, expansions);
      }
    }, operation));
  };
  const edges = (node: Node) => {
    check();
    if (node.enumerationLimited) throw new EngineLimit();
    if (!node.edges) {
      try { node.edges = [...engine(() => legalActionMap(node.state))].map(([index, action]) => ({ index, action, prior: 0, policyLogit: 0, visits: 0, sum: 0 })); }
      catch (error) { if (error instanceof EngineLimit) node.enumerationLimited = true; throw error; }
    }
    check();
    return node.edges;
  };
  const child = (node: Node, edge: Edge) => {
    check();
    if (edge.transitionLimited) throw new EngineLimit();
    if (!edge.child) {
      if (nodes >= maxNodes) { stopped = "node-limit"; throw new SoftStop(); }
      nodes += 1;
      try { edge.child = { state: engine(() => transition(node.state, edge.action)), visits: 0, sum: 0 }; }
      catch (error) { if (error instanceof EngineLimit) edge.transitionLimited = true; throw error; }
    }
    check();
    return edge.child;
  };
  const evaluate = async (node: Node, final = false): Promise<number> => {
    check(final);
    const terminal = terminalValue(node.state);
    if (terminal !== undefined) { node.value = terminal; return terminal; }
    if (node.value !== undefined) return node.value;
    const available = node === root && root.edges ? root.edges : edges(node);
    const evaluation = await evaluator(encodeState(node.state), {
      state: node.state, legalActions: new Map(available.map(edge => [edge.index, edge.action])), signal: request.signal,
    });
    check(final);
    if (!Number.isFinite(evaluation.value) || Math.abs(evaluation.value) > 1 || evaluation.policyLogits.length !== config.actionCount) {
      throw new Error("Invalid model output");
    }
    // Reject corrupt output even in currently masked channels.
    for (let i = 0; i < config.actionCount; i++) if (!Number.isFinite(evaluation.policyLogits[i])) throw new Error("Non-finite policy logit");
    const max = Math.max(...available.map(edge => evaluation.policyLogits[edge.index]));
    let total = 0;
    for (const edge of available) { edge.policyLogit = evaluation.policyLogits[edge.index]; edge.prior = Math.exp(edge.policyLogit - max); total += edge.prior; }
    for (const edge of available) edge.prior /= total;
    node.value = evaluation.value;
    return evaluation.value;
  };
  function reports(): ActionReport[] {
    return (root.edges ?? []).map(edge => ({
      executable: edge.child || edge.resolved ? true : edge.transitionLimited ? false : null,
      index: edge.index, visits: edge.visits, prior: edge.prior, policyLogit: edge.policyLogit,
      value: edge.visits ? edge.sum / edge.visits : null,
      immediate: safety.get(edge.index) ?? "incomplete", tactical: proofs.get(edge.index) ?? "incomplete",
    }));
  }
  const recovery = (reason: Extract<SearchResult, { status: "recovery" }>["reason"]): SearchResult => ({
    status: "recovery", ...cacheEvidence(), reason, actions: reports(), nodes, simulations: completed, elapsedMs: performance.now() - started, engineBudget, stopped,
  });
  const sample = (choices: Edge[], score: (edge: Edge) => number): Edge => {
    const scores = choices.map(score);
    const best = Math.max(...scores);
    if (temperature === 0) {
      const tied = choices.filter((_, i) => scores[i] === best);
      return tied[Math.floor(random() * tied.length)];
    }
    const weights = scores.map(value => Math.exp((value - best) / temperature));
    let draw = random() * weights.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < choices.length; i++) { draw -= weights[i]; if (draw < 0) return choices[i]; }
    return choices[choices.length - 1];
  };
  const finish = (edge: Edge): GameState => {
    // The deadline stops additional work. Already completed transitions remain
    // usable; cancellation (including the host watchdog) still rejects them.
    if (request.signal?.aborted) throw abort();
    if (edge.child) return edge.child.state;
    if (edge.resolved) return edge.resolved;
    check(true);
    if (edge.transitionLimited) throw new EngineLimit();
    try { edge.resolved = engine(() => transition(root.state, edge.action), true); return edge.resolved; }
    catch (error) { if (error instanceof EngineLimit) edge.transitionLimited = true; throw error; }
  };
  const ready = (chosen: Edge, candidates: Edge[], reason: Extract<SearchResult, { status: "ready" }>["reason"]): SearchResult => {
    let nextState: GameState;
    try { nextState = finish(chosen); }
    catch (error) { if (error instanceof SoftStop || error instanceof EngineLimit) return recovery("no-completed-search"); throw error; }
    const total = candidates.reduce((sum, edge) => sum + edge.visits, 0);
    return {
      status: "ready", ...cacheEvidence(), nextState, legality, action: chosen.action, actionIndex: chosen.index,
      value: chosen.visits ? chosen.sum / chosen.visits : root.value!,
      policy: candidates.map(edge => ({ index: edge.index, probability: total ? edge.visits / total : Number(edge === chosen) })),
      policyMask: true, fallback: null,
      actions: reports(), seed: request.seed, nodes, simulations: completed,
      elapsedMs: performance.now() - started, engineBudget, stopped, reason,
    };
  };
  const modelFallback = (choices: Edge[], reason: ModelFallback["reason"]): SearchResult => {
    // A chosen action needs a completed transition as well as known legality.
    const remaining = root.edges!.filter(edge => !choices.includes(edge));
    const tiers = [choices, ...(["win", "eligible", "incomplete", "losing"] as const).map(status =>
      remaining.filter(edge => (safety.get(edge.index) ?? "incomplete") === status))];
    for (const tier of tiers) {
      const pending = [...tier];
      while (pending.length) {
        const highest = Math.max(...pending.map(edge => edge.policyLogit));
        const tied = pending.filter(edge => edge.policyLogit === highest);
        const chosen = tied[Math.floor(random() * tied.length)];
        pending.splice(pending.indexOf(chosen), 1);
        let nextState: GameState;
        try { nextState = finish(chosen); }
        catch (error) {
          if (error instanceof EngineLimit) continue;
          if (error instanceof SoftStop) { chosen.transitionLimited = true; continue; }
          throw error;
        }
        const selectedSafety = safety.get(chosen.index) ?? "incomplete";
        const selectedReason = reason === "legality-incomplete" ? reason : selectedSafety === "eligible" ? "search-incomplete" : "safety-incomplete";
        return {
          status: "ready", ...cacheEvidence(), nextState, legality, reason: "model-fallback", action: chosen.action, actionIndex: chosen.index,
          value: root.value!, policy: [], policyMask: false,
          fallback: { schemaVersion: selectedReason === "legality-incomplete" || selectedSafety === "losing" || selectedReason !== reason ? 2 : 1,
            reason: selectedReason, selectionBasis: "model-policy", selectedActionSafety: selectedSafety,
            valueSource: "root-model",
            checkedEligibleCount: root.edges!.filter(edge => safety.get(edge.index) === "eligible").length,
            uncheckedCount: root.edges!.filter(edge => !safety.has(edge.index)).length,
            provenLosingCount: root.edges!.filter(edge => safety.get(edge.index) === "losing").length },
          actions: reports(), seed: request.seed, nodes, simulations: completed,
          elapsedMs: performance.now() - started, engineBudget, stopped,
        };
      }
    }
    return recovery("no-completed-search");
  };
  // One aggregate root allowance: expensive candidates cannot reset it. Cheap
  // zero-expansion validation may still establish alternatives after exhaustion.
  let rootExpansions = 0;
  let enumerationStopped = false;
  root.edges = [];
  try {
    scanLegalActions(root.state, operation => {
      if (request.signal?.aborted) throw abort();
      if (enumerationStopped) return undefined;
      try { check(); return rules(() => withEngineComputationGuard(expansion => {
        check();
        if (expansion) {
          if (rootExpansions >= engineBudget.perOperationLimit) {
            engineBudget.limitReached = true; stopped = "node-limit"; throw new EngineLimit();
          }
          rootExpansions++; engineBudget.totalExpansions++;
          engineBudget.peakExpansions = Math.max(engineBudget.peakExpansions, rootExpansions);
        }
      }, operation)); }
      catch (error) {
        if (error instanceof SoftStop) { enumerationStopped = true; return undefined; }
        if (error instanceof EngineLimit) return undefined;
        throw error;
      }
    }, (index, action, legal) => {
      if (legal === undefined) { legality.unknown++; legality.complete = false; }
      else legality.checked++;
      if (legal) { legality.indices.push(index); root.edges!.push({ index, action, prior: 0, policyLogit: 0, visits: 0, sum: 0 }); }
    });
  } catch (error) {
    if (!(error instanceof SoftStop)) throw error;
    legality.complete = false;
  }
  const rootSign = mover(root.state);
  try {
    check(true);
    if (terminalValue(root.state) !== undefined) return recovery("terminal");
    if (!root.edges!.length) return recovery(legality.complete ? "no-legal-actions" : "no-completed-search");
    await evaluate(root, true);
    // Scan all immediate outcomes first; an early safety expansion must not hide a win.
    for (const edge of root.edges!) {
      try {
        const next = child(root, edge);
        const value = terminalValue(next.state);
        if (value === rootSign) safety.set(edge.index, "win");
        else if (value === -rootSign) safety.set(edge.index, "losing");
        else if (value !== undefined || next.state.sideToMove === root.state.sideToMove) safety.set(edge.index, "eligible");
      } catch (error) { if (!(error instanceof EngineLimit)) throw error; }
    }
    const wins = root.edges!.filter(edge => safety.get(edge.index) === "win");
    if (wins.length && !legality.complete) return modelFallback(wins, "legality-incomplete");
    if (wins.length) {
      for (const edge of wins) { edge.visits = 1; edge.sum = rootSign; proofs.set(edge.index, "proven-win"); }
      return ready(sample(wins, edge => Math.log(Math.max(edge.prior, Number.MIN_VALUE))), wins, "immediate-win");
    }
    // Incomplete reply enumeration never grants eligibility.
    for (const edge of [...root.edges!].sort((a, b) => b.prior - a.prior || a.index - b.index)) {
      if (safety.has(edge.index)) continue;
      try {
        const next = child(root, edge);
        let losing = false;
        for (const reply of edges(next)) {
          if (terminalValue(child(next, reply).state) === -rootSign) { losing = true; break; }
        }
        safety.set(edge.index, losing ? "losing" : "eligible");
        if (!legality.complete && !losing) break;
      } catch (error) { if (!(error instanceof EngineLimit)) throw error; }
    }
  } catch (error) { if (!(error instanceof SoftStop) && !(error instanceof EngineLimit)) throw error; }
  if (request.signal?.aborted) throw abort();
  if (root.value === undefined) return recovery("no-completed-search");
  const rootEdges = root.edges!;
  // A completed immediate win remains usable even if scanning other actions hit the budget.
  const knownWins = rootEdges.filter(edge => safety.get(edge.index) === "win");
  if (knownWins.length && !legality.complete) return modelFallback(knownWins, "legality-incomplete");
  if (knownWins.length) {
    for (const edge of knownWins) { edge.visits = 1; edge.sum = rootSign; proofs.set(edge.index, "proven-win"); }
    return ready(sample(knownWins, edge => Math.log(Math.max(edge.prior, Number.MIN_VALUE))), knownWins, "immediate-win");
  }
  let eligible = rootEdges.filter(edge => safety.get(edge.index) === "eligible");
  if (!legality.complete) {
    const notLosing = rootEdges.filter(edge => safety.get(edge.index) !== "losing");
    return modelFallback(eligible.length ? eligible : notLosing.length ? notLosing : rootEdges, "legality-incomplete");
  }
  if (!eligible.length) {
    if (rootEdges.every(edge => safety.get(edge.index) === "losing")) {
      const highest = Math.max(...rootEdges.map(edge => edge.prior));
      const preferred = rootEdges.filter(edge => edge.prior === highest);
      const chosen = preferred[Math.floor(random() * preferred.length)];
      chosen.visits = 1; chosen.sum = -rootSign;
      return ready(chosen, [chosen], "unavoidable-loss");
    }
    return modelFallback(rootEdges.filter(edge => safety.get(edge.index) !== "losing"), "safety-incomplete");
  }

  // Complete one model evaluation before optional tactical work. A deadline never
  // returns a partially evaluated leaf or manufactures visits from its prior.
  async function visit(edge: Edge) {
    const path: { node: Node; edge: Edge }[] = [{ node: root, edge }];
    let node = child(root, edge);
    while (node.value !== undefined && terminalValue(node.state) === undefined && edges(node).length) {
      check();
      const sign = mover(node.state);
      const options = edges(node);
      let best = -Infinity;
      let selected = options[0];
      for (const candidate of options) {
        const q = candidate.visits ? candidate.sum / candidate.visits : node.value!;
        const score = sign * q + config.search.cPuct * candidate.prior * Math.sqrt(Math.max(1, node.visits)) / (1 + candidate.visits);
        if (score > best || (score === best && candidate.index < selected.index)) { selected = candidate; best = score; }
      }
      path.push({ node, edge: selected });
      node = child(node, selected);
    }
    const value = await evaluate(node);
    check();
    node.visits++; node.sum += value;
    for (const item of path) { item.node.visits++; item.node.sum += value; item.edge.visits++; item.edge.sum += value; }
    completed++;
  }
  const limitedVisits = new Set<number>();
  for (const preferred of [...eligible].sort((a, b) => b.prior - a.prior || a.index - b.index)) {
    try { await visit(preferred); break; }
    catch (error) {
      if (error instanceof EngineLimit) { limitedVisits.add(preferred.index); continue; }
      if (error instanceof SoftStop) break;
      throw error;
    }
  }

  // Interval minimax proves only terminal-forced outcomes. Horizon and unfinished
  // work remain distinct. Reserve at least half the remaining nodes for PUCT.
  const tacticalCeiling = nodes + Math.floor((maxNodes - nodes) / 2);
  const tacticalRules = {
    terminal: (node: Node) => terminalValue(node.state),
    controller: (node: Node) => node.state.sideToMove,
    children: function* (node: Node): Generator<Node> {
      try {
        check();
        if (nodes >= tacticalCeiling) throw new TacticalInterrupted();
        for (const edge of edges(node)) {
          if (!edge.child && nodes >= tacticalCeiling) throw new TacticalInterrupted();
          yield child(node, edge);
        }
      } catch (error) {
        if (error instanceof SoftStop || error instanceof EngineLimit) throw new TacticalInterrupted();
        throw error;
      }
    },
  };
  for (const edge of eligible) {
    const result = proveTactical(edge.child!, config.search.tacticalDepth - 1, tacticalRules);
    const exact = result.lower === result.upper;
    proofs.set(edge.index, exact ? result.lower === rootSign ? "proven-win" : result.lower === -rootSign ? "proven-loss" : "proven-draw" : result.incomplete ? "incomplete" : "horizon");
  }
  const forced = eligible.filter(edge => proofs.get(edge.index) === "proven-win");
  if (forced.length) {
    for (const edge of forced) { edge.visits = Math.max(1, edge.visits); edge.sum = rootSign * edge.visits; }
    return ready(sample(forced, edge => Math.log(Math.max(edge.prior, Number.MIN_VALUE))), forced, "forced-win");
  }
  const notProvenLost = eligible.filter(edge => proofs.get(edge.index) !== "proven-loss");
  if (notProvenLost.length) eligible = notProvenLost;
  // Root-only effective priors never replace raw model scores used by tactics,
  // first visit, fallback, deeper PUCT or final choice. Draw once, before PUCT.
  const rootPriors = exploration?.requested ? await applyRootExploration(exploration,
    eligible.filter(edge => !!edge.child && !edge.child.enumerationLimited && !edge.transitionLimited && !limitedVisits.has(edge.index)),
    simulations - completed, completed > 0 && eligible.some(edge => edge.visits > 0),
    request.deadlineMs === undefined ? undefined : request.deadlineMs - reserveMs) : new Map<number, number>();
  try {
    while (completed < simulations) {
      check();
      const available = eligible.filter(edge => !limitedVisits.has(edge.index));
      if (!available.length) break;
      let best = -Infinity;
      let selected = available[0];
      for (const edge of available) {
        const q = edge.visits ? edge.sum / edge.visits : root.value;
        const score = rootSign * q + config.search.cPuct * (rootPriors.get(edge.index) ?? edge.prior) * Math.sqrt(Math.max(1, root.visits)) / (1 + edge.visits);
        if (score > best || (score === best && edge.index < selected.index)) { best = score; selected = edge; }
      }
      try { await visit(selected); }
      catch (error) { if (error instanceof EngineLimit) limitedVisits.add(selected.index); else throw error; }
    }
  } catch (error) { if (!(error instanceof SoftStop)) throw error; }
  if (request.signal?.aborted) throw abort();
  const visited = eligible.filter(edge => edge.visits > 0);
  if (!visited.length) return modelFallback(eligible, "search-incomplete");
  const bestValue = Math.max(...visited.map(edge => rootSign * edge.sum / edge.visits));
  const choices = visited.filter(edge => bestValue - rootSign * edge.sum / edge.visits <= valueGap);
  const chosen = sample(choices, edge => Math.log(edge.visits));
  return ready(chosen, visited, "search");
}
