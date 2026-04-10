import { applyAction, listLegalActions, resolveToStability, validateAction, } from "../../game-engine/src/index.js";
import { canonicalizeAction, canonicalizeState, compareCanonicalActionKeys } from "./canonical.js";
import { getBotPersona } from "./personas.js";
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;
function getOpponent(owner) {
    return owner === "P1" ? "P2" : "P1";
}
function pieceCount(state, owner) {
    return state.pieces.filter((piece) => piece.owner === owner).length;
}
function suppliedCount(state, owner) {
    return state.pieces.filter((piece) => piece.owner === owner && piece.supplied).length;
}
function commandedCount(state, owner) {
    return state.pieces.filter((piece) => piece.owner === owner && piece.commanded).length;
}
function commanderPiece(state, owner) {
    return state.pieces.find((piece) => piece.owner === owner && piece.kind === "commander");
}
function manhattanDistance(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}
function boardCenterDistance(position, boardSize) {
    const center = (boardSize - 1) / 2;
    return Math.abs(position.row - center) + Math.abs(position.col - center);
}
function actionTypeBonus(action, persona) {
    switch (action.type) {
        case "push":
            return persona.aggression * 4 + persona.conversion * 2;
        case "rush":
            return persona.aggression * 2 + persona.conversion * 1.5;
        case "project":
            return persona.defense * 1.6 + persona.conversion * 0.8;
        case "move":
            return persona.defense * 0.9 + persona.forgiveness * 0.3;
        case "pass":
            return persona.forgiveness * 0.7;
        case "follow":
            return persona.conversion * 1.8 + persona.aggression * 0.5;
        case "retreat":
            return persona.defense * 1.5 + persona.forgiveness * 0.5;
        default:
            return 0;
    }
}
function actionLocalBias(action, state, persona) {
    let bonus = actionTypeBonus(action, persona);
    if (action.type === "move" && action.to) {
        const ownCommander = commanderPiece(state, state.sideToMove);
        const enemyCommander = commanderPiece(state, getOpponent(state.sideToMove));
        if (ownCommander && enemyCommander) {
            const before = manhattanDistance(ownCommander.position, enemyCommander.position);
            const after = action.actorId === ownCommander.id ? manhattanDistance(action.to, enemyCommander.position) : before;
            const delta = before - after;
            bonus += delta * persona.aggression * 0.7;
            bonus += -delta * persona.defense * 0.4;
        }
    }
    return bonus;
}
function evaluateState(state, rootSide, persona) {
    if (state.outcome.status === "p1_win") {
        return rootSide === "P1" ? 100000 : -100000;
    }
    if (state.outcome.status === "p2_win") {
        return rootSide === "P2" ? 100000 : -100000;
    }
    if (state.outcome.status === "draw") {
        return 0;
    }
    const opponent = getOpponent(rootSide);
    const ownCommander = commanderPiece(state, rootSide);
    const enemyCommander = commanderPiece(state, opponent);
    const ownPieceDelta = pieceCount(state, rootSide) - pieceCount(state, opponent);
    const ownSupplyDelta = suppliedCount(state, rootSide) - suppliedCount(state, opponent);
    const ownCommandDelta = commandedCount(state, rootSide) - commandedCount(state, opponent);
    const ownCommanderSafety = ownCommander && enemyCommander ? manhattanDistance(ownCommander.position, enemyCommander.position) : 0;
    const ownCentering = ownCommander ? -boardCenterDistance(ownCommander.position, state.boardSize) : 0;
    const enemyCentering = enemyCommander ? boardCenterDistance(enemyCommander.position, state.boardSize) : 0;
    const mobility = listLegalActions(state).length;
    const commanderPresence = ownCommander ? 5 : -5;
    const enemyCommanderPresence = enemyCommander ? -5 : 5;
    const continuationPenalty = state.continuation ? -2 : 1;
    return (ownPieceDelta * 18 +
        ownSupplyDelta * 12 +
        ownCommandDelta * 6 +
        ownCommanderSafety * (persona.defense * 1.6 - persona.aggression * 0.8) +
        ownCentering * 1.1 +
        enemyCentering * 0.8 +
        mobility * (persona.forgiveness * 0.8 + 0.15) +
        commanderPresence +
        enemyCommanderPresence +
        continuationPenalty * (persona.conversion * 0.6 + 0.3));
}
function orderCandidates(state, persona, actions) {
    return [...actions].sort((left, right) => {
        const leftScore = actionLocalBias(left, state, persona);
        const rightScore = actionLocalBias(right, state, persona);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        return compareCanonicalActionKeys(left, right);
    });
}
function searchState(state, rootSide, persona, depth, branchFactor, explored) {
    explored.nodes += 1;
    if (depth <= 0 || state.outcome.status !== "ongoing") {
        explored.leaves += 1;
        return {
            score: evaluateState(state, rootSide, persona),
            pv: [],
            exploredNodes: 1,
            evaluatedLeaves: 1,
        };
    }
    const legalActions = orderCandidates(state, persona, listLegalActions(state)).slice(0, branchFactor);
    if (legalActions.length === 0) {
        explored.leaves += 1;
        return {
            score: evaluateState(state, rootSide, persona),
            pv: [],
            exploredNodes: 1,
            evaluatedLeaves: 1,
        };
    }
    const maximizing = state.sideToMove === rootSide;
    let bestScore = maximizing ? NEGATIVE_INFINITY : POSITIVE_INFINITY;
    let bestPV = [];
    let bestKey = "";
    for (const action of legalActions) {
        const applied = applyAction(state, action);
        const resolved = resolveToStability(applied.state, { artifactMode: "minimal" });
        const child = searchState(resolved, rootSide, persona, depth - 1, branchFactor, explored);
        const bias = maximizing ? actionLocalBias(action, state, persona) : 0;
        const score = child.score + bias;
        const actionKey = canonicalizeAction(action).key;
        const isBetter = maximizing ? score > bestScore : score < bestScore;
        const isTieBreak = score === bestScore &&
            (bestKey === "" ||
                (maximizing ? actionKey.localeCompare(bestKey) < 0 : actionKey.localeCompare(bestKey) > 0));
        if (isBetter || isTieBreak) {
            bestScore = score;
            bestKey = actionKey;
            bestPV = [actionKey, ...child.pv];
        }
    }
    return {
        score: bestScore,
        pv: bestPV,
        exploredNodes: explored.nodes,
        evaluatedLeaves: explored.leaves,
    };
}
function prepareLegalActions(state, legalActions) {
    const provided = legalActions ?? listLegalActions(state);
    const filtered = provided.filter((action) => validateAction(state, action).ok);
    const actionsForBot = state.continuation?.type === "rush"
        ? filtered
        : (() => {
            const nonPassActions = filtered.filter((action) => action.type !== "pass");
            return nonPassActions.length > 0 ? nonPassActions : filtered;
        })();
    const deduped = new Map();
    for (const action of actionsForBot) {
        deduped.set(canonicalizeAction(action).key, action);
    }
    return [...deduped.values()].sort(compareCanonicalActionKeys);
}
function buildTraceRoot(state, legalActionCount) {
    return {
        type: "root",
        state: canonicalizeState(state),
        legalActionCount,
    };
}
function buildCandidateTrace(action, score, depth, sequence) {
    return {
        type: "candidate",
        action: canonicalizeAction(action),
        score,
        depth,
        sequence,
    };
}
export function selectMove(request) {
    const persona = getBotPersona(request.personaId);
    const seed = request.seed ?? 0;
    const start = Date.now();
    const canonicalState = canonicalizeState(request.state);
    const legalActions = prepareLegalActions(request.state, request.legalActions);
    if (legalActions.length === 0) {
        throw new Error(`No legal actions available for ${persona.displayName}`);
    }
    const trace = request.trace ? [buildTraceRoot(request.state, legalActions.length)] : [];
    const explored = { nodes: 0, leaves: 0 };
    const rootSide = request.state.sideToMove;
    let selectedAction = legalActions[0];
    let selectedScore = NEGATIVE_INFINITY;
    let selectedIndex = 0;
    let selectedPV = [];
    const candidateSummaries = [];
    for (let index = 0; index < legalActions.length; index += 1) {
        const action = legalActions[index];
        const applied = applyAction(request.state, action);
        const resolved = resolveToStability(applied.state, { artifactMode: "minimal" });
        const child = searchState(resolved, rootSide, persona, persona.searchDepth - 1, persona.branchFactor, explored);
        const actionKey = canonicalizeAction(action).key;
        const noise = deterministicNoise(seed, actionKey) * persona.noiseScale;
        const score = child.score + actionLocalBias(action, request.state, persona) + noise;
        candidateSummaries.push({
            action: canonicalizeAction(action),
            score,
            depth: persona.searchDepth,
        });
        if (request.trace) {
            trace.push(buildCandidateTrace(action, score, persona.searchDepth, [actionKey, ...child.pv]));
            trace.push({
                type: "leaf",
                depth: persona.searchDepth - 1,
                score: child.score,
                state: canonicalizeState(resolved),
            });
        }
        if (score > selectedScore ||
            (score === selectedScore && actionKey < canonicalizeAction(selectedAction).key)) {
            selectedAction = action;
            selectedScore = score;
            selectedIndex = index;
            selectedPV = [actionKey, ...child.pv];
        }
    }
    const validation = validateAction(request.state, selectedAction);
    if (!validation.ok) {
        throw new Error(`Computer player selected illegal action: ${validation.code}`);
    }
    const elapsedMs = Date.now() - start;
    const diagnostics = {
        persona,
        seed,
        legalActionCount: legalActions.length,
        canonicalState,
        selectedAction: canonicalizeAction(selectedAction),
        selectedActionIndex: selectedIndex,
        selectedScore,
        principalVariation: selectedPV,
        searchDepth: persona.searchDepth,
        exploredNodes: explored.nodes,
        evaluatedLeaves: explored.leaves,
        searchTimeMs: elapsedMs,
        candidateSummaries,
        trace,
    };
    return {
        action: selectedAction,
        diagnostics,
    };
}
function deterministicNoise(seed, key) {
    let hash = (seed ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x85ebca6b) >>> 0;
        hash ^= hash >>> 13;
    }
    return ((hash >>> 0) % 1000000) / 1000000 - 0.5;
}
