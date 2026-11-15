import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createInitialState,normalizeState,resolveToStability,deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {encodeState} from '../../packages/computer-player/src/index.ts';
import {canonical,assert} from '../hosted-compute/policy.mjs';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');

export function expectedEvaluationStart(job){
 assert(job&&['normal','developed'].includes(job.startKind),'explicit evaluation start kind required');
 assert(job.startKind==='normal'?(job.kind==='normal'&&job.initialState==null):(job.kind==='simple'&&job.initialState&&typeof job.initialState==='object'&&!Array.isArray(job.initialState)),'normal/custom evaluation construction mismatch');
 const state=resolveToStability(normalizeState(structuredClone(job.startKind==='normal'?createInitialState():job.initialState)));
 encodeState(state);
 assert(state.outcome.status==='ongoing','evaluation start is terminal');
 const construction=job.startKind==='normal'?{kind:'normal'}:{kind:'simple',initialState:state};
 return {schema:1,startKind:job.startKind,kind:job.kind,stateHash:deterministicStateHash(state),constructionSha256:digest(construction)};
}

export function verifyEvaluationGameStart(job,game){
 const expected=expectedEvaluationStart(job);
 assert(canonical(job.startIdentity)===canonical(expected),'frozen evaluation start identity mismatch');
 assert(game?.rootState&&game.initialState&&Array.isArray(game.warmupActions)&&game.warmupActions.length===0,'evaluation game root/warmup missing or changed');
 assert(deterministicStateHash(game.rootState)===expected.stateHash&&deterministicStateHash(game.initialState)===expected.stateHash,'executed evaluation game start differs from frozen job');
 return expected;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const request=JSON.parse(readFileSync(0,'utf8'));
 const result=request.game?verifyEvaluationGameStart(request.job,request.game):request.jobs.map(expectedEvaluationStart);
 process.stdout.write(JSON.stringify(result)+'\n');
}
