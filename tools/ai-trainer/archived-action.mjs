import {archivedRetreatSemantics} from '../../packages/shared-types/src/retreat-rules.ts';
import {encodeAction,transition,TURN_CONTROL_POLICY_INDEX} from '../../packages/computer-player/src/index.ts';

// Replay only: old rush sequences closed with a bare Pass in policy slot 2800.
// Current rules still decide whether End Turn is legal. The caller must verify
// the exact recorded after-state (or the warmup's exact initial-state hash).
// Never rewrite the stored action or use this adapter for live submissions.
export function transitionArchivedAction(state,action,bounded,retreatSemantics) {
  const rules={retreatSemantics:archivedRetreatSemantics(retreatSemantics)};
  const legacy=action?.type==='pass' && state.continuation?.type==='rush' && Object.keys(action).length===1;
  const replayAction=legacy?{type:'end_turn'}:action;
  if(legacy && (encodeAction(action)!==TURN_CONTROL_POLICY_INDEX || encodeAction(replayAction)!==TURN_CONTROL_POLICY_INDEX))throw Error('Archived turn-control encoding mismatch');
  return bounded(()=>transition(state,replayAction,rules));
}
