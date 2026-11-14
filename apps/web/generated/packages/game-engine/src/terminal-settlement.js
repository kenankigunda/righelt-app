import { resolveToStability } from './resolve.js';
import { checkEngineComputation, EngineComputationLimit } from './computation-guard.js';
import { deterministicStateHash } from './hash.js';
import { terminalPushFrame } from './terminal-push-frame.js';
import { canonicalTerminalDisplacement } from './terminal-displacement.js';
const record = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value) => typeof value === 'string' && value.length > 0;
const point = (value, size) => record(value)
    && Object.keys(value).length === 2 && Object.keys(value).every(key => key === 'row' || key === 'col')
    && Number.isInteger(value.row) && Number.isInteger(value.col)
    && Number(value.row) >= 0 && Number(value.row) < size && Number(value.col) >= 0 && Number(value.col) < size;
const same = (a, b) => a.row === b.row && a.col === b.col;
// The terminal-only validator cannot be called with an invented outcome. These
// are its structural metadata checks, plus the existing constructor's linkage
// checks, applied to the ongoing input before any hashing or recursive cloning.
function supportedPush(state, push) {
    if (!push || !text(push.decisionId) || typeof push.frameHash !== 'string' || !/^[0-9a-f]{64}$/.test(push.frameHash))
        return false;
    const action = push.action;
    if (!record(action) || Object.keys(action).some(key => !['type', 'actorId', 'from', 'to', 'targetId'].includes(key))
        || action.type !== 'push' || !text(action.actorId) || !point(action.from, state.boardSize) || !point(action.to, state.boardSize))
        return false;
    const continuation = state.continuation;
    if (continuation?.type !== 'push' || continuation.phase !== 'retreat' || !text(continuation.pushedPieceId)
        || !point(continuation.followPoint, state.boardSize) || !same(continuation.followPoint, action.from))
        return false;
    const defender = state.pieces.find(piece => piece.id === continuation.pushedPieceId);
    const attacker = state.pieces.find(piece => piece.id === action.actorId);
    if (!defender || !attacker || defender.pushed !== true || attacker.pushed || defender.owner === attacker.owner
        || continuation.owner !== defender.owner || continuation.attackerOwner !== attacker.owner
        || !same(defender.position, action.to) || !same(attacker.position, action.to)
        || (action.targetId !== undefined && action.targetId !== defender.id)
        || state.pieces.filter(piece => piece.pushed).length !== 1
        || state.pieces.filter(piece => !piece.pushed && same(piece.position, action.to)).length !== 1)
        return false;
    if (Object.keys(defender).some(key => !['id', 'owner', 'kind', 'position', 'supplied', 'commanded', 'displaySupplied', 'displayCommanded', 'pushed', 'shifted'].includes(key))
        || !['P1', 'P2'].includes(defender.owner) || !['unit', 'commander'].includes(defender.kind)
        || typeof defender.supplied !== 'boolean' || typeof defender.commanded !== 'boolean')
        return false;
    for (const key of ['displaySupplied', 'displayCommanded', 'shifted']) {
        if (defender[key] !== undefined && typeof defender[key] !== 'boolean')
            return false;
    }
    return true;
}
function supportedOccupants(state) {
    const ids = new Set(), squares = new Set();
    for (const piece of state.pieces) {
        if (!text(piece.id) || ids.has(piece.id) || !point(piece.position, state.boardSize))
            return false;
        ids.add(piece.id);
        if (!piece.pushed) {
            const square = `${piece.position.row},${piece.position.col}`;
            if (squares.has(square))
                return false;
            squares.add(square);
        }
    }
    return true;
}
/** Inactive, clone-only physical settlement. No actions or branch/finality proof. */
export function probeTerminalSettlement(state, push, options) {
    if (state.outcome.status !== 'ongoing' || state.terminalDisplacement !== undefined)
        return { kind: 'unknown', reason: 'unsupported' };
    try {
        checkEngineComputation();
        if (!supportedOccupants(state))
            return { kind: 'unknown', reason: 'unsupported' };
        const displaced = state.pieces.some(piece => piece.pushed)
            || (state.continuation?.type === 'push' && state.continuation.phase === 'retreat');
        if (displaced ? !supportedPush(state, push) : push !== undefined)
            return { kind: 'unknown', reason: 'unsupported' };
        if (displaced && push.frameHash !== deterministicStateHash(state))
            return { kind: 'unknown', reason: 'unsupported' };
        const probe = structuredClone(state);
        const defender = displaced ? state.pieces.find(piece => piece.id === state.continuation.pushedPieceId) : undefined;
        // Exclude the proved displacement before releasing protection. It is not a
        // destruction, an ordinary occupant, or a supply/command relay.
        if (defender)
            probe.pieces = probe.pieces.filter(piece => piece.id !== defender.id);
        probe.continuation = null;
        const removals = [];
        const resolved = resolveToStability(probe, {
            ...options,
            onRemoval: event => { removals.push(structuredClone(event)); },
        });
        checkEngineComputation();
        if (defender) {
            const attacker = resolved.pieces.filter(piece => piece.id === push.action.actorId);
            if (!supportedOccupants(resolved) || attacker.length !== 1 || attacker[0].pushed
                || !same(attacker[0].position, push.action.to) || resolved.pieces.some(piece => piece.id === defender.id || piece.pushed)
                || resolved.pieces.filter(piece => same(piece.position, defender.position)).length !== 1)
                return { kind: 'unknown', reason: 'unsupported' };
            if (resolved.outcome.status !== 'ongoing') {
                const normalized = terminalPushFrame(state, resolved.outcome, push);
                if (normalized.kind !== 'normalized')
                    return { kind: 'unknown', reason: 'unsupported' };
                // Use the actual RESOLVED occupancy, not the constructor's earlier one.
                const occupancy = structuredClone(resolved);
                occupancy.terminalDisplacement = structuredClone(normalized.frame.displacement);
                canonicalTerminalDisplacement(occupancy);
                return { kind: 'settled', persistable: true,
                    frame: { recorded: normalized.frame.recorded, occupancy, displacement: normalized.frame.displacement },
                    removals: structuredClone(removals) };
            }
            // Ongoing evidence is deliberately not a persisted terminal GameState.
            const displacement = {
                decisionId: push.decisionId, frameHash: push.frameHash, attackerId: push.action.actorId,
                action: { ...push.action, from: structuredClone(push.action.from), to: structuredClone(push.action.to) },
                piece: structuredClone(defender),
            };
            return { kind: 'settled', persistable: false,
                frame: { recorded: structuredClone(state), occupancy: structuredClone(resolved), displacement },
                removals: structuredClone(removals) };
        }
        return { kind: 'settled', persistable: resolved.outcome.status !== 'ongoing',
            frame: { recorded: structuredClone(state), occupancy: structuredClone(resolved) }, removals: structuredClone(removals) };
    }
    catch (error) {
        if (error instanceof EngineComputationLimit)
            return { kind: 'unknown', reason: error.code };
        throw error;
    }
}
