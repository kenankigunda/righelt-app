import {teachingDecision}from '../training-teaching.mjs';
import {readFileSync}from 'node:fs';
import {createHash}from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deterministicStateHash,listLegalActions} from '../../../packages/game-engine/src/index.ts';
import {transition,encodeState} from '../../../packages/computer-player/src/index.ts';
import {commanderOutcome} from '../../../packages/shared-types/src/commander-outcome.js';
import {commander,unit,makeState} from '../../../packages/game-engine/test/helpers/state-builders.mjs';
import {replayDecision,legacyCommanderReplayState} from '../decision-replay.mjs';
import {execFile} from 'node:child_process';

const oldReason = status => status==='draw'?'both_commanders_unsupplied':status==='p1_win'?'p2_commander_unsupplied':'p1_commander_unsupplied';
const retainedTerminal = state => ({...structuredClone(state),outcome:{...state.outcome,reason:oldReason(state.outcome.status)}});
function destroyedCommanderGame(){
 const initial=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',4,2),unit('A1','P1',4,1),unit('A2','P1',3,1),unit('B1','P1',3,2),unit('B2','P2',5,2),unit('B3','P1',4,3)]});
 let state=initial;const decisions=[];
 const append=action=>{
  const next=transition(state,action),retained=next.outcome.status==='ongoing'?next:retainedTerminal(next);
  decisions.push({id:`retained:${decisions.length}`,controller:state.sideToMove,action,beforeHash:deterministicStateHash(state),afterHash:deterministicStateHash(retained)});
  state=next;
 };
 append({type:'push',actorId:'A1',from:{row:4,col:1},to:{row:4,col:2}});
 for(let count=0;state.continuation&&count<8;count++){
  const legal=listLegalActions(state),action=legal.find(a=>a.type==='follow')??legal.find(a=>a.type==='end_turn'||a.type==='pass');
  assert(action);append(action);
 }
 assert.deepEqual(state.outcome,{status:'p1_win',reason:'p2_commander_destroyed'});
 return{initial,decisions,canonical:state,retained:retainedTerminal(state)};
}

test('a retained real push and follow chain replays its original terminal hash without changing records',()=>{
 const game=destroyedCommanderGame(),before=structuredClone(game);let state=game.initial;
 assert.notEqual(deterministicStateHash(game.canonical),deterministicStateHash(game.retained));
 for(const record of game.decisions)state=replayDecision(state,record,work=>work());
 assert.equal(deterministicStateHash(state),game.decisions.at(-1).afterHash);
 assert.deepEqual(state,game.retained);assert.deepEqual(game,before);
});

for(const [name,pieces] of [
 ['P2 destroyed',[commander('C1','P1',3,6)]],
 ['P1 destroyed',[commander('C2','P2',6,3)]],
 ['both destroyed',[]],
 ['P1 unsupplied and P2 destroyed',[commander('C1','P1',3,6,{supplied:false})]],
 ['P1 destroyed and P2 unsupplied',[commander('C2','P2',6,3,{supplied:false})]],
])test(`retained ${name} matches only its exact old terminal-reason hash`,()=>{
 const canonical=makeState({pieces,outcome:commanderOutcome(pieces)}),retained=retainedTerminal(canonical),before=structuredClone(canonical);
 assert.deepEqual(legacyCommanderReplayState(canonical,deterministicStateHash(retained)),retained);
 assert.deepEqual(canonical,before);
 for(const alter of [s=>s.pieces.push(unit('extra','P1',0,0)),s=>s.turnIndex++,s=>s.sideToMove='P2',s=>s.continuation={kind:'altered'},s=>s.outcome.reason='invented_reason',s=>s.outcome.status='ongoing']){
  const different=structuredClone(retained);alter(different);
  assert.equal(legacyCommanderReplayState(canonical,deterministicStateHash(different)),null);
 }
});

test('current canonical hashes remain canonical and altered decisions remain rejected',()=>{
 const game=destroyedCommanderGame(),before=structuredClone(game);
 let current=game.initial;
 for(const [index,record]of game.decisions.entries())current=replayDecision(current,index===game.decisions.length-1?{...record,afterHash:deterministicStateHash(game.canonical)}:record,work=>work());
 assert.deepEqual(current,game.canonical);
 const first=game.decisions[0];
 for(const patch of [{beforeHash:'tampered'},{afterHash:'tampered'},{controller:'P2'},{action:{type:'pass'}}])assert.throws(()=>replayDecision(game.initial,{...first,...patch},work=>work()));
 assert.deepEqual(game,before);
 const supplied=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3,{supplied:false})],outcome:{status:'p1_win',reason:'p2_commander_unsupplied'}});
 assert.equal(legacyCommanderReplayState(supplied,deterministicStateHash(supplied)),null);
});

test('the real replay and training inventory worker preserve retained final hashes without model evaluation',async()=>{
 const source=destroyedCommanderGame(),game={id:'retained-commander',partition:'train',initialState:source.initial,decisions:source.decisions,finalHash:deterministicStateHash(source.retained),outcome:source.retained.outcome,termination:'terminal'},before=structuredClone(game);
 for(const command of ['replay','inventory']){
  const output=await new Promise((resolve,reject)=>{
   const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},(error,stdout,stderr)=>error?reject(new Error(`${stderr}\n${stdout}`,{cause:error})):resolve(JSON.parse(stdout.trim())));
   child.stdin.end(JSON.stringify({command,game,indices:[0],budgetMs:8000})+'\n');
  });
  assert.equal(output.type,command==='replay'?'replayed':'inventoried');assert.equal(output.hash,game.finalHash);assert.deepEqual(output.outcome,game.outcome);
  if(command==='inventory')assert.equal(output.states[0].hash,game.decisions[0].beforeHash);
 }
 assert.deepEqual(game,before);
});

