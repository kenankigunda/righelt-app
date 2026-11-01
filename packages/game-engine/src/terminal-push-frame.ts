import type { Action, GameState, Outcome, Piece } from './types';
import { deterministicStateHash } from './hash';

// A terminal view cannot turn the displaced defender into an ordinary occupant
// or a destruction. Keep the exact acknowledged frame and piece losslessly.
// This internal representation is not yet a serialized GameState/API contract.
export type TerminalPushFrame = {
  recorded: GameState;
  occupancy: GameState;
  displacement: { decisionId: string; frameHash: string; attackerId: string; action: Action; piece: Piece };
};
export type AcknowledgedPushFrame = { decisionId: string; action: Action; frameHash: string };

// The caller must supply an acknowledged record and a separately proved terminal
// outcome. This function establishes representation consistency, not legality or
// outcome proof. Missing provenance remains unknown; historical outcomes stay as
// recorded and are never normalized by this entry point.
export function terminalPushFrame(state: GameState, outcome: Outcome, push?: AcknowledgedPushFrame):
  { kind: 'normalized'; frame: TerminalPushFrame } | { kind: 'unknown' } {
  if (state.outcome.status !== 'ongoing' || outcome.status === 'ongoing' || !push?.decisionId ||
      push.action.type !== 'push' || !push.action.actorId || !push.action.from || !push.action.to ||
      push.frameHash !== deterministicStateHash(state)) return { kind: 'unknown' };
  const continuation=state.continuation;
  if (continuation?.type !== 'push' || continuation.phase !== 'retreat' || !continuation.pushedPieceId ||
      !continuation.followPoint || continuation.followPoint.row !== push.action.from.row ||
      continuation.followPoint.col !== push.action.from.col) return { kind: 'unknown' };
  const defender=state.pieces.find(piece=>piece.id===continuation.pushedPieceId);
  const attacker=state.pieces.find(piece=>piece.id===push.action.actorId);
  const atTarget=(piece:Piece)=>piece.position.row===push.action.to!.row&&piece.position.col===push.action.to!.col;
  if (!defender?.pushed || !attacker || attacker.pushed || defender.owner===attacker.owner ||
      continuation.owner!==defender.owner || continuation.attackerOwner!==attacker.owner ||
      !atTarget(defender) || !atTarget(attacker) ||
      (push.action.targetId && push.action.targetId!==defender.id) ||
      state.pieces.filter(piece=>piece.pushed).length!==1 ||
      state.pieces.filter(piece=>!piece.pushed&&atTarget(piece)).length!==1) return { kind:'unknown' };
  const recorded=structuredClone(state),occupancy=structuredClone(state);
  occupancy.pieces=occupancy.pieces.filter(piece=>piece.id!==defender.id);
  occupancy.continuation=null;
  occupancy.outcome=structuredClone(outcome);
  delete occupancy.artifacts; // No cached supply/command artifact may reference the displacement.
  const displacement={decisionId:push.decisionId,frameHash:push.frameHash,attackerId:attacker.id,action:structuredClone(push.action),piece:structuredClone(defender)};
  occupancy.terminalDisplacement=structuredClone(displacement);
  return {kind:'normalized',frame:{recorded,occupancy,displacement}};
}
