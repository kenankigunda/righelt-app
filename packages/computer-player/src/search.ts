import type { Action, GameState } from "../../shared-types/src/engine";
import { encodeState, experimentConfig as config, legalActionMap } from "./representation";
import { terminalValue, transition } from "./transition";
import { proveTactical, TacticalInterrupted, type TacticalStatus } from "./tactics";
export type { TacticalStatus } from "./tactics";

export type Evaluation = { policyLogits: ArrayLike<number>; value: number };
export type Evaluator = (input: Float32Array, context: {
  state: GameState; legalActions: Map<number, Action>; signal?: AbortSignal;
}) => Promise<Evaluation>;
export type SearchRequest = {
  state: GameState; seed: number; simulations?: number; temperature?: number;
  maxValueGap?: number; maxNodes?: number; deadlineMs?: number; signal?: AbortSignal;
};
export type ActionReport = {
  index: number; visits: number; prior: number; value: number | null;
  immediate: "win" | "eligible" | "losing" | "incomplete";
  tactical: TacticalStatus;
};
export type SearchResult = {
  status: "ready"; action: Action; actionIndex: number; value: number;
  policy: { index: number; probability: number }[];
  actions: ActionReport[]; seed: number; nodes: number; simulations: number;
  elapsedMs: number; stopped: "complete" | "deadline" | "node-limit";
  reason: "immediate-win" | "forced-win" | "search" | "unavoidable-loss";
} | {
  status: "recovery"; reason: "terminal" | "no-legal-actions" | "incomplete-safety" | "no-completed-search";
  actions: ActionReport[]; nodes: number; simulations: number; elapsedMs: number;
  stopped: "complete" | "deadline" | "node-limit";
};

