import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {automaticEndingCorpus} from '../packages/game-engine/test/helpers/automatic-ending-corpus.mjs';
import {proveRelevantContinuation} from '../packages/game-engine/src/early-ending-proof.ts';
import {createInitialGame,applyAcceptedAutomaticEnding} from '../packages/api-handler/src/shell-live-core.ts';
import {withEngineComputationObserver} from '../packages/game-engine/src/computation-guard.ts';

const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
const results=[];
for(const entry of automaticEndingCorpus()){
 const durations=[],accepted=[],work={};let cold;
 for(let i=0;i<31;i++){
  const started=performance.now();
  const result=withEngineComputationObserver(event=>{if(i===0)work[event.type]=(work[event.type]??0)+1;},()=>proveRelevantContinuation(entry.state,'P1',entry.options));
  const elapsed=performance.now()-started;if(i===0)cold=elapsed;else durations.push(elapsed);
  assert.equal(result.kind,entry.expected);if(entry.outcome)assert.equal(result.candidateOutcome.status,entry.outcome);
  // Measure the authoritative ending wrapper through record construction too.
  const game=createInitialGame({gameId:'benchmark',identityId:'benchmark-human',selfPlayMode:true});game.board.state=structuredClone(entry.state);
  game.turns=[{index:entry.state.turnIndex,startedAt:game.createdAt,endedAt:null,status:'active',playerSeat:'Player 1',moveIndexes:[],lastMoveAt:null}];
  const move={moveId:entry.options?.push?.decisionId??'benchmark-move',index:0,displayMoveNumber:1,turnIndex:entry.state.turnIndex,turnMoveIndex:0,actorSide:'P1',at:game.createdAt,notation:'RUSH',clientCommandId:'benchmark-only',action:entry.options?.push?.action??{type:'rush'},selectionSnapshot:structuredClone(entry.state),snapshot:structuredClone(entry.state),destroyedPieces:[]};game.moves=[move];game.turns[0].moveIndexes=[0];
  const began=performance.now();applyAcceptedAutomaticEnding(game,move.action,{move,destroyedPieces:[]},{clientCommandId:'benchmark-only',eventSeq:1,gameplayRevision:1,actorSide:'P1',turnOwnerSide:'P1',turnIndex:entry.state.turnIndex});accepted.push(performance.now()-began);
 }
 results.push({name:entry.name,coldMs:cold,proofMs:summarize(durations),endingWrapperMs:summarize(accepted),work});
}
await mkdir('test-results/automatic-endings',{recursive:true});
await writeFile('test-results/automatic-endings/performance.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,samplesPerPosition:30,results},null,2));
console.log(JSON.stringify(results,null,2));
assert.ok(results.every(row=>row.proofMs.p95<100&&row.endingWrapperMs.p95<100),'Ending calculations must meet the agreed 100 ms p95 on the fixed corpus');
