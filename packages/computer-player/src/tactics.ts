export type TacticalStatus = "proven-win" | "proven-loss" | "proven-draw" | "horizon" | "incomplete";
export type TacticalBounds = { lower: number; upper: number; incomplete: boolean };
export class TacticalInterrupted extends Error {}

/** Terminal-only minimax. Values are always P1's; controllers may repeat. */
export function proveTactical<Node>(node: Node, depth: number, rules: {
  terminal: (node: Node) => number | undefined;
  controller: (node: Node) => "P1" | "P2";
  children: (node: Node) => Iterable<Node>;
  continuation?: (node: Node) => boolean;
}, settlementDepth = 0): TacticalBounds {
  const terminal = rules.terminal(node);
  if (terminal !== undefined) return { lower: terminal, upper: terminal, incomplete: false };
  if (depth === 0 && (settlementDepth === 0 || !rules.continuation?.(node))) {
    return { lower: -1, upper: 1, incomplete: false };
  }
  try {
    const maximize = rules.controller(node) === "P1";
    let lower = maximize ? -1 : 1;
    let upper = lower;
    let incomplete = false;
    let children = 0;
    for (const child of rules.children(node)) {
      children++;
      const result = proveTactical(child, Math.max(0, depth - 1), rules,
        depth === 0 ? settlementDepth - 1 : settlementDepth);
      lower = maximize ? Math.max(lower, result.lower) : Math.min(lower, result.lower);
      upper = maximize ? Math.max(upper, result.upper) : Math.min(upper, result.upper);
      incomplete ||= result.incomplete;
      if ((maximize && lower === 1) || (!maximize && upper === -1)) return { lower, upper, incomplete: false };
    }
    return children ? { lower, upper, incomplete } : { lower: -1, upper: 1, incomplete: true };
  } catch (error) {
    if (!(error instanceof TacticalInterrupted)) throw error;
    return { lower: -1, upper: 1, incomplete: true };
  }
}