test('completed-turn teaching metadata must match exact engine replay',async()=>{
 const source=destroyedCommanderGame();let state=source.initial;
 const decisions=source.decisions.map(record=>{
  const stamped={...record,turnIndex:state.turnIndex};state=replayDecision(state,record,work=>work());return stamped;
 });
 const game={id:'turn-metadata',partition:'train',initialState:source.initial,decisions,
  finalHash:deterministicStateHash(source.retained),outcome:source.retained.outcome,termination:'terminal'};
 const replay=game=>new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},
   (error,stdout,stderr)=>error?reject(new Error(`${stderr}\n${stdout}`,{cause:error})):resolve(JSON.parse(stdout.trim())));
  child.stdin.end(JSON.stringify({command:'replay',game,budgetMs:8000})+'\n');
 });
 assert.equal((await replay(game)).hash,game.finalHash);
 const changed=structuredClone(game);changed.decisions[0].turnIndex++;
 await assert.rejects(replay(changed),/completed-turn index mismatch/);
});

test('a retained terminal warmup preserves its exact old initial and final hashes with no decisions',async()=>{
 const source=destroyedCommanderGame(),game={id:'retained-terminal-warmup',partition:'train',rootState:source.initial,warmupActions:source.decisions.map(record=>record.action),initialState:source.retained,decisions:[],finalHash:deterministicStateHash(source.retained),outcome:source.retained.outcome,termination:'terminal'},before=structuredClone(game);
 const replay=game=>new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},(error,stdout,stderr)=>error?reject(new Error(`${stderr}\n${stdout}`,{cause:error})):resolve(JSON.parse(stdout.trim())));
  child.stdin.end(JSON.stringify({command:'replay',game,budgetMs:8000})+'\n');
 });
 const result=await replay(game);assert.equal(result.type,'replayed');assert.equal(result.hash,game.finalHash);assert.deepEqual(result.outcome,game.outcome);assert.deepEqual(game,before);
 for(const alter of [g=>g.initialState.turnIndex++,g=>g.initialState.pieces.push(unit('extra','P1',0,0)),g=>g.warmupActions.pop()]){
  const changed=structuredClone(game);alter(changed);await assert.rejects(replay(changed),/Replay warmup mismatch/);
 }
 const changed=structuredClone(game);changed.warmupActions[0]={type:'pass'};await assert.rejects(replay(changed),/Cannot apply invalid action/);
 await assert.rejects(replay({...game,finalHash:'altered'}),/Replay final hash mismatch/);
});

test('terminal endpoint teaching facts are exact engine facts, never caller inventions',async()=>{
 const source=destroyedCommanderGame(),game={id:'terminal-endpoint',partition:'train',initialState:source.initial,decisions:source.decisions,finalHash:deterministicStateHash(source.retained),outcome:source.retained.outcome,termination:'terminal',finalTurnIndex:source.retained.turnIndex,finalEncoding:Array.from(encodeState(source.retained))};
 const replay=g=>new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},(error,stdout,stderr)=>error?reject(new Error(`${stderr}\n${stdout}`,{cause:error})):resolve(JSON.parse(stdout.trim())));
  child.stdin.end(JSON.stringify({command:'replay',game:g,budgetMs:8000})+'\n');
 });
 assert.equal((await replay(game)).hash,game.finalHash);
 await assert.rejects(replay({...game,finalTurnIndex:game.finalTurnIndex+1}),/final.*turn|turn.*final/i);
 const altered=structuredClone(game);altered.finalEncoding[0]=1-altered.finalEncoding[0];
 await assert.rejects(replay(altered),/final.*encod|encod.*final/i);
});

test('actual replay rejects stripped or changed teacher envelopes',async()=>{
 const raw=readFileSync(new URL('../../../packages/computer-player/config/followup-teaching-v1.json',import.meta.url)),definition=JSON.parse(raw),cycle=definition.cycles[1],profile=definition.profiles[cycle.profile];
 const teaching={schema:1,definitionSha256:createHash('sha256').update(raw).digest('hex'),recipeSha256:'a'.repeat(64),cycle:1,roles:cycle.roles,models:{current:'learner',teacher:'b'.repeat(64)},profiles:{P1:profile,P2:profile}};
 const source=destroyedCommanderGame(),game={id:'teaching-retained',partition:'train',modelVersion:'learner',teaching,initialState:source.initial,decisions:source.decisions.map(d=>({...d,...teachingDecision(teaching,d.controller)})),finalHash:deterministicStateHash(source.retained),outcome:source.retained.outcome,termination:'terminal'};
 const replay=g=>new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:10000},(error,stdout,stderr)=>error?reject(new Error(`${stderr}\n${stdout}`,{cause:error})):resolve(JSON.parse(stdout.trim())));
  child.stdin.end(JSON.stringify({command:'replay',game:g,budgetMs:8000})+'\n');
 });
 assert.equal((await replay(game)).hash,game.finalHash);
 const orphan=structuredClone(game);delete orphan.teaching;
 await assert.rejects(replay(orphan),/Orphaned/);
 await assert.rejects(replay({...game,modelVersion:'different'}),/current teacher-model provenance/);
});
