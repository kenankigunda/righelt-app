import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {usesFirefoxCiAudio,runWithFirefoxAudio} from '../linux-audio.mjs';

const hosted={...process.env,CI:'true',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'};
test('native audio service is scoped to hosted Linux Firefox',()=>{
 assert.equal(usesFirefoxCiAudio('firefox',{env:hosted,platform:'linux'}),true);
 for(const [project,platform,env] of [['webkit','linux',hosted],['chromium','linux',hosted],['firefox','darwin',hosted],['firefox','linux',{}],['firefox','linux',{...hosted,RUNNER_ENVIRONMENT:'self-hosted'}]])
  assert.equal(Boolean(usesFirefoxCiAudio(project,{env,platform})),false);
});

async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'audio child fixture '));
 const program=async(name,body)=>{const file=path.join(directory,name);await writeFile(file,`#!${process.execPath}\n${body}`,{mode:0o700});return file;};
 const pulse=await program('pulse',`const fs=require('node:fs');const socket=process.env.PULSE_SERVER.slice(5);fs.writeFileSync(socket+'.ready',String(process.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
 const pactl=await program('pactl',`const fs=require('node:fs');process.exit(fs.existsSync(process.env.PULSE_SERVER.slice(5)+'.ready')?0:1);`);
 const browser=await program('browser',`require('node:fs').writeFileSync(process.env.PROOF,JSON.stringify({server:process.env.PULSE_SERVER,pid:Number(require('node:fs').readFileSync(process.env.PULSE_SERVER.slice(5)+'.ready')),args:process.argv.slice(2)}));process.exit(7);`);
 return {directory,pulse,pactl,browser};
}
test('owned foreground service is ready before browser admission and is stopped after a failing browser',{timeout:15000},async()=>{
 const f=await fixture(),proof=path.join(f.directory,'proof.json');
 try{
  const result=await runWithFirefoxAudio(['--project=firefox'],{env:{...hosted,PROOF:proof},platform:'linux',pulseCommand:f.pulse,pactlCommand:f.pactl,browserCommand:f.browser,browserArgs:['literal argument']});
  assert.equal(result,7);
  const data=JSON.parse(await readFile(proof,'utf8'));assert.deepEqual(data.args,['literal argument']);
  assert.match(data.server,/^unix:.*righelt-audio-.*\/native$/);
  assert.throws(()=>process.kill(data.pid,0),{code:'ESRCH'});
  await assert.rejects(readFile(data.server.slice(5)+'.ready'),{code:'ENOENT'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('audio startup failure never admits the browser',{timeout:15000},async()=>{
 const f=await fixture(),proof=path.join(f.directory,'proof.json');
 try{
  await writeFile(f.pulse,`#!${process.execPath}\nprocess.exit(3);`,{mode:0o700});
  await assert.rejects(runWithFirefoxAudio(['--project=firefox'],{env:{...hosted,PROOF:proof},platform:'linux',pulseCommand:f.pulse,pactlCommand:f.pactl,browserCommand:f.browser,browserArgs:[]}),/exited before readiness/);
  await assert.rejects(readFile(proof),{code:'ENOENT'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('an audio service exit fails the running browser and cleans both children',{timeout:15000},async()=>{
 const f=await fixture(),proof=path.join(f.directory,'proof.json');
 try{
  await writeFile(f.pulse,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.env.PULSE_SERVER.slice(5)+'.ready',String(process.pid));setTimeout(()=>process.exit(3),1000);`,{mode:0o700});
  await writeFile(f.browser,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.env.PROOF,JSON.stringify({server:process.env.PULSE_SERVER,browserPid:process.pid,pid:Number(fs.readFileSync(process.env.PULSE_SERVER.slice(5)+'.ready'))}));setInterval(()=>{},1000);`,{mode:0o700});
  assert.equal(await runWithFirefoxAudio(['--project=firefox'],{env:{...hosted,PROOF:proof},platform:'linux',pulseCommand:f.pulse,pactlCommand:f.pactl,browserCommand:f.browser,browserArgs:[]}),1);
  const data=JSON.parse(await readFile(proof,'utf8'));
  for(const pid of [data.pid,data.browserPid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  await assert.rejects(readFile(data.server.slice(5)+'.ready'),{code:'ENOENT'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('ordinary browser execution preserves its status without launching audio',async()=>{
 assert.equal(await runWithFirefoxAudio(['--project=chromium'],{env:{},platform:'darwin',browserCommand:process.execPath,browserArgs:['-e','process.exit(4)'],pulseCommand:'/must-not-run'}),4);
});
