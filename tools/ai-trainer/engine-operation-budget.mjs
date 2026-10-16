import { withEngineComputationGuard, MAX_ENGINE_OPERATION_EXPANSIONS } from '../../packages/game-engine/src/index.ts';

// Verification traverses the complete authoritative legal list. Its allowance
// is separate from the unchanged 2,048-node move-selection tree ceiling.
// Both paths retain the caller's deadline and external process watchdog.
export const REPLAY_MAX_EXPANSIONS = MAX_ENGINE_OPERATION_EXPANSIONS;
export const GENERATION_MAX_EXPANSIONS = MAX_ENGINE_OPERATION_EXPANSIONS;
export class EngineExpansionLimit extends Error {}

export function createEngineOperationBudget(command, searchLimit, check) {
  const stats={perOperationLimit:command==='replay' ? REPLAY_MAX_EXPANSIONS : GENERATION_MAX_EXPANSIONS,searchNodesLimit:searchLimit,peakExpansions:0,operations:0,maxObservedHeapUsedBytes:0};
  const bounded=operation=>{
    let expansions=0;stats.operations++;
    try {return withEngineComputationGuard(expansion=>{
      check();
      if(expansion){
        if(expansions>=stats.perOperationLimit)throw new EngineExpansionLimit('node-limit');
        expansions++;stats.peakExpansions=Math.max(stats.peakExpansions,expansions);
      }
    },operation);} finally {stats.maxObservedHeapUsedBytes=Math.max(stats.maxObservedHeapUsedBytes,process.memoryUsage().heapUsed);}
  };
  return {bounded,stats};
}
