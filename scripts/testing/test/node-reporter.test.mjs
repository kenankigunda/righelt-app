import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import reporter from '../node-reporter.mjs';

test('machine observations retain failure status while primary logs retain errors and child output', async () => {
 const dir=mkdtempSync(path.join(os.tmpdir(),'righelt-node-reporter-'));
 const previous=process.env.RIGHELT_TEST_OBSERVATIONS;
 try {
  process.env.RIGHELT_TEST_OBSERVATIONS=path.join(dir,'observations.json');
  async function* events() {
   yield {type:'test:stdout',data:{message:'fixture ready\n'}};
   yield {type:'test:stderr',data:{message:'probe diagnostic\n'}};
   yield {type:'test:fail',data:{file:'fixture.test.mjs',name:'cleanup proof',details:{type:'test',duration_ms:12,error:new Error('probe failed',{cause:new Error('process table unavailable')})}}};
  }
  let output='';for await(const chunk of reporter(events()))output+=chunk;
  for(const text of ['fixture ready','probe diagnostic','fixture.test.mjs: cleanup proof','probe failed','process table unavailable'])assert.ok(output.includes(text),text);
  const result=JSON.parse(readFileSync(process.env.RIGHELT_TEST_OBSERVATIONS,'utf8'));
  assert.equal(result.failed,1);assert.equal(result.passed,0);assert.equal(result.tests[0].status,'failed');
 } finally {if(previous===undefined)delete process.env.RIGHELT_TEST_OBSERVATIONS;else process.env.RIGHELT_TEST_OBSERVATIONS=previous;rmSync(dir,{recursive:true,force:true});}
});
