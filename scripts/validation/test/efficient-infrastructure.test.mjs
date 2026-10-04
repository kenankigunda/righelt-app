import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,realpath,access,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {command} from '../io.mjs';
import {evidenceKey,saveSuccessfulEvidence,loadSuccessfulEvidence,installSignature} from '../reuse.mjs';
import {createCheckpoint,restoreCheckpoint} from '../checkpoints.mjs';
import {compactStatus} from '../status.mjs';
const temporary=async t=>{const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'validation-efficient-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;};
const expiry=()=>new Date(Date.now()+86400000).toISOString();
const provenance={sourceTree:'tree',harness:'harness',environment:{node:'v26',platform:'test'},command:['test'],dependencies:'lock+manifests+config',state:'fresh'};

test('logged commands stream complete stdout/stderr while retaining only explicit bounded tail',async t=>{
 const root=await temporary(t),log=path.join(root,'command.log');
 const pending=command([process.execPath,'-e',"process.stdout.write('a'.repeat(200000));setTimeout(()=>{process.stderr.write('FINAL');},100)"],{log,maxOutputBytes:40});
 const result=await pending;
 assert.equal(result.code,0);assert.equal(result.outputBytes,200005);assert.equal(result.truncated,true);assert.equal(Buffer.byteLength(result.output),40);assert.match(result.output,/FINAL$/);
 const full=await readFile(log,'utf8');assert.equal(full.length,200005);assert.match(full,/FINAL$/);
});
test('full log is available while child is still running',async t=>{
 const root=await temporary(t),log=path.join(root,'live.log'),release=path.join(root,'release');
 let finished=false;
 const pending=command([process.execPath,'-e',"const fs=require('node:fs');process.stdout.write('READY');const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);process.stdout.write('DONE');}},5);setTimeout(()=>process.exit(8),3000).unref();",release],{log,maxOutputBytes:4}).finally(()=>{finished=true;});
 const deadline=Date.now()+2000;let written='';
 while(Date.now()<deadline){try{written=await readFile(log,'utf8');}catch{}if(written==='READY')break;await new Promise(resolve=>setTimeout(resolve,5));}
 try{assert.equal(written,'READY');assert.equal(finished,false);}finally{await writeFile(release,'go');}
 const result=await pending;assert.equal(result.output,'DONE');assert.equal(await readFile(log,'utf8'),'READYDONE');
});
test('default command retains complete output even with log, and failure logs survive',async t=>{
 const root=await temporary(t),log=path.join(root,'full.log');
 const result=await command([process.execPath,'-e',"process.stdout.write('x'.repeat(90000))"],{log});assert.equal(result.output.length,90000);assert.equal(result.truncated,false);
 await assert.rejects(command([process.execPath,'-e',"process.stderr.write('specific failure');process.exitCode=9"],{log,maxOutputBytes:8}),/failed \(9\)/);
 assert.equal(await readFile(log,'utf8'),'specific failure');
 await assert.rejects(command([process.execPath,'-e',''],{maxOutputBytes:10}),/requires a log/);
});
test('successful evidence requires exact provenance, unchanged artifacts, successful status and unexpired receipt',async t=>{
 const root=await temporary(t),artifact=path.join(root,'result'),receipt=path.join(root,'cache.json');await writeFile(artifact,'evidence');
 await saveSuccessfulEvidence(receipt,{provenance,result:{status:'passed',count:12},artifacts:[artifact],expiresAt:expiry()});
 assert.deepEqual(await loadSuccessfulEvidence(receipt,provenance),{status:'passed',count:12});
 for(const change of [{sourceTree:'new'},{harness:'new'},{state:'retained'},{environment:{node:'other'}},{dependencies:'changed'}])assert.equal(await loadSuccessfulEvidence(receipt,{...provenance,...change}),null);
 assert.equal(await loadSuccessfulEvidence(receipt,provenance,{now:Date.now()+172800000}),null);
 await writeFile(artifact,'changed');assert.equal(await loadSuccessfulEvidence(receipt,provenance),null);
 await assert.rejects(saveSuccessfulEvidence(receipt,{provenance,result:{status:'failed'},expiresAt:expiry()}),/successful/);
});
test('evidence receipts reject tampering, malformed JSON, absent artifacts and symlinks',async t=>{
 const root=await temporary(t),receipt=path.join(root,'cache'),artifact=path.join(root,'artifact');await writeFile(artifact,'ok');
 await saveSuccessfulEvidence(receipt,{provenance,result:{status:'passed'},artifacts:[artifact],expiresAt:expiry()});
 const raw=JSON.parse(await readFile(receipt,'utf8'));raw.result.fake='tampered';await writeFile(receipt,JSON.stringify(raw));assert.equal(await loadSuccessfulEvidence(receipt,provenance),null);
 await writeFile(receipt,'{');assert.equal(await loadSuccessfulEvidence(receipt,provenance),null);
 await symlink(artifact,path.join(root,'link'));await assert.rejects(saveSuccessfulEvidence(receipt,{provenance,result:{status:'passed'},artifacts:[path.join(root,'link')],expiresAt:expiry()}),/symlinks/);
 await saveSuccessfulEvidence(receipt,{provenance,result:{status:'passed'},artifacts:[artifact],expiresAt:expiry()});await rm(artifact);assert.equal(await loadSuccessfulEvidence(receipt,provenance),null);
});
test('dependency signatures include every supplied toolchain dimension and canonicalize object order',()=>{
 const base={lockHash:'lock',packageHash:'all manifests and configs',nodeVersion:'26',pnpmVersion:'11',platform:'darwin',arch:'arm64'};
 for(const key of Object.keys(base))assert.notEqual(installSignature(base),installSignature({...base,[key]:'changed'}));
 assert.throws(()=>installSignature({...base,pnpmVersion:''}),/Complete/);
 assert.equal(evidenceKey({b:2,a:1}),evidenceKey({a:1,b:2}));assert.throws(()=>evidenceKey({missing:undefined}),/explicit JSON/);
});
test('checkpoint copies full stopped state including WAL and sidecars, then restores to a new root',async t=>{
 const root=await temporary(t),live=path.join(root,'live'),checkpoint=path.join(root,'checkpoint'),restored=path.join(root,'restored');await mkdir(live);
 await writeFile(path.join(live,'db.sqlite'),'base');await writeFile(path.join(live,'db.sqlite-wal'),'uncheckpointed');await writeFile(path.join(live,'continuity.json'),JSON.stringify({identity:'retained'}));let stops=0;
 const options={provenance,expiresAt:expiry(),assertStopped:async()=>{stops++;return true;}};
 const manifest=await createCheckpoint({...options,root:live,destination:checkpoint});assert.equal(Object.keys(manifest.files).length,3);
 await restoreCheckpoint({...options,checkpoint,destination:restored});assert.equal(stops,4);assert.equal(await readFile(path.join(restored,'db.sqlite-wal'),'utf8'),'uncheckpointed');assert.equal(await readFile(path.join(live,'db.sqlite'),'utf8'),'base');
 await assert.rejects(restoreCheckpoint({...options,checkpoint,destination:restored}),/already exists/);
});
test('checkpoint refuses live services, symlinks, overlapping roots and mutation during copy',async t=>{
 const root=await temporary(t),live=path.join(root,'live');await mkdir(live);await writeFile(path.join(live,'db'),'before');const common={root:live,destination:path.join(root,'saved'),provenance,expiresAt:expiry()};
 await assert.rejects(createCheckpoint({...common,assertStopped:async()=>false}),/stopped/);
 await assert.rejects(createCheckpoint({...common,destination:path.join(live,'nested'),assertStopped:async()=>true}),/separate/);
 let checks=0;await assert.rejects(createCheckpoint({...common,assertStopped:async()=>{if(++checks===2)await writeFile(path.join(live,'db'),'after');return true;}}),/changed while copying/);
 await assert.rejects(access(path.join(common.destination,'manifest.json')));
 await symlink(path.join(live,'db'),path.join(live,'link'));await assert.rejects(createCheckpoint({...common,destination:path.join(root,'other'),assertStopped:async()=>true}),/symlinks/);
});
test('restore fails closed on provenance, expiry, and corrupted checkpoint contents',async t=>{
 const root=await temporary(t),live=path.join(root,'live'),checkpoint=path.join(root,'saved');await mkdir(live);await writeFile(path.join(live,'db'),'ok');const common={provenance,assertStopped:async()=>true};await createCheckpoint({...common,root:live,destination:checkpoint,expiresAt:expiry()});
 const opts={...common,checkpoint,destination:path.join(root,'restore')};await assert.rejects(restoreCheckpoint({...opts,provenance:{...provenance,sourceTree:'new'}}),/provenance/);await assert.rejects(restoreCheckpoint({...opts,now:Date.now()+172800000}),/expiry/);
 await writeFile(path.join(checkpoint,'state','db'),'broken');await assert.rejects(restoreCheckpoint(opts),/integrity/);await assert.rejects(access(opts.destination));
});
test('compact status suppresses unchanged state but observes gate and authorization changes',()=>{
 const run={id:'run',complete:false,stages:[{id:'stage-1',status:'passed',checks:[{name:'E2E',status:'passed'}],items:[{huge:'image data'}]}],prs:[{number:92,head:'abc',checks:'pending'}]};const first=compactStatus(run);assert.equal(first.changed,true);assert.equal(JSON.stringify(first).includes('image data'),false);
 assert.deepEqual(compactStatus(run,{afterCursor:first.cursor}),{cursor:first.cursor,changed:false});run.prs[0].checks='passed';assert.equal(compactStatus(run,{afterCursor:first.cursor}).changed,true);const second=compactStatus(run);run.prs[0].authorization={state:'authorized'};assert.notEqual(compactStatus(run).cursor,second.cursor);
 run.complete=true;run.stages[0].status='failed';assert.equal(compactStatus(run).status,'failed');
});
test('binary stdout-only logs exclude stderr without changing default command output',async t=>{
 const root=await temporary(t),log=path.join(root,'archive');const result=await command([process.execPath,'-e',"process.stdout.write(Buffer.from([0,255,1]));process.stderr.write('warning')"],{log,maxOutputBytes:30,logStdoutOnly:true});assert.deepEqual(await readFile(log),Buffer.from([0,255,1]));assert.match(result.output,/warning/);
});

test('private checkpoint bundles retain config, SQLite bytes, storage and continuity while capping cookie expiry',async t=>{
 const root=await temporary(t),live=path.join(root,'live'),checkpoint=path.join(root,'saved'),destination=path.join(root,'restored');await mkdir(live,{mode:0o755});await mkdir(path.join(live,'private-config'));
 const expires=Math.floor(Date.now()/1000)+3600,fixture={version:2,account:{id:'retained'},storage:{cookies:[{name:'session',value:'private',expires:-1},{name:'auth',value:'private',expires},{name:'later',expires:expires+100}],origins:[]},gameURL:'/game/retained'};
 await writeFile(path.join(live,'continuity.json.account-mobile'),JSON.stringify(fixture));await writeFile(path.join(live,'continuity-state.json'),JSON.stringify({accountContinuity:'continuity.json'}));await writeFile(path.join(live,'private-config','worker.toml'),'name = "private-fixture"');const bytes=Buffer.from([83,81,76,105,116,101,0,255,1]);await writeFile(path.join(live,'db.sqlite'),bytes);
 const common={provenance,assertStopped:async()=>true};const manifest=await createCheckpoint({...common,root:live,destination:checkpoint,expiresAt:new Date(Date.now()+7*86400000).toISOString()});assert.equal(Date.parse(manifest.expiresAt),expires*1000);
 await restoreCheckpoint({...common,checkpoint,destination});assert.deepEqual(await readFile(path.join(destination,'db.sqlite')),bytes);assert.deepEqual(JSON.parse(await readFile(path.join(destination,'continuity.json.account-mobile'))),fixture);assert.equal(await readFile(path.join(destination,'private-config','worker.toml'),'utf8'),'name = "private-fixture"');
 for(const dir of [checkpoint,path.join(checkpoint,'state'),destination])assert.equal((await stat(dir)).mode&0o777,0o700);
 await assert.rejects(restoreCheckpoint({...common,checkpoint,destination:path.join(root,'expired'),now:expires*1000}),/expiry/);
});
test('session-only checkpoints cap at 24 hours; expired or malformed persistent cookies fail closed',async t=>{
 const root=await temporary(t),live=path.join(root,'live');await mkdir(live);const fixture=path.join(live,'continuity.json.account-full-wide');const common={root:live,provenance,assertStopped:async()=>true,expiresAt:new Date(Date.now()+7*86400000).toISOString()};
 await writeFile(fixture,JSON.stringify({storage:{cookies:[{expires:-1}]}}));const manifest=await createCheckpoint({...common,destination:path.join(root,'session')});assert.equal(Date.parse(manifest.expiresAt)-Date.parse(manifest.createdAt),86400000);
 for(const [i,expires] of [0,-2,'future',null].entries()){await writeFile(fixture,JSON.stringify({storage:{cookies:[{expires}]}}));await assert.rejects(createCheckpoint({...common,destination:path.join(root,`bad-${i}`)}),/cookie/);}
 // Even an integrity-valid legacy/tampered deadline cannot extend a cookie's lifetime.
 const expirySeconds=Math.floor(Date.now()/1000)+60;await writeFile(fixture,JSON.stringify({storage:{cookies:[{expires:expirySeconds}]}}));const saved=path.join(root,'short');const short=await createCheckpoint({...common,destination:saved});short.expiresAt=new Date(Date.parse(short.createdAt)+3600000).toISOString();delete short.integrity;short.integrity=evidenceKey(short);await writeFile(path.join(saved,'manifest.json'),JSON.stringify(short));await assert.rejects(restoreCheckpoint({checkpoint:saved,destination:path.join(root,'too-late'),provenance,assertStopped:async()=>true}),/cookie deadline/);
});
