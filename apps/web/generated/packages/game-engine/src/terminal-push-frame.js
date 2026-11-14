import { deterministicStateHash } from './hash.js';
import { canonicalTerminalDisplacement } from './terminal-displacement.js';
// The caller must supply an acknowledged record and a separately proved terminal
// outcome. This function establishes representation consistency, not legality or
// outcome proof. Missing provenance remains unknown; historical outcomes stay as
// recorded and are never normalized by this entry point.
export function terminalPushFrame(state, outcome, push) {
    if (state.outcome.status !== 'ongoing' || outcome.status === 'ongoing' || !push?.decisionId ||
        push.action.type !== 'push' || !push.action.actorId || !push.action.from || !push.action.to ||
        !push.frameHash)
        return { kind: 'unknown' };
    const continuation = state.continuation;
    if (continuation?.type !== 'push' || continuation.phase !== 'retreat' || !continuation.pushedPieceId ||
        !continuation.followPoint || continuation.followPoint.row !== push.action.from.row ||
        continuation.followPoint.col !== push.action.from.col)
        return { kind: 'unknown' };
    const defender = state.pieces.find(piece => piece.id === continuation.pushedPieceId);
    const attacker = state.pieces.find(piece => piece.id === push.action.actorId);
    const atTarget = (piece) => piece.position.row === push.action.to.row && piece.position.col === push.action.to.col;
    if (!defender?.pushed || !attacker || attacker.pushed || defender.owner === attacker.owner ||
        continuation.owner !== defender.owner || continuation.attackerOwner !== attacker.owner ||
        !atTarget(defender) || !atTarget(attacker) ||
        (push.action.targetId && push.action.targetId !== defender.id) ||
        state.pieces.filter(piece => piece.pushed).length !== 1 ||
        state.pieces.filter(piece => !piece.pushed && atTarget(piece)).length !== 1)
        return { kind: 'unknown' };
    const pieces = state.pieces.filter(piece => piece.id !== defender.id);
    let canonical;
    try {
        // Validate raw provenance before hashing or cloning recursive/extra metadata.
        // The strict serialized contract remains the single representation authority.
        canonical = canonicalTerminalDisplacement({ ...state, pieces, continuation: null, outcome,
            terminalDisplacement: { decisionId: push.decisionId, frameHash: push.frameHash, attackerId: attacker.id, action: push.action, piece: defender } });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'Invalid terminal displacement')
            return { kind: 'unknown' };
        throw error;
    }
    if (!canonical || push.frameHash !== deterministicStateHash(state))
        return { kind: 'unknown' };
    const recorded = structuredClone(state), occupancy = structuredClone(state);
    occupancy.pieces = occupancy.pieces.filter(piece => piece.id !== defender.id);
    occupancy.continuation = null;
    occupancy.outcome = structuredClone(outcome);
    delete occupancy.artifacts; // No cached supply/command artifact may reference the displacement.
    // Cloning an entire graph preserves aliases. Split mutable provenance fields
    // so action endpoints and the defender position stay independently editable.
    const displacement = { ...canonical, action: { ...canonical.action, from: structuredClone(canonical.action.from), to: structuredClone(canonical.action.to) }, piece: structuredClone(canonical.piece) };
    occupancy.terminalDisplacement = structuredClone(displacement);
    return { kind: 'normalized', frame: { recorded, occupancy, displacement } };
}
