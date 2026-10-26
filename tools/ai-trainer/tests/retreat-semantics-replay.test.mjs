import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deterministicStateHash, LEGACY_RETREAT_SEMANTICS, CURRENT_RETREAT_SEMANTICS} from '../../../packages/game-engine/src/index.ts';
import {legalActionMap, encodeState} from '../../../packages/computer-player/src/index.ts';
import {replayDecision} from '../decision-replay.mjs';
import {transitionArchivedAction} from '../archived-action.mjs';
const fixture=JSON.parse(readFileSync(new URL('../../../packages/game-engine/test/fixtures/completion-preserving-retreat.json',import.meta.url),'utf8'));
const bounded=operation=>operation();
// Original worker record/mask is captured independently of this candidate's legal map.
const record=()=>({...structuredClone(fixture.originalRetreatRecord),legal:[...fixture.originalRetreatRecord.legality.indices]});

test('unversioned and explicit geometric archives replay raw retreat and complete historical mask exactly',()=>{
 for(const version of [undefined,LEGACY_RETREAT_SEMANTICS]) {
  const row=record();assert.deepEqual(row.legal,[1144,1146]);if(version!==undefined)row.retreatSemantics=version;
  const original=structuredClone(row);
  assert.equal(deterministicStateHash(replayDecision(fixture.states.afterPush,row,bounded)),fixture.retreat.afterHash);
  assert.deepEqual(row,original);
 }
});

test('current retreat records reject old masks and old actions without weakening after-hash checks',()=>{
 const row={...record(),retreatSemantics:CURRENT_RETREAT_SEMANTICS};
 assert.throws(()=>replayDecision(fixture.states.afterPush,row,bounded),/legal mask mismatch/);
 delete row.legal;
 assert.throws(()=>replayDecision(fixture.states.afterPush,row,bounded));
 const old={...record(),afterHash:'0'.repeat(64)};
 assert.throws(()=>replayDecision(fixture.states.afterPush,old,bounded),/after-state mismatch/);
 assert.throws(()=>replayDecision(fixture.states.afterPush,{...record(),controller:'P2'},bounded),/controller mismatch/);
 assert.throws(()=>replayDecision(fixture.states.afterPush,{...record(),encoded:[]},bounded),/encoding mismatch/);
});

test('archive warmup interpreter rejects unknown versions and keeps retained hashes',()=>{
 assert.equal(deterministicStateHash(transitionArchivedAction(fixture.states.afterPush,fixture.retreat.action,bounded)),fixture.retreat.afterHash);
 for(const version of [null,'future-retreat-v9'])assert.throws(()=>transitionArchivedAction(fixture.states.afterPush,fixture.retreat.action,bounded,version),/Unknown archived retreat semantics/);
});


test('partial historical masks verify selected unsafe retreat only under explicit archived semantics',()=>{
 const row=record();
 Object.assign(row,{legal:[fixture.retreat.index],policy:[],policyMask:false,
  legality:{complete:false,indices:[fixture.retreat.index],checked:1,unknown:1},
  fallback:{schemaVersion:2,reason:'legality-incomplete',selectionBasis:'model-policy',valueSource:'root-model',selectedActionSafety:'eligible',checkedEligibleCount:1,uncheckedCount:1,provenLosingCount:0}});
 assert.equal(deterministicStateHash(replayDecision(fixture.states.afterPush,row,bounded)),fixture.retreat.afterHash);
 assert.throws(()=>replayDecision(fixture.states.afterPush,{...row,retreatSemantics:CURRENT_RETREAT_SEMANTICS},bounded),/Illegal action in recorded subset/);
});

test('real worker interprets unsafe historical warmup before rejecting its truthful unfinished game',async()=>{
 const {execFile}=await import('node:child_process');
 const run=(game,command='replay')=>new Promise(resolve=>{
  const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},(error,stdout)=>resolve({error,output:JSON.parse(stdout.trim())}));
  child.stdin.end(JSON.stringify({command,game,...(command==='inventory'?{indices:[0]}:{}),budgetMs:8000})+'\n');
 });
 const game={rootState:fixture.states.afterPush,warmupActions:[fixture.retreat.action],initialState:fixture.states.afterRetreat,decisions:[],finalHash:fixture.retreat.afterHash,outcome:{status:'ongoing'},termination:'truncated',truncationReason:'no-legal-actions'};
 // A deadlocked partial record must not be promoted into a valid completed game.
 // Reaching the existing truncation guard proves exact warmup replay first.
 const old=await run(game);assert.ok(old.error);assert.match(old.output.message,/Unjustified truncation/);
 const current=await run({...game,retreatSemantics:CURRENT_RETREAT_SEMANTICS});assert.ok(current.error);assert.match(current.output.message,/Cannot apply invalid action/);
 const unknown=await run({...game,retreatSemantics:'unknown'});assert.ok(unknown.error);assert.match(unknown.output.message,/Unknown archived retreat semantics/);
 const inventory={...game,partition:'train',decisions:[{action:{type:'pass'},controller:'P2',beforeHash:fixture.retreat.afterHash,afterHash:fixture.retreat.afterHash}]};
 const retainedInventory=await run(inventory,'inventory');assert.ok(retainedInventory.error);assert.match(retainedInventory.output.message,/CONTINUATION_REQUIRED/);
 assert.equal(retainedInventory.output.states,undefined,'invalid continuation supplies no adopted start');
 const newInventory=await run({...inventory,retreatSemantics:CURRENT_RETREAT_SEMANTICS},'inventory');assert.ok(newInventory.error);assert.match(newInventory.output.message,/Cannot apply invalid action/);
});
