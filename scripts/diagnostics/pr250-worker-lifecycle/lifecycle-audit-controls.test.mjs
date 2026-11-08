import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditLifecycle} from './lifecycle-audit.mjs';
const contextId='11111111-1111-4111-8111-111111111111',pageId='22222222-2222-4222-8222-222222222222',documentNonce='33333333-3333-4333-8333-333333333333';
const observations=()=>({tests:[{id:'original-one',attempts:[{status:'passed'}]}]});
const pageEvent=(kind,sequence,extra={})=>({kind:'console-original',contextId,pageId,text:'__RIGHELT_WORKER_LIFECYCLE_V1__'+JSON.stringify({version:1,contextId,documentNonce,sequence,kind,...extra})});
function original(){return[
 {kind:'fixture-import',environmentWorkerIdentity:{workerIndex:'0',parallelIndex:'0'}},
 {kind:'fixture-loaded',workerIndex:0,parallelIndex:0,projectName:'webkit',browserVersion:'actual-version'},
 {kind:'test-start',testId:'original-one',projectName:'webkit',workerIndex:0},
 {kind:'context-created',contextId},{kind:'context-init-installed',contextId},{kind:'page-created',contextId,pageId},
 {kind:'native-frame-navigation',contextId,pageId,mainFrame:true,observedURL:'http://127.0.0.1:9888/'},
 pageEvent('document-install',1,{nonceAvailable:true}),pageEvent('installed',2),pageEvent('worker-created',3,{workerOrdinal:1}),
 pageEvent('post-called',4,{workerOrdinal:1,data:{id:1,type:{value:'project'},scope:{value:'admit:one'}}}),
 {kind:'test-end',testId:'original-one',projectName:'webkit',workerIndex:0,observedStatusAtFixtureEnd:'passed'},
 {kind:'page-close',contextId,pageId},{kind:'context-close',contextId},{kind:'fixture-finished',incomplete:false},{kind:'node-exit',incomplete:false}
];}
function within(fn){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'owned-lifecycle-audit-'));try{return fn(directory);}finally{fs.rmSync(directory,{recursive:true,force:true});}}
function save(directory,rows,pid=100){
 const sequences=new Map();
 const records=rows.map((value,index)=>{const row={...value};if(row.kind==='console-original'){const prefix='__RIGHELT_WORKER_LIFECYCLE_V1__',event=JSON.parse(row.text.slice(prefix.length));event.sequence=(sequences.get(event.documentNonce)??0)+1;sequences.set(event.documentNonce,event.sequence);row.text=prefix+JSON.stringify(event);}return JSON.stringify({nodePid:pid,nodeSequence:index+1,...row});});
 fs.writeFileSync(path.join(directory,`browser-events-${pid}.jsonl`),records.join('\n')+'\n',{mode:0o600});
}
function check(change,code){within(directory=>{const rows=original();change(rows,directory);if(!fs.readdirSync(directory).length)save(directory,rows);const result=auditLifecycle(directory,observations());assert.equal(result.complete,false);assert(result.errors.some(error=>error.code===code),JSON.stringify(result.errors));});}
test('actual ledger audit accepts complete native evidence plus legitimate discovery/main and all-skipped imports',()=>within(directory=>{
 save(directory,original());save(directory,[{kind:'fixture-import',environmentWorkerIdentity:{workerIndex:null,parallelIndex:null}},{kind:'node-exit',incomplete:false}],101);
 save(directory,[{kind:'fixture-import',environmentWorkerIdentity:{workerIndex:'1',parallelIndex:'0'}},{kind:'node-exit',incomplete:false}],102);
 const observed=observations();observed.tests.push({id:'intentional-skip',attempts:[{status:'skipped'}]});assert.equal(auditLifecycle(directory,observed).complete,true);
}));
test('absent and empty retained ledgers are incomplete',()=>within(directory=>{
 assert(auditLifecycle(directory,observations()).errors.some(error=>error.code==='no-ledger-files'));
 fs.writeFileSync(path.join(directory,'browser-events-100.jsonl'),'');assert(auditLifecycle(directory,observations()).errors.some(error=>error.code==='empty-ledger'));
}));
test('malformed JSON and incomplete trailing original records are refused without rewriting raw',()=>within(directory=>{
 const file=path.join(directory,'browser-events-100.jsonl');fs.writeFileSync(file,'not json\n');const before=fs.readFileSync(file);assert(auditLifecycle(directory,observations()).errors.some(error=>error.code==='unreadable-or-malformed-ledger'));assert.deepEqual(fs.readFileSync(file),before);
 save(directory,original());const text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.slice(0,-1));assert(auditLifecycle(directory,observations()).errors.some(error=>error.code==='incomplete-trailing-record'));
}));
test('a recorded document without installed acknowledgement cannot pass',()=>check(rows=>rows.splice(rows.findIndex(row=>row.text?.includes('"kind":"installed"')),1),'document-install-incomplete'));
test('page cap loss and truncated original error text remain incomplete',()=>{
 check(rows=>rows.splice(10,0,pageEvent('cap-loss',4,{dropped:1})),'page-evidence-loss');
 check(rows=>rows.splice(10,0,pageEvent('native-error',4,{workerOrdinal:1,error:{message:{value:'short',truncated:true}}})),'truncated-page-evidence');
});
test('fixture absent, missing node terminal and a node write failure flag remain incomplete',()=>{
 check(rows=>rows.splice(0,1),'fixture-import-missing-or-duplicate');
 check(rows=>rows.pop(),'node-terminal-incomplete');
 check(rows=>rows.at(-1).incomplete=true,'node-terminal-incomplete');
});
test('browser fixture completion and context/page closure must be explicit',()=>{
 check(rows=>rows.splice(rows.findIndex(row=>row.kind==='fixture-finished'),1),'browser-fixture-terminal-incomplete');
 check(rows=>rows.splice(rows.findIndex(row=>row.kind==='context-close'),1),'context-terminal-incomplete');
 check(rows=>rows.splice(rows.findIndex(row=>row.kind==='page-close'),1),'page-terminal-incomplete');
});
test('executed original case IDs require positive worker testimony, but skipped-only cases do not',()=>within(directory=>{
 save(directory,original());const observed=observations();observed.tests.push({id:'unobserved-original',attempts:[{status:'failed'}]});assert(auditLifecycle(directory,observed).errors.some(error=>error.code==='original-executed-case-unobserved'));
}));
test('foreign case and missing Worker object evidence cannot pass',()=>{
 check(rows=>{for(const row of rows)if(row.testId)row.testId='foreign';},'foreign-case-observed');
 check(rows=>{for(let i=rows.length-1;i>=0;i--)if(rows[i].text?.includes('workerOrdinal'))rows.splice(i,1);},'no-worker-object-observed');
});
test('an original native failure stays a failure even when diagnostic evidence is complete',()=>within(directory=>{
 const rows=original();rows.splice(10,0,pageEvent('native-error',4,{workerOrdinal:1,message:{value:'original error',truncated:false}}));
 // Preserve a complete emitted Page sequence after inserting the error.
 const post=JSON.parse(rows[11].text.slice('__RIGHELT_WORKER_LIFECYCLE_V1__'.length));post.sequence=5;rows[11].text='__RIGHELT_WORKER_LIFECYCLE_V1__'+JSON.stringify(post);save(directory,rows);
 const observed={tests:[{id:'original-one',status:'unexpected',attempts:[{status:'failed',errors:['original failure']}]}]},before=structuredClone(observed),result=auditLifecycle(directory,observed);
 assert.equal(result.complete,true);assert.deepEqual(observed,before);assert.equal(observed.tests[0].attempts[0].status,'failed');
}));
