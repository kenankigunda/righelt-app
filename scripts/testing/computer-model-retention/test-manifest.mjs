// UNEXECUTED qualification: synthetic metadata ONLY. Never import app/browser/models.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,OLD,containsPath} from './manifest.mjs';
import {validateSnapshot,assertHistoryPrefix} from './state-fixture.mjs';
const ref=name=>({path:`/synthetic-private/${name}`,sha256:'a'.repeat(64)});
function fixture(){return {version:1,kind:'local-computer-cross-version-retention-v1',old:{...OLD,checkout:'/synthetic-old',assetPath:'/synthetic-old/assets/1554.onnx'},prospective:{checkout:'/synthetic-next',sourceRevision:'b'.repeat(40),tree:'c'.repeat(40),modelId:'closed-model-7',assetPath:'/synthetic-next/assets/closed.onnx',assetSha256:'d'.repeat(64)},origin:'https://127.0.0.1:9988',output:'/synthetic-private/new-proof',authorization:ref('root-authorization.json'),trainingClosure:ref('closure.json'),numericProof:ref('numeric/proof-result.json'),numericModel:ref('numeric/model.onnx'),roundStatePath:'/synthetic-private/round-state.json',guardian:{checkout:'/synthetic-tools',sourceRevision:'e'.repeat(40)},dependencies:ref('dependencies.json'),playwrightEntry:ref('playwright.cjs'),browserExecutable:ref('chromium'),phaseDeadline:'2099-01-01T00:00:00Z'};}
test('typed synthetic manifest validates without reading any path',()=>assert.equal(validateManifest(fixture()).old.modelId,'initial-1554'));
const mutations=[
 ['missing manifest',()=>undefined],
 ['unknown manifest property',m=>({...m,skip:true})],
 ['wrong fixed old source',m=>{m.old.sourceRevision='f'.repeat(40);return m;}],
 ['wrong fixed old tree',m=>{m.old.tree='f'.repeat(40);return m;}],
 ['wrong fixed old asset',m=>{m.old.assetSha256='f'.repeat(64);return m;}],
 ['wrong fixed old model',m=>{m.old.modelId='initial-other';return m;}],
 ['unchanged next model',m=>{m.prospective.modelId=m.old.modelId;return m;}],
 ['unchanged next asset',m=>{m.prospective.assetSha256=m.old.assetSha256;return m;}],
 ['placeholder next model',m=>{m.prospective.modelId='placeholder';return m;}],
 ['foreign origin',m=>({...m,origin:'https://righelt.com'})],
 ['missing browser executable',m=>{delete m.browserExecutable;return m;}],
 ['missing numeric artifact',m=>{delete m.numericModel;return m;}],
 ['malformed immutable reference',m=>{m.trainingClosure.sha256='not-a-sha';return m;}],
 ['relative source path',m=>{m.old.checkout='relative';return m;}],
 ['asset escaping checkout',m=>{m.prospective.assetPath='/external/model.onnx';return m;}],
 ['asset exactly parent path',m=>{m.prospective.assetPath='/';return m;}],
 ['output inside source',m=>({...m,output:'/synthetic-next/test-results/proof'})],
 ['output equals source',m=>({...m,output:'/synthetic-next'})],
 ['output contains source',m=>({...m,output:'/'})],
 ['malformed deadline',m=>({...m,phaseDeadline:'later'})],
 ['missing guardian pin',m=>{m.guardian.sourceRevision='';return m;}],
];
for(const [label,mutate]of mutations)test(`manifest rejects ${label}`,()=>assert.throws(()=>validateManifest(mutate(fixture()))));
test('containment is strict, rejects parent/exact/sibling-prefix paths',()=>{assert.equal(containsPath('/a','/a/b'),true);for(const file of ['/a','/','/ab/b'])assert.equal(containsPath('/a',file),false);});
function snapshot(){const action={type:'move',from:{row:1,col:2},to:{row:2,col:2}};return {kind:'actual-old026-computer-retention-v1',account:{id:'synthetic-account'},sessionContextId:'synthetic-session',gameId:'synthetic-game',modelId:'initial-1554',ownerId:'synthetic-account',computer:{ownerId:'synthetic-account'},history:{gameId:'synthetic-game',moves:[{moveId:'synthetic-move'}],turns:[{index:0,endedAt:'synthetic-time'}]},storage:{cookies:[{name:'synthetic',value:'fake'}],origins:[]},sessionStorage:{},acceptedDecision:{moveId:'synthetic-move',computerProof:{modelId:'initial-1554'},action},attempt:{result:{status:'ready',action:structuredClone(action)}},archive:{items:[{id:'synthetic-move'}]},pendingCommands:[]};}
test('synthetic snapshot requires actual-proof metadata bindings, not a new seed',()=>assert.equal(validateSnapshot(snapshot()).gameId,'synthetic-game'));
for(const [label,mutate]of [
 ['missing session',s=>{delete s.sessionContextId;}],
 ['foreign owner',s=>{s.ownerId='other';s.computer.ownerId='other';}],
 ['missing original cookie storage',s=>{s.storage.cookies=[];}],
 ['changed model',s=>{s.modelId='closed-model-7';}],
 ['pending immutable command',s=>{s.pendingCommands=[{clientCommandId:'original-pending'}];}],
 ['proof action mismatch',s=>{s.attempt.result.action.type='rush';}],
 ['duplicate history identity',s=>{s.history.moves.push(s.history.moves[0]);}],
 ['missing archived decision',s=>{s.archive.items=[];}],
])test(`snapshot rejects ${label}`,()=>{const value=snapshot();mutate(value);assert.throws(()=>validateSnapshot(value));});
test('completed turn prefix uses canonical turn index and rejects a changed original turn',()=>{const saved=snapshot(),game={id:saved.gameId,computer:{modelId:saved.modelId,ownerId:saved.ownerId},moves:structuredClone(saved.history.moves),turns:structuredClone(saved.history.turns)};assert.doesNotThrow(()=>assertHistoryPrefix(game,saved));game.turns[0].endedAt='changed';assert.throws(()=>assertHistoryPrefix(game,saved));});
