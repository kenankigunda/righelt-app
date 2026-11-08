import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolveCandidatePlaywright} from './candidate-playwright.mjs';
const actual=process.env.RIGHELT_RESOLVER_TEST_CANDIDATE;
if(!actual||!path.isAbsolute(actual))throw Error('Explicit actual candidate dependency graph required');
const actualRequire=createRequire(path.join(actual,'package.json')),actualExports=actualRequire('@playwright/test');
const actualDirect=fs.realpathSync(path.join(actual,'node_modules/@playwright/test'));
function ownFixture(fn){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'owned-strict-playwright-'));try{return fn(directory);}finally{fs.rmSync(directory,{recursive:true,force:true});}}
function directOnly(directory){fs.mkdirSync(path.join(directory,'node_modules/@playwright'),{recursive:true});fs.symlinkSync(actualDirect,path.join(directory,'node_modules/@playwright/test'),'dir');fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'owned-strict-fixture',private:true}));}
test('strict direct-only pnpm layout reproduces actual old resolver failure and resolves original own WebKit metadata',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'owned-strict-playwright-'));
 try{
  directOnly(directory);assert.equal(fs.existsSync(path.join(directory,'node_modules/playwright')),false);assert.equal(fs.existsSync(path.join(directory,'node_modules/playwright-core')),false);
  // Exact old expression. No platform shim or browser/native execution.
  await assert.rejects(import(pathToFileURL(path.join(directory,'node_modules/playwright/index.mjs')).href),error=>error.code==='ERR_MODULE_NOT_FOUND');
  const result=resolveCandidatePlaywright(directory);
  assert.equal(result.webkit,actualExports.webkit);assert.equal(result.original.test,actualExports.test);
  assert.equal(result.provenance.packages.test.root,actualDirect);
  for(const pkg of Object.values(result.provenance.packages))assert.equal(pkg.version,'1.59.1');
  assert.equal(result.provenance.browsersFile,path.join(result.provenance.packages.core.root,'browsers.json'));assert(result.provenance.browsers.browsers.some(row=>row.name==='webkit'));
  assert.equal(result.webkit.executablePath(),actualExports.webkit.executablePath());
  console.log(JSON.stringify({strictDirectOnly:true,oldResolver:'ERR_MODULE_NOT_FOUND',version:result.provenance.packages.test.version,browserIdentityUnchanged:true,browserMetadata:result.provenance.browsersFile,noLaunch:true}));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('missing direct candidate dependency cannot silently use an ancestor installation',()=>ownFixture(directory=>{
 directOnly(directory);const child=path.join(directory,'child');fs.mkdirSync(child);fs.writeFileSync(path.join(child,'package.json'),'{}');
 assert.equal(createRequire(path.join(child,'package.json'))('@playwright/test').webkit,actualExports.webkit,'Negative fixture must expose an ancestor fallback');
 assert.throws(()=>resolveCandidatePlaywright(child),error=>error.code==='ENOENT');
}));
