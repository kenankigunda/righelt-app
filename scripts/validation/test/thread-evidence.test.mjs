import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {renderReport} from '../report.mjs';
import {command} from '../io.mjs';

test('report creates local Markdown with bounded screenshots, provenance and explicit gaps',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'thread-evidence-')),site=path.join(dir,'site');await mkdir(site);
 await writeFile(path.join(site,'proof.png'),'fixture');
 const run={id:'proof',revision:'candidate-sha',base:'base-sha',harnessRevision:'harness-sha',recipient:'PRIVATE_EMAIL',secret:'PRIVATE_SECRET',stages:[{id:'final',status:'failed',head:'stage-sha',visualReviewed:false,unmapped:['unmapped/path'],checks:[{name:'Browser',status:'failed'},{name:'Unit',status:'passed',reused:true,source:{revision:'original-sha'}}],items:[{id:'text',title:'Ownership',status:'failed',assertions:['Both clients retained roles'],findings:['Role mismatch'],images:[]},{id:'flow',title:'Flow',viewport:'mobile',status:'failed',assertions:['reload retains history'],images:Array.from({length:10},(_,i)=>({src:'proof.png',caption:`Checkpoint ${i}`,digest:'original-digest'}))}]}],risks:['Review still pending']};
 await renderReport(run,site);
 const md=await readFile(path.join(dir,'evidence.md'),'utf8');
 for(const expected of ['candidate-sha','harness-sha','stage-sha','Browser: failed','original-sha','Coverage gap','Screenshot inspection: pending','8 selected from 10','reload retains history',path.join(site,'proof.png'),'original-digest','Review still pending','Both clients retained roles','Role mismatch'])assert.ok(md.includes(expected),expected);
 assert.equal((md.match(/!\[/g)||[]).length,8);
 assert.ok(!md.includes('PRIVATE_'));
 assert.ok(await readFile(path.join(site,'index.html'),'utf8'));
});

test('summary refuses traversal, symlink escape and missing screenshot sources',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'thread-evidence-safe-')),site=path.join(dir,'site');await mkdir(site);
 await writeFile(path.join(dir,'private.png'),'private');await symlink(path.join(dir,'private.png'),path.join(site,'escape.png'));
 await renderReport({id:'safe',stages:[{items:[{images:[{src:'../private.png'},{src:'escape.png'},{src:'missing.png'}]}]}]},site);
 const md=await readFile(path.join(dir,'evidence.md'),'utf8');assert.equal((md.match(/Screenshot unavailable/g)||[]).length,3);assert.ok(!md.includes('!['));
});

test('CLI report and publish under paused config generate Markdown without credentials or network',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'thread-evidence-cli-')),file=path.join(dir,'run.json'),config=path.join(dir,'config.json');
 await writeFile(file,JSON.stringify({id:'cli',stages:[]}));await writeFile(config,JSON.stringify({pagesProject:'proof',publicationEnabled:false}));
 for(const mode of ['report','publish']){const result=await command([process.execPath,'scripts/validation/cli.mjs',mode,'--run',file],{env:{RIGHELT_VALIDATION_CONFIG:config}});assert.ok(result.output.includes(path.join(dir,'evidence.md')));}
 assert.equal(JSON.parse(await readFile(file)).publication.status,'disabled');
});
