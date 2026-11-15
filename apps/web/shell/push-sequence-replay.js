import {BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';
import {recordedMoveNumber,visibleRecordedMoves} from './recorded-narration.js';
import { normalizeActivitySide } from './activity-affiliation.js';
import {listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {canonicalCommandJson} from '../generated/packages/shared-types/src/sync-protocol.js';
import {immediateRemovalRecords,moveInspectionSnapshot,settlementRemovalRecords,withCausalDestructionPresentation} from './destruction-presentation.js';

const isHumanSide = (game, side, turn, identityId) => {
  if (!side) return false;
  const seat = side === 'P1' ? 'player1' : 'player2';
  const owns = identityId ? game[seat]?.identityId === identityId : (game.myRoles ?? [game.myRole]).includes(side === 'P1' ? 'Player 1' : 'Player 2');
  const computer = game.computer;
  return owns && !(computer && !computer.manual && computer.takeoverTurn !== turn && computer.seats?.[side === 'P1' ? 'p1' : 'p2']);
};

export function latestLocalPushSequence(game, identityId) {
  const moves = visibleRecordedMoves(game?.moves??[]);
  for (let start = moves.length - 1; start >= 0; start--) {
    const push = moves[start];
    if (push.action?.type !== 'push' || !isHumanSide(game, normalizeActivitySide(push.actorSide), push.turnIndex, identityId)) continue;
    const sequence = [push];
    for (const move of moves.slice(start + 1)) {
      if (move.turnIndex !== push.turnIndex || !['retreat', 'follow'].includes(move.action?.type)) break;
      sequence.push(move);
    }
    if (!push.moveId || !sequence.at(-1)?.moveId || sequence.at(-1)?.action.type !== 'follow') return null;
    if (moves.slice(start + sequence.length).some(move => isHumanSide(game, normalizeActivitySide(move.actorSide), move.turnIndex, identityId))) return null;
    const follows=sequence.filter(move=>move.action?.type==='follow');
    const automatic=follows.length>0&&follows.every(isAutomaticFollowMove);
    return { startId: push.moveId, endId: sequence.at(-1).moveId, moves: sequence, automatic };
  }
  return null;
}

export function isAutomaticFollowMove(move) {
  if(move?.action?.type!=='follow'||!move.selectionSnapshot)return false;
  try {
    const legal=listLegalActions(move.selectionSnapshot);
    return legal.length===1&&canonicalCommandJson(legal[0])===canonicalCommandJson(move.action);
  } catch { return false; }
}

export function buildPushSequenceReplay({ moves, startId, endId, gameId, revision, lineageHead }) {
  const active = visibleRecordedMoves(moves??[]);
  const start = active.findIndex(move => move.moveId === startId), end = active.findIndex(move => move.moveId === endId);
  if (start < 0 || end <= start) return null;
  const sequence = active.slice(start, end + 1), push = sequence[0];
  if (push.action?.type !== 'push' || sequence.at(-1).action?.type !== 'follow'
    || sequence.slice(1).some((move, index) => !['retreat', 'follow'].includes(move.action?.type) || move.action.type === 'retreat' && index !== 0 || move.turnIndex !== push.turnIndex)
    || sequence.some((move, index) => !move.moveId || !move.selectionSnapshot || !move.snapshot || move.turnMoveIndex !== push.turnMoveIndex + index)) return null;
  const presented=withCausalDestructionPresentation(sequence);
  return structuredClone({ gameId, revision, lineageHead, frames: sequence.map((move,index) => ({ decisionId: move.moveId,
    action: move.action,before:move.selectionSnapshot,after:moveInspectionSnapshot(move),destroyedPieces:immediateRemovalRecords(move),
    ...(move.inspectionSnapshot&&move.snapshot?{settledAfter:move.snapshot,settlementDestroyedPieces:settlementRemovalRecords(move)}:{}),
    moveNumber:recordedMoveNumber(move),recordedMove:presented[index] })) });
}

export function withPushSequenceMessage(message, game, selection, identityId) {
  if (!game || game.inHistoryMode || selection.selectedPieceId || selection.inspection || (message?.action?.id === 'replay-computer'||message?.context?.action?.id==='replay-computer')) return message;
  const completed=latestLocalPushSequence(game,identityId);
  if (!completed) return message;
  const sequence = { purpose:BOARD_CONTEXT_PURPOSE.SEQUENCE, actorSide:normalizeActivitySide(completed.moves[0].actorSide), text: completed.automatic?'Your push group automatically followed':'Your push group followed', action: { id: 'replay-push-sequence', label: 'Show me again' } };
  const pass = game.legalActions?.some(action => action.type === 'pass');
  const end = game.legalActions?.some(action => action.type === 'end_turn');
  const prompt = message ? typeof message === 'string' ? { text: message } : message : {
    text: game.board?.state?.continuation ? end ? 'Select a move or' : 'Select a move' : pass ? 'Select a piece or' : 'Select a piece',
    actions: end ? [{ id: 'end-turn', label: 'End turn' }] : pass ? [{ id: 'pass', label: 'Pass' }] : [],
  };
  return { ...prompt, context: sequence };
}
