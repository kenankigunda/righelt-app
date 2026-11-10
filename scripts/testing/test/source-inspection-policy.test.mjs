import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {inspectModule,sourceReaders,policyProblems,legacyProblems,LEGACY_BASELINE,checkPolicy} from '../source-inspection.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
test('production source inspection has only explicit legacy or artifact contracts',()=>{
 const policy=JSON.parse(readFileSync(path.join(root,'scripts/testing/source-inspection-allowlist.json'),'utf8'));
 assert.deepEqual(checkPolicy(root,policy),[]);
});
for(const [label,source] of [
 ['direct',`import {readFileSync} from 'node:fs';readFileSync(new URL('../shell/view.js',import.meta.url));`],
 ['alias',`import {readFile as load} from 'node:fs/promises';load(new URL('../shell/view.js',import.meta.url));`],
 ['namespace',`import * as fs from 'node:fs';fs.readFileSync(new URL('../shell/view.js',import.meta.url));`],
 ['dynamic',`const {readFile:load}=await import('node:fs/promises');load(new URL('../shell/view.js',import.meta.url));`],
 ['dynamic namespace',`const fs=await import('node:fs/promises');fs.readFile(new URL('../shell/view.js',import.meta.url));`],
])test(`detects ${label} source reads without executing candidate code`,()=>{
 assert.deepEqual(inspectModule('apps/web/test/probe.test.mjs',source).reads,['apps/web/shell/view.js']);
});
test('fixture data is allowed and unknown targets require classification',()=>{
 assert.deepEqual(inspectModule('tests/probe.test.mjs',`import {readFileSync} from 'node:fs';readFileSync(new URL('./data.json',import.meta.url));`).reads,[]);
 assert.deepEqual(inspectModule('tests/probe.test.mjs',`import {readFileSync} from 'node:fs';readFileSync(variable);`).reads,['unresolved:variable']);
});
test('follows local helpers and dynamic imports, handles cycles and excludes ordinary production imports',()=>{
 const modules={
 'e2e/a.spec.mjs':`import './support/one.mjs'; import '../apps/web/shell/view.js';`,
 'e2e/support/one.mjs':`await import('./two.mjs');`,
 'e2e/support/two.mjs':`import './one.mjs';import {readFile as load} from 'node:fs/promises';load(new URL('../../apps/web/shell/view.js',import.meta.url));`,
 'apps/web/shell/view.js':`throw Error('must not execute or inspect a normal production import');`,
 };
 assert.deepEqual(sourceReaders('/unused',{files:Object.keys(modules),read:file=>modules[file]}),[{file:'e2e/support/two.mjs',targets:['apps/web/shell/view.js']}]);
});
test('policy reports unexpected, stale, duplicate and unclassified readers separately',()=>{
 const findings=[{file:'a.test.mjs',targets:['app.js']},{file:'new.test.mjs',targets:['new.js']}];
 const policy={version:2,legacy:[{file:'a.test.mjs',targets:['old.js'],reason:'frozen legacy'}],artifacts:[]};
 assert.match(policyProblems(findings,policy).join('\n'),/Unexpected source reader: new/);
 assert.match(policyProblems(findings,policy).join('\n'),/Unclassified source read: a/);
 assert.match(policyProblems(findings,policy).join('\n'),/Stale source exception: a/);
 policy.legacy.push(policy.legacy[0]);assert.match(policyProblems(findings,policy).join('\n'),/Duplicate entry/);
});
test('new artifact exceptions need a specific contract and execution limitation',()=>{
 const findings=[{file:'a.test.mjs',targets:['workflow.yml']}];
 const artifact={file:'a.test.mjs',targets:['workflow.yml'],kind:'workflow',reason:'Required CI jobs are emitted',whyExecutionInsufficient:'Executing local tests cannot establish the GitHub workflow trigger configuration'};
 assert.deepEqual(policyProblems(findings,{version:2,legacy:[],artifacts:[artifact]}),[]);
 assert.match(policyProblems(findings,{version:2,artifacts:[{...artifact,kind:'native-fixture',whyExecutionInsufficient:''}]}).join('\n'),/Artifact exception needs/);
});

test('an unrelated shadowed data binding cannot hide a source read',()=>{
 const source=`import {readFileSync} from 'node:fs';const target='app.js';readFileSync(target);function unrelated(){const target='fixture.json';return target;}`;
 assert.deepEqual(inspectModule('test/a.test.mjs',source).reads,['unresolved:target']);
});
test('follows re-exported support modules',()=>{
 const modules={'e2e/a.spec.mjs':"import './support/bridge.mjs';",'e2e/support/bridge.mjs':"export {value} from './reader.mjs';",'e2e/support/reader.mjs':"import {readFileSync} from 'node:fs';const value=readFileSync('app.js');export {value};"};
 assert.deepEqual(sourceReaders('/unused',{files:Object.keys(modules),read:f=>modules[f]}),[{file:'e2e/support/reader.mjs',targets:['app.js']}]);
});
test('legacy entries cannot authorize a reader or target absent from the fixed baseline',()=>{
 const policy={baselineRevision:LEGACY_BASELINE,legacy:[{file:'old.test.mjs',targets:['old.js']}]};
 const read=file=>{if(file!=='old.test.mjs')throw Error('absent');return ['old.js'];};
 assert.deepEqual(legacyProblems(policy,read),[]);
 policy.legacy[0].targets.push('new.js');assert.match(legacyProblems(policy,read).join('\n'),/New legacy target is forbidden/);
 policy.legacy.push({file:'new.test.mjs',targets:['new.js']});assert.match(legacyProblems(policy,read).join('\n'),/New legacy reader is forbidden/);
 policy.baselineRevision='new';assert.match(legacyProblems(policy,read).join('\n'),/baseline revision must not change/);
});

test('reassigned path bindings cannot disguise executable source as fixture data',()=>{
 const source=`import {readFileSync} from 'node:fs';let target='fixture.json';target='app.js';readFileSync(target);`;
 assert.deepEqual(inspectModule('test/a.test.mjs',source).reads,['unresolved:target']);
});
