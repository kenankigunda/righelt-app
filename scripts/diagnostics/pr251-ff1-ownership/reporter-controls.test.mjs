import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import Reporter,{validateOwnership} from './inline-ownership-reporter.mjs';
import {additiveReporterCLI} from './reporter-selection.mjs';
const expected=JSON.parse(fs.readFileSync(new URL('./expected-inventory.json',import.meta.url),'utf8'));
const keyboard={inputMethod:'keyboard',hover:false,hoverMedia:false,keyboardFocus:true,tabFocused:true,visible:'true',inert:false,expanded:'true'};
function setup(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'righelt-owned-inline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=path.join(root,'observer'),reporter=new Reporter({outputDir:out,expected,...options});
 const tests=expected.tests.map(row=>({id:row.id,titlePath:()=>row.name.split(' > '),location:{file:'/owned/e2e/'+row.file},expectedStatus:'passed'}));
 reporter.onBegin({workers:1,reporter:[['github'],['line'],['junit'],['original-browser'],['observer']],projects:[{name:'firefox',retries:0,timeout:60000,use:{trace:'retain-on-failure',screenshot:'only-on-failure',headless:true}}]}, {allTests:()=>tests});
 function finish(attachments){
  for(const row of tests)reporter.onTestEnd(row,{status:'passed',retry:0,attachments:row.id===expected.target.id?attachments:[]});
  const native={status:'passed'};assert.equal(reporter.onEnd(native),undefined);assert.deepEqual(native,{status:'passed'});return reporter.summary;
 }
 return{out,reporter,tests,finish};
}
const attached=body=>({name:expected.target.name,contentType:'application/json',body});
test('binds the actual current full74 inventory and all3 original serial phases',()=>{assert.equal(expected.inventory.length,74);assert.equal(expected.horusIDs.length,3);assert(expected.horusIDs.includes(expected.target.id));});
test('persists exact inline UTF8 Buffer bytes before parsing, without native-result mutation',t=>{
 const h=setup(t),body=Buffer.from(JSON.stringify(keyboard,null,2)+'\n'),attachment=attached(body),saved=Buffer.from(body);
 const summary=h.finish([attachment]);assert(summary.observerComplete&&summary.keyboardProved);assert.deepEqual(body,saved);
 const row=summary.attachments[0];assert.equal(row.name,attachment.name);assert.equal(row.contentType,attachment.contentType);assert.deepEqual(fs.readFileSync(path.join(h.out,row.file)),body);
 assert.equal(row.sha256,createHash('sha256').update(body).digest('hex'));assert.equal(summary.originalNativeStatus,'passed');
});
test('missing conditional body is incomplete even when all original cases passed',t=>{const h=setup(t),s=h.finish([]);assert.equal(s.observerComplete,false);assert.equal(s.keyboardProved,false);assert.equal(s.conditionalBypassFails,true);assert.equal(s.originalNativeStatus,'passed');});
test('path-only attachment is not read or synthesized as inline ownership',t=>{const h=setup(t),s=h.finish([{name:expected.target.name,contentType:'application/json',path:'/not-an-inline-body.json'}]);assert.equal(s.observerComplete,false);assert.equal(s.attachments.length,0);});
test('malformed/invalidUTF8 JSON is preserved raw then rejected',t=>{
 for(const body of [Buffer.from('{'),Buffer.from([0xff,0x7b,0x7d])]){
  const h=setup(t),s=h.finish([attached(body)]);assert.equal(s.observerComplete,false);assert.deepEqual(fs.readFileSync(path.join(h.out,s.attachments[0].file)),body);
 }
});
test('duplicates and wrong content type cannot qualify',t=>{
 const a=setup(t),body=Buffer.from(JSON.stringify(keyboard));assert.equal(a.finish([attached(body),attached(body)]).observerComplete,false);
 const b=setup(t);assert.equal(b.finish([{...attached(body),contentType:'text/plain'}]).observerComplete,false);
});
test('foreign test attachment cannot qualify the target',t=>{
 const h=setup(t),row=h.tests.find(x=>x.id!==expected.target.id);h.reporter.onTestEnd(row,{status:'passed',retry:0,attachments:[attached(Buffer.from(JSON.stringify(keyboard)))]});
 const s=h.finish([]);assert.equal(s.observerComplete,false);assert.equal(s.keyboardProved,false);
});
test('pointer observation stays pointer and does not prove the keyboard gate',t=>{
 const h=setup(t),s=h.finish([attached(Buffer.from(JSON.stringify({...keyboard,inputMethod:'pointer',hoverMedia:true,hover:true,keyboardFocus:false,tabFocused:false})))]);
 assert.equal(s.observerComplete,true);assert.equal(s.keyboardProved,false);assert.equal(s.attachments[0].ownership.actual.inputMethod,'pointer');
});
test('unsafe ownership values fail original strict semantics',()=>{
 for(const change of [{inert:true},{visible:'false'},{expanded:'false'},{keyboardFocus:false},{tabFocused:false},{inputMethod:'pointer'}])assert.throws(()=>validateOwnership(Buffer.from(JSON.stringify({...keyboard,...change}))));
});
test('write failure is incomplete and never overrides native case outcome',t=>{
 const h=setup(t,{writeExclusive:()=>{throw Error('controlled disk failure');}}),s=h.finish([attached(Buffer.from(JSON.stringify(keyboard)))]);
 assert.equal(s.observerComplete,false);assert.equal(s.originalNativeStatus,'passed');assert(s.errors.some(x=>x.includes('disk failure')));
});
test('additive reporter argument preserves all4 originals and JUnit environment contract',()=>{
 const rows=[['github'],['line'],['junit',{outputFile:'/candidate/junit.xml'}],['./scripts/testing/browser-reporter.mjs']];
 const flag=additiveReporterCLI(rows,{candidate:'/candidate',junitFile:'/candidate/junit.xml',observer:'/diagnostic/observer.mjs'});
 assert.equal(flag,'--reporter=github,line,junit,/candidate/scripts/testing/browser-reporter.mjs,/diagnostic/observer.mjs');
 for(const changed of [rows.slice(0,3),[...rows,['extra']],rows.map((r,i)=>i===2?['junit',{outputFile:'/foreign'}]:r)])assert.throws(()=>additiveReporterCLI(changed,{candidate:'/candidate',junitFile:'/candidate/junit.xml',observer:'/diagnostic/observer.mjs'}));
});
