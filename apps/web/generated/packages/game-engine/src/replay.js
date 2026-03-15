import { applyAction } from "./apply.js";
import { normalizeState } from "./deterministic.js";
import { validateAction } from "./legal.js";
import { resolveToStability } from "./resolve.js";
export function replayActions(initial, actions, options) {
    const includeTrace = options?.includeTrace ?? true;
    const artifactMode = options?.artifactMode ?? "minimal";
    let current = resolveToStability(normalizeState(initial), {
        artifactMode,
    });
    const trace = includeTrace ? [normalizeState(current)] : undefined;
    for (let i = 0; i < actions.length; i += 1) {
        const action = actions[i];
        const validation = validateAction(current, action);
        if (!validation.ok) {
            return {
                finalState: current,
                outcome: current.outcome,
                trace,
                failure: {
                    index: i,
                    validation,
                },
            };
        }
        const result = applyAction(current, action);
        current = resolveToStability(normalizeState(result.state), {
            artifactMode,
        });
        if (trace) {
            trace.push(normalizeState(current));
        }
    }
    return {
        finalState: current,
        outcome: current.outcome,
        trace,
    };
}
