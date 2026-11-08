import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
test('actual diagnostic fixture forwards the original Chromium BrowserType identity without launching',()=>{
 const candidate=process.env.RIGHELT_EXPORT_TEST_CANDIDATE;assert(candidate&&path.isAbsolute(candidate),'Explicit own candidate package root required');
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'owned-export-identity-'));
 try{
  const code=`import assert from 'node:assert/strict';import {chromium} from ${JSON.stringify(new URL('./test-fixture.mjs',import.meta.url).href)};import * as original from ${JSON.stringify(pathToFileURL(path.join(candidate,'node_modules/@playwright/test/index.mjs')).href)};assert.equal(chromium,original.chromium);console.log('Exact original Chromium export retained, no launch');`;
  const stdout=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{...process.env,RIGHELT_DIAGNOSTIC_CANDIDATE:candidate,RIGHELT_DIAGNOSTIC_OUT:out}});
  assert(stdout.includes('Exact original Chromium export retained, no launch'));
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});
