import { equivalentGameStates } from '../generated/packages/game-engine/src/index.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { buildPieceMoveResponse } from './client-move-generation.js';

// A separate worker from model inference. Results are always complete.
self.onmessage = ({ data: { id, scope, type, input } }) => {
  try {
    const result = type === 'project' ? projectOptimisticGame(input)
      : type === 'previews' ? buildPieceMoveResponse(input)
        : type === 'equivalent' ? equivalentGameStates(input.left, input.right)
        : (() => { throw new Error('unknown_rules_operation'); })();
    self.postMessage({ id, scope, type, result });
  } catch (error) {
    self.postMessage({ id, scope, type, error: { message: error.message, code: error.code } });
  }
};