type Edge = { index: number; action: Action; prior: number; visits: number; sum: number; child?: Node };
type Node = { state: GameState; edges?: Edge[]; value?: number; visits: number; sum: number };
class SoftStop extends Error {}
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
  const random = seededRandom(request.seed);
  const simulations = request.simulations ?? config.search.selfPlaySimulations;
  const maxNodes = request.maxNodes ?? config.search.maxNodes;
  const temperature = request.temperature ?? 0;
  const valueGap = request.maxValueGap ?? 0;
  if (!Number.isSafeInteger(request.seed) || !Number.isSafeInteger(simulations) || simulations < 1 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > config.search.maxNodes ||
      !Number.isFinite(temperature) || temperature < 0 || !Number.isFinite(valueGap) || valueGap < 0 ||
      (request.deadlineMs !== undefined && !Number.isFinite(request.deadlineMs))) throw new Error("Invalid search limits");
  let nodes = 1;
  let completed = 0;
  let stopped: "complete" | "deadline" | "node-limit" = "complete";
  const root: Node = { state: request.state, visits: 0, sum: 0 };
  const safety = new Map<number, ActionReport["immediate"]>();
  const proofs = new Map<number, TacticalStatus>();
  const check = () => {
    if (request.signal?.aborted) throw abort();
    if (request.deadlineMs !== undefined && performance.now() >= request.deadlineMs) {
      stopped = "deadline"; throw new SoftStop();
    }
  };
  const edges = (node: Node) => {
    check();
    if (!node.edges) node.edges = [...legalActionMap(node.state)].map(([index, action]) => ({ index, action, prior: 0, visits: 0, sum: 0 }));
    check();
    return node.edges;
  };
  const child = (node: Node, edge: Edge) => {
    check();
    if (!edge.child) {
      if (nodes >= maxNodes) { stopped = "node-limit"; throw new SoftStop(); }
      edge.child = { state: transition(node.state, edge.action), visits: 0, sum: 0 };
      nodes += 1;
    }
    check();
    return edge.child;
  };
  const evaluate = async (node: Node): Promise<number> => {
    check();
    const terminal = terminalValue(node.state);
    if (terminal !== undefined) { node.value = terminal; return terminal; }
    if (node.value !== undefined) return node.value;
    const available = edges(node);
    const evaluation = await evaluator(encodeState(node.state), {
      state: node.state, legalActions: new Map(available.map(edge => [edge.index, edge.action])), signal: request.signal,
    });
    check();
    if (!Number.isFinite(evaluation.value) || Math.abs(evaluation.value) > 1 || evaluation.policyLogits.length !== config.actionCount) {
      throw new Error("Invalid model output");
    }
    // Reject corrupt output even in currently masked channels.
    for (let i = 0; i < config.actionCount; i++) if (!Number.isFinite(evaluation.policyLogits[i])) throw new Error("Non-finite policy logit");
    const max = Math.max(...available.map(edge => evaluation.policyLogits[edge.index]));
    let total = 0;
    for (const edge of available) { edge.prior = Math.exp(evaluation.policyLogits[edge.index] - max); total += edge.prior; }
    for (const edge of available) edge.prior /= total;
    node.value = evaluation.value;
    return evaluation.value;
  };
  function reports(): ActionReport[] {
    return (root.edges ?? []).map(edge => ({
      index: edge.index, visits: edge.visits, prior: edge.prior,
      value: edge.visits ? edge.sum / edge.visits : null,
      immediate: safety.get(edge.index) ?? "incomplete", tactical: proofs.get(edge.index) ?? "incomplete",
    }));
  }
  const recovery = (reason: Extract<SearchResult, { status: "recovery" }>["reason"]): SearchResult => ({
    status: "recovery", reason, actions: reports(), nodes, simulations: completed, elapsedMs: performance.now() - started, stopped,
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
  const ready = (chosen: Edge, candidates: Edge[], reason: Extract<SearchResult, { status: "ready" }>["reason"]): SearchResult => {
    const total = candidates.reduce((sum, edge) => sum + edge.visits, 0);
    return {
      status: "ready", action: chosen.action, actionIndex: chosen.index,
      value: chosen.visits ? chosen.sum / chosen.visits : root.value!,
      policy: candidates.map(edge => ({ index: edge.index, probability: total ? edge.visits / total : Number(edge === chosen) })),
      actions: reports(), seed: request.seed, nodes, simulations: completed,
      elapsedMs: performance.now() - started, stopped, reason,
    };
  };
  const rootSign = mover(root.state);
  try {
    check();
    if (terminalValue(root.state) !== undefined) return recovery("terminal");
    if (!edges(root).length) return recovery("no-legal-actions");
    await evaluate(root);
    // Scan all immediate outcomes first; an early safety expansion must not hide a win.
    for (const edge of root.edges!) {
      const next = child(root, edge);
      const value = terminalValue(next.state);
      if (value === rootSign) safety.set(edge.index, "win");
      else if (value === -rootSign) safety.set(edge.index, "losing");
      else if (value !== undefined || next.state.sideToMove === root.state.sideToMove) safety.set(edge.index, "eligible");
    }
    const wins = root.edges!.filter(edge => safety.get(edge.index) === "win");
    if (wins.length) {
      for (const edge of wins) { edge.visits = 1; edge.sum = rootSign; proofs.set(edge.index, "proven-win"); }
      return ready(sample(wins, edge => Math.log(Math.max(edge.prior, Number.MIN_VALUE))), wins, "immediate-win");
    }
    // Incomplete reply enumeration never grants eligibility.
    for (const edge of [...root.edges!].sort((a, b) => b.prior - a.prior || a.index - b.index)) {
      if (safety.has(edge.index)) continue;
      const next = child(root, edge);
      let losing = false;
      for (const reply of edges(next)) {
        if (terminalValue(child(next, reply).state) === -rootSign) { losing = true; break; }
      }
      safety.set(edge.index, losing ? "losing" : "eligible");
    }
  } catch (error) { if (!(error instanceof SoftStop)) throw error; }
  if (request.signal?.aborted) throw abort();
  if (root.value === undefined) return recovery("no-completed-search");
  const rootEdges = root.edges!;
  // A completed immediate win remains usable even if scanning other actions hit the budget.
  const knownWins = rootEdges.filter(edge => safety.get(edge.index) === "win");
  if (knownWins.length) {
    for (const edge of knownWins) { edge.visits = 1; edge.sum = rootSign; proofs.set(edge.index, "proven-win"); }
    return ready(sample(knownWins, edge => Math.log(Math.max(edge.prior, Number.MIN_VALUE))), knownWins, "immediate-win");
  }
  let eligible = rootEdges.filter(edge => safety.get(edge.index) === "eligible");
  if (!eligible.length) {
    if (rootEdges.every(edge => safety.get(edge.index) === "losing")) {
      const highest = Math.max(...rootEdges.map(edge => edge.prior));
      const preferred = rootEdges.filter(edge => edge.prior === highest);
      const chosen = preferred[Math.floor(random() * preferred.length)];
      chosen.visits = 1; chosen.sum = -rootSign;
      return ready(chosen, [chosen], "unavoidable-loss");
    }
    return recovery("incomplete-safety");
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
  try {
    const preferred = [...eligible].sort((a, b) => b.prior - a.prior || a.index - b.index)[0];
    await visit(preferred);
  } catch (error) { if (!(error instanceof SoftStop)) throw error; }

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
        if (error instanceof SoftStop) throw new TacticalInterrupted();
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
  try {
    while (completed < simulations) {
      check();
      let best = -Infinity;
      let selected = eligible[0];
      for (const edge of eligible) {
        const q = edge.visits ? edge.sum / edge.visits : root.value;
        const score = rootSign * q + config.search.cPuct * edge.prior * Math.sqrt(Math.max(1, root.visits)) / (1 + edge.visits);
        if (score > best || (score === best && edge.index < selected.index)) { best = score; selected = edge; }
      }
      await visit(selected);
    }
  } catch (error) { if (!(error instanceof SoftStop)) throw error; }
  if (request.signal?.aborted) throw abort();
  const visited = eligible.filter(edge => edge.visits > 0);
  if (!visited.length) return recovery("no-completed-search");
  const bestValue = Math.max(...visited.map(edge => rootSign * edge.sum / edge.visits));
  const choices = visited.filter(edge => bestValue - rootSign * edge.sum / edge.visits <= valueGap);
  const chosen = sample(choices, edge => Math.log(edge.visits));
  return ready(chosen, visited, "search");
}
